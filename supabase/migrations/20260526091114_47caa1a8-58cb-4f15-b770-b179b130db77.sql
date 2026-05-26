
ALTER TABLE public.frigate_instances
  ADD COLUMN IF NOT EXISTS offline_alert_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS offline_alert_minutes integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS offline_alert_recipients text[] NOT NULL DEFAULT '{}'::text[];

CREATE TABLE IF NOT EXISTS public.camera_offline_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT 'c093c027-920c-4e88-865a-fb17413b3b5a'::uuid,
  instance_id uuid NOT NULL,
  camera text NOT NULL,
  since timestamptz NOT NULL,
  alerted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, camera, since)
);

ALTER TABLE public.camera_offline_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coa_read ON public.camera_offline_alerts;
CREATE POLICY coa_read ON public.camera_offline_alerts
  FOR SELECT TO authenticated
  USING (public.can_read_org(organization_id));

DROP POLICY IF EXISTS coa_write ON public.camera_offline_alerts;
CREATE POLICY coa_write ON public.camera_offline_alerts
  FOR ALL TO authenticated
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));

CREATE UNIQUE INDEX IF NOT EXISTS camera_status_instance_camera_uniq
  ON public.camera_status (instance_id, camera);
