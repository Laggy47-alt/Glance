-- webhook_sources
DROP POLICY IF EXISTS "public read sources" ON public.webhook_sources;
DROP POLICY IF EXISTS "public write sources" ON public.webhook_sources;
DROP POLICY IF EXISTS "public update sources" ON public.webhook_sources;
DROP POLICY IF EXISTS "public delete sources" ON public.webhook_sources;
CREATE POLICY "auth read sources" ON public.webhook_sources FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins write sources" ON public.webhook_sources FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update sources" ON public.webhook_sources FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete sources" ON public.webhook_sources FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- webhook_events
DROP POLICY IF EXISTS "public read events" ON public.webhook_events;
DROP POLICY IF EXISTS "public write events" ON public.webhook_events;
DROP POLICY IF EXISTS "public update events" ON public.webhook_events;
DROP POLICY IF EXISTS "public delete events" ON public.webhook_events;
CREATE POLICY "auth read events" ON public.webhook_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth update events" ON public.webhook_events FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admins delete events" ON public.webhook_events FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));
-- INSERT intentionally not exposed: only the service role (webhook-ingest, frigate-poll) inserts.

-- auto_read_rules
DROP POLICY IF EXISTS "public read rules" ON public.auto_read_rules;
DROP POLICY IF EXISTS "public write rules" ON public.auto_read_rules;
DROP POLICY IF EXISTS "public update rules" ON public.auto_read_rules;
DROP POLICY IF EXISTS "public delete rules" ON public.auto_read_rules;
CREATE POLICY "auth read rules" ON public.auto_read_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins write rules" ON public.auto_read_rules FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update rules" ON public.auto_read_rules FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete rules" ON public.auto_read_rules FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- media_items
DROP POLICY IF EXISTS "public read media" ON public.media_items;
DROP POLICY IF EXISTS "public write media" ON public.media_items;
DROP POLICY IF EXISTS "public delete media" ON public.media_items;
CREATE POLICY "auth read media" ON public.media_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins delete media" ON public.media_items FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));
-- INSERT only via service role.

-- media_tags
DROP POLICY IF EXISTS "public read media tags" ON public.media_tags;
DROP POLICY IF EXISTS "public insert media tags" ON public.media_tags;
DROP POLICY IF EXISTS "public delete media tags" ON public.media_tags;
CREATE POLICY "auth read media tags" ON public.media_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert media tags" ON public.media_tags FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "admins delete media tags" ON public.media_tags FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- frigate_instances
DROP POLICY IF EXISTS "public read frigate" ON public.frigate_instances;
DROP POLICY IF EXISTS "public write frigate" ON public.frigate_instances;
DROP POLICY IF EXISTS "public update frigate" ON public.frigate_instances;
DROP POLICY IF EXISTS "public delete frigate" ON public.frigate_instances;
CREATE POLICY "auth read frigate" ON public.frigate_instances FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins write frigate" ON public.frigate_instances FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update frigate" ON public.frigate_instances FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete frigate" ON public.frigate_instances FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- event_audit_log
DROP POLICY IF EXISTS "public read audit" ON public.event_audit_log;
DROP POLICY IF EXISTS "public write audit" ON public.event_audit_log;
CREATE POLICY "auth read audit" ON public.event_audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert audit" ON public.event_audit_log FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
