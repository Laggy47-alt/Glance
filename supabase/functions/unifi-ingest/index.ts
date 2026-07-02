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

function imageKind(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  const head = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (head === "RIFF" && webp === "WEBP") return "webp";
  return null;
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

  // Site lookup + ensure camera row exists (so /cameras page can list it)
  let siteId: string | null = null;
  let siteName: string | null = null;
  if (cameraId) {
    const { data: camAssign } = await supabase
      .from("unifi_camera_sites")
      .select("site_id, unifi_sites(name)")
      .eq("unifi_instance_id", inst.id)
      .eq("camera_id", cameraId)
      .maybeSingle();
    if (camAssign) {
      siteId = (camAssign as any).site_id ?? null;
      siteName = ((camAssign as any).unifi_sites?.name as string | undefined) ?? null;
      // keep camera_name fresh
      await supabase.from("unifi_camera_sites")
        .update({ camera_name: cameraName })
        .eq("unifi_instance_id", inst.id).eq("camera_id", cameraId);
    } else {
      await supabase.from("unifi_camera_sites").insert({
        organization_id: inst.organization_id,
        unifi_instance_id: inst.id,
        camera_id: cameraId,
        camera_name: cameraName,
      });
    }
  }

  // Optional snapshot
  let thumbnailPath: string | null = null;
  if (typeof ev.thumbnail_b64 === "string" && ev.thumbnail_b64.length > 0) {
    try {
      const bytes = decodeBase64(ev.thumbnail_b64);
      const kind = imageKind(bytes);
      console.log("unifi-ingest visual received", JSON.stringify({ instance_id: inst.id, remote_event_id: remoteId, bytes: bytes.length, kind, visual_retry: isVisualRetry }));
      const path = `${inst.organization_id}/unifi/${inst.id}/${cameraId ?? "unknown"}/${startMs}.jpg`;
      const { error: upErr } = await supabase.storage.from("camera-snapshots").upload(path, bytes, {
        contentType: "image/jpeg",
        upsert: true,
      });
      if (!upErr) thumbnailPath = path;
      else console.log("unifi-ingest visual upload failed", JSON.stringify({ instance_id: inst.id, remote_event_id: remoteId, message: upErr.message }));
    } catch (e) {
      console.log("unifi-ingest visual decode failed", JSON.stringify({ instance_id: inst.id, remote_event_id: remoteId, message: e instanceof Error ? e.message : String(e) }));
    }
  }

  // Optional MP4 clip
  let clipPath: string | null = null;
  let clipUrl: string | null = null;
  if (typeof ev.clip_b64 === "string" && ev.clip_b64.length > 0) {
    try {
      const bytes = decodeBase64(ev.clip_b64);
      const path = `${inst.organization_id}/unifi/${inst.id}/${cameraId ?? "unknown"}/${startMs}.mp4`;
      const { error: upErr } = await supabase.storage.from("camera-snapshots").upload(path, bytes, {
        contentType: "video/mp4",
        upsert: true,
      });
      if (!upErr) {
        clipPath = path;
        const { data: pub } = supabase.storage.from("camera-snapshots").getPublicUrl(path);
        clipUrl = pub?.publicUrl ?? null;
        console.log("unifi-ingest clip saved", JSON.stringify({ instance_id: inst.id, remote_event_id: remoteId, bytes: bytes.length }));
      } else {
        console.log("unifi-ingest clip upload failed", JSON.stringify({ message: upErr.message }));
      }
    } catch (e) {
      console.log("unifi-ingest clip decode failed", JSON.stringify({ message: e instanceof Error ? e.message : String(e) }));
    }
  }

  // Upsert typed row
  const eventRow: Record<string, unknown> = {
    organization_id: inst.organization_id,
    instance_id: inst.id,
    remote_event_id: remoteId,
    camera_id: cameraId,
    camera_name: cameraName,
    event_type: eventType,
    smart_types: smartTypes,
    start_at: startIso,
    end_at: endIso,
    score,
    raw: ev,
    site_id: siteId,
  };
  if (thumbnailPath) eventRow.thumbnail_path = thumbnailPath;
  if (clipPath) eventRow.clip_path = clipPath;
  const { error: upErr } = await supabase
    .from("unifi_events")
    .upsert(eventRow, { onConflict: "instance_id,remote_event_id" });
  if (upErr) return json({ error: "insert failed", detail: upErr.message }, 500);

  // Prefer the site name as the display "camera source"; fall back to NVR name.
  const displaySite = siteName || inst.name;

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
      site_id: siteId,
      site_name: displaySite,
      clip_url: clipUrl,
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

    // Locate an existing media row for this event (by remoteId) so both
    // thumbnail retries and clip uploads update it instead of duplicating.
    let existingMediaId: string | null = null;
    if (remoteId) {
      const { data: existingMedia } = await supabase
        .from("media_items")
        .select("id")
        .eq("source_id", inst.source_id)
        .eq("instance_id", inst.id)
        .eq("camera", cameraName)
        .gte("ts", new Date(startMs - 2000).toISOString())
        .lte("ts", new Date(startMs + 2000).toISOString())
        .maybeSingle();
      existingMediaId = existingMedia?.id ?? null;
    }

    if (thumbnailPath || clipUrl) {
      const { data: pub } = thumbnailPath
        ? supabase.storage.from("camera-snapshots").getPublicUrl(thumbnailPath)
        : { data: null } as { data: { publicUrl?: string } | null };
      const snapshotUrl = pub?.publicUrl ?? null;

      const mediaRow: Record<string, unknown> = {
        organization_id: inst.organization_id,
        source_id: inst.source_id,
        event_id: existingWebhookId,
        kind: clipUrl ? "clip" : "snapshot",
        url: snapshotUrl ?? clipUrl ?? "",
        camera: cameraName,
        topic: eventType,
        ts: startIso,
        instance_id: inst.id,
      };
      if (clipUrl) (mediaRow as any).clip_url = clipUrl;

      if (existingMediaId) {
        const patch: Record<string, unknown> = { camera: cameraName, topic: eventType, event_id: existingWebhookId };
        if (snapshotUrl) { patch.url = snapshotUrl; patch.kind = "snapshot"; }
        if (clipUrl) { patch.clip_url = clipUrl; if (!snapshotUrl) patch.kind = "clip"; }
        const { error: mediaErr } = await supabase.from("media_items").update(patch).eq("id", existingMediaId);
        if (mediaErr) console.log("unifi-ingest media update failed", JSON.stringify({ message: mediaErr.message }));
      } else {
        const { error: mediaErr } = await supabase.from("media_items").insert(mediaRow);
        if (mediaErr) console.log("unifi-ingest media insert failed", JSON.stringify({ message: mediaErr.message }));
      }
      console.log("unifi-ingest media saved", JSON.stringify({ instance_id: inst.id, remote_event_id: remoteId, snapshot: !!snapshotUrl, clip: !!clipUrl }));
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
