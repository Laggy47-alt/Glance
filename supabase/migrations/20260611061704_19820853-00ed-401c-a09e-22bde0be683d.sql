ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_heartbeat_status TEXT;