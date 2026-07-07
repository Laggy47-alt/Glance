-- Adds a per-UniFi-NVR opt-in for the daily WhatsApp offline broadcast.
--
-- Apply on the self-hosted Supabase DB:
--   docker exec -i supabase-db psql -U postgres -d postgres < self-hosted-migrations/20260707_unifi_daily_broadcast.sql
--
-- Defaults to FALSE so no existing org (including ABC) changes behavior.
-- Fiber can flip this on per UniFi NVR to include offline UniFi cameras in
-- the org's 08:00 / 18:00 daily-offline-broadcast summary.

ALTER TABLE public.unifi_offline_alert_settings
  ADD COLUMN IF NOT EXISTS daily_broadcast_enabled boolean NOT NULL DEFAULT false;
