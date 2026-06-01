CREATE OR REPLACE FUNCTION public.can_admin_org(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_super_admin(auth.uid())
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.organization_members
         WHERE user_id = auth.uid()
           AND organization_id = _org_id
           AND role = 'admin'
      )
$$;

-- Also promote existing org_members rows for any user who has the global 'admin' app_role
UPDATE public.organization_members om
   SET role = 'admin'
  FROM public.user_roles ur
 WHERE ur.user_id = om.user_id
   AND ur.role = 'admin'
   AND om.role <> 'admin';

-- And update the auto_add_to_abc trigger so new admin users land as admin, not customer
CREATE OR REPLACE FUNCTION public.auto_add_to_abc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  member_role public.org_member_role := 'customer';
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND role IN ('admin','super_admin')) THEN
    member_role := 'admin';
  END IF;
  INSERT INTO public.organization_members(organization_id, user_id, role)
  VALUES ('c093c027-920c-4e88-865a-fb17413b3b5a'::uuid, NEW.id, member_role)
  ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role
   WHERE public.organization_members.role <> 'admin';
  RETURN NEW;
END $$;