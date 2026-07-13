-- Prevent overlapping Frigate poll cron runs from stacking up outbound
-- connections/file descriptors when an NVR or DNS path is slow.

ALTER TABLE public.frigate_instances
  ADD COLUMN IF NOT EXISTS poll_locked_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_frigate_instances_poll_lock
  ON public.frigate_instances (poll_locked_until)
  WHERE poll_locked_until IS NOT NULL;