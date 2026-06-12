// Proxies requests to a UniFi Protect (ENVR) instance.
// URL: /functions/v1/unifi-proxy/<instance_id>/<upstream-path>
// e.g.  /unifi-proxy/<id>/proxy/protect/integration/v1/cameras
//       /unifi-proxy/<id>/proxy/protect/integration/v1/cameras/<camId>/snapshot?highQuality=false
//
// Auth to UniFi: header `X-API-KEY` (UniFi local API key).
// Mirrors the patterns and timeouts used by `frigate-proxy`.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, range, apikey, x-client-info, accept, cache-control, pragma",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges",
};

function textResponse(message: string, status: number) {
  return new Response(message, { status, headers: corsHeaders });
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const segs = url.pathname.split("/").filter(Boolean);
    const upIdx = segs.indexOf("unifi-proxy");
    if (upIdx === -1 || !segs[upIdx + 1]) {
      return new Response("Bad path", { status: 400, headers: corsHeaders });
    }
    const instanceId = segs[upIdx + 1];
    if (instanceId === "health") return jsonResponse({ ok: true, service: "unifi-proxy" }, 200);
    if (!isUuid(instanceId)) return jsonResponse({ error: "invalid_instance_id" }, 400);

    const rest = segs.slice(upIdx + 2).join("/");
    if (!rest) return jsonResponse({ error: "missing_upstream_path" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "proxy_not_configured" }, 500);
    }

    let inst: { base_url: string; api_key: string | null; enabled: boolean; verify_tls: boolean } | null = null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const lookup = await fetch(
        `${supabaseUrl}/rest/v1/unifi_instances?id=eq.${encodeURIComponent(instanceId)}&select=base_url,api_key,enabled,verify_tls&limit=1`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Accept: "application/json",
          },
          signal: ctrl.signal,
        },
      ).finally(() => clearTimeout(t));
      if (!lookup.ok) {
        const body = await lookup.text().catch(() => "");
        return jsonResponse({ error: "instance_lookup_failed", status: lookup.status, message: body.slice(0, 300) }, 500);
      }
      const rows = (await lookup.json()) as Array<typeof inst>;
      inst = (rows[0] as any) ?? null;
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      return jsonResponse({
        error: "instance_lookup_failed",
        message: aborted ? "DB lookup timed out after 3s." : (e as Error).message,
      }, 500);
    }

    if (!inst) return textResponse("Instance not found", 404);
    if (!inst.enabled) return textResponse("Instance disabled", 403);

    const base = inst.base_url.replace(/\/+$/, "");
    const target = `${base}/${rest}${url.search}`;

    const upstreamHeaders: Record<string, string> = { Accept: req.headers.get("accept") ?? "*/*" };
    const range = req.headers.get("range");
    if (range) upstreamHeaders["Range"] = range;
    if (inst.api_key) upstreamHeaders["X-API-KEY"] = inst.api_key;

    let upstream: Response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);
    try {
      upstream = await fetch(target, {
        method: req.method === "HEAD" ? "HEAD" : "GET",
        headers: upstreamHeaders,
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      const message = aborted ? "The NVR did not respond within 7s." : ((e as Error).message || "Unable to reach the NVR.");
      return jsonResponse({ error: "nvr_unreachable", message, target }, aborted ? 504 : 502);
    } finally {
      clearTimeout(timeoutId);
    }

    const outHeaders = new Headers(corsHeaders);
    const passthrough = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"];
    for (const h of passthrough) {
      const v = upstream.headers.get(h);
      if (v) outHeaders.set(h, v);
    }

    return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
  } catch (e) {
    return jsonResponse({ error: "proxy_error", message: (e as Error).message }, 500);
  }
});
