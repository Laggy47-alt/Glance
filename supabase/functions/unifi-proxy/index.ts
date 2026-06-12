// Proxies requests to a UniFi Protect NVR.
// URL: /functions/v1/unifi-proxy/<instance_id>/<upstream_path...>
// e.g.  /unifi-proxy/<id>/proxy/protect/api/cameras
//       /unifi-proxy/<id>/proxy/protect/api/cameras/<cameraId>/snapshot?ts=...
//       /unifi-proxy/<id>/proxy/protect/api/events?start=...&end=...
//       /unifi-proxy/<id>/proxy/protect/api/events/<eventId>/thumbnail
//
// Auth: forwards `X-API-KEY` header from the stored instance API key.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, range, apikey, x-client-info, accept, cache-control, pragma",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges",
};

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function textResponse(message: string, status: number) {
  return new Response(message, { status, headers: corsHeaders });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const segs = url.pathname.split("/").filter(Boolean);
    const fpIdx = segs.indexOf("unifi-proxy");
    if (fpIdx === -1 || !segs[fpIdx + 1]) {
      return textResponse("Bad path", 400);
    }
    const instanceId = segs[fpIdx + 1];
    if (instanceId === "health") return jsonResponse({ ok: true, service: "unifi-proxy" }, 200);
    if (!isUuid(instanceId)) return jsonResponse({ error: "invalid_instance_id" }, 400);

    const rest = segs.slice(fpIdx + 2).join("/");
    if (!rest) return jsonResponse({ error: "missing_upstream_path" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "proxy_not_configured" }, 500);
    }

    // Lookup instance
    let inst: {
      base_url: string;
      api_key: string;
      enabled: boolean;
      verify_tls: boolean;
    } | null = null;
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 3000);
      const r = await fetch(
        `${supabaseUrl}/rest/v1/unifi_instances?id=eq.${encodeURIComponent(instanceId)}&select=base_url,api_key,enabled,verify_tls&limit=1`,
        {
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" },
          signal: c.signal,
        },
      ).finally(() => clearTimeout(t));
      if (!r.ok) return jsonResponse({ error: "instance_lookup_failed", status: r.status }, 500);
      const rows = (await r.json()) as Array<typeof inst>;
      inst = rows[0] ?? null;
    } catch (e) {
      return jsonResponse({ error: "instance_lookup_failed", message: (e as Error).message }, 500);
    }

    if (!inst) return textResponse("Instance not found", 404);
    if (!inst.enabled) return textResponse("Instance disabled", 403);

    const base = inst.base_url.replace(/\/+$/, "");
    const target = `${base}/${rest}${url.search}`;

    const upstreamHeaders: Record<string, string> = {
      "X-API-KEY": inst.api_key,
      Accept: req.headers.get("accept") ?? "*/*",
    };
    const range = req.headers.get("range");
    if (range) upstreamHeaders["Range"] = range;

    let upstream: Response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      upstream = await fetch(target, {
        method: req.method === "HEAD" ? "HEAD" : req.method === "POST" ? "POST" : "GET",
        headers: upstreamHeaders,
        body: req.method === "POST" ? await req.arrayBuffer() : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      return jsonResponse(
        {
          error: "nvr_unreachable",
          message: aborted ? "UniFi NVR did not respond within 8s." : (e as Error).message,
          target,
        },
        aborted ? 504 : 502,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const respHeaders = new Headers(corsHeaders);
    const passthrough = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "cache-control",
      "etag",
      "last-modified",
    ];
    for (const h of passthrough) {
      const v = upstream.headers.get(h);
      if (v) respHeaders.set(h, v);
    }
    if (!respHeaders.has("cache-control")) respHeaders.set("cache-control", "public, max-age=5");

    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  } catch (e) {
    return jsonResponse({ error: "proxy_error", message: (e as Error).message }, 502);
  }
});
