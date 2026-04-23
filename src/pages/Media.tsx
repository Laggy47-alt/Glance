import { DashboardLayout } from "@/components/DashboardLayout";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useEffect, useMemo, useState } from "react";
import { Camera, Film, ImageOff, Play, Tag as TagIcon } from "lucide-react";
import { MediaLightbox, LightboxItem } from "@/components/MediaLightbox";
import { resolveMediaUrl } from "@/lib/webhookStore";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Tab = "all" | "snapshot" | "clip";

const Media = () => {
  const store = useWebhookStore();
  const [selected, setSelected] = useState<LightboxItem | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [filter, setFilter] = useState("");

  const items = useMemo(() => {
    return store.media
      .filter((m) => tab === "all" || m.kind === tab)
      .filter((m) => {
        if (!filter) return true;
        const f = filter.toLowerCase();
        return (m.camera ?? "").toLowerCase().includes(f) || (m.topic ?? "").toLowerCase().includes(f);
      });
  }, [store.media, tab, filter]);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "all", label: "All", count: store.media.length },
    { id: "snapshot", label: "Snapshots", count: store.media.filter((m) => m.kind === "snapshot").length },
    { id: "clip", label: "Clips", count: store.media.filter((m) => m.kind === "clip").length },
  ];

  return (
    <DashboardLayout
      title="Media"
      subtitle="Every snapshot and clip captured from webhooks"
      actions={<Button variant="outline" size="sm" onClick={() => store.clearMedia()}>Clear all</Button>}
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex bg-secondary/50 rounded-md p-1 border border-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5",
                tab === t.id ? "bg-primary text-primary-foreground shadow-glow" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
              <span className={cn("text-[10px] px-1.5 rounded-full tabular-nums", tab === t.id ? "bg-primary-foreground/20" : "bg-secondary")}>
                {t.count}
              </span>
            </button>
          ))}
        </div>
        <Input
          placeholder="Filter by camera or topic…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-secondary border-border max-w-xs ml-auto"
        />
      </div>

      {items.length === 0 ? (
        <Card className="bg-gradient-card border-border shadow-card p-12 text-center">
          <ImageOff className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-foreground font-medium">No media yet</p>
          <p className="text-xs text-muted-foreground mt-1">Snapshots and clips arriving via webhooks will appear here.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {items.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelected(m)}
              className="group relative aspect-video bg-black rounded-md overflow-hidden border border-border hover:border-primary transition-colors text-left"
            >
              {m.kind === "snapshot" ? (
                <img src={m.url} alt={m.camera ?? ""} className="w-full h-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
              ) : (
                <div className="absolute inset-0 grid place-items-center bg-black">
                  <div className="grid place-items-center text-muted-foreground"><Film className="h-6 w-6" /></div>
                  <div className="absolute inset-0 grid place-items-center">
                    <div className="h-10 w-10 rounded-full bg-primary/90 grid place-items-center shadow-glow">
                      <Play className="h-5 w-5 text-primary-foreground ml-0.5" />
                    </div>
                  </div>
                </div>
              )}
              <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-black/60 backdrop-blur px-1.5 py-0.5 rounded text-[10px]">
                {m.kind === "snapshot" ? <Camera className="h-2.5 w-2.5" /> : <Film className="h-2.5 w-2.5" />}
                <span className="text-foreground/90 capitalize">{m.camera ?? "—"}</span>
              </div>
              <div className="absolute bottom-1.5 right-1.5 bg-black/60 backdrop-blur px-1.5 py-0.5 rounded text-[10px] text-foreground/80 tabular-nums">
                {new Date(m.ts).toLocaleTimeString()}
              </div>
            </button>
          ))}
        </div>
      )}
      <MediaLightbox item={selected} onClose={() => setSelected(null)} />
    </DashboardLayout>
  );
};

export default Media;
