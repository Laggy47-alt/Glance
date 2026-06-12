// Polls each enabled UniFi Protect (ENVR) instance for new events and bridges
// them into the SAME wall pipeline that Frigate uses (webhook_events + media_items).
// Each unifi_instance is paired with a webhook_sources row (auto-created lazily)
// so the existing wall, auto-read rules, and webhook UI all keep working unchanged.
// Idempotent via webhook_events.frigate_event_id with a "unifi-" prefix.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

type UnifiInstance = {
  id: string;
  organization_id: string;
  name: string;
  base_url: string;
  api_key: string;
  color: string;
  enabled: boolean;
  poll_enabled: boolean;
  source_id: string | null;
  last_event_ts: string | null;
};

type UnifiEvent = {
  id: string;
  item?: unknown;
  event?: unknown;
  modelKey?: string;
  action?: string;
  type?: string;
  start?: number; // ms epoch
  end?: number | null;
  timestamp?: number;
  camera?: string | { id?: string; name?: string }; // camera id or expanded camera
  cameraId?: string;
  cameraName?: string;
  score?: number;
  thumbnail?: string;
  thumb?: string;
  smartDetectTypes?: string[];
  smartDetectEvents?: string[];
};

type UnifiCamera = {
  id: string;
  name: string;
};

type NormalizedUnifiEvent = {
  id: string;
  cameraId: string;
  cameraName: string;
  eventType: string;
  smartTypes: string[];
  startMs: number;
  endMs: number | null;
  score: number | null;
  raw: Record<string, unknown>;
};

const MAX_EVENT_AGE_MS = 5 * 60 * 1000;

function trimUrl(u: string) { return u.replace(/\/+$/, ""); }

async function unifiFetch(base: string, apiKey: string, path: string, init?: RequestInit) {
  const url = `${base}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-API-KEY": apiKey,
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const r = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`${r.status} ${r.statusText} @ ${path}${body ? ` — ${body.slice(0, 200)}` : ""}`);
  }
  return r;
}

async function rest<T>(supabaseUrl: string, serviceKey: string, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: (init?.headers as any)?.["Prefer"] ?? "return=representation",
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`PostgREST ${r.status} ${path} — ${body.slice(0, 200)}`);
  }
  if (r.status === 204) return undefined as unknown as T;
  return r.json() as Promise<T>;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function topicFor(evType: string, cameraName: string) {
  return `unifi/${cameraName}/${evType || "event"}`;
}

function kindFor(evType: string): string {
  if (!evType) return "event";
  const t = evType.toLowerCase();
  if (t.includes("smart") || t.includes("ring") || t.includes("alarm")) return "alert";
  return "event";
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unifi";
}

function asArray<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  const obj = data as Record<string, unknown> | null;
  if (Array.isArray(obj?.[key])) return obj[key] as T[];
  if (Array.isArray(obj?.data)) return obj.data as T[];
  return [];
}

function parseTimeMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? Math.floor(value * 1000) : Math.floor(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n < 10_000_000_000 ? Math.floor(n * 1000) : Math.floor(n);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeEvent(input: UnifiEvent, camName: Map<string, string>): NormalizedUnifiEvent | null {
  const wrapped = input as Record<string, unknown>;
  const candidate = (wrapped.item && typeof wrapped.item === "object")
    ? wrapped.item
    : (wrapped.event && typeof wrapped.event === "object")
      ? wrapped.event
      : input;
  const ev = candidate as UnifiEvent & Record<string, unknown>;
  if (!ev || typeof ev !== "object") return null;

  const id = ev.id ?? ev.eventId ?? ev._id;
  if (!id) return null;

  const cameraObj = ev.camera && typeof ev.camera === "object" ? ev.camera as { id?: string; name?: string } : null;
  const cameraId = String(cameraObj?.id ?? ev.cameraId ?? (typeof ev.camera === "string" ? ev.camera : "") ?? "");
  const cameraName = String(cameraObj?.name ?? ev.cameraName ?? camName.get(cameraId) ?? cameraId || "camera");
  const smartTypes = Array.from(new Set([
    ...(Array.isArray(ev.smartDetectTypes) ? ev.smartDetectTypes.map(String) : []),
    ...(Array.isArray(ev.smartDetectEvents) ? ev.smartDetectEvents.map(String) : []),
  ]));
  const eventType = String(ev.type ?? ev.eventType ?? ev.modelKey ?? "event");
  const startMs = parseTimeMs(ev.start ?? ev.timestamp ?? ev.createdAt) ?? Date.now();
  const endMs = parseTimeMs(ev.end);
  const score = typeof ev.score === "number" ? ev.score : null;

  return {
    id: String(id),
    cameraId,
    cameraName,
    eventType,
    smartTypes,
    startMs,
    endMs,
    score,
    raw: ev as Record<string, unknown>,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "missing_env" }, 500);

  const url = new URL(req.url);
  const onlyId = url.searchParams.get("instance_id");

  let q = `unifi_instances?select=id,organization_id,name,base_url,api_key,color,enabled,poll_enabled,source_id,last_event_ts&enabled=eq.true&poll_enabled=eq.true`;
  if (onlyId) q += `&id=eq.${encodeURIComponent(onlyId)}`;

  let instances: UnifiInstance[] = [];
  try {
    instances = await rest<UnifiInstance[]>(supabaseUrl, serviceKey, q);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }

  const results: Array<Record<string, unknown>> = [];
  for (const inst of instances) {
    try {
      const r = await pollOne(supabaseUrl, serviceKey, inst);
      results.push({ instance: inst.name, ...r });
    } catch (e) {
      const msg = (e as Error).message;
      results.push({ instance: inst.name, error: msg });
      try {
        await rest(supabaseUrl, serviceKey, `unifi_instances?id=eq.${inst.id}`, {
          method: "PATCH",
          body: JSON.stringify({ last_error: msg, last_polled_at: new Date().toISOString() }),
        });
      } catch { /* ignore */ }
    }
  }

  return json({ ok: true, polled: results.length, results });
});

async function ensureSource(supabaseUrl: string, serviceKey: string, inst: UnifiInstance): Promise<string> {
  if (inst.source_id) return inst.source_id;
  // Create a paired webhook_source so the wall, auto-read rules, etc.
  // can treat this NVR like any other webhook source.
  const slug = `unifi-${slugify(inst.name)}-${crypto.randomUUID().slice(0, 6)}`;
  const created = await rest<Array<{ id: string }>>(supabaseUrl, serviceKey, `webhook_sources`, {
    method: "POST",
    body: JSON.stringify({
      name: `UniFi · ${inst.name}`,
      slug,
      secret: crypto.randomUUID(),
      color: inst.color,
      enabled: true,
      organization_id: inst.organization_id,
    }),
  });
  const sourceId = created?.[0]?.id;
  if (!sourceId) throw new Error("failed to create paired webhook_source");
  await rest(supabaseUrl, serviceKey, `unifi_instances?id=eq.${inst.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ source_id: sourceId }),
  });
  return sourceId;
}

async function pollOne(supabaseUrl: string, serviceKey: string, inst: UnifiInstance) {
  const base = trimUrl(inst.base_url);
  const sourceId = await ensureSource(supabaseUrl, serviceKey, inst);

  // Catch-up window bounded so a long outage can't drag in days of history.
  const nowMs = Date.now();
  const maxAgeStartMs = nowMs - MAX_EVENT_AGE_MS;
  const cursorMs = inst.last_event_ts ? new Date(inst.last_event_ts).getTime() : null;
  const sinceMs = cursorMs ? Math.max(cursorMs, maxAgeStartMs) : maxAgeStartMs;
  const windowStartMs = maxAgeStartMs;

  // Skip disarmed cameras (managed by arm-scheduler, same as Frigate path).
  const armedRows = await rest<Array<{ camera: string; armed: boolean }>>(
    supabaseUrl,
    serviceKey,
    `camera_armed_state?select=camera,armed&instance_id=eq.${inst.id}`,
  ).catch(() => []);
  const disarmed = new Set<string>(
    (armedRows ?? []).filter((r) => r.armed === false).map((r) => r.camera),
  );

  // Map camera id → name for nicer topics and offline checks.
  const cameras = await unifiFetch(base, inst.api_key, "/proxy/protect/integration/v1/cameras")
    .then((r) => r.json())
    .then((data) => asArray<UnifiCamera>(data, "cameras"))
    .catch(() => [] as UnifiCamera[]);
  const camName = new Map<string, string>();
  for (const c of cameras) camName.set(String(c.id), String(c.name ?? c.id));

  const evPath = `/proxy/protect/integration/v1/events?start=${sinceMs}&end=${nowMs}&limit=100`;
  const rawEvents = await unifiFetch(base, inst.api_key, evPath)
    .then((r) => r.json())
    .then((data) => asArray<UnifiEvent>(data, "events"));

  let inserted = 0;
  let insertedAlerts = 0;
  let insertedMedia = 0;
  let maxStart = sinceMs;
  let skippedOld = 0;
  let skippedDisarmed = 0;
  let skippedInvalid = 0;

  for (const rawEv of rawEvents) {
    const ev = normalizeEvent(rawEv, camName);
    if (!ev) { skippedInvalid++; continue; }
    if (ev.startMs > maxStart) maxStart = ev.startMs;
    if (!ev.startMs || ev.startMs < windowStartMs) { skippedOld++; continue; }
    if (disarmed.has(ev.cameraName)) { skippedDisarmed++; continue; }

    const topic = topicFor(ev.eventType, ev.cameraName);
    const score = typeof ev.score === "number" ? (ev.score > 1 ? ev.score / 100 : ev.score) : null;
    const label = ev.smartTypes[0] || ev.eventType;
    const dedupeId = `unifi-${inst.id}-${ev.id}`;

    await rest(supabaseUrl, serviceKey, `unifi_events?on_conflict=instance_id,remote_event_id`, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({
        organization_id: inst.organization_id,
        instance_id: inst.id,
        remote_event_id: ev.id,
        camera_id: ev.cameraId || "unknown",
        camera_name: ev.cameraName,
        event_type: ev.eventType,
        smart_types: ev.smartTypes.length ? ev.smartTypes : null,
        start_at: new Date(ev.startMs).toISOString(),
        end_at: ev.endMs ? new Date(ev.endMs).toISOString() : null,
        score: typeof ev.score === "number" ? Math.round(ev.score) : null,
        thumbnail_path: String(ev.raw.thumbnail ?? ev.raw.thumb ?? "") || null,
        raw: ev.raw,
      }),
    }).then((rows: any) => { if (Array.isArray(rows) && rows[0]?.id) insertedAlerts++; }).catch(() => null);

    let row: Array<{ id: string }> = [];
    try {
      row = await rest<Array<{ id: string }>>(supabaseUrl, serviceKey, `webhook_events?on_conflict=frigate_event_id`, {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify({
          organization_id: inst.organization_id,
          source_id: sourceId,
          topic,
          payload: ev,
          headers: { "x-unifi-instance": inst.id },
          read: false,
          archived: false,
          ts: new Date(ev.startMs).toISOString(),
          frigate_event_id: dedupeId,
          label,
          camera: ev.cameraName,
          score,
          kind: kindFor(ev.eventType),
        }),
      });
    } catch (_) { continue; }

    const eventId = row?.[0]?.id;
    if (!eventId) continue; // duplicate
    inserted++;

    // Snapshot: try event-specific thumbnail, fall back to live camera snapshot.
    const tsParam = ev.startMs ? `&ts=${ev.startMs}` : "";
    const snapshotUrl = `${supabaseUrl}/functions/v1/unifi-proxy/${inst.id}/proxy/protect/integration/v1/events/${encodeURIComponent(ev.id)}/thumbnail?highQuality=false${tsParam}`;
    try {
      await rest(supabaseUrl, serviceKey, `media_items`, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{
          organization_id: inst.organization_id,
          source_id: sourceId,
          event_id: eventId,
          instance_id: inst.id,
          kind: "snapshot",
          url: snapshotUrl,
          camera: ev.cameraName,
          topic,
          ts: new Date(ev.startMs).toISOString(),
          frigate_event_id: dedupeId,
        }]),
      });
      insertedMedia++;
    } catch { /* ignore media insert error */ }
  }

  await rest(supabaseUrl, serviceKey, `unifi_instances?id=eq.${inst.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      last_polled_at: new Date().toISOString(),
      last_event_ts: new Date(maxStart).toISOString(),
      last_seen_at: new Date().toISOString(),
      last_error: null,
    }),
  });

  return { scanned: rawEvents.length, alerts: insertedAlerts, wall: inserted, media: insertedMedia, skipped_old: skippedOld, skipped_disarmed: skippedDisarmed, skipped_invalid: skippedInvalid };
}
