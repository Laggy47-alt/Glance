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

  const hostConfig = {
    id: String(hostId),
    url: pathAndQuery || "/",
    protocolType: isHttps ? "HTTPS" : "HTTP",
    parameterFormatType: "XML",
    addressingFormatType: "hostname",
    hostName: parsed.hostname,
    portNo: String(port),
    httpAuthenticationMethod: "none",
  };

  const jsonPayloads = {
    list: JSON.stringify({
      HttpHostNotificationList: {
        "@version": "2.0",
        "@xmlns": "http://www.isapi.org/ver20/XMLSchema",
        HttpHostNotification: {
          ...hostConfig,
          Extensions: { "@xmlns": "urn:selfextension:psiaext-ver10-xsd", intervalBetweenEvents: "0" },
        },
      },
    }),
    single: JSON.stringify({ HttpHostNotification: hostConfig }),
  };

  const xmlHost =
    `<HttpHostNotification version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">` +
    `<id>${hostConfig.id}</id>` +
    `<url>${xmlEscape(hostConfig.url)}</url>` +
    `<protocolType>${hostConfig.protocolType}</protocolType>` +
    `<parameterFormatType>${hostConfig.parameterFormatType}</parameterFormatType>` +
    `<addressingFormatType>${hostConfig.addressingFormatType}</addressingFormatType>` +
    `<hostName>${xmlEscape(hostConfig.hostName)}</hostName>` +
    `<portNo>${hostConfig.portNo}</portNo>` +
    `<httpAuthenticationMethod>${hostConfig.httpAuthenticationMethod}</httpAuthenticationMethod>` +
    `<Extensions xmlns="urn:selfextension:psiaext-ver10-xsd"><intervalBetweenEvents>0</intervalBetweenEvents></Extensions>` +
    `</HttpHostNotification>`;
  const xmlPayloads = {
    list: `<HttpHostNotificationList version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">${xmlHost}</HttpHostNotificationList>`,
    single: xmlHost,
  };

  async function tryPut(path: string, payload: string, contentType: "application/json" | "application/xml") {
    const r = await hikvisionFetch(
      inst,
      path,
      { method: "PUT", headers: { "Content-Type": contentType }, body: payload },
      10000,
    );
    const text = await r.text();
    return { status: r.status, text };
  }

  const attempts = [
    {
      label: "xml-list",
      path: "/ISAPI/Event/notification/httpHosts",
      contentType: "application/xml" as const,
      payload: xmlPayloads.list,
    },
    {
      label: "json-list",
      path: "/ISAPI/Event/notification/httpHosts?format=json",
      contentType: "application/json" as const,
      payload: jsonPayloads.list,
    },
    {
      label: "xml-slot",
      path: `/ISAPI/Event/notification/httpHosts/${hostId}`,
      contentType: "application/xml" as const,
      payload: xmlPayloads.single,
    },
    {
      label: "json-slot",
      path: `/ISAPI/Event/notification/httpHosts/${hostId}?format=json`,
      contentType: "application/json" as const,
      payload: jsonPayloads.single,
    },
  ];

  let status = 0;
  let respText = "";
  const failures: string[] = [];
  try {
    for (const attempt of attempts) {
      const res = await tryPut(attempt.path, attempt.payload, attempt.contentType);
      status = res.status;
      respText = res.text;
      const ok = status >= 200 && status < 300 && !/statusCode>\s*[^1<]/.test(respText);
      if (ok) {
        return json({ ok: true, host_id: hostId, ingest_url: body.ingest_url, mode: attempt.label, response: respText.slice(0, 500) });
      }
      failures.push(`${attempt.label}: HTTP ${status} ${respText.replace(/\s+/g, " ").slice(0, 240)}`);
    }
  } catch (e) {
    return json({ error: `NVR unreachable: ${(e as Error).message}` }, 502);
  }

  return json({ error: `NVR rejected config (HTTP ${status})`, response: failures.join(" | ").slice(0, 900) }, 400);
});
