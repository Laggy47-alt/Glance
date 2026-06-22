// List backups in the `frigate-backups` storage bucket and (optionally) sign one.
// GET/POST { action?: "list" | "sign", instance_id?: string, path?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const isInternalDockerHost = (hostname: string) =>
  hostname === "kong" || hostname === "functions" || hostname.endsWith(".docker.internal");

const getPublicBackendBase = (req: Request) => {
  const configured =
    Deno.env.get("PUBLIC_SUPABASE_URL") ||
    Deno.env.get("API_EXTERNAL_URL") ||
    Deno.env.get("SUPABASE_PUBLIC_URL");
  if (configured) return configured;
  const incoming = new URL(req.url);
  return isInternalDockerHost(incoming.hostname) ? null : `${incoming.protocol}//${incoming.host}`;
};

const rewriteSignedUrl = (signedUrl: string, req: Request) => {
  try {
    const publicBase = getPublicBackendBase(req);
    if (!publicBase) return signedUrl;
    const s = new URL(signedUrl);
    const p = new URL(publicBase);
    s.protocol = p.protocol;
    s.host = p.host;
    return s.toString();
  } catch { return signedUrl; }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: { action?: string; instance_id?: string; path?: string } = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch { /* ignore */ }
  } else {
    const u = new URL(req.url);
    body = {
      action: u.searchParams.get("action") ?? undefined,
      instance_id: u.searchParams.get("instance_id") ?? undefined,
      path: u.searchParams.get("path") ?? undefined,
    };
  }
  const action = body.action ?? "list";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (action === "sign") {
    if (!body.path) return json({ error: "path required" }, 400);
    const { data, error } = await supabase.storage
      .from("frigate-backups")
      .createSignedUrl(body.path, 60 * 10);
    if (error || !data) return json({ error: "sign failed", detail: error?.message }, 500);
    return json({ ok: true, signedUrl: rewriteSignedUrl(data.signedUrl, req) });
  }

  // list
  // Storage layout: <instance_id>/<filename>
  // Discover instance folders (optionally filtered to one).
  const folders: string[] = [];
  if (body.instance_id) {
    folders.push(body.instance_id);
  } else {
    const { data: top, error: topErr } = await supabase.storage
      .from("frigate-backups")
      .list("", { limit: 1000 });
    if (topErr) return json({ error: "list failed", detail: topErr.message }, 500);
    for (const entry of top ?? []) {
      // Folders show up as entries with no metadata / id.
      if (entry && entry.name && (entry as any).id === null) folders.push(entry.name);
      else if (entry && entry.name && !entry.name.includes(".")) folders.push(entry.name);
    }
  }

  // Fetch instance names for display.
  const { data: insts } = await supabase
    .from("frigate_instances")
    .select("id, name, organization_id");
  const instMap = new Map<string, { name: string; organization_id: string }>(
    (insts ?? []).map((i: any) => [i.id, { name: i.name, organization_id: i.organization_id }]),
  );

  const items: Array<{
    path: string;
    name: string;
    instance_id: string;
    instance_name: string | null;
    organization_id: string | null;
    size: number | null;
    created_at: string | null;
  }> = [];

  for (const folder of folders) {
    const { data: files, error: fErr } = await supabase.storage
      .from("frigate-backups")
      .list(folder, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
    if (fErr) continue;
    const meta = instMap.get(folder);
    for (const f of files ?? []) {
      if (!f?.name || (f as any).id === null) continue;
      items.push({
        path: `${folder}/${f.name}`,
        name: f.name,
        instance_id: folder,
        instance_name: meta?.name ?? null,
        organization_id: meta?.organization_id ?? null,
        size: (f.metadata as any)?.size ?? null,
        created_at: f.created_at ?? (f as any).updated_at ?? null,
      });
    }
  }

  items.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  return json({ ok: true, items });
});
