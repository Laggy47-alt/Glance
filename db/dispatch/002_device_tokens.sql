-- Phase 1: Responder device tokens (one active token per responder, regenerable)
-- Run against self-hosted DB:
--   docker compose exec -T db psql -U postgres -d postgres -f /path/to/this.sql
-- Or paste via: docker compose exec -T db psql -U postgres -d postgres < 002_device_tokens.sql

CREATE TABLE IF NOT EXISTS public.responder_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  responder_id UUID NOT NULL REFERENCES public.responders(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  label TEXT,                                   -- e.g. "Samsung A15 - John's phone"
  last_seen_at TIMESTAMPTZ,
  last_latitude DOUBLE PRECISION,
  last_longitude DOUBLE PRECISION,
  last_accuracy_m DOUBLE PRECISION,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS responder_devices_org_idx ON public.responder_devices(organization_id);
CREATE INDEX IF NOT EXISTS responder_devices_responder_idx ON public.responder_devices(responder_id);
CREATE UNIQUE INDEX IF NOT EXISTS responder_devices_active_uniq
  ON public.responder_devices(responder_id) WHERE revoked_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.responder_devices TO authenticated;
GRANT ALL ON public.responder_devices TO service_role;
ALTER TABLE public.responder_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS responder_devices_read ON public.responder_devices;
DROP POLICY IF EXISTS responder_devices_write ON public.responder_devices;
CREATE POLICY responder_devices_read ON public.responder_devices FOR SELECT
  USING (public.can_read_org(organization_id));
CREATE POLICY responder_devices_write ON public.responder_devices FOR ALL
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));

DROP TRIGGER IF EXISTS responder_devices_touch ON public.responder_devices;
CREATE TRIGGER responder_devices_touch BEFORE UPDATE ON public.responder_devices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.responder_devices;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;
