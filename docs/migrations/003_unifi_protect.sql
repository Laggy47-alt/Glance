-- 003_unifi_protect.sql
-- Adds UniFi Protect support: per-org camera_provider flag, instance config, event cache.
-- Safe to run multiple times.

BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS camera_provider TEXT NOT NULL DEFAULT 'frigate';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_camera_provider_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_camera_provider_check
      CHECK (camera_provider IN ('frigate', 'unifi'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.unifi_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#22c55e',
  enabled BOOLEAN NOT NULL DEFAULT true,
  is_local BOOLEAN NOT NULL DEFAULT true,
  verify_tls BOOLEAN NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.unifi_instances TO authenticated;
GRANT ALL ON public.unifi_instances TO service_role;

ALTER TABLE public.unifi_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "unifi_instances_select" ON public.unifi_instances;
CREATE POLICY "unifi_instances_select" ON public.unifi_instances
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "unifi_instances_admin_write" ON public.unifi_instances;
CREATE POLICY "unifi_instances_admin_write" ON public.unifi_instances
  FOR ALL TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id))
  WITH CHECK (public.is_org_admin(auth.uid(), organization_id));

CREATE INDEX IF NOT EXISTS idx_unifi_instances_org ON public.unifi_instances(organization_id);

DROP TRIGGER IF EXISTS trg_unifi_instances_updated ON public.unifi_instances;
CREATE TRIGGER trg_unifi_instances_updated
  BEFORE UPDATE ON public.unifi_instances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.unifi_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_id UUID NOT NULL REFERENCES public.unifi_instances(id) ON DELETE CASCADE,
  remote_event_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  camera_name TEXT,
  event_type TEXT NOT NULL,
  smart_types TEXT[] DEFAULT '{}',
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ,
  thumbnail_path TEXT,
  score INT,
  read BOOLEAN NOT NULL DEFAULT false,
  archived BOOLEAN NOT NULL DEFAULT false,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instance_id, remote_event_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.unifi_events TO authenticated;
GRANT ALL ON public.unifi_events TO service_role;

ALTER TABLE public.unifi_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "unifi_events_select" ON public.unifi_events;
CREATE POLICY "unifi_events_select" ON public.unifi_events
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "unifi_events_member_write" ON public.unifi_events;
CREATE POLICY "unifi_events_member_write" ON public.unifi_events
  FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE INDEX IF NOT EXISTS idx_unifi_events_org_start ON public.unifi_events(organization_id, start_at DESC);
CREATE INDEX IF NOT EXISTS idx_unifi_events_instance ON public.unifi_events(instance_id, start_at DESC);

COMMIT;
