import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Bell, BellOff, Camera, Check, Play, X, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type DemoAlert = {
  key: string;
  camera: string;
  site: string;
  label: string;
  ts: string;
  receivedAt: number;
  snapshot: string;
  clip: string;
  acked: boolean;
};

const SITES = ["ABC Office", "Hagerhof", "Auto Excellence", "North Yard", "South Gate"];
const CAMERAS = [
  "Front Door", "Loading Bay", "Reception", "Carpark East",
  "Carpark West", "Warehouse", "Service Lane", "Forecourt",
  "Side Entrance", "Perimeter",
];
const LABELS = ["person", "car", "person", "person", "car"];

// Five public sample snapshots (Picsum) + five public sample clips (Google CDN)
const SNAPSHOTS = [
  "https://picsum.photos/seed/glance-1/800/450",
  "https://picsum.photos/seed/glance-2/800/450",
  "https://picsum.photos/seed/glance-3/800/450",
  "https://picsum.photos/seed/glance-4/800/450",
  "https://picsum.photos/seed/glance-5/800/450",
];
const CLIPS = [
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
];

const pick = <T,>(arr: T[], i: number) => arr[i % arr.length];
const rand = (n: number) => Math.floor(Math.random() * n);

function makeAlert(idx: number): DemoAlert {
  const camera = pick(CAMERAS, idx);
  const site = pick(SITES, idx);
  const label = pick(LABELS, idx);
  return {
    key: `demo-${idx}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    camera,
    site,
    label,
    ts: new Date().toISOString(),
    receivedAt: Date.now(),
    snapshot: pick(SNAPSHOTS, idx),
    clip: pick(CLIPS, idx),
    acked: false,
  };
}

export default function Demo() {
  const [alerts, setAlerts] = useState<DemoAlert[]>(() =>
    Array.from({ length: 5 }, (_, i) => makeAlert(i))
  );
  const [muted, setMuted] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [lightbox, setLightbox] = useState<DemoAlert | null>(null);
  const counterRef = useRef(5);

  // Periodically inject a new random alert to simulate live activity
  useEffect(() => {
    if (!autoplay) return;
    const id = setInterval(() => {
      counterRef.current += 1;
      const next = makeAlert(rand(1000));
      setAlerts((prev) => [next, ...prev].slice(0, 12));
      if (!muted) {
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.frequency.value = 880;
          g.gain.value = 0.05;
          o.connect(g).connect(ctx.destination);
          o.start();
          o.stop(ctx.currentTime + 0.12);
        } catch { /* ignore */ }
      }
    }, 9000);
    return () => clearInterval(id);
  }, [autoplay, muted]);

  const ack = (key: string) =>
    setAlerts((prev) => prev.map((a) => (a.key === key ? { ...a, acked: true } : a)));
  const ackAll = () => setAlerts((prev) => prev.map((a) => ({ ...a, acked: true })));
  const reset = () => {
    counterRef.current = 5;
    setAlerts(Array.from({ length: 5 }, (_, i) => makeAlert(i)));
  };

  const unacked = useMemo(() => alerts.filter((a) => !a.acked).length, [alerts]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/40 backdrop-blur sticky top-0 z-10">
        <div className="px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Glance — Live Wall Demo</h1>
            <Badge variant="outline" className="ml-2">DEMO</Badge>
          </div>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <Badge variant={unacked > 0 ? "destructive" : "secondary"}>
              {unacked} un-ACKed
            </Badge>
            <div className="flex items-center gap-2">
              <Switch checked={autoplay} onCheckedChange={setAutoplay} id="autoplay" />
              <label htmlFor="autoplay" className="cursor-pointer">Auto-feed</label>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMuted((m) => !m)}
              className="gap-2"
            >
              {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
              {muted ? "Muted" : "Sound on"}
            </Button>
            <Button variant="outline" size="sm" onClick={ackAll}>ACK all</Button>
            <Button variant="default" size="sm" onClick={reset}>Reset demo</Button>
          </div>
        </div>
      </header>

      <main className="p-6">
        <p className="text-sm text-muted-foreground mb-4">
          A safe sandbox to show customers what operators see. Five seeded snapshots + five sample clips.
          Alerts persist until acknowledged. Toggle <em>Auto-feed</em> to simulate new motion every few seconds.
        </p>

        {alerts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-16 text-center text-muted-foreground">
            No alerts. Click <strong>Reset demo</strong> to seed.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {alerts.map((a) => (
              <article
                key={a.key}
                className={cn(
                  "group rounded-lg overflow-hidden border bg-card transition-all",
                  a.acked
                    ? "border-border opacity-60"
                    : "border-destructive/60 ring-2 ring-destructive/40 shadow-lg shadow-destructive/10"
                )}
              >
                <button
                  onClick={() => setLightbox(a)}
                  className="relative block w-full aspect-video bg-muted overflow-hidden"
                >
                  <img
                    src={a.snapshot}
                    alt={`${a.camera} snapshot`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-background/0 group-hover:bg-background/30 transition">
                    <Play className="h-10 w-10 text-foreground opacity-0 group-hover:opacity-100" />
                  </span>
                  {!a.acked && (
                    <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded bg-destructive text-destructive-foreground px-2 py-0.5 text-xs font-medium animate-pulse">
                      <Bell className="h-3 w-3" /> LIVE
                    </span>
                  )}
                </button>
                <div className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate flex items-center gap-1">
                        <Camera className="h-3.5 w-3.5 text-muted-foreground" />
                        {a.camera}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{a.site}</div>
                    </div>
                    <Badge variant="secondary" className="capitalize shrink-0">{a.label}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{new Date(a.ts).toLocaleTimeString()}</span>
                    {a.acked ? (
                      <span className="inline-flex items-center gap-1 text-green-500">
                        <Check className="h-3 w-3" /> ACKed
                      </span>
                    ) : (
                      <Button size="sm" variant="default" onClick={() => ack(a.key)} className="h-7 gap-1">
                        <Check className="h-3 w-3" /> ACK
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-background/90 backdrop-blur flex items-center justify-center p-6"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-card border border-border hover:bg-muted"
            onClick={() => setLightbox(null)}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-lg font-semibold">{lightbox.camera}</h2>
              <Badge variant="outline">{lightbox.site}</Badge>
              <Badge variant="secondary" className="capitalize">{lightbox.label}</Badge>
              <span className="ml-auto text-sm text-muted-foreground">
                {new Date(lightbox.ts).toLocaleString()}
              </span>
            </div>
            <video
              key={lightbox.key}
              src={lightbox.clip}
              poster={lightbox.snapshot}
              controls
              autoPlay
              className="w-full rounded-lg border border-border bg-black"
            />
          </div>
        </div>
      )}
    </div>
  );
}
