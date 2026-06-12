// UniFi Protect Alarm Manager webhook receiver.
// Endpoint: /functions/v1/unifi-webhook/<instance_id>
// Header:   Authorization: Bearer <unifi_instances.webhook_secret>
//
// On success, inserts a row into `unifi_events` AND a row into `webhook_events`
// so the Wall picks it up via realtime alongside other event sources.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function pickCamera(p: any): { id: string | null; name: string | null } {
  // UniFi Alarm Manager payloads vary by firmware. Try common shapes.
  const trigger = p?.alarm?.triggers?.[0] ?? p?.triggers?.[0] ?? {};
  const camera = p?.alarm?.sources?.[0]?.device ?? p?.device ?? trigger?.device ?? {};
  const id = trigger?.device || camera?.id || camera?.mac || p?.cameraId || null;
  const name = camera?.name || trigger?.name || p?.cameraName || null;
  return { id: id ? String(id) : null, name: name ? String(name) : null };
}

function pickEventType(p: any): { type: string; smart: string[] } {
  const t = p?.alarm?.name || p?.alarm?.triggers?.[0]?.key || p?.eventType || p?.type || "alarm";
  const detections = p?.alarm?.conditions?.[0]?.condition?.source ?? p?.smartDetectTypes ?? [];
  const smart = Array.isArray(detections) ? detections.map(String) : [];
  return { type: String(t), smart };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    // Path layout: /unifi-webhook/<instance_id>
    const parts = url.pathname.split("/").filter(Boolean);
    const instanceId = parts[parts.length - 1];
    if (!instanceId || !/^[0-9a-f-]{36}$/i.test(instanceId)) {
      return json({ error: "Missing or invalid instance id in URL" }, 400);
    }

    // Token validation: accept "Authorization: Bearer <secret>" OR "Token: <secret>".
    const auth = req.headers.get("authorization") ?? "";
    const tokenHeader = req.headers.get("token") ?? "";
    const presented = auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : tokenHeader.trim();
    if (!presented) return json({ error: "Missing bearer token" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const { data: inst, error: instErr } = await admin
      .from("unifi_instances")
      .select("id, organization_id, source_id, webhook_secret, name, enabled")
      .eq("id", instanceId)
      .maybeSingle();
    if (instErr) return json({ error: instErr.message }, 500);
    if (!inst) return json({ error: "Unknown instance" }, 404);

    // constant-time-ish compare
    const a = new TextEncoder().encode(presented);
    const b = new TextEncoder().encode(inst.webhook_secret ?? "");
    let ok = a.length === b.length;
    if (ok) for (let i = 0; i < a.length; i++) ok = ok && a[i] === b[i];
    if (!ok) return json({ error: "Bad token" }, 401);

    if (!inst.enabled) {
      return json({ ok: true, skipped: "instance disabled" });
    }

    const bodyText = await req.text();
    let payload: any;
    try { payload = bodyText ? JSON.parse(bodyText) : {}; } catch { payload = { _raw: bodyText }; }

    const { id: camId, name: camName } = pickCamera(payload);
    const { type, smart } = pickEventType(payload);
    const startAt = new Date(
      payload?.alarm?.start ??
      payload?.start ??
      payload?.timestamp ??
      Date.now(),
    ).toISOString();
    const endAt = payload?.alarm?.end ?? payload?.end ?? null;
    const remoteId = String(
      payload?.alarm?.eventId ??
      payload?.eventId ??
      payload?.id ??
      `${inst.id}:${startAt}:${camId ?? "unknown"}`,
    );

    // 1) Insert into unifi_events (idempotent on remote_event_id per instance)
    const { error: ueErr } = await admin
      .from("unifi_events")
      .upsert(
        {
          organization_id: inst.organization_id,
          instance_id: inst.id,
          remote_event_id: remoteId,
          event_type: type,
          smart_types: smart.length ? smart : null,
          camera_id: camId ?? "unknown",
          camera_name: camName,
          start_at: startAt,
          end_at: endAt,
          raw: payload,
        },
        { onConflict: "instance_id,remote_event_id", ignoreDuplicates: true },
      );
    if (ueErr) console.error("unifi_events insert error:", ueErr);

    // 2) Mirror to webhook_events so the Wall surfaces it.
    if (inst.source_id) {
      const { error: weErr } = await admin.from("webhook_events").insert({
        organization_id: inst.organization_id,
        source_id: inst.source_id,
        kind: "unifi",
        label: smart[0] ?? type,
        camera: camName ?? camId ?? null,
        payload,
        payload_text: bodyText,
        headers: Object.fromEntries(req.headers.entries()),
        frigate_event_id: remoteId,
        ts: startAt,
      });
      if (weErr) console.error("webhook_events insert error:", weErr);
    } else {
      console.warn(`Instance ${inst.id} has no source_id; cannot mirror to Wall.`);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("unifi-webhook fatal:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
