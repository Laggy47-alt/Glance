ALTER TABLE public.frigate_instances
  ADD COLUMN IF NOT EXISTS nvr_unreachable_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nvr_unreachable_alerted_since TIMESTAMPTZ;