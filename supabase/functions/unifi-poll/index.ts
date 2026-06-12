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
  type?: string;
  start?: number; // ms epoch
  end?: number | null;
  camera?: string; // camera id
  score?: number;
  smartDetectTypes?: string[];
  smartDetectEvents?: string[];
};

type UnifiCamera = {
  id: string;
  name: string;
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
    .then((data) => (Array.isArray(data) ? data : (data?.cameras ?? [])) as UnifiCamera[])
    .catch(() => [] as UnifiCamera[]);
  const camName = new Map<string, string>();
  for (const c of cameras) camName.set(String(c.id), String(c.name ?? c.id));

  const evPath = `/proxy/protect/integration/v1/events?start=${sinceMs}&end=${nowMs}&limit=100`;
  const events = await unifiFetch(base, inst.api_key, evPath)
    .then((r) => r.json())
    .then((data) => (Array.isArray(data) ? data : ((data as any)?.events ?? [])) as UnifiEvent[]);

  let inserted = 0;
  let insertedMedia = 0;
  let maxStart = sinceMs;

  for (const ev of events) {
    const startMs = typeof ev.start === "number" ? ev.start : 0;
    if (startMs > maxStart) maxStart = startMs;
    if (!startMs || startMs < windowStartMs) continue;
    const cameraId = String(ev.camera ?? "");
    const cameraNameStr = camName.get(cameraId) || cameraId || "camera";
    if (disarmed.has(cameraNameStr)) continue;

    const evType = String(ev.type ?? "event");
    const topic = topicFor(evType, cameraNameStr);
    const score = typeof ev.score === "number" ? ev.score / 100 : null;
    const label = (ev.smartDetectTypes && ev.smartDetectTypes[0])
      || (ev.smartDetectEvents && ev.smartDetectEvents[0])
      || evType;
    const dedupeId = `unifi-${inst.id}-${ev.id}`;

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
          ts: new Date(startMs).toISOString(),
          frigate_event_id: dedupeId,
          label,
          camera: cameraNameStr,
          score,
          kind: kindFor(evType),
        }),
      });
    } catch (_) { continue; }

    const eventId = row?.[0]?.id;
    if (!eventId) continue; // duplicate
    inserted++;

    // Snapshot: try event-specific thumbnail, fall back to live camera snapshot.
    const tsParam = startMs ? `&ts=${startMs}` : "";
    const snapshotUrl = `/functions/v1/unifi-proxy/${inst.id}/proxy/protect/integration/v1/events/${encodeURIComponent(ev.id)}/thumbnail?highQuality=false${tsParam}`;
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
          camera: cameraNameStr,
          topic,
          ts: new Date(startMs).toISOString(),
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

  return { events: inserted, media: insertedMedia };
}
