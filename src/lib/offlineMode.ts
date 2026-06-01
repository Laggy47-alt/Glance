/**
 * Offline diagnostics mode.
 *
 * If the Supabase backend is unreachable, the app falls back to an emergency
 * diagnostics page gated by a hardcoded emergency credential. This lets the
 * platform owner inspect connectivity and reconnect even when the database is
 * down.
 *
 * Emergency credentials:
 *   - admin / Abcsec2008
 *
 * Plain-text comparison is used intentionally — `crypto.subtle` is unavailable
 * over plain HTTP, and the credentials are already shipped in the bundle, so
 * hashing buys no real security.
 */

const EMERGENCY_CREDENTIALS: Array<{ user: string; pass: string }> = [
  { user: "admin", pass: "Abcsec2008" },
];

export const EMERGENCY_USER = "admin";
export const EMERGENCY_PASS = "Abcsec2008";

/**
 * Call the admin-users/emergency-reset endpoint to create or reset the
 * bootstrap admin account using the emergency credentials. Used from the
 * /offline diagnostics page so a fresh self-hosted install can mint its
 * first working login without ever needing to exec into the backend.
 */
export async function emergencyResetAdmin(newPassword: string): Promise<{ ok: boolean; error?: string; created?: boolean; username?: string }> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url) return { ok: false, error: "VITE_SUPABASE_URL not configured" };
  try {
    const res = await fetch(`${url}/functions/v1/admin-users/emergency-reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { apikey: key, Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        emergency_user: EMERGENCY_USER,
        emergency_pass: EMERGENCY_PASS,
        new_password: newPassword,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, created: !!data.created, username: data.username || "admin" };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

export async function forceCreateAdmin(newPassword: string): Promise<{ ok: boolean; error?: string; created?: boolean; username?: string }> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke("admin-users/emergency-reset", {
    method: "POST",
    body: {
      emergency_user: EMERGENCY_USER,
      emergency_pass: EMERGENCY_PASS,
      new_password: newPassword,
    },
  });
  if (error || !data?.ok) return { ok: false, error: data?.error || error?.message || "Failed to create admin account." };
  return { ok: true, created: !!data.created, username: data.username || "admin" };
}

export const OFFLINE_SESSION_KEY = "offline.superAdminSession";

export async function verifyEmergencyCredentials(username: string, password: string) {
  const u = username.trim().toLowerCase();
  return EMERGENCY_CREDENTIALS.some((c) => c.user === u && c.pass === password);
}

export function isEmergencyCredentials(username: string, password: string) {
  const u = username.trim().toLowerCase();
  return EMERGENCY_CREDENTIALS.some((c) => c.user === u && c.pass === password);
}

export function startOfflineSession(username = "admin") {
  try {
    localStorage.setItem(
      OFFLINE_SESSION_KEY,
      JSON.stringify({ user: username, ts: Date.now() })
    );
  } catch { /* ignore */ }
}

export function endOfflineSession() {
  try { localStorage.removeItem(OFFLINE_SESSION_KEY); } catch { /* ignore */ }
}

export function hasOfflineSession(): boolean {
  try { return !!localStorage.getItem(OFFLINE_SESSION_KEY); } catch { return false; }
}

/**
 * Probe Supabase reachability. Returns true if the REST endpoint responds at
 * all (even an auth error counts as "reachable"). A network failure / timeout
 * means the backend is down.
 */
export async function pingSupabase(timeoutMs = 5000): Promise<{ ok: boolean; status?: number; error?: string }> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url) return { ok: false, error: "VITE_SUPABASE_URL not configured" };

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: key ? { apikey: key } : {},
      signal: ctl.signal,
    });
    return { ok: res.ok || res.status < 500, status: res.status };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  } finally {
    clearTimeout(t);
  }
}
