UPDATE public.frigate_instances SET poll_interval_seconds = 5;
ALTER TABLE public.frigate_instances ALTER COLUMN poll_interval_seconds SET DEFAULT 5;