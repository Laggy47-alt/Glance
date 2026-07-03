import { supabase } from "@/integrations/supabase/client";
import type { UnifiCameraStatus, UnifiOfflineAlertSettings } from "@/lib/webhookStore";

export async function fetchUnifiCameraStatus(instanceId?: string): Promise<UnifiCameraStatus[]> {
  let q = supabase.from("unifi_camera_status").select("*").order("name", { ascending: true });
  if (instanceId) q = q.eq("instance_id", instanceId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as UnifiCameraStatus[];
}

export async function fetchOfflineAlertSettings(instanceId: string): Promise<UnifiOfflineAlertSettings | null> {
  const { data, error } = await supabase
    .from("unifi_offline_alert_settings")
    .select("*")
    .eq("unifi_instance_id", instanceId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as UnifiOfflineAlertSettings) ?? null;
}

export async function upsertOfflineAlertSettings(
  organizationId: string,
  s: Omit<UnifiOfflineAlertSettings, "updated_at" | "organization_id">,
): Promise<void> {
  const row = { ...s, organization_id: organizationId, updated_at: new Date().toISOString() };
  const { error } = await supabase
    .from("unifi_offline_alert_settings")
    .upsert(row as never, { onConflict: "unifi_instance_id" });
  if (error) throw error;
}
