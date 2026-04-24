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

// Cached actor identity, keyed by user id so a new login never inherits
// the previous user's name.
let cachedActor: string | null = null;
let cachedActorUserId: string | null = null;

// Reset the cache whenever the auth state changes so the next logAudit call
// re-resolves the actor for the freshly signed-in user.
supabase.auth.onAuthStateChange((_e, session) => {
  if (session?.user?.id !== cachedActorUserId) {
    cachedActor = null;
    cachedActorUserId = null;
  }
});

async function resolveActor(): Promise<string> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      // Reuse cache only if it belongs to the current user
      if (cachedActor && cachedActorUserId === user.id) return cachedActor;
      const { data: prof } = await supabase
        .from("profiles")
        .select("username, display_name")
        .eq("user_id", user.id)
        .maybeSingle();
      const name = prof?.display_name || prof?.username || user.email || "user";
      cachedActor = name;
      cachedActorUserId = user.id;
      return name;
    }
  } catch { /* fall through */ }
  cachedActor = null;
  cachedActorUserId = null;
  try {
    const v = localStorage.getItem(ACTOR_KEY);
    if (v && v.trim()) return v;
  } catch { /* no-op */ }
  return "operator";
}

export function getActor(): string {
  return cachedActor ?? "operator";
}

export function setActor(name: string) {
  cachedActor = name;
  try { localStorage.setItem(ACTOR_KEY, name); } catch { /* no-op */ }
}

export async function logAudit(input: {
  alert_key: string;
  event_id?: string | null;
  action: string;
  note?: string | null;
}) {
  const actor = await resolveActor();
  const { error } = await supabase.from("event_audit_log").insert({
    alert_key: input.alert_key,
    event_id: input.event_id ?? null,
    action: input.action,
    note: input.note ?? null,
    actor,
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
