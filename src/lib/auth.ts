import { supabase } from "@/integrations/supabase/client";

export const usernameToEmail = (u: string) => `${u.toLowerCase().trim()}@local.app`;
export const emailToUsername = (e: string | null | undefined) =>
  e ? e.replace(/@local\.app$/i, "") : "";

export async function signInWithUsername(username: string, password: string) {
  return supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
}

export async function changeOwnPassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    await supabase.from("profiles").update({ must_change_password: false }).eq("user_id", data.user.id);
  }
}
