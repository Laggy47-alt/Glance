-- Enforce one WhatsApp positive dispatch per (media, group). This makes the
-- edge function atomically idempotent: race conditions and network retries
-- can no longer produce duplicate sends.
DELETE FROM public.positive_alert_dispatches a
USING public.positive_alert_dispatches b
WHERE a.ctid < b.ctid
  AND a.media_id = b.media_id
  AND a.group_jid = b.group_jid;

CREATE UNIQUE INDEX IF NOT EXISTS positive_alert_dispatches_media_group_uniq
  ON public.positive_alert_dispatches (media_id, group_jid);