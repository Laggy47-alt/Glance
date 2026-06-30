-- Immutable audit trail for every alert received.
-- Logs lifecycle: received, acked, archived, auto_archived, auto_read, unarchived.
-- Apply on self-hosted Supabase via:
--   docker compose cp self-hosted-migrations/20260630_alert_audit_log.sql db:/tmp/m.sql
--   docker compose exec db psql -U postgres -d postgres -f /tmp/m.sql

CREATE TABLE IF NOT EXISTS public.alert_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  event_id uuid,
  source_id uuid,
  instance_id uuid,
  camera text,
  action text NOT NULL,
  actor uuid,
  actor_name text,
  note text,
  ts timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_audit_event_idx  ON public.alert_audit_log (event_id, ts DESC);
CREATE INDEX IF NOT EXISTS alert_audit_camera_idx ON public.alert_audit_log (camera, ts DESC);
CREATE INDEX IF NOT EXISTS alert_audit_ts_idx     ON public.alert_audit_log (ts DESC);

GRANT SELECT ON public.alert_audit_log TO authenticated;
GRANT ALL    ON public.alert_audit_log TO service_role;

ALTER TABLE public.alert_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alert_audit_read   ON public.alert_audit_log;
DROP POLICY IF EXISTS alert_audit_delete ON public.alert_audit_log;
CREATE POLICY alert_audit_read   ON public.alert_audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY alert_audit_delete ON public.alert_audit_log FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Trigger: log on INSERT (received, plus auto_archived/auto_read if pre-cleared)
CREATE OR REPLACE FUNCTION public.log_webhook_event_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inst uuid;
  has_archived_by boolean;
  has_read_by boolean;
  arc_by uuid; arc_by_name text; arc_at timestamptz;
  rd_by uuid;  rd_by_name text;  rd_at timestamptz;
BEGIN
  inst := NULLIF(NEW.headers ->> 'x-frigate-instance', '')::uuid;

  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='webhook_events' AND column_name='archived_by') INTO has_archived_by;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='webhook_events' AND column_name='read_by') INTO has_read_by;

  INSERT INTO public.alert_audit_log (organization_id, event_id, source_id, instance_id, camera, action, ts)
  VALUES (NEW.organization_id, NEW.id, NEW.source_id, inst, NEW.camera, 'received', COALESCE(NEW.ts, now()));

  IF NEW.archived IS TRUE THEN
    IF has_archived_by THEN
      EXECUTE 'SELECT ($1).archived_by, ($1).archived_by_name, ($1).archived_at' INTO arc_by, arc_by_name, arc_at USING NEW;
    END IF;
    INSERT INTO public.alert_audit_log (organization_id, event_id, source_id, instance_id, camera, action, actor, actor_name, ts)
    VALUES (NEW.organization_id, NEW.id, NEW.source_id, inst, NEW.camera,
            CASE WHEN arc_by IS NULL THEN 'auto_archived' ELSE 'archived' END,
            arc_by, arc_by_name, COALESCE(arc_at, NEW.ts, now()));
  ELSIF NEW.read IS TRUE THEN
    IF has_read_by THEN
      EXECUTE 'SELECT ($1).read_by, ($1).read_by_name, ($1).read_at' INTO rd_by, rd_by_name, rd_at USING NEW;
    END IF;
    INSERT INTO public.alert_audit_log (organization_id, event_id, source_id, instance_id, camera, action, actor, actor_name, ts)
    VALUES (NEW.organization_id, NEW.id, NEW.source_id, inst, NEW.camera,
            CASE WHEN rd_by IS NULL THEN 'auto_read' ELSE 'acked' END,
            rd_by, rd_by_name, COALESCE(rd_at, NEW.ts, now()));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_webhook_event_insert ON public.webhook_events;
CREATE TRIGGER trg_log_webhook_event_insert
AFTER INSERT ON public.webhook_events
FOR EACH ROW EXECUTE FUNCTION public.log_webhook_event_insert();

-- Trigger: log on UPDATE (state transitions)
CREATE OR REPLACE FUNCTION public.log_webhook_event_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inst uuid;
  has_archived_by boolean;
  has_read_by boolean;
  arc_by uuid; arc_by_name text; arc_at timestamptz;
  rd_by uuid;  rd_by_name text;  rd_at timestamptz;
BEGIN
  inst := NULLIF(NEW.headers ->> 'x-frigate-instance', '')::uuid;

  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='webhook_events' AND column_name='archived_by') INTO has_archived_by;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='webhook_events' AND column_name='read_by') INTO has_read_by;

  IF COALESCE(OLD.archived, false) IS DISTINCT FROM COALESCE(NEW.archived, false) THEN
    IF NEW.archived THEN
      IF has_archived_by THEN
        EXECUTE 'SELECT ($1).archived_by, ($1).archived_by_name, ($1).archived_at' INTO arc_by, arc_by_name, arc_at USING NEW;
      END IF;
      INSERT INTO public.alert_audit_log (organization_id, event_id, source_id, instance_id, camera, action, actor, actor_name, ts)
      VALUES (NEW.organization_id, NEW.id, NEW.source_id, inst, NEW.camera,
              CASE WHEN arc_by IS NULL THEN 'auto_archived' ELSE 'archived' END,
              arc_by, arc_by_name, COALESCE(arc_at, now()));
    ELSE
      INSERT INTO public.alert_audit_log (organization_id, event_id, source_id, instance_id, camera, action, ts)
      VALUES (NEW.organization_id, NEW.id, NEW.source_id, inst, NEW.camera, 'unarchived', now());
    END IF;
  ELSIF COALESCE(OLD.read, false) IS DISTINCT FROM COALESCE(NEW.read, false) AND NEW.read THEN
    IF has_read_by THEN
      EXECUTE 'SELECT ($1).read_by, ($1).read_by_name, ($1).read_at' INTO rd_by, rd_by_name, rd_at USING NEW;
    END IF;
    INSERT INTO public.alert_audit_log (organization_id, event_id, source_id, instance_id, camera, action, actor, actor_name, ts)
    VALUES (NEW.organization_id, NEW.id, NEW.source_id, inst, NEW.camera,
            CASE WHEN rd_by IS NULL THEN 'auto_read' ELSE 'acked' END,
            rd_by, rd_by_name, COALESCE(rd_at, now()));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_webhook_event_update ON public.webhook_events;
CREATE TRIGGER trg_log_webhook_event_update
AFTER UPDATE ON public.webhook_events
FOR EACH ROW EXECUTE FUNCTION public.log_webhook_event_update();

-- Backfill: received for every existing event
INSERT INTO public.alert_audit_log (organization_id, event_id, source_id, camera, action, ts)
SELECT we.organization_id, we.id, we.source_id, we.camera, 'received', we.ts
FROM public.webhook_events we
LEFT JOIN public.alert_audit_log a
  ON a.event_id = we.id AND a.action = 'received'
WHERE a.id IS NULL;

-- Backfill: archived/auto_archived & acked/auto_read (column-aware)
DO $$
DECLARE
  has_arc_by boolean;
  has_rd_by  boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='webhook_events' AND column_name='archived_by') INTO has_arc_by;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='webhook_events' AND column_name='read_by') INTO has_rd_by;

  IF has_arc_by THEN
    EXECUTE $sql$
      INSERT INTO public.alert_audit_log (organization_id, event_id, source_id, camera, action, actor, actor_name, ts)
      SELECT we.organization_id, we.id, we.source_id, we.camera,
             CASE WHEN we.archived_by IS NULL THEN 'auto_archived' ELSE 'archived' END,
             we.archived_by, we.archived_by_name, COALESCE(we.archived_at, we.ts)
      FROM public.webhook_events we
      LEFT JOIN public.alert_audit_log a
        ON a.event_id = we.id AND a.action IN ('archived','auto_archived')
      WHERE we.archived IS TRUE AND a.id IS NULL
    $sql$;
  ELSE
    INSERT INTO public.alert_audit_log (organization_id, event_id, source_id, camera, action, ts)
    SELECT we.organization_id, we.id, we.source_id, we.camera, 'auto_archived', we.ts
    FROM public.webhook_events we
    LEFT JOIN public.alert_audit_log a
      ON a.event_id = we.id AND a.action IN ('archived','auto_archived')
    WHERE we.archived IS TRUE AND a.id IS NULL;
  END IF;

  IF has_rd_by THEN
    EXECUTE $sql$
      INSERT INTO public.alert_audit_log (organization_id, event_id, source_id, camera, action, actor, actor_name, ts)
      SELECT we.organization_id, we.id, we.source_id, we.camera,
             CASE WHEN we.read_by IS NULL THEN 'auto_read' ELSE 'acked' END,
             we.read_by, we.read_by_name, COALESCE(we.read_at, we.ts)
      FROM public.webhook_events we
      LEFT JOIN public.alert_audit_log a
        ON a.event_id = we.id AND a.action IN ('acked','auto_read')
      WHERE we.read IS TRUE AND COALESCE(we.archived, false) = false AND a.id IS NULL
    $sql$;
  ELSE
    INSERT INTO public.alert_audit_log (organization_id, event_id, source_id, camera, action, ts)
    SELECT we.organization_id, we.id, we.source_id, we.camera, 'auto_read', we.ts
    FROM public.webhook_events we
    LEFT JOIN public.alert_audit_log a
      ON a.event_id = we.id AND a.action IN ('acked','auto_read')
    WHERE we.read IS TRUE AND COALESCE(we.archived, false) = false AND a.id IS NULL;
  END IF;
END $$;
