// Periodic heartbeat to keep the self-hosted Mudslide WhatsApp session
// active and logged in. For each organization with WhatsApp enabled and a
// mudslide_url configured, this pings Mudslide's /me endpoint and records
// the result in whatsapp_settings.last_heartbeat_at / last_heartbeat_status.
//
// Intended to be invoked on a schedule (e.g. every 5 minutes via pg_cron).
// Can also be called manually: POST {} (no body required).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

async function tryReq(url: string, method: string, token: string | null) {
  try {
    const r = await fetch(url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: "application/json",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: method === "POST" ? "{}" : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const text = await r.text().catch(() => "");
    return { status: r.status, ok: r.ok, body: text.slice(0, 300) };
  } catch (e) {
    return { status: 0, ok: false, body: (e as Error).message };
  }
}

async function pingMudslide(url: string, token: string | null) {
  const base = url.replace(/\/+$/, "");
  const attempts: Array<[string, string]> = [
    ["/me", "GET"], ["/me", "POST"],
    ["/groups", "GET"], ["/contacts", "GET"],
    ["/status", "GET"], ["/health", "GET"],
    ["/", "GET"],
  ];
  let lastErr = "";
  for (const [ep, method] of attempts) {
    const r = await tryReq(base + ep, method, token);
    if (r.ok) return { ok: true, status: r.status, endpoint: `${method} ${ep}`, body: r.body };
    if (r.status === 401 || r.status === 403) {
      return { ok: true, status: r.status, endpoint: `${method} ${ep}`, body: `auth-required` };
    }
    // A JSON 404 like {"error":"not found"} still proves the HTTP server
    // (and therefore the Mudslide process) is up and routing requests.
    if (r.status === 404 && /\{.*\}/.test(r.body)) {
      return { ok: true, status: r.status, endpoint: `${method} ${ep}`, body: `alive (404 json) ${r.body.slice(0, 120)}` };
    }
    lastErr = `${method} ${ep} -> ${r.status} ${r.body.slice(0, 100)}`;
  }
  return { ok: false, status: 0, endpoint: null as string | null, body: lastErr };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: rows, error } = await supabase
    .from("whatsapp_settings")
    .select("organization_id, enabled, mudslide_url, mudslide_token");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: any[] = [];
  for (const s of rows ?? []) {
    if (!s.enabled || !s.mudslide_url) {
      results.push({ organization_id: s.organization_id, skipped: true });
      continue;
    }
    const res = await pingMudslide(s.mudslide_url, s.mudslide_token);
    const status = res.ok
      ? `ok ${res.status}${res.endpoint ? ` ${res.endpoint}` : ""}`
      : `error ${res.body}`.slice(0, 500);

    await supabase
      .from("whatsapp_settings")
      .update({
        last_heartbeat_at: new Date().toISOString(),
        last_heartbeat_status: status,
      })
      .eq("organization_id", s.organization_id);

    results.push({ organization_id: s.organization_id, ok: res.ok, status });
  }

  return new Response(JSON.stringify({ ran_at: new Date().toISOString(), results }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
