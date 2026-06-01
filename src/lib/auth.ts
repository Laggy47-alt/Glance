import { supabase } from "@/integrations/supabase/client";

const SUPER_SLUG = "super";

/** Builds the synthetic auth email used for sign-in. Org slug "super" is reserved for the platform owner. */
export const buildAuthEmail = (username: string, orgSlug: string) =>
  `${username.toLowerCase().trim()}@${orgSlug.toLowerCase().trim()}.local.app`;

/** Back-compat helper still used by older code paths (defaults to legacy domain). */
export const usernameToEmail = (u: string) => `${u.toLowerCase().trim()}@local.app`;

export const emailToUsername = (e: string | null | undefined) =>
  e ? e.replace(/@[^@]+$/i, "") : "";

export const emailToOrgSlug = (e: string | null | undefined) => {
  if (!e) return null;
  const m = e.match(/@([^.]+)\.local\.app$/i);
  return m ? m[1].toLowerCase() : null;
};

export const isSuperSlug = (slug: string | null | undefined) =>
  (slug ?? "").toLowerCase() === SUPER_SLUG;

const AUTH_LOCK_ABORT_MESSAGE = "The previous sign-in attempt was interrupted. Please try again.";

function normalizeAuthError(error: unknown): { message: string } | null {
  if (!error) return null;
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error);

  if (/lock request is aborted|aborterror/i.test(message)) {
    return { message: AUTH_LOCK_ABORT_MESSAGE };
  }
  return { message: message || "Sign in failed." };
}

export async function signInWithUsername(username: string, password: string, orgSlug: string) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: buildAuthEmail(username, orgSlug),
      password,
    });
    return { data, error: normalizeAuthError(error) };
  } catch (error) {
    return { data: { user: null, session: null }, error: normalizeAuthError(error) };
  }
}

export async function changeOwnPassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    await supabase.from("profiles").update({ must_change_password: false }).eq("user_id", data.user.id);
  }
}
