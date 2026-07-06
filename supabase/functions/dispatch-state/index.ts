// dispatch-state — phone-side state transitions using device token auth.
//
// POST /functions/v1/dispatch-state
// Body: { token, dispatch_id?, action, note? }
//   action ∈ 'acknowledge' | 'arrive' | 'complete' | 'cancel'
// If dispatch_id is omitted, uses the responder's most recent active dispatch.

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
  const action = String(body?.action ?? "").trim();
  const note = body?.note ? String(body.note) : null;
  const dispatchId: string | null = body?.dispatch_id ?? null;

  if (!token) return json({ error: "token required" }, 400);
  if (!["acknowledge", "arrive", "complete", "cancel"].includes(action)) {
    return json({ error: "invalid action" }, 400);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: dev } = await sb
    .from("responder_devices")
    .select("id, responder_id, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (!dev || dev.revoked_at) return json({ error: "invalid token" }, 401);

  let dispatch: any = null;
  if (dispatchId) {
    const { data } = await sb.from("dispatches").select("*").eq("id", dispatchId).maybeSingle();
    if (!data || data.responder_id !== dev.responder_id) return json({ error: "dispatch not found" }, 404);
    dispatch = data;
  } else {
    const { data } = await sb
      .from("dispatches")
      .select("*")
      .eq("responder_id", dev.responder_id)
      .in("status", ["pending", "en_route", "on_site"])
      .order("dispatched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return json({ error: "no active dispatch" }, 404);
    dispatch = data;
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  let kind = "status_change";

  if (action === "acknowledge") {
    if (!dispatch.acknowledged_at) patch.acknowledged_at = now;
    if (dispatch.status === "pending") patch.status = "en_route";
    kind = "acknowledged";
  } else if (action === "arrive") {
    patch.arrived_at = now;
    patch.status = "on_site";
    kind = "arrived";
  } else if (action === "complete") {
    patch.completed_at = now;
    patch.status = "completed";
    if (!dispatch.arrived_at) patch.arrived_at = now;
    kind = "completed";
  } else if (action === "cancel") {
    patch.cancelled_at = now;
    patch.status = "cancelled";
    kind = "cancelled";
  }

  await sb.from("dispatches").update(patch).eq("id", dispatch.id);
  await sb.from("dispatch_events").insert({
    dispatch_id: dispatch.id,
    organization_id: dispatch.organization_id,
    kind,
    payload: { note, source: "responder_device" },
  });

  return json({ ok: true, dispatch: dispatch.id, status: patch.status ?? dispatch.status });
});
