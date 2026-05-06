REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_has_instance(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_has_camera(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.touch_app_settings() FROM PUBLIC;
-- RLS policies need authenticated to call these helpers
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_instance(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_camera(uuid, uuid, text) TO authenticated;
