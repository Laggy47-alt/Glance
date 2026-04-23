import { supabase } from "@/integrations/supabase/client";

export type AuditEntry = {
  id: string;
  event_id: string | null;
  alert_key: string;
  action: string;
  note: string | null;
  actor: string | null;
  ts: string;
};

const ACTOR_KEY = "wall.actor";

export function getActor(): string {
  try {
    const v = localStorage.getItem(ACTOR_KEY);
    if (v && v.trim()) return v;
  } catch { /* no-op */ }
  return "operator";
}

export function setActor(name: string) {
  try { localStorage.setItem(ACTOR_KEY, name); } catch { /* no-op */ }
}

export async function logAudit(input: {
  alert_key: string;
  event_id?: string | null;
  action: string;
  note?: string | null;
}) {
  const { error } = await supabase.from("event_audit_log").insert({
    alert_key: input.alert_key,
    event_id: input.event_id ?? null,
    action: input.action,
    note: input.note ?? null,
    actor: getActor(),
  });
  if (error) throw error;
}

export async function fetchAudit(alert_key: string): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from("event_audit_log")
    .select("*")
    .eq("alert_key", alert_key)
    .order("ts", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AuditEntry[];
}
