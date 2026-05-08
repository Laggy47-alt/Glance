import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useMemo, useState } from "react";
import {
  Bell, BellOff, Camera, X, Archive as ArchiveIcon, MessageSquare, Tag as TagIcon,
  RotateCcw, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

type DemoAlert = {
  key: string; camera: string; site: string; label: string; ts: string;
  snapshotUrl: string; clipUrl: string; score?: number;
};

const STORAGE = "https://bgczubehzofjvjenozof.supabase.co/storage/v1/object/public/camera-snapshots/demo";
const SEED: DemoAlert[] = [
  { key: "demo-1", camera: "maritha_hof_6", site: "ABC · Hagerhof", label: "person", ts: "2026-05-08T09:11:35.121Z", score: 0.87, snapshotUrl: `${STORAGE}/snap-1.jpg`, clipUrl: `${STORAGE}/clip-1.mp4` },
  { key: "demo-2", camera: "eden_1", site: "ABC · Hagerhof", label: "person", ts: "2026-05-08T09:08:55.116Z", score: 0.79, snapshotUrl: `${STORAGE}/snap-2.jpg`, clipUrl: `${STORAGE}/clip-2.mp4` },
  { key: "demo-3", camera: "perimeter_5", site: "ABC · Eikenwater", label: "person", ts: "2026-05-08T09:07:24.216Z", score: 0.82, snapshotUrl: `${STORAGE}/snap-3.jpg`, clipUrl: `${STORAGE}/clip-3.mp4` },
  { key: "demo-4", camera: "3_peeka_front", site: "ABC · Peeka", label: "person", ts: "2026-05-08T09:03:32.611Z", score: 0.91, snapshotUrl: `${STORAGE}/snap-4.jpg`, clipUrl: `${STORAGE}/clip-4.mp4` },
  { key: "demo-5", camera: "3_peeka_front", site: "ABC · Peeka", label: "person", ts: "2026-05-08T09:02:15.882Z", score: 0.76, snapshotUrl: `${STORAGE}/snap-5.jpg`, clipUrl: `${STORAGE}/clip-5.mp4` },
];

type LB = { snapshotUrl: string; clipUrl: string; camera: string; site: string; ts: string; label: string };

const Demo = () => {
  const [alerts, setAlerts] = useState<DemoAlert[]>(SEED);
  const [muted, setMuted] = useState(false);
  const [lightbox, setLightbox] = useState<LB | null>(null);
  const ack = (key: string) => setAlerts((p) => p.filter((a) => a.key !== key));
  const reset = () => setAlerts(SEED);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/40 backdrop-blur sticky top-0 z-20">
        <div className="px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Glance — Customer Demo</h1>
            <Badge variant="outline" className="ml-1 uppercase tracking-wider">Demo</Badge>
          </div>
          <p className="text-xs text-muted-foreground hidden md:block ml-2">
            Sandbox. No changes are saved.
          </p>
        </div>
      </header>

      <main className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold">Live Wall</h2>
            <p className="text-xs text-muted-foreground">Idle screen — incoming snapshots pop up here. Click an alert to play the clip; press ACK to dismiss.</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success pulse-dot" />
              {alerts.length} active
            </Badge>
            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
              <Switch checked={!muted} onCheckedChange={(v) => setMuted(!v)} />
            </div>
          </div>
        </div>

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
                  onOpen={() => setLightbox({ ...a })}
                  onTag={() => setLightbox({ ...a })}
                />
              ))}
            </div>
          </div>
        </div>
      </main>

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur flex items-center justify-center p-6" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 p-2 rounded-full bg-card border border-border hover:bg-muted" onClick={() => setLightbox(null)} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
          <div className="max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold capitalize">{lightbox.camera}</h2>
              <Badge variant="outline">{lightbox.site}</Badge>
              <Badge variant="secondary" className="capitalize">{lightbox.label}</Badge>
              <span className="ml-auto text-sm text-muted-foreground">{new Date(lightbox.ts).toLocaleString()}</span>
            </div>
            <video key={lightbox.clipUrl} src={lightbox.clipUrl} poster={lightbox.snapshotUrl} controls autoPlay className="w-full rounded-lg border border-border bg-black" />
          </div>
        </div>
      )}
    </div>
  );
};

function DemoCard({ alert, onArchive, onDismiss, onOpen, onTag }: {
  alert: DemoAlert; onArchive: () => void; onDismiss: () => void; onOpen: () => void; onTag: () => void;
}) {
  const snapUrl = useMemo(() => alert.snapshotUrl, [alert.snapshotUrl]);
  return (
    <div className={cn("pointer-events-auto w-full rounded-lg border border-border bg-card/95 backdrop-blur shadow-lg overflow-hidden", "animate-in zoom-in-95 fade-in duration-300")}>
      <div className="px-2 py-1.5 border-b border-border bg-secondary/40">
        <div className="text-xs font-semibold text-foreground capitalize truncate" title={`${alert.site} · ${alert.camera}`}>{alert.camera}</div>
      </div>
      <button type="button" onClick={onOpen} className="relative aspect-video bg-black w-full block cursor-pointer group" aria-label="Open clip">
        <img src={snapUrl} alt={alert.camera} className="w-full h-full object-cover" />
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-destructive/90 text-destructive-foreground px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold">
          <span className="h-1 w-1 rounded-full bg-destructive-foreground pulse-dot" /> Live
        </div>
        <div className="absolute bottom-1.5 left-1.5 bg-black/70 text-foreground/90 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold opacity-0 group-hover:opacity-100 transition-opacity">Play clip</div>
        <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onDismiss(); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onDismiss(); } }} className="absolute top-1.5 right-1.5 h-6 w-6 grid place-items-center rounded-full bg-black/60 hover:bg-black/80 text-foreground/90" aria-label="Dismiss">
          <X className="h-3.5 w-3.5" />
        </span>
      </button>
      <div className="p-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-foreground capitalize truncate">{alert.site} · {alert.camera}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums truncate">
            {new Date(alert.ts).toLocaleTimeString()}
            {alert.score != null && ` · ${(alert.score * 100).toFixed(0)}%`}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={onTag} className="gap-1 h-7 px-2 text-[11px]" title="Open snapshot"><TagIcon className="h-3 w-3" /></Button>
          <Button size="sm" variant="ghost" className="gap-1 h-7 px-2 text-[11px]" title="Comment (disabled in demo)" disabled><MessageSquare className="h-3 w-3" /></Button>
          <Button size="sm" variant="secondary" onClick={onArchive} className="gap-1 h-7 px-2 text-[11px]"><ArchiveIcon className="h-3 w-3" /> ACK</Button>
        </div>
      </div>
    </div>
  );
}

export default Demo;
