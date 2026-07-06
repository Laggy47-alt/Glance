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

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const token = String(body?.token ?? "").trim();
  if (!token) return json({ error: "token required" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: dev } = await sb
    .from("responder_devices")
    .select("id, responder_id, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (!dev || dev.revoked_at) return json({ error: "invalid token" }, 401);

  // Touch last_seen
  await sb.from("responder_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", dev.id);

  const { data: d } = await sb
    .from("dispatches")
    .select("id, status, priority, site_id, site_name, site_lat, site_lng, dispatched_at, acknowledged_at, arrived_at")
    .eq("responder_id", dev.responder_id)
    .in("status", ["pending", "en_route", "on_site"])
    .order("dispatched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const tracking = !!d && (d.status === "pending" || d.status === "en_route");
  return json({
    dispatch: d ?? null,
    tracking,
    interval_ms: tracking ? 10000 : 15000,
  });
});
