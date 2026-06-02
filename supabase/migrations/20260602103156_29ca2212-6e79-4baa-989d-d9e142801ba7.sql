-- Unschedule the per-minute Frigate poll cron job (push-only mode)
SELECT cron.unschedule('frigate-poll-every-minute')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'frigate-poll-every-minute');

-- Disable polling on all existing instances
UPDATE public.frigate_instances SET poll_enabled = false WHERE poll_enabled = true;

-- New instances default to push-only
ALTER TABLE public.frigate_instances ALTER COLUMN poll_enabled SET DEFAULT false;