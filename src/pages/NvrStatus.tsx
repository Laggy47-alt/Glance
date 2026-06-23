import { DashboardLayout } from "@/components/DashboardLayout";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState, useCallback } from "react";
import {
  Server, RefreshCw, CheckCircle2, AlertTriangle, VideoOff, Camera, WifiOff, Wifi, ShieldCheck,
} from "lucide-react";
import { fetchFrigateStats } from "@/lib/frigateStats";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { HikvisionInstance } from "@/lib/webhookStore";


type CameraStatus = {
  name: string;
  online: boolean;
  fps?: number;
  detectionFps?: number;
  pid?: number;
};

type NvrCardStatus = {
  instanceId: string;
  loading: boolean;
  error: string | null;
  cameras: CameraStatus[];
  fetchedAt: number | null;
};

function parseStats(stats: unknown): CameraStatus[] {
  if (!stats || typeof stats !== "object") return [];
  const root = stats as Record<string, unknown>;
  const cameras = (root.cameras && typeof root.cameras === "object" ? root.cameras : root) as Record<string, unknown>;
  const reserved = new Set([
    "cpu_usages", "gpu_usages", "service", "detectors", "detection_fps",
    "processes", "bandwidth_usages", "version",
  ]);
  const out: CameraStatus[] = [];
  for (const [name, val] of Object.entries(cameras)) {
    if (reserved.has(name)) continue;
    if (!val || typeof val !== "object") continue;
    const c = val as Record<string, any>;
    const hasShape = "camera_fps" in c || "process_fps" in c || "detection_fps" in c || "pid" in c;
    if (!hasShape) continue;
    const fps = typeof c.camera_fps === "number" ? c.camera_fps : undefined;
    const detectionFps = typeof c.detection_fps === "number" ? c.detection_fps : undefined;
    const pid = typeof c.pid === "number" ? c.pid : undefined;
    const online = (pid === undefined || pid > 0) && (fps === undefined || fps > 0);
    out.push({ name, online, fps, detectionFps, pid });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const NvrStatus = () => {
  const store = useWebhookStore();
  const { activeOrg } = useAuth();
  const [statuses, setStatuses] = useState<Record<string, NvrCardStatus>>({});
  const [hikStatuses, setHikStatuses] = useState<Record<string, NvrCardStatus>>({});

  const fetchOne = useCallback(async (instanceId: string) => {
    const inst = store.frigates.find((x) => x.id === instanceId);
    if (!inst) return;
    setStatuses((prev) => ({
      ...prev,
      [instanceId]: { ...(prev[instanceId] ?? { instanceId, cameras: [], fetchedAt: null }), loading: true, error: null, instanceId },
    }));
    try {
      const json = await fetchFrigateStats(inst);
      const cameras = parseStats(json);
      setStatuses((prev) => ({
        ...prev,
        [instanceId]: { instanceId, loading: false, error: null, cameras, fetchedAt: Date.now() },
      }));
    } catch (e) {
      setStatuses((prev) => ({
        ...prev,
        [instanceId]: { instanceId, loading: false, error: (e as Error).message, cameras: [], fetchedAt: Date.now() },
      }));
    }
  }, [store.frigates]);

  const fetchHikOne = useCallback(async (h: HikvisionInstance) => {
    if (!activeOrg?.id) return;
    setHikStatuses((prev) => ({
      ...prev,
      [h.id]: { ...(prev[h.id] ?? { instanceId: h.id, cameras: [], fetchedAt: null }), loading: true, error: null, instanceId: h.id },
    }));
    try {
      // camera_status is populated by hikvision-watch every minute keyed by friendly channel name.
      const { data, error } = await supabase
        .from("camera_status")
        .select("camera, online")
        .eq("organization_id", activeOrg.id)
        .eq("instance_id", h.id);
      if (error) throw error;
      const cameras: CameraStatus[] = (data ?? [])
        .map((r) => ({ name: r.camera, online: !!r.online }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const err = h.nvr_unreachable_since ? "NVR unreachable" : h.last_error;
      setHikStatuses((prev) => ({
        ...prev,
        [h.id]: { instanceId: h.id, loading: false, error: err, cameras, fetchedAt: Date.now() },
      }));
    } catch (e) {
      setHikStatuses((prev) => ({
        ...prev,
        [h.id]: { instanceId: h.id, loading: false, error: (e as Error).message, cameras: [], fetchedAt: Date.now() },
      }));
    }
  }, [activeOrg?.id]);

  const fetchAll = useCallback(() => {
    for (const f of store.frigates) if (f.enabled) fetchOne(f.id);
    for (const h of store.hikvisions) if (h.enabled) fetchHikOne(h);
  }, [store.frigates, store.hikvisions, fetchOne, fetchHikOne]);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 30000);
    return () => clearInterval(t);
  }, [fetchAll]);

  const enabledFrigates = store.frigates.filter((f) => f.enabled);
  const enabledHiks = store.hikvisions.filter((h) => h.enabled);
  const totalOffline =
    Object.values(statuses).reduce((a, s) => a + s.cameras.filter((c) => !c.online).length, 0) +
    Object.values(hikStatuses).reduce((a, s) => a + s.cameras.filter((c) => !c.online).length, 0);
  const totalCams =
    Object.values(statuses).reduce((a, s) => a + s.cameras.length, 0) +
    Object.values(hikStatuses).reduce((a, s) => a + s.cameras.length, 0);
  const totalNvrs = enabledFrigates.length + enabledHiks.length;

  return (
    <DashboardLayout
      title="NVR Status"
      subtitle={`${totalNvrs} NVR${totalNvrs === 1 ? "" : "s"} · ${totalCams} camera${totalCams === 1 ? "" : "s"} · ${totalOffline} offline`}
      actions={
        <Button variant="outline" size="sm" onClick={fetchAll} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh all
        </Button>
      }
    >
      {totalNvrs === 0 ? (
        <Card className="bg-gradient-card border-border shadow-card p-12 text-center">
          <Server className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-foreground font-medium">No NVRs configured</p>
          <p className="text-xs text-muted-foreground mt-1">Add Frigate or Hikvision instances from the NVRs page.</p>
        </Card>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {enabledFrigates.map((f) => {
            const s = statuses[f.id];
            const offline = s?.cameras.filter((c) => !c.online) ?? [];
            const online = s?.cameras.filter((c) => c.online) ?? [];
            const reachable = !s?.error;
            return (
              <Card key={f.id} className="bg-gradient-card border-border shadow-card overflow-hidden">
                <div className="p-4 border-b border-border flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-md grid place-items-center shrink-0" style={{ background: `${f.color}22`, color: f.color }}>
                      <Server className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground truncate">{f.name}</h3>
                        <Badge variant="secondary" className="text-[9px] bg-primary/15 text-primary border-primary/30 h-4 px-1.5">Frigate</Badge>
                        {f.is_local && (
                          <Badge variant="secondary" className="gap-1 text-[9px] bg-primary/15 text-primary border-primary/30 h-4 px-1.5">
                            <Wifi className="h-2.5 w-2.5" /> Local
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate">{f.base_url}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!reachable ? (
                      <Badge variant="destructive" className="gap-1 text-[10px]"><WifiOff className="h-3 w-3" /> Unreachable</Badge>
                    ) : offline.length > 0 ? (
                      <Badge variant="destructive" className="gap-1 text-[10px]"><AlertTriangle className="h-3 w-3" /> {offline.length} offline</Badge>
                    ) : s?.cameras.length ? (
                      <Badge className="bg-success/15 text-success border border-success/30 gap-1 text-[10px]"><CheckCircle2 className="h-3 w-3" /> All online</Badge>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => fetchOne(f.id)} className="h-7 px-2">
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
                  ) : s?.cameras.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No cameras reported by this NVR.</p>
                  ) : (
                    <div className="space-y-3">
                      {offline.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Offline ({offline.length})</p>
                          <div className="space-y-1">
                            {offline.map((c) => (
                              <div key={c.name} className="flex items-center gap-2 px-2 py-1.5 rounded bg-destructive/10 border border-destructive/30">
                                <VideoOff className="h-3.5 w-3.5 text-destructive shrink-0" />
                                <span className="text-xs text-foreground capitalize flex-1 truncate">{c.name}</span>
                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                  {c.fps !== undefined ? `${c.fps.toFixed(1)} fps` : "no data"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {online.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Online ({online.length})</p>
                          <div className="grid grid-cols-2 gap-1">
                            {online.map((c) => (
                              <div key={c.name} className="flex items-center gap-2 px-2 py-1.5 rounded bg-secondary/40">
                                <Camera className="h-3.5 w-3.5 text-success shrink-0" />
                                <span className="text-xs text-foreground capitalize flex-1 truncate">{c.name}</span>
                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                  {c.fps !== undefined ? `${c.fps.toFixed(0)}` : "—"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
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

          {enabledHiks.map((h) => {
            const s = hikStatuses[h.id];
            const offline = s?.cameras.filter((c) => !c.online) ?? [];
            const online = s?.cameras.filter((c) => c.online) ?? [];
            const reachable = !s?.error;
            return (
              <Card key={h.id} className="bg-gradient-card border-border shadow-card overflow-hidden">
                <div className="p-4 border-b border-border flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-md grid place-items-center shrink-0" style={{ background: `${h.color}22`, color: h.color }}>
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground truncate">{h.name}</h3>
                        <Badge variant="secondary" className="text-[9px] bg-destructive/15 text-destructive border-destructive/30 h-4 px-1.5">Hikvision</Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate">{h.base_url}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!reachable ? (
                      <Badge variant="destructive" className="gap-1 text-[10px]"><WifiOff className="h-3 w-3" /> {s?.error}</Badge>
                    ) : offline.length > 0 ? (
                      <Badge variant="destructive" className="gap-1 text-[10px]"><AlertTriangle className="h-3 w-3" /> {offline.length} offline</Badge>
                    ) : s?.cameras.length ? (
                      <Badge className="bg-success/15 text-success border border-success/30 gap-1 text-[10px]"><CheckCircle2 className="h-3 w-3" /> All online</Badge>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => fetchHikOne(h)} className="h-7 px-2">
                      <RefreshCw className={cn("h-3.5 w-3.5", s?.loading && "animate-spin")} />
                    </Button>
                  </div>
                </div>

                <div className="p-4">
                  {s?.loading && !s.cameras.length ? (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  ) : s?.error && !s.cameras.length ? (
                    <div className="flex items-start gap-2 text-xs text-destructive">
                      <WifiOff className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span className="break-all">{s.error}</span>
                    </div>
                  ) : s?.cameras.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No channels yet — use Discover channels on the NVRs page.</p>
                  ) : (
                    <div className="space-y-3">
                      {offline.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Offline ({offline.length})</p>
                          <div className="space-y-1">
                            {offline.map((c) => (
                              <div key={c.name} className="flex items-center gap-2 px-2 py-1.5 rounded bg-destructive/10 border border-destructive/30">
                                <VideoOff className="h-3.5 w-3.5 text-destructive shrink-0" />
                                <span className="text-xs text-foreground capitalize flex-1 truncate">{c.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {online.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Online ({online.length})</p>
                          <div className="grid grid-cols-2 gap-1">
                            {online.map((c) => (
                              <div key={c.name} className="flex items-center gap-2 px-2 py-1.5 rounded bg-secondary/40">
                                <Camera className="h-3.5 w-3.5 text-success shrink-0" />
                                <span className="text-xs text-foreground capitalize flex-1 truncate">{c.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
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
      )}
    </DashboardLayout>
  );
};

export default NvrStatus;
