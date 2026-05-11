import { useEffect, useRef, useState } from "react";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { frigateUrl } from "@/lib/webhookStore";

const POLL_MS = 30_000;

function parseOfflineCount(stats: unknown): { total: number; offline: number } {
  if (!stats || typeof stats !== "object") return { total: 0, offline: 0 };
  const root = stats as Record<string, unknown>;
  const cameras = (root.cameras && typeof root.cameras === "object" ? root.cameras : root) as Record<string, unknown>;
  const reserved = new Set([
    "cpu_usages", "gpu_usages", "service", "detectors", "detection_fps",
    "processes", "bandwidth_usages", "version",
  ]);
  let total = 0, offline = 0;
  for (const [name, val] of Object.entries(cameras)) {
    if (reserved.has(name)) continue;
    if (!val || typeof val !== "object") continue;
    const c = val as Record<string, unknown>;
    const hasShape = "camera_fps" in c || "process_fps" in c || "detection_fps" in c || "pid" in c;
    if (!hasShape) continue;
    const fps = typeof c.camera_fps === "number" ? c.camera_fps : undefined;
    const pid = typeof c.pid === "number" ? c.pid : undefined;
    const online = (pid === undefined || pid > 0) && (fps === undefined || fps > 0);
    total += 1;
    if (!online) offline += 1;
  }
  return { total, offline };
}

function playOfflineChime() {
  try {
    type AC = typeof AudioContext;
    const Ctor: AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: AC }).webkitAudioContext;
    const ctx = new Ctor();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "triangle";
    o.frequency.setValueAtTime(440, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.35);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    o.start();
    o.stop(ctx.currentTime + 0.42);
  } catch { /* no-op */ }
}

/**
 * Polls every enabled Frigate NVR and tracks the number of offline cameras
 * and unreachable NVRs. Plays a chime when the offline count transitions
 * from zero to non-zero. Used by the sidebar to show a "!" badge on
 * "NVR Status" and "Camera Status".
 */
export function useOfflineStatus() {
  const store = useWebhookStore();
  const [offlineCameras, setOfflineCameras] = useState(0);
  const [unreachableNvrs, setUnreachableNvrs] = useState(0);
  const lastOfflineRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const enabled = store.frigates.filter((f) => f.enabled);
      if (enabled.length === 0) {
        if (!cancelled) { setOfflineCameras(0); setUnreachableNvrs(0); }
        return;
      }
      let off = 0;
      let unreach = 0;
      await Promise.all(enabled.map(async (f) => {
        try {
          const url = frigateUrl(f, "/api/stats");
          const res = await fetch(url);
          if (!res.ok) { unreach += 1; return; }
          const json = await res.json();
          const { offline } = parseOfflineCount(json);
          off += offline;
        } catch {
          unreach += 1;
        }
      }));
      if (cancelled) return;
      const total = off + unreach;
      if (total > 0 && lastOfflineRef.current === 0) playOfflineChime();
      lastOfflineRef.current = total;
      setOfflineCameras(off);
      setUnreachableNvrs(unreach);
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [store.frigates]);

  return {
    offlineCameras,
    unreachableNvrs,
    hasOffline: offlineCameras + unreachableNvrs > 0,
  };
}
