import { supabase } from "@/integrations/supabase/client";

export type UnifiInstance = {
  id: string;
  organization_id: string;
  name: string;
  base_url: string;
  api_key: string;
  color: string;
  enabled: boolean;
  is_local: boolean;
  verify_tls: boolean;
};

export type UnifiCamera = {
  id: string;
  name: string;
  state?: string;
  isConnected?: boolean;
  modelKey?: string;
  type?: string;
};

function supabaseBaseUrl() {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (url) return url.replace(/\/+$/, "");
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  return `https://${projectId}.supabase.co`;
}

/** Build a URL to the unifi-proxy edge function for the given instance + upstream path. */
export function unifiProxyUrl(instanceId: string, path: string) {
  const p = path.startsWith("/") ? path : "/" + path;
  return `${supabaseBaseUrl()}/functions/v1/unifi-proxy/${instanceId}${p}`;
}

/**
 * Returns the best URL for a UniFi Protect API path, given an instance.
 * Local instances talk directly to the NVR on the LAN. Otherwise we go through
 * the cloud `unifi-proxy` edge function (which adds the X-API-KEY header).
 */
export function unifiUrl(instance: { id: string; base_url: string; is_local: boolean }, path: string) {
  const p = path.startsWith("/") ? path : "/" + path;
  if (instance.is_local) return `${instance.base_url.replace(/\/+$/, "")}${p}`;
  return unifiProxyUrl(instance.id, p);
}

/** List cameras on a UniFi Protect instance via the integration v1 API. */
export async function fetchUnifiCameras(instance: UnifiInstance): Promise<UnifiCamera[]> {
  // Always go through the proxy: it injects X-API-KEY and avoids CORS.
  const url = unifiProxyUrl(instance.id, "/proxy/protect/integration/v1/cameras");
  const r = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`${r.status} ${r.statusText}${body ? ` — ${body.slice(0, 160)}` : ""}`);
  }
  const data = await r.json();
  // Integration API returns an array; legacy API returns {cameras: []}.
  const arr = Array.isArray(data) ? data : Array.isArray((data as any)?.cameras) ? (data as any).cameras : [];
  return arr.map((c: any) => ({
    id: String(c.id),
    name: String(c.name ?? c.id ?? "camera"),
    state: c.state,
    isConnected: c.isConnected ?? (c.state ? c.state === "CONNECTED" : undefined),
    modelKey: c.modelKey,
    type: c.type,
  })) as UnifiCamera[];
}

/** URL for a low-res thumbnail snapshot of a UniFi camera. */
export function unifiCameraThumbnailUrl(instanceId: string, cameraId: string, cacheBust?: number) {
  const qs = cacheBust ? `&ts=${cacheBust}` : "";
  return unifiProxyUrl(
    instanceId,
    `/proxy/protect/integration/v1/cameras/${encodeURIComponent(cameraId)}/snapshot?highQuality=false${qs}`,
  );
}

/** Load all enabled UniFi instances for the active org. */
export async function loadUnifiInstances(orgId: string | null | undefined): Promise<UnifiInstance[]> {
  if (!orgId) return [];
  const { data, error } = await supabase
    .from("unifi_instances")
    .select("id, organization_id, name, base_url, api_key, color, enabled, is_local, verify_tls")
    .eq("organization_id", orgId)
    .order("name");
  if (error) throw error;
  return (data ?? []) as UnifiInstance[];
}
