-- NVR multi-site assignments.
--
-- Each NVR keeps its primary `site_id` (used for dispatch/geofence defaults).
-- When `multi_site = true`, the NVR may be additionally linked to more sites
-- through the join table below (organizational grouping / reporting).
--
-- Dispatch continues to use the NVR's primary site_id — this table is additive.

ALTER TABLE public.unifi_instances     ADD COLUMN IF NOT EXISTS multi_site boolean NOT NULL DEFAULT false;
ALTER TABLE public.hikvision_instances ADD COLUMN IF NOT EXISTS multi_site boolean NOT NULL DEFAULT false;
ALTER TABLE public.frigate_instances   ADD COLUMN IF NOT EXISTS multi_site boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.nvr_site_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  nvr_kind text NOT NULL CHECK (nvr_kind IN ('unifi','hikvision','frigate')),
  nvr_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nvr_kind, nvr_id, site_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nvr_site_assignments TO authenticated;
GRANT ALL ON public.nvr_site_assignments TO service_role;

ALTER TABLE public.nvr_site_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members manage nvr_site_assignments" ON public.nvr_site_assignments;
CREATE POLICY "org members manage nvr_site_assignments"
  ON public.nvr_site_assignments FOR ALL
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE INDEX IF NOT EXISTS idx_nvr_site_assignments_site ON public.nvr_site_assignments(site_id);
CREATE INDEX IF NOT EXISTS idx_nvr_site_assignments_nvr  ON public.nvr_site_assignments(nvr_kind, nvr_id);
