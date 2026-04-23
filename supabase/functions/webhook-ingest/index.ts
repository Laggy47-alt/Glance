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
      .select("id, name, slug, secret, enabled")
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

    let topic = queryTopic ?? headerTopic ?? "";
    if (!topic && payload && typeof payload === "object" && !Array.isArray(payload)) {
      const rec = payload as Record<string, unknown>;
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

    const { data: ev, error: evErr } = await supabase
      .from("webhook_events")
      .insert({
        source_id: source.id,
        topic,
        payload: payloadJson,
        payload_text: payloadText,
        headers,
        read: matched,
        archived: matched,
      })
      .select("id")
      .single();

    if (evErr) return json({ error: evErr.message }, 500);

    const media = extractMedia(topic, payload, source.name);
    if (media.length) {
      await supabase.from("media_items").insert(
        media.map((m) => ({
          source_id: source.id,
          event_id: ev.id,
          kind: m.kind,
          url: m.url,
          camera: m.camera,
          topic,
        })),
      );
    }

    return json({ ok: true, event_id: ev.id, media: media.length, auto_read: matched });
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
