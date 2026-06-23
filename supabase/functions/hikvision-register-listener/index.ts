// Push HTTP Host Notification config to a Hikvision NVR via ISAPI so it POSTs
// AcuSense events to our ingest webhook. Authed (org member).
//
// POST /functions/v1/hikvision-register-listener
//   { instance_id: string, ingest_url: string, host_id?: number }
//
// We PUT /ISAPI/Event/notification/httpHosts/<id> with the parsed components of
// ingest_url. host_id defaults to 1 (overwrites slot 1).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { hikvisionFetch } from "../_shared/hikvisionAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function xmlEscape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const authed = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error: cErr } = await authed.auth.getUser();
  if (cErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

  let body: { instance_id?: string; ingest_url?: string; host_id?: number };
  try { body = await req.json(); } catch { body = {}; }
  if (!body.instance_id || !body.ingest_url) return json({ error: "instance_id and ingest_url required" }, 400);

  let parsed: URL;
  try { parsed = new URL(body.ingest_url); } catch { return json({ error: "invalid ingest_url" }, 400); }
  if (!/^https?:$/.test(parsed.protocol)) return json({ error: "ingest_url must be http/https" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: inst } = await admin.from("hikvision_instances")
    .select("id, organization_id, base_url, auth_username, auth_password, verify_tls")
    .eq("id", body.instance_id).maybeSingle();
  if (!inst) return json({ error: "instance not found" }, 404);

  const { data: member } = await admin.from("organization_members")
    .select("user_id").eq("user_id", userData.user.id).eq("organization_id", inst.organization_id).maybeSingle();
  if (!member) return json({ error: "Forbidden" }, 403);

  const hostId = Math.max(1, Math.min(32, Math.round(body.host_id ?? 1)));
  const isHttps = parsed.protocol === "https:";
  const port = parsed.port ? Number(parsed.port) : (isHttps ? 443 : 80);
  const pathAndQuery = parsed.pathname + (parsed.search || "");

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<HttpHostNotification version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">` +
    `<id>${hostId}</id>` +
    `<url>${xmlEscape(pathAndQuery)}</url>` +
    `<protocolType>${isHttps ? "HTTPS" : "HTTP"}</protocolType>` +
    `<parameterFormatType>XML</parameterFormatType>` +
    `<addressingFormatType>hostname</addressingFormatType>` +
    `<hostName>${xmlEscape(parsed.hostname)}</hostName>` +
    `<portNo>${port}</portNo>` +
    `<userName></userName>` +
    `<httpAuthenticationMethod>none</httpAuthenticationMethod>` +
    `</HttpHostNotification>`;

  let status = 0;
  let respText = "";
  try {
    const r = await hikvisionFetch(
      inst,
      `/ISAPI/Event/notification/httpHosts/${hostId}`,
      { method: "PUT", headers: { "Content-Type": "application/xml" }, body: xml },
      10000,
    );
    status = r.status;
    respText = await r.text();
  } catch (e) {
    return json({ error: `NVR unreachable: ${(e as Error).message}` }, 502);
  }

  // Hikvision returns 200 + a <ResponseStatus> XML; statusCode "1" is success.
  const ok = status >= 200 && status < 300 && !/statusCode>\s*[^1<]/.test(respText);
  if (!ok) {
    return json({ error: `NVR rejected config (HTTP ${status})`, response: respText.slice(0, 500) }, 400);
  }

  return json({ ok: true, host_id: hostId, ingest_url: body.ingest_url, response: respText.slice(0, 500) });
});
