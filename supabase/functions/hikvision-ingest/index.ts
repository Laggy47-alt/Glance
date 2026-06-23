// Hikvision ISAPI HTTP Host Notification ingest.
//
// URL: /functions/v1/hikvision-ingest/{instance_id}/{webhook_secret}
//
// Hikvision posts either:
//   - application/xml body with <EventNotificationAlert>...</EventNotificationAlert>
//   - multipart/form-data with one XML part + one or more image/jpeg parts
//
// We parse the XML for channelID, eventType, dateTime, targetType, store any
// JPEG snapshot in camera-snapshots/{org}/hikvision/{instance}/{channel}/{ts}.jpg,
// insert a hikvision_events row, and bump camera_status to online so the
// offline watcher doesn't false-fire.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function pickTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : null;
}

function pickTargets(xml: string): { primary: string | null; all: string[] } {
  // AcuSense: <DetectionRegionList><DetectionRegionEntry><detectionTarget>human</detectionTarget>
  // Newer firmware: <TargetType>human</TargetType> or <targetType>...
  const all = new Set<string>();
  const re = /<(?:detectionTarget|targetType|TargetType)>([^<]+)</gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const v = m[1].trim().toLowerCase();
    if (v && v !== "none") all.add(v);
  }
  const arr = Array.from(all);
  return { primary: arr[0] ?? null, all: arr };
}

async function parseRequest(req: Request): Promise<{ xml: string; image: Uint8Array | null }> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    let xml = "";
    let image: Uint8Array | null = null;
    for (const [, value] of form.entries()) {
      if (value instanceof File) {
        const t = value.type || "";
        if (t.includes("xml") || value.name?.endsWith(".xml")) {
          xml = await value.text();
        } else if (t.startsWith("image/") || value.name?.match(/\.(jpe?g|png)$/i)) {
          if (!image) image = new Uint8Array(await value.arrayBuffer());
        }
      } else if (typeof value === "string" && value.includes("<EventNotificationAlert")) {
        xml = value;
      }
    }
    return { xml, image };
  }
  // Plain XML body.
  return { xml: await req.text(), image: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const url = new URL(req.url);
  // Path: /hikvision-ingest/{instanceId}/{secret}
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("hikvision-ingest");
  const instanceId = idx >= 0 ? parts[idx + 1] : undefined;
  const secret = idx >= 0 ? parts[idx + 2] : undefined;
  if (!instanceId || !secret) {
    return new Response(JSON.stringify({ error: "missing instance_id or secret in URL" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: inst, error: instErr } = await supabase
    .from("hikvision_instances")
    .select("id, organization_id, webhook_secret, enabled")
    .eq("id", instanceId)
    .maybeSingle();
  if (instErr || !inst) {
    return new Response(JSON.stringify({ error: "instance not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (inst.webhook_secret !== secret) {
    return new Response(JSON.stringify({ error: "bad secret" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!inst.enabled) {
    return new Response(JSON.stringify({ ok: true, skipped: "instance disabled" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let xml = "", image: Uint8Array | null = null;
  try {
    const parsed = await parseRequest(req);
    xml = parsed.xml;
    image = parsed.image;
  } catch (e: any) {
    return new Response(JSON.stringify({ error: "parse failed", detail: String(e?.message ?? e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!xml) {
    return new Response(JSON.stringify({ error: "no XML payload" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const channelId = pickTag(xml, "channelID") ?? pickTag(xml, "dynChannelID") ?? "1";
  const eventType = pickTag(xml, "eventType") ?? "unknown";
  const eventState = pickTag(xml, "eventState"); // "active" | "inactive"
  const dateTimeRaw = pickTag(xml, "dateTime");
  const cameraName = pickTag(xml, "channelName") ?? pickTag(xml, "deviceName") ?? `Channel ${channelId}`;
  const eventTime = dateTimeRaw ? new Date(dateTimeRaw).toISOString() : new Date().toISOString();
  const { primary: targetType, all: detectionTargets } = pickTargets(xml);

  // Drop heartbeats & inactive-state spam — only ingest active events.
  if (eventType === "videoloss" || eventType === "VMD") {
    // keep videoloss & motion if user wants; for now allow them through
  }
  if (eventState && eventState.toLowerCase() === "inactive") {
    return new Response(JSON.stringify({ ok: true, skipped: "inactive state" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Try to look up the channel's friendly name from hikvision_channels.
  const { data: chRow } = await supabase
    .from("hikvision_channels")
    .select("name")
    .eq("instance_id", inst.id).eq("channel_id", channelId).maybeSingle();
  const finalCameraName = chRow?.name ?? cameraName;

  let thumbnailPath: string | null = null;
  if (image && image.byteLength > 0) {
    const ts = Date.now();
    const path = `${inst.organization_id}/hikvision/${inst.id}/${channelId}/${ts}.jpg`;
    const { error: upErr } = await supabase.storage.from("camera-snapshots").upload(path, image, {
      contentType: "image/jpeg", upsert: false,
    });
    if (!upErr) {
      thumbnailPath = path;
      await supabase.from("hikvision_channels").update({ last_snapshot_path: path, last_event_ts: eventTime })
        .eq("instance_id", inst.id).eq("channel_id", channelId);
    }
  } else {
    await supabase.from("hikvision_channels").update({ last_event_ts: eventTime })
      .eq("instance_id", inst.id).eq("channel_id", channelId);
  }

  const { error: insErr } = await supabase.from("hikvision_events").insert({
    organization_id: inst.organization_id,
    instance_id: inst.id,
    channel_id: channelId,
    camera_name: finalCameraName,
    event_type: eventType,
    target_type: targetType,
    detection_targets: detectionTargets,
    event_time: eventTime,
    thumbnail_path: thumbnailPath,
    raw: { xml_excerpt: xml.slice(0, 4000) },
  });
  if (insErr) {
    return new Response(JSON.stringify({ error: "insert failed", detail: insErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Bump heartbeat for the instance & mark this channel online.
  const nowIso = new Date().toISOString();
  await supabase.from("hikvision_instances")
    .update({ last_seen_at: nowIso, last_event_ts: eventTime, nvr_unreachable_since: null, nvr_unreachable_alerted_since: null })
    .eq("id", inst.id);
  await supabase.from("camera_status").upsert({
    instance_id: inst.id,
    organization_id: inst.organization_id,
    camera: finalCameraName,
    online: true,
    since: nowIso,
    last_checked: nowIso,
  }, { onConflict: "instance_id,camera" });
  await supabase.from("camera_offline_alerts").delete()
    .eq("instance_id", inst.id).eq("camera", finalCameraName);

  return new Response(JSON.stringify({ ok: true, channel: channelId, event: eventType }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
