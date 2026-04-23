import { DashboardLayout } from "@/components/DashboardLayout";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, Camera, X, Archive as ArchiveIcon, Filter, Check } from "lucide-react";
import { resolveMediaUrl, type MediaItem, type WebhookEvent } from "@/lib/webhookStore";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Alert = {
  key: string;
  event: WebhookEvent | null;
  clip?: MediaItem;
  snapshot?: MediaItem;
  camera: string;
  label: string;
  ts: string;
  receivedAt: number;
};

const AUTO_DISMISS_MS = 25_000;

const Wall = () => {
  const store = useWebhookStore();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [muted, setMuted] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const mountedAtRef = useRef<number>(Date.now());

  // Helper: find best media match for an event (frigate_event_id, then event_id, then camera+time window)
  const findMedia = (e: WebhookEvent, kind: "snapshot" | "clip") => {
    const fid = e.frigate_event_id;
    if (fid) {
      const m = store.media.find((x) => x.frigate_event_id === fid && x.kind === kind);
      if (m) return m;
    }
    const byEvent = store.media.find((x) => x.event_id === e.id && x.kind === kind);
    if (byEvent) return byEvent;
    if (e.camera) {
      const eventTs = new Date(e.ts).getTime();
      const m = store.media.find((x) =>
        x.kind === kind &&
        x.camera === e.camera &&
        Math.abs(new Date(x.ts).getTime() - eventTs) < 60_000
      );
      if (m) return m;
    }
    return undefined;
  };

  // Build alerts from incoming events. Pair media as it arrives.
  useEffect(() => {
    if (!store.loaded) return;
    const newOnes: Alert[] = [];
    for (const e of store.events) {
      if (e.archived) continue;
      // Only react to fresh events arriving after mount, to avoid flooding on first load.
      if (new Date(e.ts).getTime() < mountedAtRef.current - 5_000) continue;
      const key = e.id;
      if (seenRef.current.has(key)) continue;
      const clip = findMedia(e, "clip");
      const snapshot = findMedia(e, "snapshot");
      seenRef.current.add(key);
      newOnes.push({
        key,
        event: e,
        clip,
        snapshot,
        camera: e.camera ?? "unknown",
        label: e.label ?? e.kind ?? "motion",
        ts: e.ts,
        receivedAt: Date.now(),
      });
    }
    if (newOnes.length) {
      setAlerts((prev) => [...newOnes, ...prev].slice(0, 8));
      if (!muted) {
        try {
          const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.frequency.value = 880;
          g.gain.setValueAtTime(0.0001, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
          o.start();
          o.stop(ctx.currentTime + 0.26);
        } catch { /* no-op */ }
      }
    }
  }, [store.events, store.media, store.loaded, muted]);

  // Also pop up standalone media (e.g. polled clips with no paired event row).
  useEffect(() => {
    if (!store.loaded) return;
    const newOnes: Alert[] = [];
    for (const m of store.media) {
      if (m.kind !== "clip") continue;
      if (new Date(m.ts).getTime() < mountedAtRef.current - 5_000) continue;
      const key = `m:${m.id}`;
      if (seenRef.current.has(key)) continue;
      // Skip if we already have an alert covering this clip via its paired event
      const alreadyCovered = [...seenRef.current].some((k) => {
        const ev = store.events.find((e) => e.id === k);
        if (!ev) return false;
        if (ev.frigate_event_id && m.frigate_event_id && ev.frigate_event_id === m.frigate_event_id) return true;
        if (m.event_id && m.event_id === ev.id) return true;
        return false;
      });
      if (alreadyCovered) { seenRef.current.add(key); continue; }
      seenRef.current.add(key);
      const snapshot = store.media.find((x) =>
        x.kind === "snapshot" &&
        ((m.frigate_event_id && x.frigate_event_id === m.frigate_event_id) ||
          (x.camera === m.camera && Math.abs(new Date(x.ts).getTime() - new Date(m.ts).getTime()) < 60_000))
      );
      newOnes.push({
        key,
        event: null,
        clip: m,
        snapshot,
        camera: m.camera ?? "unknown",
        label: "motion",
        ts: m.ts,
        receivedAt: Date.now(),
      });
    }
    if (newOnes.length) setAlerts((prev) => [...newOnes, ...prev].slice(0, 8));
  }, [store.media, store.events, store.loaded]);

  // When media arrives after the alert is shown, attach it.
  useEffect(() => {
    setAlerts((prev) =>
      prev.map((a) => {
        if (a.clip && a.snapshot) return a;
        const camera = a.camera;
        const eventTs = new Date(a.ts).getTime();
        const fid = a.event?.frigate_event_id;
        const matchKind = (kind: "snapshot" | "clip") => {
          if (fid) {
            const m = store.media.find((x) => x.frigate_event_id === fid && x.kind === kind);
            if (m) return m;
          }
          if (a.event) {
            const m = store.media.find((x) => x.event_id === a.event!.id && x.kind === kind);
            if (m) return m;
          }
          return store.media.find((x) =>
            x.kind === kind &&
            x.camera === camera &&
            Math.abs(new Date(x.ts).getTime() - eventTs) < 60_000
          );
        };
        const clip = a.clip ?? matchKind("clip");
        const snapshot = a.snapshot ?? matchKind("snapshot");
        if (clip !== a.clip || snapshot !== a.snapshot) return { ...a, clip, snapshot };
        return a;
      })
    );
  }, [store.media]);

  // Auto-dismiss old cards.
  useEffect(() => {
    const t = setInterval(() => {
      setAlerts((prev) => prev.filter((a) => Date.now() - a.receivedAt < AUTO_DISMISS_MS));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const archive = async (a: Alert) => {
    setAlerts((prev) => prev.filter((x) => x.key !== a.key));
    if (a.event) {
      await supabase.from("webhook_events").update({ archived: true, read: true }).eq("id", a.event.id);
    }
  };

  const dismiss = (a: Alert) => setAlerts((prev) => prev.filter((x) => x.key !== a.key));

  const recentCount = useMemo(
    () => store.events.filter((e) => !e.archived && Date.now() - new Date(e.ts).getTime() < 5 * 60_000).length,
    [store.events]
  );

  return (
    <DashboardLayout
      title="Live Wall"
      subtitle="Idle screen — incoming snapshots pop up here"
      actions={
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success pulse-dot" />
            {recentCount} in last 5m
          </Badge>
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
              <p className="text-sm text-muted-foreground">Waiting for motion…</p>
              <p className="text-[11px] text-muted-foreground/70">New events will pop up here automatically.</p>
            </div>
          </div>
        )}

        <div className="absolute inset-0 p-6 grid place-items-center pointer-events-none">
          <div className="flex flex-col gap-4 items-center w-full max-w-2xl">
            {alerts.map((a, i) => (
              <AlertCard
                key={a.key}
                alert={a}
                index={i}
                onArchive={() => archive(a)}
                onDismiss={() => dismiss(a)}
              />
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

function AlertCard({
  alert,
  index,
  onArchive,
  onDismiss,
}: {
  alert: Alert;
  index: number;
  onArchive: () => void;
  onDismiss: () => void;
}) {
  const withBbox = (raw: string) => {
    const resolved = resolveMediaUrl(raw);
    if (/\/api\/events\/[^/]+\/snapshot\.jpg/.test(raw) || /\/api\/events\/[^/]+\/snapshot\.jpg/.test(resolved)) {
      return resolved + (resolved.includes("?") ? "&" : "?") + "bbox=1";
    }
    return resolved;
  };
  const snapUrl = alert.snapshot ? withBbox(alert.snapshot.url) : null;
  const elapsed = Math.max(0, Math.min(1, (Date.now() - alert.receivedAt) / AUTO_DISMISS_MS));

  return (
    <div
      className={cn(
        "pointer-events-auto w-full max-w-2xl rounded-xl border border-border bg-card/95 backdrop-blur shadow-2xl overflow-hidden",
        "animate-in zoom-in-95 fade-in duration-300"
      )}
      style={{ opacity: 1 - index * 0.08 }}
    >
      <div className="relative aspect-video bg-black">
        {snapUrl ? (
          <img src={snapUrl} alt={alert.camera} className="w-full h-full object-contain" />
        ) : (
          <div className="grid place-items-center h-full text-muted-foreground text-xs">
            Waiting for snapshot…
          </div>
        )}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-destructive/90 text-destructive-foreground px-2 py-1 rounded text-[10px] uppercase tracking-wider font-semibold">
          <span className="h-1.5 w-1.5 rounded-full bg-destructive-foreground pulse-dot" />
          Live alert
        </div>
        <button
          onClick={onDismiss}
          className="absolute top-2 right-2 h-7 w-7 grid place-items-center rounded-full bg-black/60 hover:bg-black/80 text-foreground/90"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground capitalize truncate">
            {alert.label} · {alert.camera}
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {new Date(alert.ts).toLocaleTimeString()}
            {alert.event?.score != null && ` · ${(alert.event.score * 100).toFixed(0)}%`}
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={onArchive} className="gap-1.5">
          <ArchiveIcon className="h-3.5 w-3.5" /> Archive
        </Button>
      </div>
      <div className="h-0.5 bg-border">
        <div className="h-full bg-primary transition-[width] duration-1000 ease-linear" style={{ width: `${(1 - elapsed) * 100}%` }} />
      </div>
    </div>
  );
}

export default Wall;
