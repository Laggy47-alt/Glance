CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

CREATE OR REPLACE FUNCTION public.ensure_hikvision_webhook_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  src_id uuid;
  base_slug text;
  final_slug text;
  suffix int := 0;
  secret_hex text;
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

  -- Use pgcrypto's gen_random_bytes if available, else fall back to md5(random()) for self-hosted.
  BEGIN
    secret_hex := encode(public.gen_random_bytes(16), 'hex');
  EXCEPTION WHEN undefined_function THEN
    secret_hex := md5(random()::text || clock_timestamp()::text) || md5(random()::text || NEW.id::text);
  END;

  INSERT INTO public.webhook_sources (organization_id, name, slug, secret, color, enabled)
  VALUES (NEW.organization_id, NEW.name, final_slug, secret_hex, NEW.color, NEW.enabled)
  RETURNING id INTO src_id;

  NEW.source_id := src_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_unifi_webhook_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  src_id uuid;
  base_slug text;
  final_slug text;
  suffix int := 0;
  secret_hex text;
BEGIN
  IF NEW.source_id IS NOT NULL THEN
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

  BEGIN
    secret_hex := encode(public.gen_random_bytes(16), 'hex');
  EXCEPTION WHEN undefined_function THEN
    secret_hex := md5(random()::text || clock_timestamp()::text) || md5(random()::text || NEW.id::text);
  END;

  INSERT INTO public.webhook_sources (organization_id, name, slug, secret, color, enabled)
  VALUES (NEW.organization_id, NEW.name, final_slug, secret_hex, NEW.color, NEW.enabled)
  RETURNING id INTO src_id;

  NEW.source_id := src_id;
  RETURN NEW;
END;
$function$;