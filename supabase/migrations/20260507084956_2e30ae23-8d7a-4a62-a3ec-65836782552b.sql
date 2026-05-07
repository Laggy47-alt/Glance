
-- Helper functions (idempotent rewrites)
CREATE OR REPLACE FUNCTION public.can_read_org(_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(auth.uid())
      OR EXISTS (SELECT 1 FROM public.organization_members
                 WHERE user_id = auth.uid() AND organization_id = _org_id)
$$;

CREATE OR REPLACE FUNCTION public.can_admin_org(_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(auth.uid())
      OR EXISTS (SELECT 1 FROM public.organization_members
                 WHERE user_id = auth.uid() AND organization_id = _org_id AND role = 'admin')
$$;

-- Generic policy reset helper (drop everything on a table)
DO $$
DECLARE
  t text;
  p text;
  tables text[] := ARRAY[
    'app_settings','auto_read_rules','callout_requests','callout_settings',
    'camera_arm_audit','camera_arm_schedule_runs','camera_arm_schedules','camera_armed_state',
    'camera_status','customer_camera_assignments','customer_nvr_assignments','customer_offline_instructions',
    'daily_report_configs','daily_report_runs','daily_report_settings','event_audit_log',
    'frigate_instances','media_items','media_tags','offline_instruction_acks',
    'webhook_events','webhook_sources','super_callout_requests'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p, t);
    END LOOP;
  END LOOP;
END $$;

------------------------------------------------------------------
-- STANDARD TENANT TABLES (read=member, write=admin)
------------------------------------------------------------------

-- app_settings
CREATE POLICY app_settings_read ON public.app_settings FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY app_settings_write ON public.app_settings FOR ALL TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));

-- auto_read_rules
CREATE POLICY auto_read_rules_read ON public.auto_read_rules FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY auto_read_rules_write ON public.auto_read_rules FOR ALL TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));

-- callout_settings
CREATE POLICY callout_settings_read ON public.callout_settings FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY callout_settings_write ON public.callout_settings FOR ALL TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));

-- camera_arm_audit
CREATE POLICY camera_arm_audit_read ON public.camera_arm_audit FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY camera_arm_audit_insert ON public.camera_arm_audit FOR INSERT TO authenticated
  WITH CHECK (public.can_read_org(organization_id));
CREATE POLICY camera_arm_audit_admin_delete ON public.camera_arm_audit FOR DELETE TO authenticated
  USING (public.can_admin_org(organization_id));

-- camera_arm_schedule_runs
CREATE POLICY camera_arm_schedule_runs_read ON public.camera_arm_schedule_runs FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY camera_arm_schedule_runs_write ON public.camera_arm_schedule_runs FOR ALL TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));

-- camera_arm_schedules
CREATE POLICY camera_arm_schedules_read ON public.camera_arm_schedules FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY camera_arm_schedules_write ON public.camera_arm_schedules FOR ALL TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));

-- camera_armed_state (customers can write for assigned NVRs)
CREATE POLICY camera_armed_state_read ON public.camera_armed_state FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY camera_armed_state_admin ON public.camera_armed_state FOR ALL TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));
CREATE POLICY camera_armed_state_customer_insert ON public.camera_armed_state FOR INSERT TO authenticated
  WITH CHECK (public.can_read_org(organization_id) AND public.user_has_instance(auth.uid(), instance_id));
CREATE POLICY camera_armed_state_customer_update ON public.camera_armed_state FOR UPDATE TO authenticated
  USING (public.can_read_org(organization_id) AND public.user_has_instance(auth.uid(), instance_id))
  WITH CHECK (public.can_read_org(organization_id) AND public.user_has_instance(auth.uid(), instance_id));

-- camera_status
CREATE POLICY camera_status_read ON public.camera_status FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY camera_status_write ON public.camera_status FOR ALL TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));

-- customer_nvr_assignments
CREATE POLICY cna_admin ON public.customer_nvr_assignments FOR ALL TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));
CREATE POLICY cna_self_read ON public.customer_nvr_assignments FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- customer_camera_assignments
CREATE POLICY cca_admin ON public.customer_camera_assignments FOR ALL TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));
CREATE POLICY cca_self_read ON public.customer_camera_assignments FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- customer_offline_instructions
CREATE POLICY coi_read ON public.customer_offline_instructions FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY coi_admin ON public.customer_offline_instructions FOR ALL TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));
CREATE POLICY coi_self ON public.customer_offline_instructions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.user_has_instance(auth.uid(), instance_id));

-- callout_requests
CREATE POLICY callout_requests_admin ON public.callout_requests FOR ALL TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));
CREATE POLICY callout_requests_customer_read ON public.callout_requests FOR SELECT TO authenticated
  USING (requested_by = auth.uid());
CREATE POLICY callout_requests_customer_create ON public.callout_requests FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid() AND public.user_has_instance(auth.uid(), instance_id));

-- daily_report_configs
CREATE POLICY drc_read ON public.daily_report_configs FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY drc_write ON public.daily_report_configs FOR ALL TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));

-- daily_report_runs
CREATE POLICY drr_read ON public.daily_report_runs FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY drr_insert ON public.daily_report_runs FOR INSERT TO authenticated
  WITH CHECK (public.can_admin_org(organization_id));

-- daily_report_settings
CREATE POLICY drs_read ON public.daily_report_settings FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY drs_write ON public.daily_report_settings FOR ALL TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));

-- event_audit_log
CREATE POLICY eal_read ON public.event_audit_log FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY eal_insert ON public.event_audit_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND public.can_read_org(organization_id));

-- frigate_instances
CREATE POLICY fi_read ON public.frigate_instances FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY fi_write ON public.frigate_instances FOR ALL TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));

-- media_items
CREATE POLICY mi_read ON public.media_items FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY mi_admin_delete ON public.media_items FOR DELETE TO authenticated
  USING (public.can_admin_org(organization_id));

-- media_tags
CREATE POLICY mt_read ON public.media_tags FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY mt_insert ON public.media_tags FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND public.can_read_org(organization_id));
CREATE POLICY mt_admin_delete ON public.media_tags FOR DELETE TO authenticated
  USING (public.can_admin_org(organization_id));

-- offline_instruction_acks
CREATE POLICY oia_self ON public.offline_instruction_acks FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY oia_admin_read ON public.offline_instruction_acks FOR SELECT TO authenticated
  USING (public.can_admin_org(organization_id));

-- webhook_events
CREATE POLICY we_read ON public.webhook_events FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY we_update ON public.webhook_events FOR UPDATE TO authenticated
  USING (public.can_read_org(organization_id))
  WITH CHECK (public.can_read_org(organization_id));
CREATE POLICY we_admin_delete ON public.webhook_events FOR DELETE TO authenticated
  USING (public.can_admin_org(organization_id));

-- webhook_sources
CREATE POLICY ws_read ON public.webhook_sources FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));
CREATE POLICY ws_write ON public.webhook_sources FOR ALL TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));

-- super_callout_requests (org admins create + see own; super admin manages all)
CREATE POLICY scr_admin_create ON public.super_callout_requests FOR INSERT TO authenticated
  WITH CHECK (public.can_admin_org(organization_id) AND requested_by = auth.uid());
CREATE POLICY scr_admin_read ON public.super_callout_requests FOR SELECT TO authenticated
  USING (public.can_admin_org(organization_id));
CREATE POLICY scr_super_manage ON public.super_callout_requests FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
