// One-shot channel discovery for a Hikvision NVR. Authed (org admin).
// POST /functions/v1/hikvision-discover { instance_id }
// Hits ISAPI, populates hikvision_channels, returns the discovered list +
// device info (model, firmware).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { hikvisionFetch } from "../_shared/hikvisionAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function pick(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`, "i"));
  return m ? m[1].trim() : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const authed = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: claims, error: cErr } = await authed.auth.getClaims(auth.replace("Bearer ", ""));
  if (cErr || !claims?.claims) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: { instance_id?: string };
  try { body = await req.json(); } catch { body = {}; }
  if (!body.instance_id) {
    return new Response(JSON.stringify({ error: "instance_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: inst } = await admin.from("hikvision_instances")
    .select("id, organization_id, base_url, auth_username, auth_password, verify_tls")
    .eq("id", body.instance_id).maybeSingle();
  if (!inst) return new Response(JSON.stringify({ error: "instance not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const userId = (claims.claims as any).sub;
  const { data: member } = await admin.from("organization_members")
    .select("user_id, role").eq("user_id", userId).eq("organization_id", inst.organization_id).maybeSingle();
  if (!member) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // Device info.
  let deviceInfo: any = null;
  try {
    const r = await hikvisionFetch(inst, "/ISAPI/System/deviceInfo", {}, 6000);
    if (r.ok) {
      const xml = await r.text();
      deviceInfo = {
        deviceName: pick(xml, "deviceName"),
        model: pick(xml, "model"),
        firmwareVersion: pick(xml, "firmwareVersion"),
        serialNumber: pick(xml, "serialNumber"),
      };
    }
  } catch { /* ignore */ }

  // Channels.
  let xml = "";
  try {
    let r = await hikvisionFetch(inst, "/ISAPI/ContentMgmt/InputProxy/channels", {}, 8000);
    if (!r.ok) r = await hikvisionFetch(inst, "/ISAPI/System/Video/inputs/channels", {}, 8000);
    if (r.ok) xml = await r.text();
  } catch { /* ignore */ }

  const blocks = xml.split(/<(?:InputProxyChannel|VideoInputChannel)[\s>]/i).slice(1);
  const channels: Array<{ id: string; name: string }> = [];
  for (const raw of blocks) {
    const id = (raw.match(/<id>([^<]+)<\/id>/i)?.[1] ?? "").trim();
    const name = (raw.match(/<name>([^<]+)<\/name>/i)?.[1] ?? "").trim() || `Channel ${id}`;
    if (id) channels.push({ id, name });
  }

  if (channels.length) {
    await admin.from("hikvision_channels").upsert(
      channels.map((c) => ({
        organization_id: inst.organization_id,
        instance_id: inst.id,
        channel_id: c.id,
        name: c.name,
      })),
      { onConflict: "instance_id,channel_id" },
    );
  }

  return new Response(JSON.stringify({ ok: true, deviceInfo, channels }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
