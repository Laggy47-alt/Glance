import { useEffect, useState, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Server, RefreshCw, CheckCircle2, AlertTriangle, VideoOff, Camera, WifiOff, Wifi, ImageOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchUnifiCameras,
  loadUnifiInstances,
  unifiCameraThumbnailUrl,
  type UnifiCamera,
  type UnifiInstance,
} from "@/lib/unifi";
import { cn } from "@/lib/utils";

type CamState = {
  loading: boolean;
  error: string | null;
  cameras: UnifiCamera[];
  fetchedAt: number | null;
};

export function UnifiNvrCards() {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? null;
  const [instances, setInstances] = useState<UnifiInstance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [states, setStates] = useState<Record<string, CamState>>({});
  // Per-instance "force refresh" tick (bumped by the Refresh button only).
  const [refreshTick, setRefreshTick] = useState(0);

  const loadList = useCallback(async () => {
    try {
      const list = await loadUnifiInstances(orgId);
      setInstances(list);
    } catch {
      setInstances([]);
    } finally {
      setLoaded(true);
    }
  }, [orgId]);

  useEffect(() => { void loadList(); }, [loadList]);

  // realtime updates so newly-added NVRs appear without a reload
  useEffect(() => {
    if (!orgId) return;
    const ch = supabase
      .channel(`unifi-instances-nvrstatus-${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "unifi_instances", filter: `organization_id=eq.${orgId}` },
        () => void loadList(),
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [orgId, loadList]);

  const fetchOne = useCallback(async (inst: UnifiInstance) => {
    setStates((p) => ({
      ...p,
      [inst.id]: { ...(p[inst.id] ?? { cameras: [], fetchedAt: null }), loading: true, error: null },
    }));
    try {
      const cameras = await fetchUnifiCameras(inst);
      setStates((p) => ({ ...p, [inst.id]: { loading: false, error: null, cameras, fetchedAt: Date.now() } }));
    } catch (e) {
      setStates((p) => ({ ...p, [inst.id]: { loading: false, error: (e as Error).message, cameras: [], fetchedAt: Date.now() } }));
    }
  }, []);

  const fetchAll = useCallback(() => {
    for (const inst of instances) if (inst.enabled) void fetchOne(inst);
  }, [instances, fetchOne]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Manual refresh only — thumbnails self-refresh on a per-camera staggered
  // schedule (see UnifiCameraThumb) so we don't kick off a thundering herd
  // of proxy calls every interval.
  const bumpAll = useCallback(() => setRefreshTick((t) => t + 1), []);

  const enabled = instances.filter((i) => i.enabled);
  if (!loaded) return null;
  if (enabled.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">UniFi ENVR</h3>
          <p className="text-xs text-muted-foreground">{enabled.length} instance{enabled.length === 1 ? "" : "s"} connected.</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAll} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {enabled.map((inst) => {
          const s = states[inst.id];
          const offline = s?.cameras.filter((c) => c.isConnected === false) ?? [];
          const online = s?.cameras.filter((c) => c.isConnected !== false) ?? [];
          const reachable = !s?.error;
          return (
            <Card key={inst.id} className="bg-gradient-card border-border shadow-card overflow-hidden">
              <div className="p-4 border-b border-border flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-md grid place-items-center shrink-0" style={{ background: `${inst.color}22`, color: inst.color }}>
                    <Server className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground truncate">{inst.name}</h3>
                      {inst.is_local && (
                        <Badge variant="secondary" className="gap-1 text-[9px] bg-primary/15 text-primary border-primary/30 h-4 px-1.5">
                          <Wifi className="h-2.5 w-2.5" /> Local
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-[9px] h-4 px-1.5">UniFi</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">{inst.base_url}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!reachable ? (
                    <Badge variant="destructive" className="gap-1 text-[10px]">
                      <WifiOff className="h-3 w-3" /> Unreachable
                    </Badge>
                  ) : offline.length > 0 ? (
                    <Badge variant="destructive" className="gap-1 text-[10px]">
                      <AlertTriangle className="h-3 w-3" /> {offline.length} offline
                    </Badge>
                  ) : s?.cameras.length ? (
                    <Badge className="bg-success/15 text-success border border-success/30 gap-1 text-[10px]">
                      <CheckCircle2 className="h-3 w-3" /> All online
                    </Badge>
                  ) : null}
                  <Button variant="ghost" size="sm" onClick={() => fetchOne(inst)} className="h-7 px-2">
                    <RefreshCw className={cn("h-3.5 w-3.5", s?.loading && "animate-spin")} />
                  </Button>
                </div>
              </div>

              <div className="p-4">
                {s?.loading && !s.cameras.length ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : s?.error ? (
                  <div className="flex items-start gap-2 text-xs text-destructive">
                    <WifiOff className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span className="break-all">Failed to reach NVR: {s.error}</span>
                  </div>
                ) : !s || s.cameras.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No cameras reported by this NVR.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {s.cameras.map((cam) => (
                        <UnifiCameraThumb
                          key={cam.id}
                          instanceId={inst.id}
                          camera={cam}
                          tick={thumbTick}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1"><Camera className="h-3 w-3 text-success" />{online.length} online</span>
                      {offline.length > 0 && (
                        <span className="flex items-center gap-1 text-destructive"><VideoOff className="h-3 w-3" />{offline.length} offline</span>
                      )}
                    </div>
                  </div>
                )}
                {s?.fetchedAt && (
                  <p className="text-[10px] text-muted-foreground mt-3 tabular-nums">
                    Updated {new Date(s.fetchedAt).toLocaleTimeString()}
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function UnifiCameraThumb({ instanceId, camera, tick }: { instanceId: string; camera: UnifiCamera; tick: number }) {
  const [errored, setErrored] = useState(false);
  const offline = camera.isConnected === false;
  const src = unifiCameraThumbnailUrl(instanceId, camera.id, tick);
  return (
    <div className={cn(
      "relative rounded-md overflow-hidden border bg-secondary/40 aspect-video",
      offline ? "border-destructive/40" : "border-border",
    )}>
      {errored || offline ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
          {offline ? <VideoOff className="h-4 w-4 text-destructive" /> : <ImageOff className="h-4 w-4" />}
          <span className="text-[9px]">{offline ? "Offline" : "No snapshot"}</span>
        </div>
      ) : (
        <img
          src={src}
          alt={camera.name}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 to-transparent px-1.5 py-1 flex items-center gap-1">
        <span className="text-[10px] text-foreground truncate flex-1">{camera.name}</span>
        {offline ? (
          <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-success shrink-0" />
        )}
      </div>
    </div>
  );
}
