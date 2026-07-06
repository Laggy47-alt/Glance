ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS daily_broadcast_times text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS daily_broadcast_last_sent_at timestamptz;

ALTER TABLE public.camera_status
  ADD COLUMN IF NOT EXISTS pending_online boolean;

ALTER TABLE public.camera_status
  ADD COLUMN IF NOT EXISTS pending_since timestamptz;