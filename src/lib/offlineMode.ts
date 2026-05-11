/**
 * Offline diagnostics mode.
 *
 * If the Supabase backend is unreachable, the app falls back to an emergency
 * diagnostics page gated by a hardcoded super-admin credential. This lets the
 * platform owner inspect connectivity and reconnect even when the database is
 * down.
 *
 * Username: charl
 * Password: CrownTE12  (stored only as a SHA-256 hash below)
 */

const EMERGENCY_USERNAME = "charl";
const EMERGENCY_PASSWORD_SHA256 =
  "b8a24143d0a4c9bd05a51b22b938e0cf6d5bf66a4a98e89e89f9c86807fba53e";

export const OFFLINE_SESSION_KEY = "offline.superAdminSession";

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyEmergencyCredentials(username: string, password: string) {
  if (username.trim().toLowerCase() !== EMERGENCY_USERNAME) return false;
  const h = await sha256Hex(password);
  return h === EMERGENCY_PASSWORD_SHA256;
}

export function startOfflineSession() {
  try {
    localStorage.setItem(
      OFFLINE_SESSION_KEY,
      JSON.stringify({ user: EMERGENCY_USERNAME, ts: Date.now() })
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
  } catch (e: any) {
    return { ok: false, error: e?.message || "network error" };
  } finally {
    clearTimeout(t);
  }
}
