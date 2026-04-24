import { DashboardLayout } from "@/components/DashboardLayout";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEffect, useMemo, useState } from "react";
import { Camera, Film, Play, VideoOff, Server, Radio } from "lucide-react";
import { MediaLightbox, LightboxItem } from "@/components/MediaLightbox";
import type { MediaItem } from "@/lib/webhookStore";
import { resolveMediaUrl, frigateUrl } from "@/lib/webhookStore";
import { cn } from "@/lib/utils";

type CameraEntry = {
  name: string;
  latestSnapshot?: MediaItem;
  clips: MediaItem[];
  lastTs: number;
  instanceId: string | null;
};

type LiveCam = { instanceId: string; name: string };

const Cameras = () => {
  const store = useWebhookStore();
  const [selected, setSelected] = useState<LightboxItem | null>(null);
  const [live, setLive] = useState<LiveCam | null>(null);
  const [activeInstance, setActiveInstance] = useState<string>("all");

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const cameras = useMemo<CameraEntry[]>(() => {
    const map = new Map<string, CameraEntry>();
    for (const m of store.media) {
      const key = `${m.instance_id ?? "_"}::${m.camera ?? "unknown"}`;
      const entry = map.get(key) ?? { name: m.camera ?? "unknown", clips: [], lastTs: 0, instanceId: m.instance_id ?? null };
      const t = new Date(m.ts).getTime();
      if (m.kind === "snapshot") {
        if (!entry.latestSnapshot || t > new Date(entry.latestSnapshot.ts).getTime()) entry.latestSnapshot = m;
      } else {
        entry.clips.push(m);
      }
      entry.lastTs = Math.max(entry.lastTs, t);
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.lastTs - a.lastTs);
  }, [store.media]);

  // Group cameras by frigate instance id
  const grouped = useMemo(() => {
    const groups = new Map<string, CameraEntry[]>();
    for (const cam of cameras) {
      const key = cam.instanceId ?? "_other";
      const arr = groups.get(key) ?? [];
      arr.push(cam);
      groups.set(key, arr);
    }
    return groups;
  }, [cameras]);

  const instanceTabs = useMemo(() => {
    // Only show NVR tabs that have cameras
    return store.frigates.filter((f) => grouped.has(f.id));
  }, [store.frigates, grouped]);

  const hasOther = grouped.has("_other");

  const visibleCameras = useMemo(() => {
    if (activeInstance === "all") return cameras;
    if (activeInstance === "_other") return grouped.get("_other") ?? [];
    return grouped.get(activeInstance) ?? [];
  }, [cameras, grouped, activeInstance]);

  const liveInstance = live ? store.frigates.find((f) => f.id === live.instanceId) : null;
  // Frigate provides MJPEG at /api/<camera>?h=720 (multipart/x-mixed-replace) — works directly in <img>.
  const liveImgSrc = live && liveInstance
    ? `${frigateUrl(liveInstance, `/api/${encodeURIComponent(live.name)}`)}?h=720`
    : null;

  return (
    <DashboardLayout
      title="Cameras"
      subtitle={`${cameras.length} device${cameras.length === 1 ? "" : "s"} across ${instanceTabs.length} NVR${instanceTabs.length === 1 ? "" : "s"}`}
      actions={
        <Button variant="outline" size="sm" onClick={() => store.clearMedia()}>Clear media</Button>
      }
    >
      {cameras.length === 0 ? (
        <Card className="bg-gradient-card border-border shadow-card p-12 text-center">
          <VideoOff className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-foreground font-medium">No cameras detected yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            POST a JSON body containing <code className="text-accent">snapshot_url</code> or <code className="text-accent">clip_url</code> to one of your webhook URLs.
          </p>
        </Card>
      ) : (
        <>
          {/* NVR group tabs */}
          <div className="flex flex-wrap items-center gap-1 mb-4 bg-secondary/50 rounded-md p-1 border border-border w-fit">
            <button
              onClick={() => setActiveInstance("all")}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded inline-flex items-center gap-1.5 transition-colors",
                activeInstance === "all"
                  ? "bg-primary text-primary-foreground shadow-glow"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              All
              <span className="text-[10px] opacity-70 tabular-nums">{cameras.length}</span>
            </button>
            {instanceTabs.map((f) => {
              const count = grouped.get(f.id)?.length ?? 0;
              const isActive = activeInstance === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setActiveInstance(f.id)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded inline-flex items-center gap-1.5 transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-glow"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: f.color }}
                  />
                  <Server className="h-3 w-3" />
                  {f.name}
                  <span className="text-[10px] opacity-70 tabular-nums">{count}</span>
                </button>
              );
            })}
            {hasOther && (
              <button
                onClick={() => setActiveInstance("_other")}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded inline-flex items-center gap-1.5 transition-colors",
                  activeInstance === "_other"
                    ? "bg-primary text-primary-foreground shadow-glow"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Other
                <span className="text-[10px] opacity-70 tabular-nums">{grouped.get("_other")?.length ?? 0}</span>
              </button>
            )}
          </div>

          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleCameras.map((cam) => {
              const recentClips = cam.clips.slice().sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, 3);
              const instance = cam.instanceId ? store.frigates.find((f) => f.id === cam.instanceId) : null;
              const liveThumb = instance
                ? `${frigateUrl(instance, `/api/${encodeURIComponent(cam.name)}/latest.jpg`)}?t=${tick}`
                : null;
              const snapshotSrc = liveThumb ?? (cam.latestSnapshot ? resolveMediaUrl(cam.latestSnapshot.url) : null);
              const lightboxSnapshot = cam.latestSnapshot
                ? { ...cam.latestSnapshot, url: resolveMediaUrl(cam.latestSnapshot.url) }
                : null;
              const instance = cam.instanceId ? store.frigates.find((f) => f.id === cam.instanceId) : null;
              const canGoLive = !!cam.instanceId;
              return (
                <Card key={`${cam.instanceId ?? "_"}-${cam.name}`} className="bg-gradient-card border-border shadow-card overflow-hidden flex flex-col">
                  <button
                    onClick={() => {
                      if (canGoLive) setLive({ instanceId: cam.instanceId!, name: cam.name });
                      else if (lightboxSnapshot) setSelected(lightboxSnapshot);
                    }}
                    className="relative aspect-video bg-black group"
                  >
                    {snapshotSrc ? (
                      <img src={snapshotSrc} alt={cam.name} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                    ) : (
                      <div className="grid place-items-center h-full text-muted-foreground">
                        <Camera className="h-8 w-8" />
                      </div>
                    )}
                    <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/60 backdrop-blur px-2 py-1 rounded text-[10px] uppercase tracking-wider">
                      <span className="h-1.5 w-1.5 rounded-full bg-success pulse-dot" />
                      <span className="text-foreground/90">{liveThumb ? "Live" : "Last"}</span>
                    </div>
                    {canGoLive && (
                      <div className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                        <div className="bg-primary text-primary-foreground rounded-full p-3 shadow-glow">
                          <Radio className="h-5 w-5" />
                        </div>
                      </div>
                    )}
                    {cam.clips.length > 0 && (
                      <div className="absolute top-2 right-2 bg-primary text-primary-foreground text-[10px] font-semibold px-1.5 py-0.5 rounded">
                        {cam.clips.length} clip{cam.clips.length === 1 ? "" : "s"}
                      </div>
                    )}
                  </button>
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-foreground capitalize truncate">{cam.name}</h3>
                        <p className="text-[10px] text-muted-foreground tabular-nums truncate">
                          {instance ? <span className="inline-flex items-center gap-1"><Server className="h-2.5 w-2.5" style={{ color: instance.color }} />{instance.name} · </span> : null}
                          {cam.latestSnapshot ? new Date(cam.latestSnapshot.ts).toLocaleTimeString() : "—"}
                        </p>
                      </div>
                      <Badge variant="secondary" className="bg-secondary text-xs gap-1 shrink-0">
                        <Camera className="h-3 w-3" /> {cam.latestSnapshot ? "1" : "0"}
                        <Film className="h-3 w-3 ml-1" /> {cam.clips.length}
                      </Badge>
                    </div>
                    {recentClips.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Recent clips</p>
                        {recentClips.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => setSelected({ ...c, url: resolveMediaUrl(c.url) })}
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded bg-secondary/50 hover:bg-secondary text-left transition-colors"
                          >
                            <Play className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="text-xs text-foreground/90 flex-1 truncate">Motion event</span>
                            <span className="text-[10px] text-muted-foreground tabular-nums">{new Date(c.ts).toLocaleTimeString()}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <MediaLightbox item={selected} onClose={() => setSelected(null)} />

      <Dialog open={!!live} onOpenChange={(o) => { if (!o) setLive(null); }}>
        <DialogContent className="max-w-4xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 capitalize">
              <span className="h-2 w-2 rounded-full bg-success pulse-dot" />
              <Radio className="h-4 w-4 text-primary" />
              {live?.name} — Live
            </DialogTitle>
          </DialogHeader>
          {liveImgSrc && (
            <div className="aspect-video bg-black rounded overflow-hidden">
              {/* Frigate serves multipart MJPEG at /api/<camera>; <img> renders it as a continuous stream */}
              <img src={liveImgSrc} alt={`${live?.name} live`} className="w-full h-full object-contain" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default Cameras;
