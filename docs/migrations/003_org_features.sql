-- 003_org_features.sql
-- Per-org feature flags (e.g. Unifi ENVR).
-- Run with:  docker exec -i supabase-db psql -U postgres -d postgres < docs/migrations/003_org_features.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.org_features (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, feature_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_features TO authenticated;
GRANT ALL ON public.org_features TO service_role;

ALTER TABLE public.org_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_features_select ON public.org_features;
CREATE POLICY org_features_select ON public.org_features
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id) OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS org_features_super_write ON public.org_features;
CREATE POLICY org_features_super_write ON public.org_features
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP TRIGGER IF EXISTS trg_org_features_touch ON public.org_features;
CREATE TRIGGER trg_org_features_touch
  BEFORE UPDATE ON public.org_features
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.org_has_feature(_org_id uuid, _key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_features
    WHERE organization_id = _org_id AND feature_key = _key AND enabled = true
  )
$$;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.org_features';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

COMMIT;
