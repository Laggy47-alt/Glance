
-- Step 1: Delete the 'test' org and its data
DO $$
DECLARE
  test_org uuid := 'c181e17d-b1d2-4d77-9828-5309347de06b';
  abc_org  uuid := 'c093c027-920c-4e88-865a-fb17413b3b5a';
BEGIN
  DELETE FROM public.media_tags WHERE organization_id = test_org;
  DELETE FROM public.media_items WHERE organization_id = test_org;
  DELETE FROM public.webhook_events WHERE organization_id = test_org;
  DELETE FROM public.webhook_sources WHERE organization_id = test_org;
  DELETE FROM public.frigate_instances WHERE organization_id = test_org;
  DELETE FROM public.camera_arm_audit WHERE organization_id = test_org;
  DELETE FROM public.camera_arm_schedule_runs WHERE organization_id = test_org;
  DELETE FROM public.camera_arm_schedules WHERE organization_id = test_org;
  DELETE FROM public.camera_armed_state WHERE organization_id = test_org;
  DELETE FROM public.camera_status WHERE organization_id = test_org;
  DELETE FROM public.auto_read_rules WHERE organization_id = test_org;
  DELETE FROM public.daily_report_runs WHERE organization_id = test_org;
  DELETE FROM public.daily_report_configs WHERE organization_id = test_org;
  DELETE FROM public.daily_report_settings WHERE organization_id = test_org;
  DELETE FROM public.callout_requests WHERE organization_id = test_org;
  DELETE FROM public.callout_settings WHERE organization_id = test_org;
  DELETE FROM public.customer_camera_assignments WHERE organization_id = test_org;
  DELETE FROM public.customer_nvr_assignments WHERE organization_id = test_org;
  DELETE FROM public.customer_offline_instructions WHERE organization_id = test_org;
  DELETE FROM public.event_audit_log WHERE organization_id = test_org;
  DELETE FROM public.offline_instruction_acks WHERE organization_id = test_org;
  DELETE FROM public.super_callout_requests WHERE organization_id = test_org;
  DELETE FROM public.app_settings WHERE organization_id = test_org;
  DELETE FROM public.organization_members WHERE organization_id = test_org;
  DELETE FROM public.organizations WHERE id = test_org;
END $$;

-- Step 2: Drop billing/payment tables and helpers
DROP TABLE IF EXISTS public.billing_acknowledgments CASCADE;
DROP TABLE IF EXISTS public.redemption_code_uses CASCADE;
DROP TABLE IF EXISTS public.redemption_codes CASCADE;
DROP TABLE IF EXISTS public.org_subscriptions CASCADE;
DROP TYPE IF EXISTS public.org_sub_status CASCADE;

DROP FUNCTION IF EXISTS public.org_is_active(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.org_trial_can_add_nvr(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.org_trial_can_send_email(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.increment_trial_email_count(uuid, integer) CASCADE;
DROP FUNCTION IF EXISTS public.redeem_code(text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.signup_create_trial_org(text, text) CASCADE;

-- Step 3: Hardcode current_user_org() to ABC
CREATE OR REPLACE FUNCTION public.current_user_org()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid
$$;

-- Step 4: Default organization_id to ABC on every tenant table
ALTER TABLE public.app_settings ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.auto_read_rules ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.callout_requests ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.callout_settings ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.camera_arm_audit ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.camera_arm_schedule_runs ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.camera_arm_schedules ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.camera_armed_state ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.camera_status ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.customer_camera_assignments ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.customer_nvr_assignments ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.customer_offline_instructions ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.daily_report_configs ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.daily_report_runs ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.daily_report_settings ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.event_audit_log ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.frigate_instances ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.media_items ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.media_tags ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.offline_instruction_acks ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.super_callout_requests ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.webhook_events ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;
ALTER TABLE public.webhook_sources ALTER COLUMN organization_id SET DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid;

-- Step 5: Lock organizations table — read-only for authenticated, super admin can write
DROP POLICY IF EXISTS "members can read their orgs" ON public.organizations;
DROP POLICY IF EXISTS "super admin full org access" ON public.organizations;
CREATE POLICY "orgs_read_authenticated" ON public.organizations FOR SELECT TO authenticated USING (true);
CREATE POLICY "orgs_super_write" ON public.organizations FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));

-- organization_members: keep existing policies (admins manage, super admin, self read) — fine.

-- Step 6: We can leave existing tenant RLS as-is because can_read_org / can_admin_org
-- still work — every authenticated user is a member of ABC. To guarantee that, ensure
-- every existing auth user is a member of ABC.
INSERT INTO public.organization_members(organization_id, user_id, role)
SELECT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid, u.id, 'customer'
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.organization_members m
  WHERE m.user_id = u.id AND m.organization_id = 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid
);

-- Step 7: Trigger to auto-add new auth users to ABC
CREATE OR REPLACE FUNCTION public.auto_add_to_abc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.organization_members(organization_id, user_id, role)
  VALUES ('c093c027-920c-4e88-865a-fb17413b3b5a'::uuid, NEW.id, 'customer')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS auto_add_to_abc_trigger ON auth.users;
CREATE TRIGGER auto_add_to_abc_trigger
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.auto_add_to_abc();
