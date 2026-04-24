INSERT INTO storage.buckets (id, name, public) VALUES ('camera-snapshots', 'camera-snapshots', true)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY "public read camera snapshots"
ON storage.objects FOR SELECT
USING (bucket_id = 'camera-snapshots');

CREATE POLICY "authenticated upload camera snapshots"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'camera-snapshots');

CREATE POLICY "authenticated update camera snapshots"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'camera-snapshots')
WITH CHECK (bucket_id = 'camera-snapshots');

CREATE POLICY "authenticated delete camera snapshots"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'camera-snapshots');