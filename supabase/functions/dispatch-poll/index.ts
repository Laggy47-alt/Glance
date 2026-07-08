// dispatch-poll — phone polls to discover its current active dispatch.
//
// POST /functions/v1/dispatch-poll
// Body: { token }
// Returns: { dispatch: {...} | null, tracking: boolean, interval_ms }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

    const token = String(body?.token ?? "").trim();
    if (!token) return json({ error: "token required" }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: dev, error: devErr } = await sb
      .from("responder_devices")
      .select("id, responder_id, revoked_at")
      .eq("token", token)
      .maybeSingle();
    if (devErr) { console.error("device lookup failed", devErr); return json({ error: "device lookup failed" }, 500); }
    if (!dev || dev.revoked_at) return json({ error: "invalid token" }, 401);

    // Touch last_seen (best-effort, don't block)
    sb.from("responder_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", dev.id).then(() => {});

    const { data: d, error: dErr } = await sb
      .from("dispatches")
      .select("id, status, priority, site_id, dispatched_at, acknowledged_at, arrived_at, alert_payload, sites(name, latitude, longitude)")
      .eq("responder_id", dev.responder_id)
      .in("status", ["pending", "en_route", "on_site"])
      .order("dispatched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (dErr) { console.error("dispatch lookup failed", dErr); return json({ error: "dispatch lookup failed", detail: dErr.message }, 500); }

    const tracking = !!d && (d.status === "pending" || d.status === "en_route");
    const site: any = (d as any)?.sites ?? null;
    return json({
      dispatch: d ? {
        id: d.id,
        status: d.status,
        priority: d.priority,
        site_id: d.site_id,
        site_name: site?.name ?? null,
        site_lat: site?.latitude ?? null,
        site_lng: site?.longitude ?? null,
        dispatched_at: d.dispatched_at,
        acknowledged_at: d.acknowledged_at,
        arrived_at: d.arrived_at,
        alert_payload: (d as any).alert_payload ?? null,
      } : null,
      tracking,
      interval_ms: tracking ? 10000 : 15000,
    });
  } catch (e) {
    console.error("dispatch-poll unexpected error", e);
    return json({ error: "server error" }, 500);
  }
});
