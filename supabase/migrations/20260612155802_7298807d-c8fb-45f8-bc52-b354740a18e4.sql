
-- 1) Webhook secret per UniFi instance
ALTER TABLE public.unifi_instances
  ADD COLUMN IF NOT EXISTS webhook_secret uuid NOT NULL DEFAULT gen_random_uuid();

-- 2) Ensure a webhook_source row exists & is linked for every UniFi instance.
--    The Wall reads from webhook_events joined to webhook_sources, so by
--    pointing unifi_instances.source_id at a matching webhook_sources row we
--    can insert into webhook_events and have UniFi alarms show on the Wall.
CREATE OR REPLACE FUNCTION public.ensure_unifi_webhook_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  src_id uuid;
  base_slug text;
  final_slug text;
  suffix int := 0;
BEGIN
  IF NEW.source_id IS NOT NULL THEN
    -- Already linked: just sync the display name/color so it stays in step.
    UPDATE public.webhook_sources
       SET name = NEW.name, color = NEW.color, enabled = NEW.enabled
     WHERE id = NEW.source_id;
    RETURN NEW;
  END IF;

  base_slug := 'unifi-' || regexp_replace(lower(NEW.name), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  IF base_slug = '' THEN base_slug := 'unifi-' || substr(NEW.id::text, 1, 8); END IF;
  final_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM public.webhook_sources WHERE slug = final_slug) LOOP
    suffix := suffix + 1;
    final_slug := base_slug || '-' || suffix::text;
  END LOOP;

  INSERT INTO public.webhook_sources (organization_id, name, slug, secret, color, enabled)
  VALUES (NEW.organization_id, NEW.name, final_slug, encode(gen_random_bytes(16), 'hex'), NEW.color, NEW.enabled)
  RETURNING id INTO src_id;

  NEW.source_id := src_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS unifi_instances_ensure_source ON public.unifi_instances;
CREATE TRIGGER unifi_instances_ensure_source
BEFORE INSERT OR UPDATE OF name, color, enabled, source_id ON public.unifi_instances
FOR EACH ROW EXECUTE FUNCTION public.ensure_unifi_webhook_source();

-- 3) Backfill source_id for existing UniFi instances that don't have one yet.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.unifi_instances WHERE source_id IS NULL LOOP
    UPDATE public.unifi_instances SET name = name WHERE id = r.id;  -- fires trigger
  END LOOP;
END $$;
