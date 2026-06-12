// Public endpoint: given a username, return the list of org slugs that have
// an auth user with email `<username>@<slug>.local.app`. The login page uses
// this to attempt sign-in against the right tenant without asking the user
// to type the org. Returns at most a handful of slugs; never reveals
// whether a password is valid.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { username?: unknown } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const raw = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  if (!raw || raw.length > 64 || !/^[a-z0-9._-]+$/i.test(raw)) {
    return json({ slugs: [] });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const suffix = "@" /* + slug + */ + ".local.app";
  const slugs = new Set<string>();

  // Page through auth.users (admin API). Usually only one page is needed.
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return json({ error: "lookup_failed" }, 500);
    for (const u of data.users ?? []) {
      const email = (u.email ?? "").toLowerCase();
      const m = email.match(/^([^@]+)@([^.]+)\.local\.app$/);
      if (m && m[1] === raw) slugs.add(m[2]);
    }
    if (!data?.users?.length || data.users.length < 200) break;
  }

  return json({ slugs: Array.from(slugs) });
});
