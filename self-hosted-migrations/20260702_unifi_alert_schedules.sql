-- Per-org UniFi alert schedule.
-- Only events that fall inside the enabled window for the current SAST weekday
-- are ingested; everything else is silently dropped at the edge function.
-- A window may cross midnight (end_time <= start_time), e.g. 18:00 → 06:00.
-- If an org has NO rows, ingest allows everything (backward-compatible).
--
-- Apply on self-hosted Supabase:
--   docker compose cp self-hosted-migrations/20260702_unifi_alert_schedules.sql db:/tmp/m.sql
--   docker compose exec db psql -U postgres -d postgres -f /tmp/m.sql

CREATE TABLE IF NOT EXISTS public.unifi_alert_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  weekday         int  NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0=Sun … 6=Sat
  start_time      time NOT NULL,
  end_time        time NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, weekday)
);

CREATE INDEX IF NOT EXISTS unifi_alert_schedules_org_idx
  ON public.unifi_alert_schedules (organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.unifi_alert_schedules TO authenticated;
GRANT ALL                            ON public.unifi_alert_schedules TO service_role;

ALTER TABLE public.unifi_alert_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS unifi_alert_schedules_all ON public.unifi_alert_schedules;
CREATE POLICY unifi_alert_schedules_all ON public.unifi_alert_schedules
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
