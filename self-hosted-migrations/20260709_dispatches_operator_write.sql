-- Allow operators (any org member) to create and update dispatches.
-- Previously dispatches_admin_write required can_admin_org, blocking operators
-- from clicking Dispatch on an alert (RLS violation on INSERT).

BEGIN;

DROP POLICY IF EXISTS dispatches_admin_write ON public.dispatches;
DROP POLICY IF EXISTS dispatches_member_write ON public.dispatches;

CREATE POLICY dispatches_member_write ON public.dispatches FOR ALL
  USING (public.can_read_org(organization_id))
  WITH CHECK (public.can_read_org(organization_id));

-- dispatch_events already allows can_read_org on insert; keep as-is.
-- Ensure the responder self-update policy still exists (untouched).

COMMIT;
