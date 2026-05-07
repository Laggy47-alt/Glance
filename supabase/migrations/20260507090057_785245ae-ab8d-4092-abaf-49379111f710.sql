
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name TEXT NOT NULL DEFAULT 'Glance',
  app_subtitle TEXT NOT NULL DEFAULT 'Super Admin Portal',
  logo_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_settings_read"
  ON public.platform_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "platform_settings_write"
  ON public.platform_settings FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER platform_settings_touch
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.platform_settings (app_name, app_subtitle)
SELECT 'Glance', 'Super Admin Portal'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings);
