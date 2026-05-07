// Public webhook ingest endpoint.
// URL: /functions/v1/webhook-ingest/<slug>
// Optional auth: header X-Webhook-Secret must match source.secret if set.
// Accepts JSON, text, or form bodies. Extracts media URLs and applies auto-read rules.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-webhook-secret, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const IMG_EXT = /\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i;
const VID_EXT = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;
const SNAPSHOT_KEYS = ["snapshot", "snapshot_url", "snapshotUrl", "image", "image_url", "imageUrl", "thumbnail", "thumb"];
const CLIP_KEYS = ["clip", "clip_url", "clipUrl", "video", "video_url", "videoUrl", "recording", "recording_url"];

function isUrl(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^https?:\/\//i.test(s) || s.startsWith("data:image") || s.startsWith("data:video");
}
function pick(obj: Record<string, unknown>, keys: string[]) {
  for (const k of keys) if (k in obj && isUrl(obj[k])) return obj[k] as string;
  return undefined;
}
function inferCamera(topic: string, fallback: string): string {
  const parts = topic.split("/").filter(Boolean);
  const known = ["cameras", "camera", "frigate", "cam", "ipcam", "unifi", "protect"];
  for (let i = 0; i < parts.length - 1; i++) {
    if (known.includes(parts[i].toLowerCase())) return parts[i + 1];
  }
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] ?? fallback;
}
function topicMatches(pattern: string, topic: string): boolean {
  const p = pattern.split("/");
  const t = topic.split("/");
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "#") return true;
    if (p[i] === "+") { if (t[i] === undefined) return false; continue; }
    if (p[i] !== t[i]) return false;
  }
  return p.length === t.length;
}

type MediaExtract = { kind: "snapshot" | "clip"; url: string; camera: string; thumbnail?: string };
function extractMedia(topic: string, payload: unknown, sourceName: string): MediaExtract[] {
  const out: MediaExtract[] = [];
  const camera = inferCamera(topic, sourceName);

  if (typeof payload === "string") {
    const t = payload.trim();
    if (IMG_EXT.test(t) && isUrl(t)) { out.push({ kind: "snapshot", url: t, camera }); return out; }
    if (VID_EXT.test(t) && isUrl(t)) { out.push({ kind: "clip", url: t, camera }); return out; }
    return out;
  }
  if (payload && typeof payload === "object") {
    const objs = Array.isArray(payload) ? payload : [payload];
    for (const o of objs) {
      if (!o || typeof o !== "object") continue;
      const rec = o as Record<string, unknown>;
      const snap = pick(rec, SNAPSHOT_KEYS);
      const clip = pick(rec, CLIP_KEYS);
      const cam = (typeof rec.camera === "string" && rec.camera) ||
                  (typeof rec.device === "string" && rec.device) ||
                  (typeof rec.name === "string" && rec.name) || camera;
      if (snap) out.push({ kind: "snapshot", url: snap, camera: cam });
      if (clip) out.push({ kind: "clip", url: clip, camera: cam, thumbnail: snap });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    // path: /webhook-ingest/<slug>
    const segs = url.pathname.split("/").filter(Boolean);
    const slug = segs[segs.length - 1];
    if (!slug || slug === "webhook-ingest") {
      return json({ error: "Missing source slug. Use /webhook-ingest/<slug>" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: source, error: srcErr } = await supabase
      .from("webhook_sources")
      .select("id, name, slug, secret, enabled, organization_id")
      .eq("slug", slug)
      .maybeSingle();

    if (srcErr) return json({ error: srcErr.message }, 500);
    if (!source) return json({ error: "Source not found" }, 404);
    if (!source.enabled) return json({ error: "Source disabled" }, 403);

    if (source.secret) {
      const provided = req.headers.get("x-webhook-secret") ?? url.searchParams.get("secret");
      if (provided !== source.secret) return json({ error: "Invalid secret" }, 401);
    }

    // Topic: from query param ?topic=, header X-Topic, JSON.topic, or empty
    const headerTopic = req.headers.get("x-topic") ?? undefined;
    const queryTopic = url.searchParams.get("topic") ?? undefined;

    const ct = req.headers.get("content-type") ?? "";
    let payload: unknown = null;
    let payloadText: string | null = null;
    const raw = await req.text();
    payloadText = raw;

    if (ct.includes("application/json") || (raw.trim().startsWith("{") || raw.trim().startsWith("["))) {
      try { payload = JSON.parse(raw); } catch { payload = raw; }
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(raw);
      payload = Object.fromEntries(params.entries());
    } else {
      payload = raw;
    }

    // Detect frigate-notify shape (flat JSON with event_id/camera/label, no topic field)
    const rec = (payload && typeof payload === "object" && !Array.isArray(payload))
      ? payload as Record<string, unknown>
      : null;
    const isFrigate = !!rec && (
      typeof rec.event_id === "string" || typeof rec.eventId === "string" ||
      (typeof rec.camera === "string" && (typeof rec.label === "string" || typeof rec.zones !== "undefined"))
    );

    let frigateMeta: { event_id: string | null; camera: string | null; label: string | null; score: number | null; kind: string } = {
      event_id: null, camera: null, label: null, score: null, kind: "event",
    };

    let topic = queryTopic ?? headerTopic ?? "";

    if (isFrigate && rec) {
      const camera = (typeof rec.camera === "string" && rec.camera) || null;
      const label = (typeof rec.label === "string" && rec.label) || null;
      const eid = (typeof rec.event_id === "string" && rec.event_id) ||
                  (typeof rec.eventId === "string" && rec.eventId) || null;
      const sevRaw = typeof rec.severity === "string" ? rec.severity.toLowerCase() : "";
      const kind = sevRaw === "alert" ? "alert" : sevRaw === "review" ? "review" : "event";
      const scoreRaw = rec.score ?? rec.top_score ?? rec.topScore;
      const score = typeof scoreRaw === "number" ? scoreRaw : (typeof scoreRaw === "string" && !isNaN(Number(scoreRaw)) ? Number(scoreRaw) : null);
      frigateMeta = { event_id: eid, camera, label, score, kind };

      if (!topic) {
        const parts = ["frigate", camera, kind === "alert" ? `review/alert` : label].filter(Boolean) as string[];
        topic = parts.join("/");
      }

      // Look up the Frigate instance paired with this source so we can rewrite media URLs through the proxy
      const { data: inst } = await supabase
        .from("frigate_instances")
        .select("id")
        .eq("source_id", source.id)
        .maybeSingle();

      if (inst && eid) {
        // If the payload references snapshot/clip via Frigate paths, rewrite as proxy paths
        for (const k of [...SNAPSHOT_KEYS, ...CLIP_KEYS]) {
          const v = rec[k];
          if (typeof v === "string" && v.includes(`/api/events/${eid}/`)) {
            const m = v.match(/\/api\/events\/[^/]+\/(snapshot\.jpg|clip\.mp4)/);
            if (m) rec[k] = `/${inst.id}/api/events/${eid}/${m[1]}`;
          }
        }
        // If neither snapshot/clip provided but we know the event_id, infer them
        if (!SNAPSHOT_KEYS.some((k) => typeof rec[k] === "string")) {
          rec.snapshot_url = `/${inst.id}/api/events/${eid}/snapshot.jpg`;
        }
        if (!CLIP_KEYS.some((k) => typeof rec[k] === "string") && rec.has_clip !== false) {
          rec.clip_url = `/${inst.id}/api/events/${eid}/clip.mp4`;
        }
      }
    }

    if (!topic && rec) {
      if (typeof rec.topic === "string") topic = rec.topic;
      else if (typeof rec.event === "string") topic = rec.event;
      else if (typeof rec.type === "string") topic = rec.type;
    }
    if (!topic) topic = source.slug;

    // Auto-read rule check
    const { data: rules } = await supabase
      .from("auto_read_rules")
      .select("pattern, source_id, enabled")
      .or(`source_id.eq.${source.id},source_id.is.null`)
      .eq("enabled", true);

    const matched = (rules ?? []).some((r) => topicMatches(r.pattern, topic));

    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { if (!["authorization", "x-webhook-secret", "cookie"].includes(k.toLowerCase())) headers[k] = v; });

    const payloadJson = (payload && typeof payload === "object") ? payload : { value: payload };

    const insertRow: Record<string, unknown> = {
      organization_id: (source as any).organization_id,
      source_id: source.id,
      topic,
      payload: payloadJson,
      payload_text: payloadText,
      headers,
      read: matched,
      archived: matched,
    };
    if (isFrigate) {
      insertRow.frigate_event_id = frigateMeta.event_id;
      insertRow.camera = frigateMeta.camera;
      insertRow.label = frigateMeta.label;
      insertRow.score = frigateMeta.score;
      insertRow.kind = frigateMeta.kind;
    }

    // Upsert on frigate_event_id when present so duplicate notifications dedupe
    let evId: string | null = null;
    if (isFrigate && frigateMeta.event_id) {
      const { data: ev, error: evErr } = await supabase
        .from("webhook_events")
        .upsert(insertRow, { onConflict: "frigate_event_id" })
        .select("id")
        .single();
      if (evErr) return json({ error: evErr.message }, 500);
      evId = ev.id;
    } else {
      const { data: ev, error: evErr } = await supabase
        .from("webhook_events")
        .insert(insertRow)
        .select("id")
        .single();
      if (evErr) return json({ error: evErr.message }, 500);
      evId = ev.id;
    }

    const media = extractMedia(topic, payload, source.name);
    if (media.length && evId) {
      // Look up instance once if Frigate (already loaded above? re-fetch lightweight)
      let instanceId: string | null = null;
      if (isFrigate) {
        const { data: inst } = await supabase
          .from("frigate_instances").select("id").eq("source_id", source.id).maybeSingle();
        instanceId = inst?.id ?? null;
      }
      await supabase.from("media_items").insert(
        media.map((m) => ({
          organization_id: (source as any).organization_id,
          source_id: source.id,
          event_id: evId,
          kind: m.kind,
          url: m.url,
          camera: m.camera ?? frigateMeta.camera,
          topic,
          instance_id: instanceId,
          frigate_event_id: frigateMeta.event_id,
        })),
      );
    }

    return json({ ok: true, event_id: evId, media: media.length, auto_read: matched, frigate: isFrigate });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
