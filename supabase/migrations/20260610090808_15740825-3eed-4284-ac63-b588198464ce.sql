ALTER TABLE public.frigate_instances
  ADD COLUMN IF NOT EXISTS multi_client boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS camera_whatsapp_recipients jsonb NOT NULL DEFAULT '{}'::jsonb;