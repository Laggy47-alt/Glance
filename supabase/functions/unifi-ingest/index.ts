// UniFi Protect ingest — receives events from the on-site bridge
// (scripts/unifi-bridge) and mirrors them into webhook_events + media_items
// so the Live Wall, Media page, WhatsApp alerts and daily reports surface
// them via the same pipelines as Frigate / Hikvision.
//
// Request: POST /functions/v1/unifi-ingest
//   Headers:  X-Webhook-Secret: <unifi_instances.webhook_secret>
//   Body (JSON):
//     {
//       "instance_id": "<uuid>",
//       "event": {
//         "id": "<protect event id>",
//         "type": "motion" | "smartDetectZone" | "smartDetectLine" | "ring" | ...,
//         "smartDetectTypes": ["person","vehicle"],
//         "camera_id": "<mac or id>",
//         "camera_name": "Front Door",
//         "start": 1730000000000,
//         "end":   1730000004000,
//         "score": 87,
//         "thumbnail_b64": "<optional base64 jpeg>"
//       }
//     }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const secret = req.headers.get("x-webhook-secret") ?? "";
  if (!secret) return json({ error: "missing X-Webhook-Secret header" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const instanceId: string | undefined = body?.instance_id;
  const ev = body?.event;
  if (!instanceId || !ev || typeof ev !== "object") {
    return json({ error: "instance_id and event are required" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: inst, error: instErr } = await supabase
    .from("unifi_instances")
    .select("id, organization_id, webhook_secret, enabled, source_id, name, color")
    .eq("id", instanceId)
    .maybeSingle();
  if (instErr || !inst) return json({ error: "instance not found" }, 404);
  if (String(inst.webhook_secret) !== secret) return json({ error: "bad secret" }, 401);
  if (!inst.enabled) return json({ ok: true, skipped: "instance disabled" });

  const remoteId: string | null = ev.id ?? null;
  const eventType: string = ev.type ?? "unknown";
  const smartTypes: string[] = Array.isArray(ev.smartDetectTypes) ? ev.smartDetectTypes : [];
  const cameraId: string | null = ev.camera_id ?? null;
  const cameraName: string = ev.camera_name || `Camera ${cameraId ?? ""}`.trim() || "Unknown camera";
  const startMs: number = typeof ev.start === "number" ? ev.start : Date.now();
  const endMs: number | null = typeof ev.end === "number" ? ev.end : null;
  const score: number | null = typeof ev.score === "number" ? ev.score : null;
  const isVisualRetry = ev.visual_retry === true;
  const startIso = new Date(startMs).toISOString();
  const endIso = endMs ? new Date(endMs).toISOString() : null;

  // Optional snapshot
  let thumbnailPath: string | null = null;
  if (typeof ev.thumbnail_b64 === "string" && ev.thumbnail_b64.length > 0) {
    try {
      const bytes = decodeBase64(ev.thumbnail_b64);
      const path = `${inst.organization_id}/unifi/${inst.id}/${cameraId ?? "unknown"}/${startMs}.jpg`;
      const { error: upErr } = await supabase.storage.from("camera-snapshots").upload(path, bytes, {
        contentType: "image/jpeg",
        upsert: true,
      });
      if (!upErr) thumbnailPath = path;
    } catch { /* swallow — snapshot is best-effort */ }
  }

  // Upsert typed row
  const { error: upErr } = await supabase
    .from("unifi_events")
    .upsert({
      organization_id: inst.organization_id,
      instance_id: inst.id,
      remote_event_id: remoteId,
      camera_id: cameraId,
      camera_name: cameraName,
      event_type: eventType,
      smart_types: smartTypes,
      start_at: startIso,
      end_at: endIso,
      thumbnail_path: thumbnailPath,
      score,
      raw: ev,
    }, { onConflict: "instance_id,remote_event_id" });
  if (upErr) return json({ error: "insert failed", detail: upErr.message }, 500);

  // Mirror to webhook_events / media_items
  if (inst.source_id) {
    const label = smartTypes.length ? smartTypes.join(",") : eventType;
    let existingWebhookId: string | null = null;
    if (remoteId) {
      const { data: existingWebhook } = await supabase
        .from("webhook_events")
        .select("id")
        .eq("source_id", inst.source_id)
        .eq("kind", "unifi")
        .eq("payload->>remote_event_id", remoteId)
        .maybeSingle();
      existingWebhookId = existingWebhook?.id ?? null;
    }

    const webhookPayload = {
      event: eventType,
      smart_types: smartTypes,
      camera_id: cameraId,
      camera: cameraName,
      score,
      start: startIso,
      end: endIso,
      instance_id: inst.id,
      remote_event_id: remoteId,
      has_thumbnail: !!thumbnailPath,
    };

    if (existingWebhookId) {
      await supabase.from("webhook_events").update({
        payload: webhookPayload,
        camera: cameraName,
        label,
        topic: eventType,
      }).eq("id", existingWebhookId);
    } else if (!isVisualRetry || !remoteId) {
      const { data: insertedWebhook } = await supabase.from("webhook_events").insert({
        organization_id: inst.organization_id,
        source_id: inst.source_id,
        topic: eventType,
        payload: webhookPayload,
        payload_text: null,
        headers: {},
        camera: cameraName,
        label,
        kind: "unifi",
        ts: startIso,
      }).select("id").maybeSingle();
      existingWebhookId = insertedWebhook?.id ?? null;
    }

    if (thumbnailPath) {
      const { data: pub } = supabase.storage.from("camera-snapshots").getPublicUrl(thumbnailPath);
      if (pub?.publicUrl) {
        const mediaRow = {
          organization_id: inst.organization_id,
          source_id: inst.source_id,
          event_id: existingWebhookId,
          kind: "snapshot",
          url: pub.publicUrl,
          camera: cameraName,
          topic: eventType,
          ts: startIso,
          instance_id: inst.id,
        };

        const { data: existingMedia } = remoteId
          ? await supabase
            .from("media_items")
            .select("id")
            .eq("source_id", inst.source_id)
            .eq("kind", "snapshot")
            .eq("instance_id", inst.id)
            .eq("camera", cameraName)
            .gte("ts", new Date(startMs - 1000).toISOString())
            .lte("ts", new Date(startMs + 1000).toISOString())
            .maybeSingle()
          : { data: null } as { data: { id: string } | null };

        if (existingMedia?.id) {
          await supabase.from("media_items").update(mediaRow).eq("id", existingMedia.id);
        } else {
          await supabase.from("media_items").insert(mediaRow);
        }
      }
    }
  }

  // Bump heartbeat
  const nowIso = new Date().toISOString();
  await supabase.from("unifi_instances")
    .update({ last_seen_at: nowIso, last_event_ts: startIso })
    .eq("id", inst.id);
  await supabase.from("camera_status").upsert({
    instance_id: inst.id,
    organization_id: inst.organization_id,
    camera: cameraName,
    online: true,
    since: nowIso,
    last_checked: nowIso,
  }, { onConflict: "instance_id,camera" });
  await supabase.from("camera_offline_alerts").delete()
    .eq("instance_id", inst.id).eq("camera", cameraName);

  return json({ ok: true, event: eventType, camera: cameraName });
});
