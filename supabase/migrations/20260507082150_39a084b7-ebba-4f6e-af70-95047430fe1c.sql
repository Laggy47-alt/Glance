
-- Helper that returns the caller's primary org (admin pref'd)
CREATE OR REPLACE FUNCTION public.current_user_org()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM public.organization_members
   WHERE user_id = auth.uid()
   ORDER BY (role = 'admin') DESC
   LIMIT 1
$$;

-- Apply as DEFAULT so types treat the column as optional
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
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET DEFAULT public.current_user_org();', t);
  END LOOP;
END $$;
