
ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS daily_broadcast_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_broadcast_recipients text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS daily_broadcast_time time NOT NULL DEFAULT '08:00';
