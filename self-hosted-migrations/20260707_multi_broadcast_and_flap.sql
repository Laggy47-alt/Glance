-- Multi-time WhatsApp offline broadcast + camera-status flap hysteresis.
--
-- Apply on the self-hosted Supabase DB:
--   docker exec -i supabase-db psql -U postgres -d postgres < self-hosted-migrations/20260707_multi_broadcast_and_flap.sql
--
-- Backwards-compatible:
--   * daily_broadcast_times defaults to '{}' (empty). When empty the broadcast
--     function keeps using the existing single-slot daily_broadcast_time.
--     Only orgs that populate the array switch to multi-slot mode.
--   * daily_broadcast_last_sent_at gates per-slot delivery for multi-slot mode.
--   * camera_status.pending_online / pending_since power the 5-minute flap
--     window in camera-watch. NULL means "no pending flip".

-- 1) whatsapp_settings: multi-time schedule + last-sent tracker
ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS daily_broadcast_times text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS daily_broadcast_last_sent_at timestamptz;

-- 2) camera_status: hysteresis columns for flap suppression
ALTER TABLE public.camera_status
  ADD COLUMN IF NOT EXISTS pending_online boolean;

ALTER TABLE public.camera_status
  ADD COLUMN IF NOT EXISTS pending_since timestamptz;
