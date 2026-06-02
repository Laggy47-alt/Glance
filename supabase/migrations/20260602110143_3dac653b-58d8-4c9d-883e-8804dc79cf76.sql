ALTER TABLE public.frigate_instances ALTER COLUMN poll_enabled SET DEFAULT true;
UPDATE public.frigate_instances SET poll_enabled = true WHERE poll_enabled = false;