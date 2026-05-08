import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useMemo, useState } from "react";
import { Bell, BellOff, Camera, X, Archive as ArchiveIcon, MessageSquare, PanelLeftClose, PanelLeftOpen, Tag as TagIcon, RotateCcw } from "lucide-react";
import { resolveMediaUrl } from "@/lib/webhookStore";
import { cn } from "@/lib/utils";
import { MediaLightbox, type LightboxItem } from "@/components/MediaLightbox";

type DemoAlert = {
  key: string;
  camera: string;
  site: string;
  label: string;
  ts: string;
  snapshotUrl: string; // raw proxy path
  clipUrl: string;     // raw proxy path
  score?: number;
};

// Five real ABC org events (snapshot + clip per camera).
// URLs are frigate-proxy paths — they resolve via resolveMediaUrl() and
// require the viewer to be logged in to an ABC org account.
const SEED: DemoAlert[] = [
  {
    key: "demo-1",
    camera: "maritha_hof_6",
    site: "ABC · Hagerhof",
    label: "person",
    ts: "2026-05-08T09:11:35.121Z",
    snapshotUrl: "/eb254705-4910-4bfc-bca9-1fea1064171f/api/events/1778231495.121451-niuct3/snapshot.jpg",
    clipUrl: "/eb254705-4910-4bfc-bca9-1fea1064171f/api/events/1778231495.121451-niuct3/clip.mp4",
    score: 0.87,
  },
  {
    key: "demo-2",
    camera: "eden_1",
    site: "ABC · Hagerhof",
    label: "person",
    ts: "2026-05-08T09:08:55.116Z",
    snapshotUrl: "/eb254705-4910-4bfc-bca9-1fea1064171f/api/events/1778231335.116684-c101mf/snapshot.jpg",
    clipUrl: "/eb254705-4910-4bfc-bca9-1fea1064171f/api/events/1778231335.116684-c101mf/clip.mp4",
    score: 0.79,
  },
  {
    key: "demo-3",
    camera: "perimeter_5",
    site: "ABC · Eikenwater",
    label: "person",
    ts: "2026-05-08T09:07:24.216Z",
    snapshotUrl: "/36762375-8e5f-4fdd-aaa6-e7c142f6262e/api/events/1778231244.216349-d93ivd/snapshot.jpg",
    clipUrl: "/36762375-8e5f-4fdd-aaa6-e7c142f6262e/api/events/1778231244.216349-d93ivd/clip.mp4",
    score: 0.82,
  },
  {
    key: "demo-4",
    camera: "3_peeka_front",
    site: "ABC · Peeka",
    label: "person",
    ts: "2026-05-08T09:03:32.611Z",
    snapshotUrl: "/eb254705-4910-4bfc-bca9-1fea1064171f/api/events/1778231012.611706-fuqzc4/snapshot.jpg",
    clipUrl: "/eb254705-4910-4bfc-bca9-1fea1064171f/api/events/1778231012.611706-fuqzc4/clip.mp4",
    score: 0.91,
  },
  {
    key: "demo-5",
    camera: "3_peeka_front",
    site: "ABC · Peeka",
    label: "person",
    ts: "2026-05-08T09:02:15.882Z",
    snapshotUrl: "/eb254705-4910-4bfc-bca9-1fea1064171f/api/events/1778230935.882003-kc3ci2/snapshot.jpg",
    clipUrl: "/eb254705-4910-4bfc-bca9-1fea1064171f/api/events/1778230935.882003-kc3ci2/clip.mp4",
    score: 0.76,
  },
];

const Demo = () => {
  const [alerts, setAlerts] = useState<DemoAlert[]>(SEED);
  const [muted, setMuted] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);

  const recentCount = alerts.length;

  const ack = (key: string) => setAlerts((p) => p.filter((a) => a.key !== key));
  const reset = () => setAlerts(SEED);

  const openClip = (a: DemoAlert) => {
    setLightbox({
      kind: "clip",
      url: resolveMediaUrl(a.clipUrl),
      camera: a.camera,
      topic: `frigate/${a.camera}/${a.label}`,
      ts: a.ts,
      thumbnail: resolveMediaUrl(a.snapshotUrl),
      frigateUrl: null,
      mediaId: a.key,
      eventId: null,
    });
  };
  const openSnap = (a: DemoAlert) => {
    setLightbox({
      kind: "snapshot",
      url: resolveMediaUrl(a.snapshotUrl),
      camera: a.camera,
      topic: `frigate/${a.camera}/${a.label}`,
      ts: a.ts,
      frigateUrl: null,
      mediaId: a.key,
      eventId: null,
    });
  };

  return (
    <DashboardLayout
      title="Live Wall — Demo"
      subtitle="Sandbox view for customer demos · 5 sample alerts (real ABC media)"
      hideSidebar={sidebarHidden}
      actions={
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8"
            onClick={() => setSidebarHidden((v) => !v)}
          >
            {sidebarHidden ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
            {sidebarHidden ? "Show menu" : "Hide menu"}
          </Button>
          <Badge variant="outline" className="uppercase tracking-wider">Demo</Badge>
          <Badge variant="secondary" className="gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success pulse-dot" />
            {recentCount} active
          </Badge>
          <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            <Switch checked={!muted} onCheckedChange={(v) => setMuted(!v)} />
          </div>
        </div>
      }
    >
      <div className="relative h-[calc(100vh-10rem)] rounded-lg border border-border bg-gradient-to-br from-background via-background to-secondary/30 overflow-hidden">
        {alerts.length === 0 && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="text-center space-y-3">
              <div className="mx-auto h-16 w-16 rounded-full bg-secondary/50 grid place-items-center">
                <Camera className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">All ACKed — press Reset to repopulate the demo.</p>
            </div>
          </div>
        )}
        <div className="absolute inset-0 overflow-y-auto p-4">
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(240px,1fr))] auto-rows-min">
            {alerts.map((a) => (
              <DemoCard
                key={a.key}
                alert={a}
                onArchive={() => ack(a.key)}
                onDismiss={() => ack(a.key)}
                onOpen={() => openClip(a)}
                onTag={() => openSnap(a)}
              />
            ))}
          </div>
        </div>
      </div>
      <MediaLightbox item={lightbox} onClose={() => setLightbox(null)} />
    </DashboardLayout>
  );
};

function DemoCard({
  alert,
  onArchive,
  onDismiss,
  onOpen,
  onTag,
}: {
  alert: DemoAlert;
  onArchive: () => void;
  onDismiss: () => void;
  onOpen: () => void;
  onTag: () => void;
}) {
  const snapUrl = useMemo(() => {
    const resolved = resolveMediaUrl(alert.snapshotUrl);
    return resolved + (resolved.includes("?") ? "&" : "?") + "bbox=1";
  }, [alert.snapshotUrl]);

  return (
    <div
      className={cn(
        "pointer-events-auto w-full rounded-lg border border-border bg-card/95 backdrop-blur shadow-lg overflow-hidden",
        "animate-in zoom-in-95 fade-in duration-300"
      )}
    >
      <div className="px-2 py-1.5 border-b border-border bg-secondary/40">
        <div className="text-xs font-semibold text-foreground capitalize truncate" title={`${alert.site} · ${alert.camera}`}>
          {alert.camera}
        </div>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="relative aspect-video bg-black w-full block cursor-pointer group"
        aria-label="Open clip"
      >
        <img src={snapUrl} alt={alert.camera} className="w-full h-full object-cover" />
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-destructive/90 text-destructive-foreground px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold">
          <span className="h-1 w-1 rounded-full bg-destructive-foreground pulse-dot" />
          Live
        </div>
        <div className="absolute bottom-1.5 left-1.5 bg-black/70 text-foreground/90 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
          Play clip
        </div>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onDismiss(); } }}
          className="absolute top-1.5 right-1.5 h-6 w-6 grid place-items-center rounded-full bg-black/60 hover:bg-black/80 text-foreground/90"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </span>
      </button>

      <div className="p-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-foreground capitalize truncate">
            {alert.site} · {alert.camera}
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums truncate">
            {new Date(alert.ts).toLocaleTimeString()}
            {alert.score != null && ` · ${(alert.score * 100).toFixed(0)}%`}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={onTag} className="gap-1 h-7 px-2 text-[11px]" title="Open snapshot">
            <TagIcon className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" className="gap-1 h-7 px-2 text-[11px]" title="Comment (disabled in demo)" disabled>
            <MessageSquare className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="secondary" onClick={onArchive} className="gap-1 h-7 px-2 text-[11px]">
            <ArchiveIcon className="h-3 w-3" /> ACK
          </Button>
        </div>
      </div>
    </div>
  );
}

export default Demo;
