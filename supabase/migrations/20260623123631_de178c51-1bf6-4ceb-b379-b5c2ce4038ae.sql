
-- Pair every hikvision_instance with a webhook_sources row so its events
-- can flow into the existing Live Wall / Media / WhatsApp / Daily Report
-- pipelines that already key off webhook_events.source_id.

ALTER TABLE public.hikvision_instances
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.webhook_sources(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.ensure_hikvision_webhook_source()
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
    UPDATE public.webhook_sources
       SET name = NEW.name, color = NEW.color, enabled = NEW.enabled
     WHERE id = NEW.source_id;
    RETURN NEW;
  END IF;

  base_slug := 'hikvision-' || regexp_replace(lower(NEW.name), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  IF base_slug = '' THEN base_slug := 'hikvision-' || substr(NEW.id::text, 1, 8); END IF;
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

DROP TRIGGER IF EXISTS trg_ensure_hikvision_webhook_source ON public.hikvision_instances;
CREATE TRIGGER trg_ensure_hikvision_webhook_source
  BEFORE INSERT OR UPDATE OF name, color, enabled, source_id
  ON public.hikvision_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_hikvision_webhook_source();

-- Backfill: create a webhook_source for any existing hikvision_instances rows.
UPDATE public.hikvision_instances SET name = name WHERE source_id IS NULL;
