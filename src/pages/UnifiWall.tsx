import { useEffect, useState, useCallback } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { useUnifiInstances } from "@/hooks/useUnifi";
import { fetchUnifiCameras, unifiSnapshotUrl, type UnifiCamera, type UnifiInstance } from "@/lib/unifiClient";
import { Loader2, Cctv, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

const REFRESH_MS = 5000;

export default function UnifiWall() {
  const { activeOrg } = useAuth();
  const { instances, loading: instLoading } = useUnifiInstances(activeOrg?.id ?? null);
  const [byInstance, setByInstance] = useState<Map<string, UnifiCamera[]>>(new Map());
  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const loadCams = useCallback(async () => {
    if (!instances.length) return;
    setRefreshing(true);
    const next = new Map<string, UnifiCamera[]>();
    await Promise.all(instances.filter((i) => i.enabled).map(async (i) => {
      try { next.set(i.id, await fetchUnifiCameras(i)); }
      catch { next.set(i.id, []); }
    }));
    setByInstance(next);
    setRefreshing(false);
  }, [instances]);

  useEffect(() => { void loadCams(); }, [loadCams]);

  // Bump snapshot URLs every few seconds to refresh thumbnails.
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const total = Array.from(byInstance.values()).reduce((s, a) => s + a.length, 0);

  return (
    <DashboardLayout
      title="Live Wall"
      subtitle={`${total} camera${total === 1 ? "" : "s"} across ${instances.length} NVR${instances.length === 1 ? "" : "s"}`}
      actions={<Button size="sm" variant="outline" onClick={loadCams} disabled={refreshing}><RefreshCcw className={`h-3.5 w-3.5 mr-1 ${refreshing ? "animate-spin" : ""}`} /> Refresh</Button>}
    >
      {instLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 inline animate-spin mr-2" /> Loading…</div>
      ) : instances.length === 0 ? (
        <Empty message="Add a UniFi NVR first." />
      ) : total === 0 ? (
        <Empty message="No cameras returned from the NVR yet." />
      ) : (
        <div className="space-y-6">
          {instances.map((inst) => {
            const cams = byInstance.get(inst.id) ?? [];
            if (!cams.length) return null;
            return (
              <section key={inst.id}>
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: inst.color }} /> {inst.name}
                  <span className="text-xs text-muted-foreground font-normal">({cams.length})</span>
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {cams.map((c) => <CameraTile key={c.id} inst={inst} cam={c} tick={tick} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </DashboardLayout>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <Cctv className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function CameraTile({ inst, cam, tick }: { inst: UnifiInstance; cam: UnifiCamera; tick: number }) {
  const offline = cam.state && cam.state !== "CONNECTED" && cam.isConnected === false;
  const url = `${unifiSnapshotUrl(inst, cam.id)}&_=${tick}`;
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="relative aspect-video bg-muted">
        {offline ? (
          <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">Offline</div>
        ) : (
          <img src={url} alt={cam.name} className="w-full h-full object-cover" loading="lazy" />
        )}
        {cam.isMotionDetected && (
          <span className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-2 py-0.5 animate-pulse">
            MOTION
          </span>
        )}
      </div>
      <div className="px-3 py-2 flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${offline ? "bg-destructive" : "bg-success"}`} />
        <span className="text-xs truncate flex-1">{cam.name}</span>
      </div>
    </div>
  );
}
