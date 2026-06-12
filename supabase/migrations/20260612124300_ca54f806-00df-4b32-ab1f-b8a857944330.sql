DELETE FROM public.organization_members om
 WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = om.user_id)
    OR NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = om.organization_id);

ALTER TABLE public.organization_members
  ADD CONSTRAINT organization_members_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.organization_members
  ADD CONSTRAINT organization_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;