// Backup a Frigate instance's config.yml to the `frigate-backups` storage bucket.
// On-demand: caller posts { instance_id }. Returns { path, signedUrl, filename, bytes }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { FRIGATE_AUTH_COLUMNS, frigateFetch, type FrigateAuthRow } from "../_shared/frigateAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: { instance_id?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const instanceId = body.instance_id;
  if (!instanceId || typeof instanceId !== "string") {
    return json({ error: "instance_id required" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: inst, error: instErr } = await supabase
    .from("frigate_instances")
    .select(`${FRIGATE_AUTH_COLUMNS}, name, enabled`)
    .eq("id", instanceId)
    .maybeSingle();
  if (instErr || !inst) return json({ error: "instance not found" }, 404);

  // Try raw YAML first, then JSON fallback.
  let configText: string | null = null;
  let ext = "yml";
  let res = await frigateFetch(supabase, inst as FrigateAuthRow, "/api/config/raw");
  if (res.ok) {
    configText = await res.text();
  } else {
    res = await frigateFetch(supabase, inst as FrigateAuthRow, "/api/config");
    if (res.ok) {
      configText = await res.text();
      // /api/config returns JSON
      ext = "json";
    } else {
      return json({
        error: "failed to fetch config from Frigate",
        status: res.status,
        detail: await res.text().catch(() => ""),
      }, 502);
    }
  }

  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19); // 2026-06-22T14-30-12
  const safeName = (inst.name as string).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || instanceId;
  const filename = `${safeName}_${ts}.${ext}`;
  const path = `${instanceId}/${filename}`;

  const { error: upErr } = await supabase.storage
    .from("frigate-backups")
    .upload(path, new Blob([configText], { type: ext === "yml" ? "text/yaml" : "application/json" }), {
      upsert: false,
      contentType: ext === "yml" ? "text/yaml" : "application/json",
    });
  if (upErr) return json({ error: "upload failed", detail: upErr.message }, 500);

  const { data: signed, error: sErr } = await supabase.storage
    .from("frigate-backups")
    .createSignedUrl(path, 60 * 10); // 10 minutes
  if (sErr || !signed) return json({ error: "sign failed", detail: sErr?.message }, 500);

  return json({
    ok: true,
    path,
    filename,
    bytes: configText.length,
    signedUrl: signed.signedUrl,
  });
});
