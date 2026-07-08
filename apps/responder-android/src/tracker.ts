import { Geolocation } from "@capacitor/geolocation";
import { api } from "./api";
import type { Pairing } from "./storage";

let watchId: string | null = null;

export async function ensureLocationPermission(): Promise<boolean> {
  const state = await Geolocation.checkPermissions();
  if (state.location === "granted") return true;
  const req = await Geolocation.requestPermissions();
  return req.location === "granted";
}

export function isTracking(): boolean {
  return watchId !== null;
}

export async function startTracking(
  pairing: Pairing,
  onPing: (t: number) => void,
  onError?: (message: string) => void,
) {
  if (watchId) return;
  const ok = await ensureLocationPermission();
  if (!ok) throw new Error("Location permission denied");
  watchId = await Geolocation.watchPosition(
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    async (pos, err) => {
      if (err || !pos) {
        if (err) onError?.(err.message ?? "location watch error");
        return;
      }
      try {
        await api.ping(pairing, {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? undefined,
          speed: pos.coords.speed ?? undefined,
          heading: pos.coords.heading ?? undefined,
        });
        onPing(Date.now());
      } catch (e: any) {
        onError?.(e?.message ?? "ping failed");
        /* keep the watcher alive */
      }
    },
  );
}

export async function stopTracking() {
  if (!watchId) return;
  await Geolocation.clearWatch({ id: watchId });
  watchId = null;
}
