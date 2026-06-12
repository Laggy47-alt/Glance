// Helpers for talking to a UniFi Protect NVR via the unifi-proxy edge function.
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
  last_seen_at: string | null;
};

export type UnifiCamera = {
  id: string;
  name: string;
  state: string;
  type?: string;
  modelKey?: string;
  isConnected?: boolean;
  isMotionDetected?: boolean;
  lastSeen?: number;
};

export type UnifiEventRow = {
  id: string;
  start: number;
  end?: number;
  type: string;
  camera: string;
  smartDetectTypes?: string[];
  score?: number;
  thumbnail?: string;
};

function proxyUrl(instanceId: string, path: string) {
  const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/unifi-proxy/${instanceId}`;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token
    ? { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "" }
    : {};
}

export async function fetchUnifiCameras(inst: UnifiInstance): Promise<UnifiCamera[]> {
  const r = await fetch(proxyUrl(inst.id, "/proxy/protect/api/cameras"), {
    headers: await authHeaders(),
  });
  if (!r.ok) throw new Error(`UniFi cameras: ${r.status}`);
  const data = await r.json();
  // UniFi Protect returns an array of camera objects
  if (!Array.isArray(data)) return [];
  return data.map((c: any) => ({
    id: c.id,
    name: c.name ?? c.id,
    state: c.state ?? "UNKNOWN",
    type: c.type,
    modelKey: c.modelKey,
    isConnected: c.isConnected,
    isMotionDetected: c.isMotionDetected,
    lastSeen: c.lastSeen,
  }));
}

export function unifiSnapshotUrl(inst: UnifiInstance, cameraId: string, hires = false) {
  const q = new URLSearchParams({ ts: String(Date.now()), highQuality: hires ? "true" : "false" });
  return proxyUrl(inst.id, `/proxy/protect/api/cameras/${encodeURIComponent(cameraId)}/snapshot?${q}`);
}

export function unifiThumbnailUrl(inst: UnifiInstance, eventId: string) {
  return proxyUrl(inst.id, `/proxy/protect/api/events/${encodeURIComponent(eventId)}/thumbnail`);
}

export async function fetchUnifiEvents(
  inst: UnifiInstance,
  opts: { start?: number; end?: number; limit?: number } = {},
): Promise<UnifiEventRow[]> {
  const start = opts.start ?? Date.now() - 24 * 3600 * 1000;
  const end = opts.end ?? Date.now();
  const q = new URLSearchParams({
    start: String(start),
    end: String(end),
    limit: String(opts.limit ?? 100),
  });
  const r = await fetch(proxyUrl(inst.id, `/proxy/protect/api/events?${q}`), {
    headers: await authHeaders(),
  });
  if (!r.ok) throw new Error(`UniFi events: ${r.status}`);
  const data = await r.json();
  if (!Array.isArray(data)) return [];
  return data.map((e: any) => ({
    id: e.id,
    start: e.start,
    end: e.end,
    type: e.type,
    camera: e.camera,
    smartDetectTypes: e.smartDetectTypes,
    score: e.score,
    thumbnail: e.thumbnail,
  }));
}
