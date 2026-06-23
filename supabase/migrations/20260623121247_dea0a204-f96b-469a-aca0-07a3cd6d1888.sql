
-- Hikvision NVR integration: instances, channels, events.

CREATE TABLE public.hikvision_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  base_url text NOT NULL,
  is_local boolean NOT NULL DEFAULT true,
  verify_tls boolean NOT NULL DEFAULT false,
  auth_username text,
  auth_password text,
  webhook_secret uuid NOT NULL DEFAULT gen_random_uuid(),
  color text NOT NULL DEFAULT '#dc2626',
  enabled boolean NOT NULL DEFAULT true,
  poll_enabled boolean NOT NULL DEFAULT true,
  last_polled_at timestamptz,
  last_seen_at timestamptz,
  last_event_ts timestamptz,
  last_error text,
  offline_alert_enabled boolean NOT NULL DEFAULT false,
  offline_alert_minutes integer NOT NULL DEFAULT 10,
  offline_alert_recipients text[] NOT NULL DEFAULT '{}',
  whatsapp_alert_enabled boolean NOT NULL DEFAULT false,
  whatsapp_alert_minutes integer,
  whatsapp_recipients text[] NOT NULL DEFAULT '{}',
  master_alert_recipients text[] NOT NULL DEFAULT '{}',
  multi_client boolean NOT NULL DEFAULT false,
  camera_whatsapp_recipients jsonb,
  nvr_unreachable_since timestamptz,
  nvr_unreachable_alerted_since timestamptz,
  mute_enabled boolean NOT NULL DEFAULT false,
  mute_start text,
  mute_end text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hikvision_instances TO authenticated;
GRANT ALL ON public.hikvision_instances TO service_role;
ALTER TABLE public.hikvision_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members manage hikvision_instances"
  ON public.hikvision_instances FOR ALL
  USING (public.can_read_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));

CREATE TRIGGER hikvision_instances_updated_at
  BEFORE UPDATE ON public.hikvision_instances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER hikvision_instances_org_fill
  BEFORE INSERT ON public.hikvision_instances
  FOR EACH ROW EXECUTE FUNCTION public.fill_organization_id();

CREATE INDEX idx_hikvision_instances_org ON public.hikvision_instances(organization_id);


CREATE TABLE public.hikvision_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  instance_id uuid NOT NULL REFERENCES public.hikvision_instances(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_snapshot_path text,
  last_event_ts timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, channel_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hikvision_channels TO authenticated;
GRANT ALL ON public.hikvision_channels TO service_role;
ALTER TABLE public.hikvision_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members manage hikvision_channels"
  ON public.hikvision_channels FOR ALL
  USING (public.can_read_org(organization_id))
  WITH CHECK (public.can_admin_org(organization_id));

CREATE TRIGGER hikvision_channels_updated_at
  BEFORE UPDATE ON public.hikvision_channels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_hikvision_channels_instance ON public.hikvision_channels(instance_id);


CREATE TABLE public.hikvision_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  instance_id uuid NOT NULL REFERENCES public.hikvision_instances(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  camera_name text NOT NULL,
  event_type text NOT NULL,
  target_type text,
  detection_targets text[] NOT NULL DEFAULT '{}',
  event_time timestamptz NOT NULL DEFAULT now(),
  thumbnail_path text,
  raw jsonb,
  read boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hikvision_events TO authenticated;
GRANT ALL ON public.hikvision_events TO service_role;
ALTER TABLE public.hikvision_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read hikvision_events"
  ON public.hikvision_events FOR SELECT
  USING (public.can_read_org(organization_id));

CREATE POLICY "Org members update hikvision_events"
  ON public.hikvision_events FOR UPDATE
  USING (public.can_read_org(organization_id))
  WITH CHECK (public.can_read_org(organization_id));

CREATE POLICY "Org members delete hikvision_events"
  ON public.hikvision_events FOR DELETE
  USING (public.can_admin_org(organization_id));

CREATE INDEX idx_hikvision_events_org_time ON public.hikvision_events(organization_id, event_time DESC);
CREATE INDEX idx_hikvision_events_instance_time ON public.hikvision_events(instance_id, event_time DESC);
CREATE INDEX idx_hikvision_events_channel_time ON public.hikvision_events(instance_id, channel_id, event_time DESC);
