-- ============================================================================
-- Strict tenant isolation patch for existing self-hosted installs.
--
-- Apply with:
--   docker exec -i supabase-db psql -U postgres -d postgres < docs/migrations/002_strict_org_isolation.sql
--
-- This intentionally does NOT backfill memberships or move data. It only fixes
-- helper functions and replaces permissive policies so org data is isolated.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _user_id AND role = 'super_admin'::public.app_role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_members
     WHERE user_id = _user_id AND organization_id = _org_id
  )
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(_user_id uuid, _org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_members
     WHERE user_id = _user_id
       AND organization_id = _org_id
       AND role = 'admin'::public.org_member_role
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
   ORDER BY (role = 'admin'::public.org_member_role) DESC, created_at ASC
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.user_org_ids(_user_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT organization_id FROM public.organization_members WHERE user_id = _user_id
$$;

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
  r record;
  isolation_tables text[] := ARRAY[
    'app_settings','auto_read_rules','callout_requests','callout_settings',
    'camera_arm_audit','camera_arm_schedule_runs','camera_arm_schedules',
    'camera_armed_state','camera_offline_alerts','camera_status',
    'customer_camera_assignments','customer_nvr_assignments',
    'customer_offline_instructions','daily_report_configs','daily_report_runs',
    'daily_report_settings','frigate_instances','media_items','media_tags',
    'offline_instruction_acks','organizations','organization_members',
    'platform_settings','profiles','super_callout_requests','user_roles',
    'webhook_events','webhook_sources','whatsapp_incoming_messages',
    'whatsapp_settings'
  ];
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = ANY(isolation_tables)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
  org_tables text[] := ARRAY[
    'app_settings','auto_read_rules','callout_requests','callout_settings',
    'camera_arm_audit','camera_arm_schedule_runs','camera_arm_schedules',
    'camera_armed_state','camera_offline_alerts','camera_status',
    'customer_camera_assignments','customer_nvr_assignments',
    'customer_offline_instructions','daily_report_configs','daily_report_runs',
    'daily_report_settings','frigate_instances','media_items','media_tags',
    'offline_instruction_acks','organization_members','super_callout_requests',
    'webhook_events','webhook_sources','whatsapp_incoming_messages',
    'whatsapp_settings'
  ];
BEGIN
  FOREACH t IN ARRAY org_tables LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.can_read_org(organization_id)) WITH CHECK (public.can_read_org(organization_id))',
      t || '_tenant_boundary', t
    );
  END LOOP;
END $$;

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
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_read_org(organization_id))', t || '_org_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_admin_org(organization_id))', t || '_org_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.can_admin_org(organization_id)) WITH CHECK (public.can_admin_org(organization_id))', t || '_org_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.can_admin_org(organization_id))', t || '_org_delete', t);
  END LOOP;
END $$;

CREATE POLICY callout_requests_org_read ON public.callout_requests FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY callout_requests_org_insert ON public.callout_requests FOR INSERT TO authenticated
  WITH CHECK (public.can_read_org(organization_id));
CREATE POLICY callout_requests_org_update ON public.callout_requests FOR UPDATE TO authenticated
  USING (public.can_admin_org(organization_id)) WITH CHECK (public.can_admin_org(organization_id));
CREATE POLICY callout_requests_org_delete ON public.callout_requests FOR DELETE TO authenticated
  USING (public.can_admin_org(organization_id));

DO $$
DECLARE
  t text;
  cust_tables text[] := ARRAY[
    'customer_camera_assignments','customer_nvr_assignments','offline_instruction_acks'
  ];
BEGIN
  FOREACH t IN ARRAY cust_tables LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_read_org(organization_id) OR user_id = auth.uid())', t || '_org_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_admin_org(organization_id) OR user_id = auth.uid())', t || '_org_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.can_admin_org(organization_id) OR user_id = auth.uid()) WITH CHECK (public.can_admin_org(organization_id) OR user_id = auth.uid())', t || '_org_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.can_admin_org(organization_id))', t || '_org_delete', t);
  END LOOP;
END $$;

CREATE POLICY whatsapp_incoming_messages_org_read ON public.whatsapp_incoming_messages
  FOR SELECT TO authenticated USING (public.can_read_org(organization_id));
CREATE POLICY whatsapp_incoming_messages_org_update ON public.whatsapp_incoming_messages
  FOR UPDATE TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));

CREATE POLICY organizations_member_read ON public.organizations FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR id IN (SELECT public.user_org_ids(auth.uid())));
CREATE POLICY organizations_super_insert ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY organizations_super_update ON public.organizations FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY organizations_super_delete ON public.organizations FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY organization_members_org_read ON public.organization_members FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY organization_members_org_insert ON public.organization_members FOR INSERT TO authenticated
  WITH CHECK (public.can_admin_org(organization_id));
CREATE POLICY organization_members_org_update ON public.organization_members FOR UPDATE TO authenticated
  USING (public.can_admin_org(organization_id)) WITH CHECK (public.can_admin_org(organization_id));
CREATE POLICY organization_members_org_delete ON public.organization_members FOR DELETE TO authenticated
  USING (public.can_admin_org(organization_id));

CREATE POLICY user_roles_self_read ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY user_roles_super_insert ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY user_roles_super_update ON public.user_roles FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY user_roles_super_delete ON public.user_roles FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));

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

CREATE POLICY platform_settings_super_all ON public.platform_settings FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

COMMIT;