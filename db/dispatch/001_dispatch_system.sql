-- Dispatch & Response Tracking system
-- Run against self-hosted DB:
--   docker compose exec -T db psql -U postgres -d postgres -f /path/to/this.sql
-- Or paste via: docker compose exec -T db psql -U postgres -d postgres < 001_dispatch_system.sql

-- =========================================================================
-- SITES
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  geofence_radius_m INTEGER NOT NULL DEFAULT 100,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sites_org_idx ON public.sites(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sites TO authenticated;
GRANT ALL ON public.sites TO service_role;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sites_read ON public.sites;
DROP POLICY IF EXISTS sites_write ON public.sites;
CREATE POLICY sites_read ON public.sites FOR SELECT
  USING (public.can_read_org(organization_id));
CREATE POLICY sites_write ON public.sites FOR ALL
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));

DROP TRIGGER IF EXISTS sites_touch ON public.sites;
CREATE TRIGGER sites_touch BEFORE UPDATE ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Link existing NVR tables to sites (nullable)
ALTER TABLE public.unifi_instances     ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL;
ALTER TABLE public.hikvision_instances ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL;
ALTER TABLE public.frigate_instances   ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL;

-- =========================================================================
-- VEHICLES
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  call_sign TEXT NOT NULL,
  registration TEXT,
  active_driver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','dispatched','on_site','offline','out_of_service')),
  last_latitude DOUBLE PRECISION,
  last_longitude DOUBLE PRECISION,
  last_speed DOUBLE PRECISION,
  last_heading DOUBLE PRECISION,
  last_ping_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, call_sign)
);
CREATE INDEX IF NOT EXISTS vehicles_org_idx ON public.vehicles(organization_id);
CREATE INDEX IF NOT EXISTS vehicles_driver_idx ON public.vehicles(active_driver_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles TO authenticated;
GRANT ALL ON public.vehicles TO service_role;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicles_read ON public.vehicles;
DROP POLICY IF EXISTS vehicles_write ON public.vehicles;
DROP POLICY IF EXISTS vehicles_driver_update ON public.vehicles;
CREATE POLICY vehicles_read ON public.vehicles FOR SELECT
  USING (public.can_read_org(organization_id));
CREATE POLICY vehicles_write ON public.vehicles FOR ALL
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));
CREATE POLICY vehicles_driver_update ON public.vehicles FOR UPDATE
  USING (active_driver_id = auth.uid())
  WITH CHECK (active_driver_id = auth.uid());

DROP TRIGGER IF EXISTS vehicles_touch ON public.vehicles;
CREATE TRIGGER vehicles_touch BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- RESPONDERS
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.responders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  on_duty BOOLEAN NOT NULL DEFAULT false,
  push_token TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS responders_org_idx ON public.responders(organization_id);
CREATE INDEX IF NOT EXISTS responders_user_idx ON public.responders(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.responders TO authenticated;
GRANT ALL ON public.responders TO service_role;
ALTER TABLE public.responders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS responders_read ON public.responders;
DROP POLICY IF EXISTS responders_admin_write ON public.responders;
DROP POLICY IF EXISTS responders_self_update ON public.responders;
CREATE POLICY responders_read ON public.responders FOR SELECT
  USING (public.can_read_org(organization_id) OR user_id = auth.uid());
CREATE POLICY responders_admin_write ON public.responders FOR ALL
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));
CREATE POLICY responders_self_update ON public.responders FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS responders_touch ON public.responders;
CREATE TRIGGER responders_touch BEFORE UPDATE ON public.responders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- DISPATCHES
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  responder_id UUID REFERENCES public.responders(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','unifi_offline','hikvision_event','frigate_event','other')),
  source_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','en_route','on_site','completed','cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','critical')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  response_seconds INTEGER GENERATED ALWAYS AS (
    CASE WHEN arrived_at IS NOT NULL
         THEN EXTRACT(EPOCH FROM (arrived_at - dispatched_at))::INTEGER
    END
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dispatches_org_idx ON public.dispatches(organization_id);
CREATE INDEX IF NOT EXISTS dispatches_status_idx ON public.dispatches(status);
CREATE INDEX IF NOT EXISTS dispatches_vehicle_idx ON public.dispatches(vehicle_id);
CREATE INDEX IF NOT EXISTS dispatches_responder_idx ON public.dispatches(responder_id);
CREATE INDEX IF NOT EXISTS dispatches_site_idx ON public.dispatches(site_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatches TO authenticated;
GRANT ALL ON public.dispatches TO service_role;
ALTER TABLE public.dispatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dispatches_read ON public.dispatches;
DROP POLICY IF EXISTS dispatches_admin_write ON public.dispatches;
DROP POLICY IF EXISTS dispatches_responder_update ON public.dispatches;
CREATE POLICY dispatches_read ON public.dispatches FOR SELECT
  USING (
    public.can_read_org(organization_id)
    OR responder_id IN (SELECT id FROM public.responders WHERE user_id = auth.uid())
  );
CREATE POLICY dispatches_admin_write ON public.dispatches FOR ALL
  USING (public.can_admin_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));
CREATE POLICY dispatches_responder_update ON public.dispatches FOR UPDATE
  USING (responder_id IN (SELECT id FROM public.responders WHERE user_id = auth.uid()))
  WITH CHECK (responder_id IN (SELECT id FROM public.responders WHERE user_id = auth.uid()));

DROP TRIGGER IF EXISTS dispatches_touch ON public.dispatches;
CREATE TRIGGER dispatches_touch BEFORE UPDATE ON public.dispatches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- DISPATCH LOCATION PINGS (breadcrumb trail)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.dispatch_location_pings (
  id BIGSERIAL PRIMARY KEY,
  dispatch_id UUID NOT NULL REFERENCES public.dispatches(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy_m DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dlp_dispatch_idx ON public.dispatch_location_pings(dispatch_id, recorded_at);
CREATE INDEX IF NOT EXISTS dlp_org_idx ON public.dispatch_location_pings(organization_id);

GRANT SELECT, INSERT ON public.dispatch_location_pings TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.dispatch_location_pings_id_seq TO authenticated;
GRANT ALL ON public.dispatch_location_pings TO service_role;
GRANT ALL ON SEQUENCE public.dispatch_location_pings_id_seq TO service_role;
ALTER TABLE public.dispatch_location_pings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dlp_read ON public.dispatch_location_pings;
DROP POLICY IF EXISTS dlp_insert ON public.dispatch_location_pings;
CREATE POLICY dlp_read ON public.dispatch_location_pings FOR SELECT
  USING (public.can_read_org(organization_id));
CREATE POLICY dlp_insert ON public.dispatch_location_pings FOR INSERT
  WITH CHECK (
    dispatch_id IN (
      SELECT d.id FROM public.dispatches d
      JOIN public.responders r ON r.id = d.responder_id
      WHERE r.user_id = auth.uid()
    )
  );

-- =========================================================================
-- DISPATCH EVENTS (audit timeline)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.dispatch_events (
  id BIGSERIAL PRIMARY KEY,
  dispatch_id UUID NOT NULL REFERENCES public.dispatches(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('created','acknowledged','geofence_entered','geofence_exited','arrived','completed','cancelled','note','status_change')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS de_dispatch_idx ON public.dispatch_events(dispatch_id, at);
CREATE INDEX IF NOT EXISTS de_org_idx ON public.dispatch_events(organization_id);

GRANT SELECT, INSERT ON public.dispatch_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.dispatch_events_id_seq TO authenticated;
GRANT ALL ON public.dispatch_events TO service_role;
GRANT ALL ON SEQUENCE public.dispatch_events_id_seq TO service_role;
ALTER TABLE public.dispatch_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS de_read ON public.dispatch_events;
DROP POLICY IF EXISTS de_insert ON public.dispatch_events;
CREATE POLICY de_read ON public.dispatch_events FOR SELECT
  USING (public.can_read_org(organization_id));
CREATE POLICY de_insert ON public.dispatch_events FOR INSERT
  WITH CHECK (public.can_read_org(organization_id));

-- =========================================================================
-- Realtime publications
-- =========================================================================
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatches;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatch_location_pings;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatch_events;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicles;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;
