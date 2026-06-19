// Proxies media requests (snapshots, clips, latest.jpg) to a Frigate instance.
// URL: /functions/v1/frigate-proxy/<instance_id>/<path>
// e.g.  /frigate-proxy/abc123/api/events/<eid>/snapshot.jpg
//       /frigate-proxy/abc123/api/<camera>/latest.jpg

// No external imports: avoid cold-start fetches that can blow the
// self-hosted edge-runtime wall-clock budget. We talk to PostgREST directly.

import { frigateAuthHeaders, type FrigateAuthRow } from "../_shared/frigateAuth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, range, apikey, x-client-info, accept, cache-control, pragma",
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
    // segs: [..., "frigate-proxy", "<instance_id>", ...rest]
    const fpIdx = segs.indexOf("frigate-proxy");
    if (fpIdx === -1 || !segs[fpIdx + 1]) {
      return new Response("Bad path", { status: 400, headers: corsHeaders });
    }
    const instanceId = segs[fpIdx + 1];
    if (instanceId === "health") return jsonResponse({ ok: true, service: "frigate-proxy" }, 200);
    if (!isUuid(instanceId)) return jsonResponse({ error: "invalid_instance_id" }, 400);

    const rest = segs.slice(fpIdx + 2).join("/");
    if (!rest) return jsonResponse({ error: "missing_upstream_path" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "proxy_not_configured", message: "Missing backend proxy secrets." }, 500);
    }

    let inst: (FrigateAuthRow & { enabled: boolean }) | null = null;
    try {
      const lookupCtrl = new AbortController();
      const lookupTimer = setTimeout(() => lookupCtrl.abort(), 3000);
      const lookupRes = await fetch(
        `${supabaseUrl}/rest/v1/frigate_instances?id=eq.${encodeURIComponent(instanceId)}&select=id,base_url,api_key,enabled,auth_username,auth_password,auth_token_cache,auth_token_expires_at&limit=1`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Accept: "application/json",
          },
          signal: lookupCtrl.signal,
        },
      ).finally(() => clearTimeout(lookupTimer));
      if (!lookupRes.ok) {
        const body = await lookupRes.text().catch(() => "");
        return jsonResponse({ error: "instance_lookup_failed", status: lookupRes.status, message: body.slice(0, 300) }, 500);
      }
      const rows = (await lookupRes.json()) as Array<FrigateAuthRow & { enabled: boolean }>;
      inst = rows[0] ?? null;
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      return jsonResponse({
        error: "instance_lookup_failed",
        message: aborted ? "DB lookup timed out after 3s." : (e as Error).message,
      }, 500);
    }

    if (!inst) return textResponse("Instance not found", 404);
    if (!inst.enabled) return textResponse("Instance disabled", 403);

    const base = (inst.base_url as string).replace(/\/+$/, "");
    const target = `${base}/${rest}${url.search}`;

    // Lazy admin client only when we actually need to mint/refresh a token.
    const sb = (inst.auth_username && inst.auth_password)
      ? createClient(supabaseUrl, serviceKey)
      : null;

    const buildUpstreamHeaders = async (force: boolean): Promise<Record<string, string>> => {
      const h: Record<string, string> = {};
      const range = req.headers.get("range");
      if (range) h["Range"] = range;
      const auth = await frigateAuthHeaders(sb, inst!, force);
      return { ...h, ...auth };
    };
    let upstreamHeaders = await buildUpstreamHeaders(false);

    let upstream: Response;
    const controller = new AbortController();
    // Must be lower than the edge-runtime wall-clock limit (~10s on self-hosted)
    // so we always respond with proper CORS headers instead of being killed.
    const timeoutId = setTimeout(() => controller.abort(), 7000);
    try {
      upstream = await fetch(target, {
        method: req.method === "HEAD" ? "HEAD" : "GET",
        headers: upstreamHeaders,
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      const message = aborted
        ? "The NVR did not respond within 7s."
        : (e as Error).message || "Unable to reach the NVR.";
      return jsonResponse({ error: "nvr_unreachable", message, target }, aborted ? 504 : 502);
    } finally {
      clearTimeout(timeoutId);
    }

    const upstreamContentType = upstream.headers.get("content-type") ?? "";
    const isCloudflareTunnelError = upstream.status === 530 && upstreamContentType.includes("text/html");

    if (isCloudflareTunnelError) {
      await upstream.body?.cancel();
      return new Response(
        JSON.stringify({
          error: "nvr_unreachable",
          message: "The NVR tunnel is unreachable. Check that cloudflared is running for this Frigate instance.",
          status: 530,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const respHeaders = new Headers(corsHeaders);
    const passthrough = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"];
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
