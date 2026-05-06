-- Lock down search_path
CREATE OR REPLACE FUNCTION public.touch_app_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- Revoke execute on SECURITY DEFINER helpers from anon; keep authenticated where it makes sense
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_has_instance(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_has_camera(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_app_settings() FROM anon, authenticated;
