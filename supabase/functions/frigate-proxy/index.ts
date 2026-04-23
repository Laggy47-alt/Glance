// Proxies media requests (snapshots, clips, latest.jpg) to a Frigate instance.
// URL: /functions/v1/frigate-proxy/<instance_id>/<path>
// e.g.  /frigate-proxy/abc123/api/events/<eid>/snapshot.jpg
//       /frigate-proxy/abc123/api/<camera>/latest.jpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, range, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const segs = url.pathname.split("/").filter(Boolean);
    // segs: [..., "frigate-proxy", "<instance_id>", ...rest]
    const fpIdx = segs.indexOf("frigate-proxy");
    if (fpIdx === -1 || !segs[fpIdx + 1]) {
      return new Response("Bad path", { status: 400, headers: corsHeaders });
    }
    const instanceId = segs[fpIdx + 1];
    const rest = segs.slice(fpIdx + 2).join("/");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: inst, error } = await supabase
      .from("frigate_instances")
      .select("base_url, api_key, enabled")
      .eq("id", instanceId)
      .maybeSingle();

    if (error || !inst) return new Response("Instance not found", { status: 404, headers: corsHeaders });
    if (!inst.enabled) return new Response("Instance disabled", { status: 403, headers: corsHeaders });

    const base = (inst.base_url as string).replace(/\/+$/, "");
    const target = `${base}/${rest}${url.search}`;

    const upstreamHeaders: Record<string, string> = {};
    const range = req.headers.get("range");
    if (range) upstreamHeaders["Range"] = range;
    if (inst.api_key) upstreamHeaders["Authorization"] = `Bearer ${inst.api_key}`;

    const upstream = await fetch(target, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(30000),
    });

    const respHeaders = new Headers(corsHeaders);
    const passthrough = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"];
    for (const h of passthrough) {
      const v = upstream.headers.get(h);
      if (v) respHeaders.set(h, v);
    }
    if (!respHeaders.has("cache-control")) respHeaders.set("cache-control", "public, max-age=5");

    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  } catch (e) {
    return new Response(`Proxy error: ${(e as Error).message}`, { status: 502, headers: corsHeaders });
  }
});
