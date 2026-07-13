// Shared Frigate auth helper.
//
// Priority per instance:
//   1. If auth_username + auth_password are set → use cached JWT (if not
//      expired), else POST {base}/api/login, cache the resulting token in
//      frigate_instances.auth_token_cache for ~23h, attach as
//      `Authorization: Bearer <jwt>` AND `Cookie: frigate_token=<jwt>`
//      (covers both Frigate 0.14 cookie auth and proxy header auth).
//   2. Else if api_key is set → `Authorization: Bearer <api_key>` (legacy).
//   3. Else → no auth headers.
//
// Designed to be additive: an instance with only api_key behaves exactly as
// before. Login failures fall through to the next strategy so we never break
// existing production NVRs that have api_key still configured.

export type FrigateAuthRow = {
  id: string;
  base_url: string;
  api_key: string | null;
  auth_username: string | null;
  auth_password: string | null;
  auth_token_cache: string | null;
  auth_token_expires_at: string | null;
};

export const FRIGATE_AUTH_COLUMNS =
  "id, base_url, api_key, auth_username, auth_password, auth_token_cache, auth_token_expires_at";

const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // 23h — Frigate default is 24h

function trimUrl(u: string) { return u.replace(/\/+$/, ""); }

function extractCookieToken(setCookie: string | null): string | null {
  if (!setCookie) return null;
  // Set-Cookie may have multiple values joined by ", " — match the frigate cookie
  const m = setCookie.match(/frigate_token=([^;,\s]+)/i);
  return m?.[1] ?? null;
}

async function persistToken(
  supabase: any,
  instId: string,
  token: string,
  expiresAt: Date,
) {
  try {
    await supabase
      .from("frigate_instances")
      .update({
        auth_token_cache: token,
        auth_token_expires_at: expiresAt.toISOString(),
      })
      .eq("id", instId);
  } catch { /* best-effort */ }
}

async function clearToken(supabase: any, instId: string) {
  try {
    await supabase
      .from("frigate_instances")
      .update({ auth_token_cache: null, auth_token_expires_at: null })
      .eq("id", instId);
  } catch { /* best-effort */ }
}

async function login(inst: FrigateAuthRow): Promise<string | null> {
  if (!inst.auth_username || !inst.auth_password) return null;
  const base = trimUrl(inst.base_url);
  let r: Response | null = null;
  try {
    r = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ user: inst.auth_username, password: inst.auth_password }),
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    // Frigate sets the JWT as Set-Cookie: frigate_token=...
    const cookieTok = extractCookieToken(r.headers.get("set-cookie"));
    if (cookieTok) return cookieTok;
    // Some builds also return JSON { token: "..." } — be liberal
    if (r.ok) {
      try {
        const j = await r.json();
        if (typeof j?.token === "string") return j.token;
      } catch { /* ignore */ }
    }
    return null;
  } catch {
    return null;
  } finally {
    await r?.body?.cancel().catch(() => undefined);
  }
}

/**
 * Resolve the headers to send to Frigate for this instance.
 * `supabase` is a service-role client (used only to persist the token cache).
 * Pass `forceRefresh=true` to bypass the cache (e.g. after a 401).
 */
export async function frigateAuthHeaders(
  supabase: any,
  inst: FrigateAuthRow,
  forceRefresh = false,
): Promise<Record<string, string>> {
  // Strategy 1: username/password JWT
  if (inst.auth_username && inst.auth_password) {
    const now = Date.now();
    const cacheValid = !forceRefresh
      && inst.auth_token_cache
      && inst.auth_token_expires_at
      && new Date(inst.auth_token_expires_at).getTime() > now + 60_000;
    let token = cacheValid ? inst.auth_token_cache! : null;
    if (!token) {
      token = await login(inst);
      if (token) {
        const expiresAt = new Date(now + TOKEN_TTL_MS);
        await persistToken(supabase, inst.id, token, expiresAt);
        inst.auth_token_cache = token;
        inst.auth_token_expires_at = expiresAt.toISOString();
      }
    }
    if (token) {
      return {
        Authorization: `Bearer ${token}`,
        Cookie: `frigate_token=${token}`,
      };
    }
    // Login failed — fall through to api_key if present.
  }

  // Strategy 2: legacy api_key
  if (inst.api_key) {
    return { Authorization: `Bearer ${inst.api_key}` };
  }

  // Strategy 3: unauthenticated
  return {};
}

/**
 * Convenience: fetch from Frigate with auth, retrying once on 401 with a
 * fresh JWT. Returns the upstream Response.
 */
export async function frigateFetch(
  supabase: any,
  inst: FrigateAuthRow,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = trimUrl(inst.base_url);
  const url = `${base}${path.startsWith("/") ? path : "/" + path}`;
  const buildHeaders = async (force: boolean) => {
    const auth = await frigateAuthHeaders(supabase, inst, force);
    return { ...(init.headers as Record<string, string> | undefined), ...auth };
  };
  let res = await fetch(url, { ...init, headers: await buildHeaders(false) });
  if (res.status === 401 && inst.auth_username && inst.auth_password) {
    await clearToken(supabase, inst.id);
    inst.auth_token_cache = null;
    inst.auth_token_expires_at = null;
    await res.body?.cancel().catch(() => undefined);
    res = await fetch(url, { ...init, headers: await buildHeaders(true) });
  }
  return res;
}

/**
 * Invalidate cached JWT for an instance (call when a 401 surfaces from a
 * direct fetch that didn't go through frigateFetch).
 */
export async function invalidateFrigateToken(supabase: any, instId: string) {
  await clearToken(supabase, instId);
}
