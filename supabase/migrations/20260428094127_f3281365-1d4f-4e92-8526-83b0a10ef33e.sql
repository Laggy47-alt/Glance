ALTER TABLE public.frigate_instances
  ADD COLUMN IF NOT EXISTS mute_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mute_start time without time zone,
  ADD COLUMN IF NOT EXISTS mute_end time without time zone;