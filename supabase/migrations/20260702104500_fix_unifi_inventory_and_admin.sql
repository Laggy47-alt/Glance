-- Fix UniFi bridge inventory upsert and self-host bootstrap admin permissions.

ALTER TABLE public.media_items
  ADD COLUMN IF NOT EXISTS clip_url text;

-- Allow the bridge to update camera inventory rows without clobbering site assignment.
ALTER TABLE public.unifi_camera_sites
  ADD COLUMN IF NOT EXISTS camera_name text;

-- Ensure the self-host bootstrap admin can administer every org from /super.
INSERT INTO public.user_roles (user_id, role)
SELECT p.user_id, 'super_admin'::public.app_role
FROM public.profiles p
WHERE lower(p.username) = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT p.user_id, 'admin'::public.app_role
FROM public.profiles p
WHERE lower(p.username) = 'admin'
ON CONFLICT DO NOTHING;
