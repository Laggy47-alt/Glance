
-- Make the super admin also an admin member of ABC so legacy admin flows keep working
DO $$
DECLARE
  abc_id UUID;
  bootstrap_admin UUID;
BEGIN
  SELECT id INTO abc_id FROM public.organizations WHERE slug = 'abc-2026';
  SELECT user_id INTO bootstrap_admin FROM public.profiles WHERE username = 'admin' LIMIT 1;
  IF abc_id IS NOT NULL AND bootstrap_admin IS NOT NULL THEN
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (abc_id, bootstrap_admin, 'admin')
    ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'admin';
  END IF;
END $$;

-- Generic trigger: if organization_id is NULL on insert, fill from caller's primary membership
CREATE OR REPLACE FUNCTION public.fill_organization_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  oid UUID;
BEGIN
  IF NEW.organization_id IS NULL AND uid IS NOT NULL THEN
    -- Prefer admin membership, otherwise any membership
    SELECT organization_id INTO oid FROM public.organization_members
     WHERE user_id = uid ORDER BY (role = 'admin') DESC LIMIT 1;
    IF oid IS NOT NULL THEN NEW.organization_id := oid; END IF;
  END IF;
  RETURN NEW;
END $$;

-- Apply trigger to tenant tables
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'frigate_instances','webhook_sources','webhook_events','media_items','media_tags',
    'event_audit_log','callout_requests','callout_settings','daily_report_configs',
    'daily_report_runs','daily_report_settings','camera_arm_schedules',
    'camera_arm_schedule_runs','camera_arm_audit','camera_armed_state','camera_status',
    'customer_nvr_assignments','customer_camera_assignments','customer_offline_instructions',
    'offline_instruction_acks','auto_read_rules','app_settings'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_fill_org ON public.%I;', t);
    EXECUTE format('CREATE TRIGGER trg_fill_org BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fill_organization_id();', t);
  END LOOP;
END $$;
