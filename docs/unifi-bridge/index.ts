// Unifi Protect → Supabase bridge.
// Maintains one websocket per enabled row in `public.unifi_instances`
// and inserts events into `public.unifi_events` via PostgREST using the
// service-role key. No npm deps — works on any Deno version.
//
// Required env:
//   SUPABASE_URL              e.g. https://supabase.abcglance.co.za
//   SUPABASE_SERVICE_ROLE_KEY service role key
//
// Optional env:
//   POLL_INSTANCES_MS         default 30000
//   LOG_LEVEL                 debug | info | warn | error (default info)
//
// Run: deno run --allow-net --allow-env index.ts

type UnifiInstance = {
  id: string;
  organization_id: string;
  name: string;
  base_url: string;
  api_key: string;
  enabled: boolean;
  verify_tls: boolean;
};

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const POLL_MS = Number(Deno.env.get("POLL_INSTANCES_MS") ?? 30_000);
const LOG_LEVEL = (Deno.env.get("LOG_LEVEL") ?? "info").toLowerCase();

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[bridge] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  Deno.exit(1);
}

const LEVELS = ["debug", "info", "warn", "error"];
const minLevel = Math.max(0, LEVELS.indexOf(LOG_LEVEL));
const log = (lvl: string, ...args: unknown[]) => {
  if (LEVELS.indexOf(lvl) >= minLevel) console.log(`[${lvl}]`, ...args);
};

const REST = `${SUPABASE_URL}/rest/v1`;
const restHeaders = (extra: Record<string, string> = {}) => ({
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  ...extra,
});

async function listInstances(): Promise<UnifiInstance[]> {
  const r = await fetch(
    `${REST}/unifi_instances?select=id,organization_id,name,base_url,api_key,enabled,verify_tls`,
    { headers: restHeaders() },
  );
  if (!r.ok) {
    log("error", "list instances HTTP", r.status, await r.text());
    return [];
  }
  return (await r.json()) as UnifiInstance[];
}

async function upsertEvent(inst: UnifiInstance, payload: any) {
  const item = payload?.item ?? payload?.event ?? payload;
  if (!item || typeof item !== "object") return;
  const remoteId = item.id ?? item.eventId ?? item._id ?? null;
  if (!remoteId) return;

  const cameraObj = item.camera && typeof item.camera === "object" ? item.camera : null;
  const row = {
    organization_id: inst.organization_id,
    instance_id: inst.id,
    remote_event_id: String(remoteId),
    camera_id: cameraObj?.id ?? item.cameraId ?? (typeof item.camera === "string" ? item.camera : null),
    camera_name: cameraObj?.name ?? item.cameraName ?? null,
    event_type: item.type ?? item.eventType ?? "motion",
    smart_types: Array.isArray(item.smartDetectTypes) ? item.smartDetectTypes : null,
    start_at: item.start ? new Date(item.start).toISOString() : new Date().toISOString(),
    end_at: item.end ? new Date(item.end).toISOString() : null,
    score: typeof item.score === "number" ? Math.round(item.score) : null,
    thumbnail_path: item.thumbnail ?? item.thumb ?? null,
    raw: item,
  };

  const r = await fetch(`${REST}/unifi_events?on_conflict=instance_id,remote_event_id`, {
    method: "POST",
    headers: restHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    log("warn", "upsert failed", inst.name, r.status, await r.text());
  } else {
    log("debug", "ingested", inst.name, row.event_type, remoteId);
  }
}

type Conn = {
  instance: UnifiInstance;
  ws: WebSocket | null;
  closing: boolean;
  retryAt: number;
  retryDelay: number;
};
const connections = new Map<string, Conn>();

function wsUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/proxy/protect/integration/v1/subscribe/events";
  return u.toString();
}

function openConnection(inst: UnifiInstance) {
  let conn = connections.get(inst.id);
  if (!conn) {
    conn = { instance: inst, ws: null, closing: false, retryAt: 0, retryDelay: 1000 };
    connections.set(inst.id, conn);
  } else {
    conn.instance = inst;
  }
  if (conn.ws && conn.ws.readyState === WebSocket.OPEN) return;
  if (Date.now() < conn.retryAt) return;

  const url = `${wsUrl(inst.base_url)}?apiKey=${encodeURIComponent(inst.api_key)}`;
  log("info", `connecting ${inst.name} (${inst.base_url})`);

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    log("warn", `ws construct failed for ${inst.name}:`, (e as Error).message);
    scheduleRetry(conn);
    return;
  }
  conn.ws = ws;

  ws.onopen = () => { log("info", `connected ${inst.name}`); conn!.retryDelay = 1000; };
  ws.onmessage = async (ev) => {
    let parsed: any = null;
    try {
      const text = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
      parsed = JSON.parse(text);
    } catch { return; }
    if (Array.isArray(parsed)) for (const p of parsed) await upsertEvent(inst, p);
    else await upsertEvent(inst, parsed);
  };
  ws.onerror = (ev) => log("warn", `ws error ${inst.name}:`, (ev as ErrorEvent).message ?? "error");
  ws.onclose = (ev) => {
    log("info", `closed ${inst.name} code=${ev.code} reason=${ev.reason || "-"}`);
    conn!.ws = null;
    if (!conn!.closing) scheduleRetry(conn!);
  };
}

function scheduleRetry(conn: Conn) {
  conn.retryDelay = Math.min(conn.retryDelay * 2, 60_000);
  conn.retryAt = Date.now() + conn.retryDelay;
  log("debug", `retry ${conn.instance.name} in ${conn.retryDelay}ms`);
}

function closeConnection(id: string) {
  const conn = connections.get(id);
  if (!conn) return;
  conn.closing = true;
  try { conn.ws?.close(); } catch { /* ignore */ }
  connections.delete(id);
  log("info", `dropped ${conn.instance.name}`);
}

async function tick() {
  const all = await listInstances();
  const enabled = all.filter((r) => r.enabled && r.api_key && r.base_url);
  const wantIds = new Set(enabled.map((r) => r.id));

  for (const id of connections.keys()) {
    if (!wantIds.has(id)) closeConnection(id);
  }
  for (const inst of enabled) openConnection(inst);
  for (const conn of connections.values()) {
    if (!conn.ws && Date.now() >= conn.retryAt) openConnection(conn.instance);
  }
}

log("info", "unifi-bridge starting");
await tick();
setInterval(tick, POLL_MS);
