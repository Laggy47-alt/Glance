-- UniFi camera health + live view.
--
-- Apply on the self-hosted Supabase Postgres:
--   docker compose cp self-hosted-migrations/20260703_unifi_camera_health.sql db:/tmp/m.sql
--   docker compose exec -T db psql -U postgres -d postgres -f /tmp/m.sql

-- 1) Per-camera live status pushed by the bridge every ~30s
CREATE TABLE IF NOT EXISTS public.unifi_camera_status (
  instance_id         uuid NOT NULL REFERENCES public.unifi_instances(id) ON DELETE CASCADE,
  camera_id           text NOT NULL,
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                text,
  state               text,                       -- CONNECTED, DISCONNECTED, MANAGING…
  is_online           boolean NOT NULL DEFAULT true,
  last_seen_at        timestamptz,                -- from Protect (camera.lastSeen)
  last_status_at      timestamptz NOT NULL DEFAULT now(), -- last poll from the bridge
  last_offline_at     timestamptz,                -- when it first flipped offline
  last_online_at      timestamptz,                -- when it last flipped back online
  last_alert_sent_at  timestamptz,                -- last WhatsApp for going offline
  last_recovery_sent_at timestamptz,              -- last WhatsApp for recovery
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, camera_id)
);

CREATE INDEX IF NOT EXISTS unifi_camera_status_org_idx
  ON public.unifi_camera_status (organization_id);
CREATE INDEX IF NOT EXISTS unifi_camera_status_offline_idx
  ON public.unifi_camera_status (is_online, last_offline_at)
  WHERE is_online = false;

GRANT SELECT ON public.unifi_camera_status TO authenticated;
GRANT ALL    ON public.unifi_camera_status TO service_role;

ALTER TABLE public.unifi_camera_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS unifi_camera_status_read ON public.unifi_camera_status;
CREATE POLICY unifi_camera_status_read ON public.unifi_camera_status
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- 2) Per-NVR offline-alert configuration
CREATE TABLE IF NOT EXISTS public.unifi_offline_alert_settings (
  unifi_instance_id   uuid PRIMARY KEY REFERENCES public.unifi_instances(id) ON DELETE CASCADE,
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled             boolean NOT NULL DEFAULT true,
  threshold_minutes   integer NOT NULL DEFAULT 5,
  cooldown_minutes    integer NOT NULL DEFAULT 60,
  notify_on_recovery  boolean NOT NULL DEFAULT true,
  -- Recipients: JSON array of { "type": "number" | "group", "value": "27..." | "1203...@g.us", "label": "..." }
  recipients          jsonb   NOT NULL DEFAULT '[]'::jsonb,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.unifi_offline_alert_settings TO authenticated;
GRANT ALL                            ON public.unifi_offline_alert_settings TO service_role;

ALTER TABLE public.unifi_offline_alert_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS unifi_offline_alerts_all ON public.unifi_offline_alert_settings;
CREATE POLICY unifi_offline_alerts_all ON public.unifi_offline_alert_settings
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- 3) Add bridge public URL + shared live view token to unifi_instances
ALTER TABLE public.unifi_instances
  ADD COLUMN IF NOT EXISTS bridge_public_url text,
  ADD COLUMN IF NOT EXISTS live_token        text;
