import type { Pairing } from "./storage";

function url(p: Pairing, fn: string) {
  return `${p.endpoint.replace(/\/$/, "")}/${fn}`;
}

async function post(p: Pairing, fn: string, body: unknown) {
  const res = await fetch(url(p, fn), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: p.anon_key,
      Authorization: `Bearer ${p.anon_key}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* leave null */ }
  if (!res.ok) {
    const msg = json?.error ? `${json.error}${json.detail ? `: ${json.detail}` : ""}` : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

export interface AlertPayload {
  site?: string;
  camera?: string;
  label?: string;
  ts?: string;
  snapshot_url?: string;
}

export interface PollResult {
  dispatch: null | {
    id: string;
    status: string;
    priority?: string;
    site_id?: string;
    site_name?: string;
    site_lat?: number;
    site_lng?: number;
    dispatched_at?: string;
    alert_payload?: AlertPayload | null;
  };
  tracking: boolean;
  interval_ms: number;
}

export const api = {
  poll: (p: Pairing) => post(p, "dispatch-poll", { token: p.token }) as Promise<PollResult>,
  ping: (p: Pairing, coords: { lat: number; lng: number; accuracy?: number; speed?: number; heading?: number }) =>
    post(p, "dispatch-ping", { token: p.token, ...coords }),
  state: (p: Pairing, action: "acknowledge" | "arrive" | "complete" | "cancel", dispatch_id?: string) =>
    post(p, "dispatch-state", { token: p.token, action, dispatch_id }),
};
