// unifi-status — receives a bulk snapshot of camera health from the on-site
// bridge every ~30s and upserts unifi_camera_status.
//
// POST /functions/v1/unifi-status
// Headers:  X-Webhook-Secret: <unifi_instances.webhook_secret>
// Body:
// {
//   "instance_id": "<uuid>",
//   "cameras": [
//     { "id": "abc123", "name": "Front Door", "state": "CONNECTED",
//       "isConnected": true, "lastSeenMs": 1712345678901 }
//   ]
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, apikey, x-client-info, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const secret = req.headers.get("x-webhook-secret") ?? "";
  if (!secret) return json({ error: "missing X-Webhook-Secret" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const instanceId: string | undefined = body?.instance_id;
  const cameras: any[] = Array.isArray(body?.cameras) ? body.cameras : [];
  if (!instanceId) return json({ error: "instance_id required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: inst } = await supabase
    .from("unifi_instances")
    .select("id, organization_id, webhook_secret, enabled")
    .eq("id", instanceId)
    .maybeSingle();
  if (!inst) return json({ error: "instance not found" }, 404);
  if (String(inst.webhook_secret) !== secret) return json({ error: "bad secret" }, 401);

  const nowIso = new Date().toISOString();

  // Fetch existing status rows to compute is_online transitions
  const camIds = cameras.map((c) => String(c?.id ?? "")).filter(Boolean);
  const { data: existing } = await supabase
    .from("unifi_camera_status")
    .select("camera_id, is_online, last_offline_at, last_online_at")
    .eq("instance_id", inst.id);
  const prev = new Map<string, any>((existing ?? []).map((r: any) => [r.camera_id, r]));

  const STALE_MS = 120_000;
  const nowMs = Date.now();

  const rows = cameras
    .filter((c) => c && c.id)
    .map((c) => {
      const camId = String(c.id);
      const lastSeenMs = typeof c.lastSeenMs === "number" ? c.lastSeenMs : (typeof c.lastSeen === "number" ? c.lastSeen : null);
      const lastSeenIso = lastSeenMs ? new Date(lastSeenMs).toISOString() : null;
      const state = String(c.state ?? "").toUpperCase();
      const fresh = lastSeenMs ? (nowMs - lastSeenMs) < STALE_MS : true;
      // Match Protect's UI: only state === CONNECTED with a recent lastSeen
      // counts as online. isConnected===false is always offline.
      const isOnline = state === "CONNECTED" && fresh && c.isConnected !== false;
      const before = prev.get(camId);
      const flippedOff = before?.is_online === true && !isOnline;
      const flippedOn = before?.is_online === false && isOnline;
      return {
        instance_id: inst.id,
        organization_id: inst.organization_id,
        camera_id: camId,
        name: String(c.name ?? "").trim() || null,
        state: c.state ?? null,
        is_online: isOnline,
        last_seen_at: lastSeenIso,
        last_status_at: nowIso,
        last_offline_at: flippedOff ? nowIso : (before?.last_offline_at ?? (isOnline ? null : nowIso)),
        last_online_at: flippedOn ? nowIso : (before?.last_online_at ?? (isOnline ? nowIso : null)),
        updated_at: nowIso,
      };
    });

  if (rows.length) {
    const { error } = await supabase
      .from("unifi_camera_status")
      .upsert(rows, { onConflict: "instance_id,camera_id" });
    if (error) return json({ error: "upsert failed", detail: error.message }, 500);
  }

  await supabase.from("unifi_instances")
    .update({ last_seen_at: nowIso, last_error: null })
    .eq("id", inst.id);

  return json({ ok: true, upserted: rows.length });
});
