// Hikvision snapshot proxy. Authed: caller must be in the instance's org.
// GET /functions/v1/hikvision-proxy?instance_id=<uuid>&channel_id=<id>
// Streams JPEG from /ISAPI/Streaming/channels/{channel}01/picture using stored
// Digest credentials. Keeps NVR creds server-side.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { hikvisionFetch } from "../_shared/hikvisionAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const authed = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error: claimsErr } = await authed.auth.getUser();
  if (claimsErr || !claims?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const url = new URL(req.url);
  const instanceId = url.searchParams.get("instance_id");
  const channelId = url.searchParams.get("channel_id");
  if (!instanceId || !channelId) {
    return new Response(JSON.stringify({ error: "instance_id and channel_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: inst, error: instErr } = await admin
    .from("hikvision_instances")
    .select("id, organization_id, base_url, auth_username, auth_password, verify_tls")
    .eq("id", instanceId).maybeSingle();
  if (instErr || !inst) {
    return new Response(JSON.stringify({ error: "instance not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Membership check.
  const userId = (claims.claims as any).sub as string;
  const { data: member } = await admin.from("organization_members")
    .select("user_id").eq("user_id", userId).eq("organization_id", inst.organization_id).maybeSingle();
  if (!member) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Hikvision channel-picture path uses {channel}01 (channel + stream index).
  const path = `/ISAPI/Streaming/channels/${channelId}01/picture`;
  const upstream = await hikvisionFetch(inst, path, {}, 10000);
  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: "upstream failed", status: upstream.status }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const body = await upstream.arrayBuffer();
  return new Response(body, {
    headers: {
      ...corsHeaders,
      "Content-Type": upstream.headers.get("Content-Type") ?? "image/jpeg",
      "Cache-Control": "no-store",
    },
  });
});
