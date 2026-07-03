-- Relax RLS for unifi_sites + unifi_camera_sites so any authenticated user in
-- the app can manage them (matches unifi_offline_alert_settings pattern).
-- Apply on self-hosted Supabase:
--   docker compose cp self-hosted-migrations/20260703_unifi_sites_rls_fix.sql db:/tmp/m.sql
--   docker compose exec -T db psql -U postgres -d postgres -f /tmp/m.sql

DROP POLICY IF EXISTS unifi_sites_org_all ON public.unifi_sites;
CREATE POLICY unifi_sites_org_all ON public.unifi_sites
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS unifi_camera_sites_org_all ON public.unifi_camera_sites;
CREATE POLICY unifi_camera_sites_org_all ON public.unifi_camera_sites
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
