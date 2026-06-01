// Admin users + organizations management — uses the service role key.
// Endpoints:
//   POST /admin-users/seed              -> idempotently checks/creates the bootstrap admin for the default org
//   POST /admin-users/create            -> { username, password, display_name, role, organization_id, contact_email }
//   POST /admin-users/reset-password    -> { user_id, password }
//   POST /admin-users/set-contact-email -> { user_id, contact_email }
//   POST /admin-users/delete            -> { user_id }
//   POST /admin-users/create-org        -> { slug, name }            (super-admin only)
//   POST /admin-users/list-orgs         -> {}                         (super-admin sees all, org-admins see their orgs)
//
// Login model: synthetic email = `${username}@${org_slug}.local.app`.

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

const buildEmail = (username: string, orgSlug: string) =>
  `${username.toLowerCase().trim()}@${orgSlug.toLowerCase().trim()}.local.app`;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

type CallerInfo = {
  userId: string;
  isSuperAdmin: boolean;
  adminOrgIds: Set<string>;
};

type AuthUserRecord = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
};

type UserIdRow = { user_id: string };

async function getCaller(authHeader: string | null): Promise<CallerInfo | null> {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error } = await userClient.auth.getUser();
  if (error || !userData.user) return null;
  const a = admin();
  const [{ data: roles }, { data: members }] = await Promise.all([
    a.from("user_roles").select("role").eq("user_id", userData.user.id),
    a.from("organization_members").select("organization_id, role").eq("user_id", userData.user.id),
  ]);
  const roleSet = new Set((roles ?? []).map((r) => r.role as string));
  const isSuperAdmin = roleSet.has("super_admin");
  const adminOrgIds = new Set<string>();
  for (const m of members ?? []) {
    const member = m as { role?: string; organization_id?: string };
    if (member.role === "admin" && member.organization_id) adminOrgIds.add(member.organization_id);
  }
  return { userId: userData.user.id, isSuperAdmin, adminOrgIds };
}

// Emergency credentials — must match src/lib/offlineMode.ts. These let the
// platform owner reset/create the bootstrap admin from the /offline page even
// when no working login exists (fresh self-host install, lost password, etc).
// Override via env EMERGENCY_USER / EMERGENCY_PASS for self-hosted deployments.
const EMERGENCY_USER = (Deno.env.get("EMERGENCY_USER") ?? "admin").toLowerCase();
const EMERGENCY_PASS = Deno.env.get("EMERGENCY_PASS") ?? "Abcsec2008";

const ABC_ORG_ID = "c093c027-920c-4e88-865a-fb17413b3b5a";
const ABC_ORG_SLUG = "abc-2026";
const ABC_ORG_NAME = "ABC";
const ADMIN_EMAIL = buildEmail("admin", ABC_ORG_SLUG);
const LEGACY_ADMIN_EMAILS = [ADMIN_EMAIL, "admin@local.app", "admin@super.local.app"];

async function listAllUsers(a: ReturnType<typeof admin>) {
  const users: AuthUserRecord[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await a.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    users.push(...((data?.users ?? []) as AuthUserRecord[]));
    if (!data?.users || data.users.length < 1000) break;
  }
  return users;
}

async function findBootstrapAdmin(a: ReturnType<typeof admin>) {
  const users = await listAllUsers(a);
  const byEmail = users.find((u) => LEGACY_ADMIN_EMAILS.includes(String(u.email ?? "").toLowerCase()));
  if (byEmail) return byEmail;

  const { data: profile } = await a.from("profiles").select("user_id").eq("username", "admin").maybeSingle();
  const row = profile as UserIdRow | null;
  if (row?.user_id) {
    return users.find((u) => u.id === row.user_id) ?? null;
  }
  return null;
}

async function ensureBootstrapOrg(a: ReturnType<typeof admin>): Promise<string> {
  const { data: byId } = await a.from("organizations").select("id").eq("id", ABC_ORG_ID).maybeSingle();
  if (byId) {
    await a.from("organizations").update({ slug: ABC_ORG_SLUG, name: ABC_ORG_NAME }).eq("id", ABC_ORG_ID);
    return ABC_ORG_ID;
  }
  const { data: bySlug } = await a.from("organizations").select("id").eq("slug", ABC_ORG_SLUG).maybeSingle();
  if (bySlug) {
    await a.from("organizations").update({ name: ABC_ORG_NAME }).eq("slug", ABC_ORG_SLUG);
    return (bySlug as { id: string }).id;
  }
  const { error } = await a.from("organizations").insert({ id: ABC_ORG_ID, slug: ABC_ORG_SLUG, name: ABC_ORG_NAME });
  if (error) throw new Error(`organization setup failed: ${error.message}`);
  return ABC_ORG_ID;
}

async function ensureBootstrapAdmin(a: ReturnType<typeof admin>, password?: string, resetPassword = false) {
  await ensureBootstrapOrg(a);

  let existing = await findBootstrapAdmin(a);
  let created = false;
  if (existing) {
    const attrs: Record<string, unknown> = { email: ADMIN_EMAIL, email_confirm: true };
    if (resetPassword && password) attrs.password = password;
    const { error } = await a.auth.admin.updateUserById(existing.id, attrs);
    if (error) throw new Error(`admin auth update failed: ${error.message}`);
  } else {
    if (!password) throw new Error("admin password is required");
    const { data, error } = await a.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password,
      email_confirm: true,
      user_metadata: { username: "admin", display_name: "Administrator", must_change_password: false, org_slug: ABC_ORG_SLUG },
    });
    if (error) {
      existing = await findBootstrapAdmin(a);
      if (!existing) throw new Error(`admin auth create failed: ${error.message}`);
    } else {
      existing = data.user;
      created = true;
    }
  }

  const userId = existing!.id;
  const { data: conflictingProfile } = await a.from("profiles").select("user_id").eq("username", "admin").maybeSingle();
  const conflictingProfileRow = conflictingProfile as UserIdRow | null;
  if (conflictingProfileRow?.user_id && conflictingProfileRow.user_id !== userId) {
    await a.from("profiles").update({ username: `admin_legacy_${Date.now()}` }).eq("user_id", conflictingProfileRow.user_id);
  }

  const { error: profileErr } = await a.from("profiles").upsert({
    user_id: userId,
    username: "admin",
    display_name: "Administrator",
    must_change_password: false,
  }, { onConflict: "user_id" });
  if (profileErr) throw new Error(`profile repair failed: ${profileErr.message}`);

  await a.from("user_roles").delete().eq("user_id", userId).eq("role", "super_admin");
  const { error: roleErr } = await a.from("user_roles").upsert(
    { user_id: userId, role: "admin" },
    { onConflict: "user_id,role" },
  );
  if (roleErr) throw new Error(`role repair failed: ${roleErr.message}`);

  const { error: memberErr } = await a.from("organization_members").upsert(
    { organization_id: ABC_ORG_ID, user_id: userId, role: "admin" },
    { onConflict: "organization_id,user_id" },
  );
  if (memberErr) throw new Error(`organization membership repair failed: ${memberErr.message}`);

  return { created, userId, organizationId: ABC_ORG_ID, username: "admin", loginEmail: ADMIN_EMAIL };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  const action = url.pathname.split("/").pop();

  try {
    const a = admin();

    if (action === "emergency-reset") {
      // Creates the bootstrap admin if missing, or resets its password.
      // Authenticated by the emergency credentials shipped in the client bundle
      // (or overridden via env on the server). Mirrors the seed flow.
      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      const emergencyUser = String(body.emergency_user ?? "").trim().toLowerCase();
      const emergencyPass = String(body.emergency_pass ?? "");
      const newPassword = String(body.new_password ?? "");
      if (emergencyUser !== EMERGENCY_USER || emergencyPass !== EMERGENCY_PASS) {
        return json({ ok: false, error: "invalid emergency credentials" }, 401);
      }
      if (newPassword.length < 8) {
        return json({ ok: false, error: "new_password must be at least 8 characters" }, 400);
      }

      try {
        const result = await ensureBootstrapAdmin(a, newPassword, true);
        return json({
          ok: true,
          created: result.created,
          user_id: result.userId,
          organization_id: result.organizationId,
          username: result.username,
          login_email: result.loginEmail,
        });
      } catch (e) {
        // Surface auth/validation errors (e.g. weak password) as 400 so the
        // client UI can show the underlying reason instead of a generic
        // "Edge Function returned a non-2xx status code".
        return json({ ok: false, error: (e as Error).message }, 400);
      }
    }

    if (action === "seed") {
      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      const requestedPassword = String(body.password ?? "");
      const checkOnly = Boolean(body.check_only);
      // Default organization for all self-hosted installs. Matches the default
      // organization_id used across the schema. We always ensure this org row
      // exists, then ensure an admin account exists that is an admin
      // of this org. No super_admin role is created — the bootstrap user is
      // a normal org admin so it can immediately manage users, sites, etc.
      await ensureBootstrapOrg(a);
      const existing = await findBootstrapAdmin(a);

      if (existing) {
        const result = await ensureBootstrapAdmin(a, undefined, false);
        return json({ ok: true, exists: true, seeded: false, reset: false, user_id: result.userId, organization_id: result.organizationId });
      }
      if (checkOnly || !requestedPassword) {
        return json({ ok: true, exists: false, needs_password: true, organization_id: ABC_ORG_ID }, 200);
      }
      if (requestedPassword.length < 8) {
        return json({ ok: false, error: "password must be at least 8 characters" }, 400);
      }
      const result = await ensureBootstrapAdmin(a, requestedPassword, false);

      return json({ ok: true, exists: true, seeded: result.created, reset: false, user_id: result.userId, organization_id: result.organizationId });
    }

    // All other endpoints require an authenticated caller
    const caller = await getCaller(req.headers.get("authorization"));
    if (!caller) return json({ ok: false, error: "forbidden" }, 403);
    const isAnyAdmin = caller.isSuperAdmin || caller.adminOrgIds.size > 0;
    if (!isAnyAdmin) return json({ ok: false, error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    if (action === "create-org") {
      if (!caller.isSuperAdmin) return json({ ok: false, error: "super-admin only" }, 403);
      const slug = String(body.slug ?? "").trim().toLowerCase();
      const name = String(body.name ?? "").trim();
      if (!/^[a-z0-9-]{2,40}$/.test(slug)) return json({ ok: false, error: "invalid slug (a-z, 0-9, -)" }, 400);
      if (slug === "super") return json({ ok: false, error: "reserved slug" }, 400);
      if (!name) return json({ ok: false, error: "name required" }, 400);
      const { data, error } = await a.from("organizations").insert({ slug, name, created_by: caller.userId })
        .select("id, slug, name, created_at").single();
      if (error) return json({ ok: false, error: error.message }, 400);

      // Seed the new org by duplicating settings (NOT data) from the most recently
      // created prior org. This gives the new tenant the same structural setup
      // (branding, callout settings, daily report email/SMTP settings, default
      // daily-report email template) without copying any operational data
      // (sites, events, users, configs, callouts, media, etc.).
      try {
        const newOrgId = (data as any).id as string;
        const sourceOrgId = String(body.copy_from ?? "").trim() || null;

        let templateOrgId: string | null = sourceOrgId;
        if (!templateOrgId) {
          const { data: prev } = await a
            .from("organizations")
            .select("id")
            .neq("id", newOrgId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          templateOrgId = (prev as any)?.id ?? null;
        }

        const stripIds = <T extends Record<string, unknown>>(row: T): Omit<T, "id" | "created_at" | "updated_at"> => {
          const { id: _i, created_at: _c, updated_at: _u, ...rest } = row as any;
          return rest;
        };

        if (templateOrgId) {
          // app_settings (branding)
          const { data: appS } = await a.from("app_settings")
            .select("*").eq("organization_id", templateOrgId).maybeSingle();
          if (appS) {
            await a.from("app_settings").insert({ ...stripIds(appS as any), organization_id: newOrgId, updated_by: caller.userId });
          }
          // callout_settings
          const { data: callS } = await a.from("callout_settings")
            .select("*").eq("organization_id", templateOrgId).maybeSingle();
          if (callS) {
            await a.from("callout_settings").insert({ ...stripIds(callS as any), organization_id: newOrgId });
          }
          // daily_report_settings (SMTP/from address etc.)
          const { data: drs } = await a.from("daily_report_settings")
            .select("*").eq("organization_id", templateOrgId).maybeSingle();
          if (drs) {
            await a.from("daily_report_settings").insert({ ...stripIds(drs as any), organization_id: newOrgId });
          }
        }
      } catch (e) {
        console.error("create-org seeding failed", e);
        // Non-fatal — the org still exists; admins can configure manually.
      }

      return json({ ok: true, organization: data });
    }

    if (action === "list-orgs") {
      if (caller.isSuperAdmin) {
        const { data } = await a.from("organizations").select("id, slug, name, created_at").order("name");
        return json({ ok: true, organizations: data ?? [] });
      }
      const ids = Array.from(caller.adminOrgIds);
      if (ids.length === 0) return json({ ok: true, organizations: [] });
      const { data } = await a.from("organizations").select("id, slug, name, created_at").in("id", ids).order("name");
      return json({ ok: true, organizations: data ?? [] });
    }

    if (action === "delete-org") {
      if (!caller.isSuperAdmin) return json({ ok: false, error: "super-admin only" }, 403);
      const organization_id = String(body.organization_id ?? "").trim();
      if (!organization_id) return json({ ok: false, error: "organization_id required" }, 400);

      const { data: org } = await a.from("organizations")
        .select("id, slug").eq("id", organization_id).maybeSingle();
      if (!org) return json({ ok: false, error: "organization not found" }, 404);
      if ((org as any).slug === "super") return json({ ok: false, error: "cannot delete the super organization" }, 400);

      const orgScopedTables = [
        "media_tags", "media_items", "event_audit_log",
        "webhook_events", "webhook_sources", "frigate_instances",
        "auto_read_rules", "camera_arm_audit", "camera_arm_schedule_runs",
        "camera_arm_schedules", "camera_armed_state", "camera_status",
        "offline_instruction_acks", "customer_offline_instructions",
        "customer_camera_assignments", "customer_nvr_assignments",
        "callout_requests", "callout_settings", "super_callout_requests",
        "daily_report_runs", "daily_report_configs", "daily_report_settings",
        "app_settings",
      ];
      for (const t of orgScopedTables) {
        const { error: delErr } = await a.from(t).delete().eq("organization_id", organization_id);
        if (delErr) console.error(`delete-org: failed clearing ${t}`, delErr.message);
      }

      const { data: members } = await a.from("organization_members")
        .select("user_id").eq("organization_id", organization_id);
      const memberIds = Array.from(new Set((members ?? []).map((m: any) => m.user_id as string)));

      await a.from("organization_members").delete().eq("organization_id", organization_id);

      for (const uid of memberIds) {
        if (uid === caller.userId) continue;
        const { count } = await a.from("organization_members")
          .select("user_id", { count: "exact", head: true }).eq("user_id", uid);
        if ((count ?? 0) === 0) {
          await a.from("user_roles").delete().eq("user_id", uid);
          await a.from("profiles").delete().eq("user_id", uid);
          const { error: authErr } = await a.auth.admin.deleteUser(uid);
          if (authErr) console.error(`delete-org: failed deleting auth user ${uid}`, authErr.message);
        }
      }

      const { error: orgErr } = await a.from("organizations").delete().eq("id", organization_id);
      if (orgErr) return json({ ok: false, error: orgErr.message }, 400);

      return json({ ok: true });
    }

    if (action === "create") {
      const username = String(body.username ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const display_name = String(body.display_name ?? username);
      const requestedRole = String(body.role ?? "user");
      // Accepted: admin (org admin), user (operator), customer (end-customer with NVR access)
      const role = (["admin", "user", "customer"].includes(requestedRole) ? requestedRole : "user") as "admin" | "user" | "customer";
      const organization_id = String(body.organization_id ?? "");
      if (!username || !password) return json({ ok: false, error: "username and password required" }, 400);
      if (!/^[a-z0-9_.-]{2,32}$/.test(username)) return json({ ok: false, error: "invalid username" }, 400);
      if (!organization_id) return json({ ok: false, error: "organization_id required" }, 400);

      // Authorization: super-admin can target any org, org-admin only their own orgs
      if (!caller.isSuperAdmin && !caller.adminOrgIds.has(organization_id)) {
        return json({ ok: false, error: "forbidden for this organization" }, 403);
      }

      const { data: org, error: orgErr } = await a.from("organizations")
        .select("id, slug, name").eq("id", organization_id).maybeSingle();
      if (orgErr || !org) return json({ ok: false, error: "organization not found" }, 404);

      const contact_email_raw = String(body.contact_email ?? "").trim();
      const contact_email = contact_email_raw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email_raw) ? contact_email_raw : null;

      const email = buildEmail(username, org.slug);
      const { data: created, error } = await a.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { username, display_name, must_change_password: true, org_slug: org.slug },
      });
      if (error) return json({ ok: false, error: error.message }, 400);
      const newId = created.user!.id;

      // Org membership: enum supports admin/customer. Operators (role='user') get
      // 'customer' membership for org-scoping while their app_role 'user' grants operator UI.
      const memberRole = role === "admin" ? "admin" : "customer";
      await a.from("organization_members").insert({ organization_id: org.id, user_id: newId, role: memberRole });
      // Legacy app_role drives UI gating (admin / user / customer)
      await a.from("user_roles").insert({ user_id: newId, role });

      if (contact_email) {
        await a.from("profiles").update({ contact_email }).eq("user_id", newId);
      }
      return json({ ok: true, user_id: newId });
    }

    if (action === "set-contact-email") {
      const user_id = String(body.user_id ?? "");
      const raw = String(body.contact_email ?? "").trim();
      const contact_email = raw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : null;
      if (!user_id) return json({ ok: false, error: "user_id required" }, 400);
      if (raw && !contact_email) return json({ ok: false, error: "invalid email" }, 400);
      const { error } = await a.from("profiles").update({ contact_email }).eq("user_id", user_id);
      if (error) return json({ ok: false, error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "reset-password") {
      const user_id = String(body.user_id ?? "");
      const password = String(body.password ?? "");
      if (!user_id || !password) return json({ ok: false, error: "user_id and password required" }, 400);
      const { error } = await a.auth.admin.updateUserById(user_id, { password });
      if (error) return json({ ok: false, error: error.message }, 400);
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
