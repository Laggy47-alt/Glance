// Polls each enabled Frigate instance for new events and review items.
// Runs on a schedule (pg_cron) or on demand via POST. Idempotent via frigate_event_id.
// MULTI-TENANT: every row written carries organization_id from the source frigate_instance.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { frigateAuthHeaders, invalidateFrigateToken, type FrigateAuthRow } from "../_shared/frigateAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

type FrigateInstance = FrigateAuthRow & {
  source_id: string;
  organization_id: string;
  name: string;
  enabled: boolean;
  poll_enabled: boolean;
  last_event_ts: string | null;
};

type FrigateEvent = {
  id: string;
  camera: string;
  label: string;
  start_time: number;
  end_time: number | null;
  top_score?: number;
  score?: number;
  has_clip?: boolean;
  has_snapshot?: boolean;
  sub_label?: string | null;
};

type FrigateReview = {
  id: string;
  camera: string;
  start_time: number;
  end_time: number | null;
  severity: string;
  thumb_path?: string;
  data?: { detections?: string[]; objects?: string[]; sub_labels?: string[]; zones?: string[] };
};

function trimUrl(u: string) { return u.replace(/\/+$/, ""); }

async function fetchWithTimeout(url: string, headers: Record<string, string>, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonAuthed<T>(
  supabase: any,
  inst: FrigateInstance,
  url: string,
): Promise<T> {
  const doFetch = async (force: boolean) => {
    const auth = await frigateAuthHeaders(supabase, inst, force);
    return fetchWithTimeout(url, { Accept: "application/json", ...auth });
  };
  let r = await doFetch(false);
  if (r.status === 401 && inst.auth_username && inst.auth_password) {
    await invalidateFrigateToken(supabase, inst.id);
    inst.auth_token_cache = null;
    inst.auth_token_expires_at = null;
    await r.body?.cancel().catch(() => undefined);
    r = await doFetch(true);
  }
  try {
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`${r.status} ${r.statusText} @ ${url}${body ? ` — ${body.slice(0, 250)}` : ""}`);
    }
    return await r.json() as T;
  } finally {
    // Deno/Supabase Edge keeps sockets/file handles open until the response
    // stream is fully released. Be defensive so failed/partial reads don't
    // accumulate fetchResponse resources under heavy cron polling.
    await r.body?.cancel().catch(() => undefined);
  }
}

function proxyUrl(instanceId: string, path: string) {
  return `/${instanceId}${path.startsWith("/") ? path : "/" + path}`;
}

// Maximum age of a Frigate event we will ingest. Generous enough to cover
// poll-interval jitter and brief poller outages, but small enough that a
// freshly-enabled instance does not backfill days of history. The Wall
// applies its own mount-time floor so reloads still ignore older rows.
const MAX_EVENT_AGE_MS = 5 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const url = new URL(req.url);
  const onlyId = url.searchParams.get("instance_id");

  let q = supabase
    .from("frigate_instances")
    .select(`id, source_id, organization_id, name, enabled, poll_enabled, last_event_ts, base_url, api_key, auth_username, auth_password, auth_token_cache, auth_token_expires_at`)
    .eq("enabled", true)
    .eq("poll_enabled", true);
  if (onlyId) q = q.eq("id", onlyId);

  const { data: instances, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const inst of (instances ?? []) as FrigateInstance[]) {
    const lock = await acquireInstanceLock(supabase, inst.id);
    if (!lock) {
      results.push({ instance: inst.name, skipped: "poll already running" });
      continue;
    }
    try {
      const r = await pollOne(supabase, inst);
      results.push({ instance: inst.name, ...r });
    } catch (e) {
      const msg = (e as Error).message;
      results.push({ instance: inst.name, error: msg });
      await supabase.from("frigate_instances")
        .update({ last_error: msg, last_polled_at: new Date().toISOString() })
        .eq("id", inst.id);
    } finally {
      await releaseInstanceLock(supabase, inst.id);
    }
  }

  return json({ ok: true, polled: results.length, results });
});

async function acquireInstanceLock(supabase: any, instanceId: string) {
  const now = new Date().toISOString();
  const lockedUntil = new Date(Date.now() + 55_000).toISOString();
  const { data, error } = await supabase
    .from("frigate_instances")
    .update({ poll_locked_until: lockedUntil })
    .eq("id", instanceId)
    .or(`poll_locked_until.is.null,poll_locked_until.lt.${now}`)
    .select("id")
    .maybeSingle();

  if (error) {
    // Older self-hosted databases may not have the lock column yet. Keep the
    // poller working, but deploy the matching migration to prevent overlap.
    if (String(error.message ?? "").includes("poll_locked_until")) return true;
    throw error;
  }
  return Boolean(data);
}

async function releaseInstanceLock(supabase: any, instanceId: string) {
  await supabase
    .from("frigate_instances")
    .update({ poll_locked_until: null })
    .eq("id", instanceId);
}

async function pollOne(supabase: any, inst: FrigateInstance) {
  const base = trimUrl(inst.base_url);
  // Live wall ingestion is intentionally NOT a catch-up job. Every poll only
  // accepts events that started in the last 5 seconds so page reloads or stale
  // cursors can never back-fill old NVR history into the shared operator wall.
  // Catch-up window: bound by MAX_EVENT_AGE_MS so a long outage doesn't
  // drag in days of history, but wide enough that normal poll jitter never
  // drops a real event.
  const nowMs = Date.now();
  const maxAgeStartMs = nowMs - MAX_EVENT_AGE_MS;
  const cursorMs = inst.last_event_ts ? new Date(inst.last_event_ts).getTime() : null;
  const sinceMs = cursorMs ? Math.max(cursorMs, maxAgeStartMs) : maxAgeStartMs;
  const windowStartMs = maxAgeStartMs;
  const sinceSec = Math.floor(sinceMs / 1000);
  const orgId = inst.organization_id;

  // Skip ingesting events for cameras that are currently disarmed
  // (set by the arm-scheduler based on the user's schedules).
  const { data: armedRows } = await supabase
    .from("camera_armed_state")
    .select("camera, armed")
    .eq("instance_id", inst.id);
  const disarmed = new Set<string>(
    (armedRows ?? []).filter((r: any) => r.armed === false).map((r: any) => r.camera as string),
  );

  const evUrl = `${base}/api/events?after=${sinceSec}&limit=100&include_thumbnails=0`;
  const events = await fetchJsonAuthed<FrigateEvent[]>(supabase, inst, evUrl);


  let insertedEvents = 0;
  let insertedMedia = 0;
  let maxStart = sinceMs;

  for (const ev of events) {
    const startMs = Math.floor((ev.start_time ?? 0) * 1000);
    if (startMs > maxStart) maxStart = startMs;
    if (startMs < windowStartMs) continue;
    // Skip disarmed cameras — still advance maxStart so we don't re-scan them.
    if (disarmed.has(ev.camera)) continue;
    const score = ev.top_score ?? ev.score ?? null;
    const topic = `frigate/${ev.camera}/${ev.label}`;


    const { data: inserted, error: insErr } = await supabase
      .from("webhook_events")
      .upsert({
        organization_id: orgId,
        source_id: inst.source_id,
        topic,
        payload: ev as unknown as Record<string, unknown>,
        payload_text: null,
        headers: { "x-frigate-instance": inst.id },
        read: false,
        archived: false,
        ts: new Date(startMs).toISOString(),
        frigate_event_id: ev.id,
        label: ev.label,
        camera: ev.camera,
        score,
        kind: "event",
      }, { onConflict: "frigate_event_id", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();

    if (insErr) continue;
    if (!inserted) continue;
    insertedEvents++;

    const eventId = inserted.id as string;
    const mediaRows: Array<Record<string, unknown>> = [];
    // Always insert a snapshot row. Frigate exposes /thumbnail.jpg even when
    // has_snapshot=false (snapshot saving disabled in NVR config), so the Wall
    // tile still gets a still image. Prefer the full snapshot when available.
    mediaRows.push({
      organization_id: orgId,
      source_id: inst.source_id,
      event_id: eventId,
      instance_id: inst.id,
      kind: "snapshot",
      url: proxyUrl(
        inst.id,
        ev.has_snapshot
          ? `/api/events/${ev.id}/snapshot.jpg`
          : `/api/events/${ev.id}/thumbnail.jpg`,
      ),
      camera: ev.camera,
      topic,
      ts: new Date(startMs).toISOString(),
      frigate_event_id: ev.id,
    });
    if (ev.has_clip) {
      mediaRows.push({
        organization_id: orgId,
        source_id: inst.source_id,
        event_id: eventId,
        instance_id: inst.id,
        kind: "clip",
        url: proxyUrl(inst.id, `/api/events/${ev.id}/clip.mp4`),
        camera: ev.camera,
        topic,
        ts: new Date(startMs).toISOString(),
        frigate_event_id: ev.id,
      });
    }
    if (mediaRows.length) {
      await supabase.from("media_items").insert(mediaRows);
      insertedMedia += mediaRows.length;
    }
  }

  let insertedReviews = 0;
  try {
    const revUrl = `${base}/api/review?after=${sinceSec}&limit=100`;
    const reviews = await fetchJsonAuthed<FrigateReview[]>(supabase, inst, revUrl);
    for (const rv of reviews) {
      const startMs = Math.floor((rv.start_time ?? 0) * 1000);
      if (startMs > maxStart) maxStart = startMs;
      if (startMs < windowStartMs) continue;
      if (disarmed.has(rv.camera)) continue;

      const labels = rv.data?.objects?.join(",") ?? rv.data?.detections?.join(",") ?? null;
      const topic = `frigate/${rv.camera}/review/${rv.severity}`;
      const fid = `review-${rv.id}`;

      const { data: inserted } = await supabase
        .from("webhook_events")
        .upsert({
          organization_id: orgId,
          source_id: inst.source_id,
          topic,
          payload: rv as unknown as Record<string, unknown>,
          headers: { "x-frigate-instance": inst.id },
          read: false,
          archived: false,
          ts: new Date(startMs).toISOString(),
          frigate_event_id: fid,
          label: labels,
          camera: rv.camera,
          kind: rv.severity === "alert" ? "alert" : "review",
        }, { onConflict: "frigate_event_id", ignoreDuplicates: true })
        .select("id")
        .maybeSingle();

      if (inserted) insertedReviews++;
    }
  } catch (_) { /* review API not available */ }

  await supabase.from("frigate_instances")
    .update({
      last_polled_at: new Date().toISOString(),
      last_event_ts: new Date(maxStart).toISOString(),
      last_error: null,
    })
    .eq("id", inst.id);

  return { events: insertedEvents, reviews: insertedReviews, media: insertedMedia };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
