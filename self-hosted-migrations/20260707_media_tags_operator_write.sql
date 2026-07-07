-- Allow any authenticated org member (not just org admins) to allocate,
-- edit, and remove media tags. Reads remain org-scoped via the existing
-- tenant boundary + read policy.
--
-- Apply with:
--   docker exec -i supabase-db psql -U postgres -d postgres \
--     < self-hosted-migrations/20260707_media_tags_operator_write.sql

BEGIN;

DROP POLICY IF EXISTS media_tags_org_insert ON public.media_tags;
DROP POLICY IF EXISTS media_tags_org_update ON public.media_tags;
DROP POLICY IF EXISTS media_tags_org_delete ON public.media_tags;

CREATE POLICY media_tags_org_insert ON public.media_tags
  FOR INSERT TO authenticated
  WITH CHECK (public.can_read_org(organization_id));

CREATE POLICY media_tags_org_update ON public.media_tags
  FOR UPDATE TO authenticated
  USING (public.can_read_org(organization_id))
  WITH CHECK (public.can_read_org(organization_id));

CREATE POLICY media_tags_org_delete ON public.media_tags
  FOR DELETE TO authenticated
  USING (public.can_read_org(organization_id));

COMMIT;
