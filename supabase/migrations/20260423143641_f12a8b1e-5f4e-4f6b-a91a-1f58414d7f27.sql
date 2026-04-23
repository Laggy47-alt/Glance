
-- Singleton-style settings table for app branding
CREATE TABLE public.app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name text NOT NULL DEFAULT 'ABC Glance',
  app_subtitle text NOT NULL DEFAULT 'Event Dashboard',
  logo_url text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read branding
CREATE POLICY "Anyone authenticated can view app settings"
ON public.app_settings FOR SELECT
TO authenticated
USING (true);

-- Only admins can insert/update/delete
CREATE POLICY "Admins can insert app settings"
ON public.app_settings FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update app settings"
ON public.app_settings FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete app settings"
ON public.app_settings FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Seed one row
INSERT INTO public.app_settings (app_name, app_subtitle) VALUES ('ABC Glance', 'Event Dashboard');

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_app_settings()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_app_settings
BEFORE UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_app_settings();

-- Public storage bucket for branding assets (logo)
INSERT INTO storage.buckets (id, name, public)
VALUES ('branding', 'branding', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: public read, admin write
CREATE POLICY "Public can read branding files"
ON storage.objects FOR SELECT
USING (bucket_id = 'branding');

CREATE POLICY "Admins can upload branding files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'branding' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update branding files"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'branding' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete branding files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'branding' AND public.has_role(auth.uid(), 'admin'));
