// Admin users management — uses the service role key.
// Endpoints:
//   POST /admin-users/seed              -> idempotently creates the bootstrap admin (admin/admin)
//   POST /admin-users/create            -> { username, password, display_name, role } (caller must be admin, except during seed)
//   POST /admin-users/reset-password    -> { user_id, password } (caller must be admin)
//   POST /admin-users/delete            -> { user_id } (caller must be admin)
//
// Username login model: synthetic email = `${username}@local.app`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const usernameToEmail = (u: string) => `${u.toLowerCase().trim()}@local.app`;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

async function getCallerIsAdmin(authHeader: string | null): Promise<{ ok: boolean; userId?: string }> {
  if (!authHeader) return { ok: false };
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error } = await userClient.auth.getUser();
  if (error || !userData.user) return { ok: false };
  const a = admin();
  const { data: roleRow } = await a
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .eq("role", "admin")
    .maybeSingle();
  return { ok: !!roleRow, userId: userData.user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  const action = url.pathname.split("/").pop();

  try {
    const a = admin();

    if (action === "seed") {
      const email = usernameToEmail("admin");

      // Find existing admin auth user (if any)
      const { data: list } = await a.auth.admin.listUsers();
      let existing = list.users.find((u) => u.email === email);

      if (!existing) {
        const { data: created, error: createErr } = await a.auth.admin.createUser({
          email,
          password: "admin",
          email_confirm: true,
          user_metadata: { username: "admin", display_name: "Administrator", must_change_password: true },
        });
        if (createErr) return json({ ok: false, error: createErr.message }, 500);
        existing = created.user!;
      } else {
        // Ensure password is "admin" and account is confirmed (idempotent reset)
        await a.auth.admin.updateUserById(existing.id, {
          password: "admin",
          email_confirm: true,
          user_metadata: { username: "admin", display_name: "Administrator", must_change_password: true },
        });
      }

      // Ensure profile exists
      await a.from("profiles").upsert(
        { user_id: existing.id, username: "admin", display_name: "Administrator", must_change_password: true },
        { onConflict: "user_id" },
      );

      // Ensure admin role exists
      const { data: roleRow } = await a
        .from("user_roles")
        .select("id")
        .eq("user_id", existing.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!roleRow) {
        await a.from("user_roles").insert({ user_id: existing.id, role: "admin" });
      }

      return json({ ok: true, seeded: true, user_id: existing.id });
    }

    // All other endpoints require an admin caller
    const caller = await getCallerIsAdmin(req.headers.get("authorization"));
    if (!caller.ok) return json({ ok: false, error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    if (action === "create") {
      const username = String(body.username ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const display_name = String(body.display_name ?? username);
      const role = (body.role === "admin" ? "admin" : "user") as "admin" | "user";
      if (!username || !password) return json({ ok: false, error: "username and password required" }, 400);
      if (!/^[a-z0-9_.-]{2,32}$/.test(username)) return json({ ok: false, error: "invalid username" }, 400);

      const email = usernameToEmail(username);
      const { data: created, error } = await a.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username, display_name, must_change_password: true },
      });
      if (error) return json({ ok: false, error: error.message }, 400);
      await a.from("user_roles").insert({ user_id: created.user!.id, role });
      return json({ ok: true, user_id: created.user!.id });
    }

    if (action === "reset-password") {
      const user_id = String(body.user_id ?? "");
      const password = String(body.password ?? "");
      if (!user_id || !password) return json({ ok: false, error: "user_id and password required" }, 400);
      const { error } = await a.auth.admin.updateUserById(user_id, { password });
      if (error) return json({ ok: false, error: error.message }, 400);
      // Force change on next login
      await a.from("profiles").update({ must_change_password: true }).eq("user_id", user_id);
      return json({ ok: true });
    }

    if (action === "delete") {
      const user_id = String(body.user_id ?? "");
      if (!user_id) return json({ ok: false, error: "user_id required" }, 400);
      if (user_id === caller.userId) return json({ ok: false, error: "cannot delete yourself" }, 400);
      const { error } = await a.auth.admin.deleteUser(user_id);
      if (error) return json({ ok: false, error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ ok: false, error: "unknown action" }, 404);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
