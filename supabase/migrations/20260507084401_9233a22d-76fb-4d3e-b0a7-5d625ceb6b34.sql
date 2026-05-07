CREATE TABLE public.super_callout_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL DEFAULT public.current_user_org() REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by UUID,
  requester_name TEXT,
  subject TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID
);

CREATE INDEX idx_super_callouts_org ON public.super_callout_requests(organization_id);
CREATE INDEX idx_super_callouts_created ON public.super_callout_requests(created_at DESC);

ALTER TABLE public.super_callout_requests ENABLE ROW LEVEL SECURITY;

-- Org admins create + view their org's requests
CREATE POLICY "org admins create super callouts"
ON public.super_callout_requests FOR INSERT TO authenticated
WITH CHECK (public.is_org_admin(auth.uid(), organization_id) AND requested_by = auth.uid());

CREATE POLICY "org admins view org super callouts"
ON public.super_callout_requests FOR SELECT TO authenticated
USING (public.is_org_admin(auth.uid(), organization_id) OR public.is_super_admin(auth.uid()));

-- Super admin manages everything
CREATE POLICY "super admin manages super callouts"
ON public.super_callout_requests FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));