import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { frigateUrl } from "@/lib/webhookStore";
import { fetchFrigateStats } from "@/lib/frigateStats";

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // hourly
const STORAGE_KEY = "snapshot-refresher:lastRun";

async function refreshInstance(inst: { id: string; base_url: string; is_local: boolean }) {
  let online: string[] = [];
  try {
    const j: any = await fetchFrigateStats(inst);
    online = Object.entries<any>(j?.cameras ?? {})
      .filter(([, d]) => Number(d?.camera_fps ?? 0) > 0)
      .map(([n]) => n);
  } catch { return; }

  await Promise.all(online.map(async (camera) => {
    try {
      const r = await fetch(frigateUrl(inst, `/api/${encodeURIComponent(camera)}/latest.jpg?h=400`));
      if (!r.ok) return;
      const blob = await r.blob();
      if (!blob.type.startsWith("image/")) return;
      const safe = camera.replace(/[^a-zA-Z0-9_-]/g, "_");
      await supabase.storage
        .from("camera-snapshots")
        .upload(`${inst.id}/${safe}.jpg`, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "60" });
    } catch { /* ignore */ }
  }));
}

async function runRefresh() {
  try {
    const { data: instances } = await supabase
      .from("frigate_instances")
      .select("id, base_url, is_local, enabled")
      .eq("enabled", true)
      .eq("is_local", true);
    for (const inst of (instances ?? []) as any[]) {
      try { await refreshInstance(inst); } catch { /* ignore per-instance */ }
    }
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch { /* ignore */ }
}

/** Periodically uploads the latest snapshot of every camera to cloud storage,
 *  so the daily report cron (which runs in the cloud) can include them. */
export function useSnapshotRefresher() {
  useEffect(() => {
    const last = Number(localStorage.getItem(STORAGE_KEY) || 0);
    const sinceLast = Date.now() - last;
    const initialDelay = sinceLast > REFRESH_INTERVAL_MS ? 5_000 : REFRESH_INTERVAL_MS - sinceLast;
    const t1 = setTimeout(() => { runRefresh(); }, initialDelay);
    const t2 = setInterval(runRefresh, REFRESH_INTERVAL_MS);
    return () => { clearTimeout(t1); clearInterval(t2); };
  }, []);
}
