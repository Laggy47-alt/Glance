-- ============================================================================
-- Multi-tenancy: real org scoping
--
-- Apply to your SELF-HOSTED Supabase via either:
--   psql "$DATABASE_URL" -f docs/migrations/001_multi_tenancy.sql
-- or paste into Studio > SQL Editor.
--
-- Safe to re-run: every DDL is idempotent.
--
-- What it does:
--   1. Backfills organization_members from user_roles for any users who are
--      not yet members of an org.
--   2. Backfills NULL organization_id rows on media_items / webhook_events /
--      auto_read_rules / media_tags / camera_arm_audit /
--      camera_arm_schedule_runs / daily_report_runs to the (only) existing org.
--   3. Sets NOT NULL + FK on every organization_id column.
--   4. Rewrites helper functions so RLS actually scopes by org membership
--      (was: any logged-in user sees everything).
--   5. Replaces every "*_authenticated_all" stub policy with real per-org
--      policies (members read, org admins write).
--   6. Updates fill_organization_id() trigger to populate from
--      current_user_org() on insert when the caller forgot to set it.
--
-- After applying, run the Supabase linter to confirm no table is left
-- without RLS.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Backfill organization_members + nullable organization_id rows
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  default_org uuid;
BEGIN
  SELECT id INTO default_org FROM public.organizations ORDER BY created_at LIMIT 1;
  IF default_org IS NULL THEN
    RAISE EXCEPTION 'No organizations row exists; cannot backfill memberships.';
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  SELECT default_org,
         ur.user_id,
         CASE
           WHEN bool_or(ur.role::text IN ('super_admin','admin')) THEN 'admin'::public.org_member_role
           ELSE 'customer'::public.org_member_role
         END
    FROM public.user_roles ur
   GROUP BY ur.user_id
  ON CONFLICT (organization_id, user_id) DO UPDATE
     SET role = CASE
                  WHEN EXCLUDED.role = 'admin'::public.org_member_role THEN 'admin'::public.org_member_role
                  ELSE public.organization_members.role
                END;

  UPDATE public.media_items             SET organization_id = default_org WHERE organization_id IS NULL;
  UPDATE public.webhook_events          SET organization_id = default_org WHERE organization_id IS NULL;
  UPDATE public.auto_read_rules         SET organization_id = default_org WHERE organization_id IS NULL;
  UPDATE public.media_tags              SET organization_id = default_org WHERE organization_id IS NULL;
  UPDATE public.camera_arm_audit        SET organization_id = default_org WHERE organization_id IS NULL;
  UPDATE public.camera_arm_schedule_runs SET organization_id = default_org WHERE organization_id IS NULL;
  UPDATE public.daily_report_runs       SET organization_id = default_org WHERE organization_id IS NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 2. NOT NULL + FK on every organization_id column
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  nullable_tables text[] := ARRAY[
    'auto_read_rules','camera_arm_audit','camera_arm_schedule_runs',
    'daily_report_runs','media_items','media_tags','webhook_events'
  ];
BEGIN
  FOREACH t IN ARRAY nullable_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL', t);
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
  fk_name text;
  fk_tables text[] := ARRAY[
    'app_settings','auto_read_rules','callout_requests','callout_settings',
    'camera_arm_audit','camera_arm_schedule_runs','camera_arm_schedules',
    'camera_armed_state','camera_offline_alerts','camera_status',
    'customer_camera_assignments','customer_nvr_assignments',
    'customer_offline_instructions','daily_report_configs','daily_report_runs',
    'daily_report_settings','frigate_instances','media_items','media_tags',
    'offline_instruction_acks','super_callout_requests','webhook_events',
    'webhook_sources','whatsapp_incoming_messages','whatsapp_settings'
  ];
BEGIN
  FOREACH t IN ARRAY fk_tables LOOP
    fk_name := t || '_organization_id_fkey';
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = fk_name AND conrelid = ('public.'||t)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE',
        t, fk_name
      );
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Helper functions (real implementations)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND (
    public.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.organization_members
       WHERE user_id = _user_id AND organization_id = _org_id
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(_user_id uuid, _org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND (
    public.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.organization_members
       WHERE user_id = _user_id
         AND organization_id = _org_id
         AND role = 'admin'::public.org_member_role
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_read_org(_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.is_org_member(auth.uid(), _org_id) $$;

CREATE OR REPLACE FUNCTION public.can_admin_org(_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.is_org_admin(auth.uid(), _org_id) $$;

CREATE OR REPLACE FUNCTION public.current_user_org()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT organization_id FROM public.organization_members
   WHERE user_id = auth.uid()
   ORDER BY (role = 'admin'::public.app_role) DESC, created_at ASC
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.user_org_ids(_user_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT organization_id FROM public.organization_members WHERE user_id = _user_id
$$;

-- ----------------------------------------------------------------------------
-- 4. fill_organization_id trigger (auto-set on insert when missing)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fill_organization_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := public.current_user_org();
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  t text;
  trig_tables text[] := ARRAY[
    'app_settings','auto_read_rules','callout_requests','callout_settings',
    'camera_arm_audit','camera_arm_schedule_runs','camera_arm_schedules',
    'camera_armed_state','camera_offline_alerts','camera_status',
    'customer_camera_assignments','customer_nvr_assignments',
    'customer_offline_instructions','daily_report_configs','daily_report_runs',
    'daily_report_settings','frigate_instances','media_items','media_tags',
    'offline_instruction_acks','super_callout_requests','webhook_events',
    'webhook_sources','whatsapp_incoming_messages','whatsapp_settings'
  ];
BEGIN
  FOREACH t IN ARRAY trig_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_fill_org_id ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_fill_org_id BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fill_organization_id()',
      t
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Replace stub policies with real org-scoped policies
-- ----------------------------------------------------------------------------

-- Drop existing stub policies on public schema.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname FROM pg_policies
     WHERE schemaname = 'public' AND policyname LIKE '%_authenticated_all'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- Drop policies we explicitly replace below.
DROP POLICY IF EXISTS "Authenticated users can read incoming messages"   ON public.whatsapp_incoming_messages;
DROP POLICY IF EXISTS "Authenticated users can update incoming messages" ON public.whatsapp_incoming_messages;
DROP POLICY IF EXISTS "Org admins manage whatsapp settings"              ON public.whatsapp_settings;

-- Admin-write tables: members read, org admins write.
DO $$
DECLARE
  t text;
  admin_write_tables text[] := ARRAY[
    'app_settings','auto_read_rules','callout_settings',
    'camera_arm_audit','camera_arm_schedule_runs','camera_arm_schedules',
    'camera_armed_state','camera_offline_alerts','camera_status',
    'customer_offline_instructions','daily_report_configs','daily_report_runs',
    'daily_report_settings','frigate_instances','media_items','media_tags',
    'super_callout_requests','webhook_events','webhook_sources',
    'whatsapp_settings'
  ];
BEGIN
  FOREACH t IN ARRAY admin_write_tables LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_read_org(organization_id))',
      t || '_org_read', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_admin_org(organization_id))',
      t || '_org_insert', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.can_admin_org(organization_id)) WITH CHECK (public.can_admin_org(organization_id))',
      t || '_org_update', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.can_admin_org(organization_id))',
      t || '_org_delete', t
    );
  END LOOP;
END $$;

-- callout_requests: any member can create a callout; admins manage.
CREATE POLICY callout_requests_org_read   ON public.callout_requests FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY callout_requests_org_insert ON public.callout_requests FOR INSERT TO authenticated
  WITH CHECK (public.can_read_org(organization_id));
CREATE POLICY callout_requests_org_update ON public.callout_requests FOR UPDATE TO authenticated
  USING (public.can_admin_org(organization_id)) WITH CHECK (public.can_admin_org(organization_id));
CREATE POLICY callout_requests_org_delete ON public.callout_requests FOR DELETE TO authenticated
  USING (public.can_admin_org(organization_id));

-- Customer assignment / ack tables: members read; assigned user reads + updates own; admins manage.
DO $$
DECLARE
  t text;
  cust_tables text[] := ARRAY[
    'customer_camera_assignments','customer_nvr_assignments','offline_instruction_acks'
  ];
BEGIN
  FOREACH t IN ARRAY cust_tables LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_read_org(organization_id) OR user_id = auth.uid())',
      t || '_org_read', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_admin_org(organization_id) OR user_id = auth.uid())',
      t || '_org_insert', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.can_admin_org(organization_id) OR user_id = auth.uid()) WITH CHECK (public.can_admin_org(organization_id) OR user_id = auth.uid())',
      t || '_org_update', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.can_admin_org(organization_id))',
      t || '_org_delete', t
    );
  END LOOP;
END $$;

-- whatsapp_incoming_messages: org-scoped reads + updates (service role inserts via SECURITY DEFINER bypass RLS).
CREATE POLICY whatsapp_incoming_messages_org_read ON public.whatsapp_incoming_messages
  FOR SELECT TO authenticated USING (public.can_read_org(organization_id));
CREATE POLICY whatsapp_incoming_messages_org_update ON public.whatsapp_incoming_messages
  FOR UPDATE TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));

-- organizations: every member sees their org; super_admin manages.
CREATE POLICY organizations_member_read ON public.organizations FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR id IN (SELECT public.user_org_ids(auth.uid())));
CREATE POLICY organizations_super_insert ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY organizations_super_update ON public.organizations FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY organizations_super_delete ON public.organizations FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- organization_members: members see roster; org admin / super_admin manages.
CREATE POLICY organization_members_org_read ON public.organization_members FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY organization_members_org_insert ON public.organization_members FOR INSERT TO authenticated
  WITH CHECK (public.can_admin_org(organization_id));
CREATE POLICY organization_members_org_update ON public.organization_members FOR UPDATE TO authenticated
  USING (public.can_admin_org(organization_id)) WITH CHECK (public.can_admin_org(organization_id));
CREATE POLICY organization_members_org_delete ON public.organization_members FOR DELETE TO authenticated
  USING (public.can_admin_org(organization_id));

-- user_roles: users see their own row; super_admin sees all and manages.
CREATE POLICY user_roles_self_read ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY user_roles_super_insert ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY user_roles_super_update ON public.user_roles FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY user_roles_super_delete ON public.user_roles FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- profiles: self + same-org members readable; self/super_admin can write.
CREATE POLICY profiles_self_or_same_org_read ON public.profiles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1
        FROM public.organization_members me
        JOIN public.organization_members them
          ON them.organization_id = me.organization_id
       WHERE me.user_id = auth.uid()
         AND them.user_id = public.profiles.user_id
    )
  );
CREATE POLICY profiles_self_insert ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_super_admin(auth.uid()));

-- platform_settings: super_admin only.
CREATE POLICY platform_settings_super_all ON public.platform_settings FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

COMMIT;

-- ---------------------------------------------------------------------------
-- Foreign keys for organization_members (required so PostgREST embedded
-- selects like organization_members?select=organizations(...) resolve).
-- Idempotent: drop-if-exists then add. Orphans (memberships pointing at a
-- deleted user or organization) are cleaned up first.
-- ---------------------------------------------------------------------------
BEGIN;

DELETE FROM public.organization_members om
 WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = om.user_id)
    OR NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = om.organization_id);

ALTER TABLE public.organization_members
  DROP CONSTRAINT IF EXISTS organization_members_organization_id_fkey;
ALTER TABLE public.organization_members
  ADD CONSTRAINT organization_members_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.organization_members
  DROP CONSTRAINT IF EXISTS organization_members_user_id_fkey;
ALTER TABLE public.organization_members
  ADD CONSTRAINT organization_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

COMMIT;
