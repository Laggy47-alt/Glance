// dispatch-ping — accepts GPS pings from a provisioned responder phone.
//
// POST /functions/v1/dispatch-ping
// Body: { token, latitude, longitude, accuracy?, speed?, heading?, recorded_at? }
//
// No user login required — the opaque device token is the auth.
// The function uses the service role to bypass RLS and writes on the
// responder's behalf.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Haversine — metres between two lat/lng pairs
function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const a = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const token = String(body?.token ?? "").trim();
  const lat = Number(body?.latitude);
  const lng = Number(body?.longitude);
  const acc = body?.accuracy != null ? Number(body.accuracy) : null;
  const speed = body?.speed != null ? Number(body.speed) : null;
  const heading = body?.heading != null ? Number(body.heading) : null;
  const recordedAt = body?.recorded_at ? new Date(body.recorded_at).toISOString() : new Date().toISOString();

  if (!token) return json({ error: "token required" }, 400);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: "latitude/longitude required" }, 400);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve token → responder
  const { data: dev, error: devErr } = await sb
    .from("responder_devices")
    .select("id, organization_id, responder_id, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (devErr) { console.error("device lookup failed", devErr); return json({ error: "device lookup failed", detail: devErr.message }, 500); }
  if (!dev || dev.revoked_at) return json({ error: "invalid token" }, 401);

  // Update device last-seen
  const { error: devUpdErr } = await sb.from("responder_devices").update({
    last_seen_at: recordedAt,
    last_latitude: lat,
    last_longitude: lng,
    last_accuracy_m: acc,
  }).eq("id", dev.id);
  if (devUpdErr) console.error("device update failed", devUpdErr);

  // Find responder's active dispatch (pending / en_route / on_site)
  const { data: dispatch, error: dErr } = await sb
    .from("dispatches")
    .select("id, status, site_id, arrived_at, organization_id")
    .eq("responder_id", dev.responder_id)
    .in("status", ["pending", "en_route", "on_site"])
    .order("dispatched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (dErr) { console.error("dispatch lookup failed", dErr); return json({ error: "dispatch lookup failed", detail: dErr.message }, 500); }

  // Update vehicle last-known-location if this responder drives one
  const { data: resp, error: respErr } = await sb.from("responders").select("vehicle_id").eq("id", dev.responder_id).maybeSingle();
  if (respErr) console.error("responder lookup failed", respErr);
  if (resp?.vehicle_id) {
    const { error: vehErr } = await sb.from("vehicles").update({
      last_latitude: lat,
      last_longitude: lng,
      last_speed: speed,
      last_heading: heading,
      last_ping_at: recordedAt,
    }).eq("id", resp.vehicle_id);
    if (vehErr) console.error("vehicle update failed", vehErr);
  }

  if (!dispatch) {
    // Device is on-duty but not dispatched — accept ping, no breadcrumb.
    return json({ ok: true, dispatch: null });
  }

  // Insert breadcrumb ping
  const { error: pingErr } = await sb.from("dispatch_location_pings").insert({
    dispatch_id: dispatch.id,
    organization_id: dispatch.organization_id,
    latitude: lat,
    longitude: lng,
    accuracy_m: acc,
    speed,
    heading,
    recorded_at: recordedAt,
  });
  if (pingErr) { console.error("ping insert failed", pingErr); return json({ error: "ping insert failed", detail: pingErr.message }, 500); }

  // Auto-transitions
  let newStatus: string | null = null;
  let arrivedAt: string | null = null;
  if (dispatch.status === "pending") {
    newStatus = "en_route";
  }

  // Auto-arrival geofence check
  const { data: site, error: siteErr } = await sb
    .from("sites")
    .select("latitude, longitude, geofence_radius_m")
    .eq("id", dispatch.site_id)
    .maybeSingle();
  if (siteErr) console.error("site lookup failed", siteErr);
  const insideGeofence =
    site?.latitude != null && site?.longitude != null &&
    distanceM(lat, lng, site.latitude, site.longitude) <= (site.geofence_radius_m ?? 100);

  if (insideGeofence && dispatch.status !== "on_site" && !dispatch.arrived_at) {
    newStatus = "on_site";
    arrivedAt = recordedAt;
  }

  if (newStatus) {
    const patch: Record<string, unknown> = { status: newStatus };
    if (arrivedAt) patch.arrived_at = arrivedAt;
    if (newStatus === "en_route" && !dispatch.arrived_at) {
      patch.acknowledged_at = recordedAt;
    }
    const { error: upErr } = await sb.from("dispatches").update(patch).eq("id", dispatch.id);
    if (upErr) console.error("dispatch update failed", upErr);

    if (arrivedAt) {
      await sb.from("dispatch_events").insert({
        dispatch_id: dispatch.id,
        organization_id: dispatch.organization_id,
        kind: "arrived",
        payload: { auto: true, lat, lng, accuracy_m: acc },
      });
    } else if (newStatus === "en_route") {
      await sb.from("dispatch_events").insert({
        dispatch_id: dispatch.id,
        organization_id: dispatch.organization_id,
        kind: "acknowledged",
        payload: { auto: true, first_ping: true },
      });
    }
  }

  return json({ ok: true, dispatch: dispatch.id, status: newStatus ?? dispatch.status });
  } catch (e: any) {
    console.error("dispatch-ping unexpected error", e);
    return json({ error: "server error", detail: e?.message ?? String(e) }, 500);
  }
});
