import { DashboardLayout } from "@/components/DashboardLayout";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMemo, useState } from "react";
import { Camera, Film, Play, VideoOff } from "lucide-react";
import { MediaLightbox, LightboxItem } from "@/components/MediaLightbox";
import type { MediaItem } from "@/lib/webhookStore";

const Cameras = () => {
  const store = useWebhookStore();
  const [selected, setSelected] = useState<LightboxItem | null>(null);

  const cameras = useMemo(() => {
    const map = new Map<string, { name: string; latestSnapshot?: MediaItem; clips: MediaItem[]; lastTs: number }>();
    for (const m of store.media) {
      const key = m.camera ?? "unknown";
      const entry = map.get(key) ?? { name: key, clips: [], lastTs: 0 };
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

  return (
    <DashboardLayout
      title="Cameras"
      subtitle={`${cameras.length} device${cameras.length === 1 ? "" : "s"} detected via webhooks`}
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
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {cameras.map((cam) => {
            const recentClips = cam.clips.slice().sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, 3);
            return (
              <Card key={cam.name} className="bg-gradient-card border-border shadow-card overflow-hidden flex flex-col">
                <button
                  onClick={() => cam.latestSnapshot && setSelected(cam.latestSnapshot)}
                  className="relative aspect-video bg-black group"
                >
                  {cam.latestSnapshot ? (
                    <img src={cam.latestSnapshot.url} alt={cam.name} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                  ) : (
                    <div className="grid place-items-center h-full text-muted-foreground">
                      <Camera className="h-8 w-8" />
                    </div>
                  )}
                  <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/60 backdrop-blur px-2 py-1 rounded text-[10px] uppercase tracking-wider">
                    <span className="h-1.5 w-1.5 rounded-full bg-success pulse-dot" />
                    <span className="text-foreground/90">Live</span>
                  </div>
                  {cam.clips.length > 0 && (
                    <div className="absolute top-2 right-2 bg-primary text-primary-foreground text-[10px] font-semibold px-1.5 py-0.5 rounded">
                      {cam.clips.length} clip{cam.clips.length === 1 ? "" : "s"}
                    </div>
                  )}
                </button>
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground capitalize">{cam.name}</h3>
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        {cam.latestSnapshot ? new Date(cam.latestSnapshot.ts).toLocaleTimeString() : "—"}
                      </p>
                    </div>
                    <Badge variant="secondary" className="bg-secondary text-xs gap-1">
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
                          onClick={() => setSelected(c)}
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
      )}
      <MediaLightbox item={selected} onClose={() => setSelected(null)} />
    </DashboardLayout>
  );
};

export default Cameras;
