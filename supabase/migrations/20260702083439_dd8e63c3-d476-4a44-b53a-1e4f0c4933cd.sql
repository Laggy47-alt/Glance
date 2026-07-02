
-- Sites per UniFi NVR
CREATE TABLE IF NOT EXISTS public.unifi_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unifi_instance_id uuid NOT NULL REFERENCES public.unifi_instances(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#3B82F6',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unifi_instance_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unifi_sites TO authenticated;
GRANT ALL ON public.unifi_sites TO service_role;
ALTER TABLE public.unifi_sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "unifi_sites_org_all" ON public.unifi_sites FOR ALL
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE TRIGGER unifi_sites_updated_at
  BEFORE UPDATE ON public.unifi_sites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_unifi_sites_instance ON public.unifi_sites(unifi_instance_id);

-- Camera → site assignment
CREATE TABLE IF NOT EXISTS public.unifi_camera_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unifi_instance_id uuid NOT NULL REFERENCES public.unifi_instances(id) ON DELETE CASCADE,
  camera_id text NOT NULL,
  camera_name text,
  site_id uuid REFERENCES public.unifi_sites(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unifi_instance_id, camera_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unifi_camera_sites TO authenticated;
GRANT ALL ON public.unifi_camera_sites TO service_role;
ALTER TABLE public.unifi_camera_sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "unifi_camera_sites_org_all" ON public.unifi_camera_sites FOR ALL
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE TRIGGER unifi_camera_sites_updated_at
  BEFORE UPDATE ON public.unifi_camera_sites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_unifi_camera_sites_site ON public.unifi_camera_sites(site_id);
CREATE INDEX IF NOT EXISTS idx_unifi_camera_sites_instance ON public.unifi_camera_sites(unifi_instance_id);

-- Stamp site + clip on events
ALTER TABLE public.unifi_events
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.unifi_sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS clip_path text;

-- Media clip url
ALTER TABLE public.media_items
  ADD COLUMN IF NOT EXISTS clip_url text;
