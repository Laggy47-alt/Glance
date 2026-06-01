import { DashboardLayout } from "@/components/DashboardLayout";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, Camera, X, Archive as ArchiveIcon, Filter, Check, MessageSquare, PanelLeftClose, PanelLeftOpen, Tag as TagIcon } from "lucide-react";
import { resolveMediaUrl, type MediaItem, type WebhookEvent } from "@/lib/webhookStore";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MediaLightbox, type LightboxItem } from "@/components/MediaLightbox";
import { logAudit } from "@/lib/auditLog";
import { AlertAuditDialog } from "@/components/AlertAuditDialog";

type Alert = {
  key: string;
  event: WebhookEvent | null;
  clip?: MediaItem;
  snapshot?: MediaItem;
  camera: string;
  site: string;
  label: string;
  ts: string;
  receivedAt: number;
};

const LIVE_WALL_POLL_LOCK_KEY = "abc-glance.live-wall-poll-lock";
const LIVE_WALL_POLL_LOCK_TTL_MS = 20_000;

function claimLiveWallPollLock(owner: string) {
  try {
    const now = Date.now();
    const raw = localStorage.getItem(LIVE_WALL_POLL_LOCK_KEY);
    const current = raw ? JSON.parse(raw) as { owner?: string; expiresAt?: number } : null;
    if (current?.owner && current.owner !== owner && (current.expiresAt ?? 0) > now) return false;
    localStorage.setItem(LIVE_WALL_POLL_LOCK_KEY, JSON.stringify({ owner, expiresAt: now + LIVE_WALL_POLL_LOCK_TTL_MS }));
    return true;
  } catch {
    return true;
  }
}

function releaseLiveWallPollLock(owner: string) {
  try {
    const raw = localStorage.getItem(LIVE_WALL_POLL_LOCK_KEY);
    const current = raw ? JSON.parse(raw) as { owner?: string } : null;
    if (current?.owner === owner) localStorage.removeItem(LIVE_WALL_POLL_LOCK_KEY);
  } catch { /* no-op */ }
}



const Wall = () => {
  const store = useWebhookStore();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [muted, setMuted] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [auditFor, setAuditFor] = useState<Alert | null>(null);
  const [cameraFilter, setCameraFilter] = useState<Set<string>>(new Set());
  const [labelFilter, setLabelFilter] = useState<Set<string>>(new Set());
  const autoArchivedRef = useRef<Set<string>>(new Set());
  const seenRef = useRef<Set<string>>(new Set());
  const mountedAtRef = useRef<number>(Date.now());
  const pollOwnerRef = useRef<string>(`wall-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`);
  // Per-camera follow-up window: if new motion fires on the SAME camera
  // within this window, the previous un-ACKed alert for that camera is
  // auto-ACKed (archived) and replaced by the newer one. Outside the window,
  // alerts MUST be ACKed by an operator — they are never silently dismissed.
  // Bundle window: events on the same camera within this window are shown as
  // a single alert (the latest one). After this window of silence, the next
  // event becomes a brand-new alert. Same rule for every camera.
  const CAMERA_FOLLOWUP_MS = 10_000;

  const availableCameras = useMemo(() => {
    const set = new Set<string>();
    store.events.forEach((e) => e.camera && set.add(e.camera));
    store.media.forEach((m) => m.camera && set.add(m.camera));
    return Array.from(set).sort();
  }, [store.events, store.media]);

  const availableLabels = useMemo(() => {
    const set = new Set<string>();
    store.events.forEach((e) => {
      const l = e.label ?? e.kind;
      if (l) set.add(l);
    });
    return Array.from(set).sort();
  }, [store.events]);

  const matchesFilter = (camera: string, label: string) => {
    if (cameraFilter.size > 0 && !cameraFilter.has(camera)) return false;
    if (labelFilter.size > 0 && !labelFilter.has(label)) return false;
    return true;
  };

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, val: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
  };

  const activeFilterCount = cameraFilter.size + labelFilter.size;

  const pollableFrigates = useMemo(
    () => store.frigates.filter((f) => f.enabled && f.poll_enabled && !f.is_local),
    [store.frigates]
  );
  const pollableSignature = useMemo(
    () => pollableFrigates.map((f) => `${f.id}:${f.poll_interval_seconds}`).join("|"),
    [pollableFrigates]
  );

  useEffect(() => {
    if (!store.loaded || pollableFrigates.length === 0) return;
    let stopped = false;
    let running = false;
    const owner = pollOwnerRef.current;
    const minInterval = Math.min(...pollableFrigates.map((f) => Math.max(5, f.poll_interval_seconds || 10))) * 1000;
    const intervalMs = Math.max(5_000, Math.min(minInterval, 15_000));

    const poll = async () => {
      if (stopped || running || document.visibilityState !== "visible") return;
      if (!claimLiveWallPollLock(owner)) return;
      running = true;
      try {
        await Promise.allSettled(pollableFrigates.map((f) => store.pollFrigateNow(f.id)));
        if (!stopped) await store.refreshAll();
      } finally {
        running = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), intervalMs);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      releaseLiveWallPollLock(owner);
    };
  }, [store, store.loaded, pollableFrigates, pollableSignature]);

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

  // NVR-level mute was removed in favor of per-camera schedules.
  const isSourceMuted = (_source_id?: string | null, _instance_id?: string | null) => false;

  // Track per-camera disarmed state so the wall suppresses alerts for cameras
  // that are currently disarmed (either by schedule or manual toggle).
  const [disarmedKeys, setDisarmedKeys] = useState<Set<string>>(new Set());
  const [disarmedLoaded, setDisarmedLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("camera_armed_state")
        .select("instance_id,camera,armed")
        .eq("armed", false);
      if (cancelled) return;
      setDisarmedKeys(new Set((data ?? []).map((r) => `${r.instance_id}::${r.camera}`)));
      setDisarmedLoaded(true);
    };
    void load();
    const ch = supabase
      .channel("wall-armed-state")
      .on("postgres_changes", { event: "*", schema: "public", table: "camera_armed_state" }, () => void load())
      .subscribe();
    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, []);

  const isCameraDisarmed = (source_id?: string | null, instance_id?: string | null, camera?: string | null) => {
    if (!camera) return false;
    const inst = store.frigates.find((f) =>
      (instance_id && f.id === instance_id) || (source_id && f.source_id === source_id)
    );
    if (!inst) return false;
    return disarmedKeys.has(`${inst.id}::${camera}`);
  };

  // Build alerts from incoming events. Pair media as it arrives.
  // Alerts persist for any un-archived event so they survive navigation away from the Wall.
  useEffect(() => {
    if (!store.loaded) return;
    if (!disarmedLoaded) return;
    const newOnes: Alert[] = [];
    const freshOnes: Alert[] = [];
    for (const e of store.events) {
      if (e.archived) continue;
      const key = e.id;
      if (seenRef.current.has(key)) continue;
      // Skip alerts whose NVR is currently muted on schedule
      if (isSourceMuted(e.source_id)) { seenRef.current.add(key); continue; }
      // Skip alerts for cameras that are currently disarmed
      if (isCameraDisarmed(e.source_id, null, e.camera)) { seenRef.current.add(key); continue; }
      // Show ALL un-archived events, even ones that pre-date this Wall session.
      // Alerts must persist until an operator ACKs them (archives in DB).
      const clip = findMedia(e, "clip");
      const snapshot = findMedia(e, "snapshot");
      seenRef.current.add(key);
      const camera = e.camera ?? "unknown";
      const label = e.label ?? e.kind ?? "motion";
      const inst = store.frigates.find((f) => f.source_id === e.source_id);
      const site = inst?.name ?? "Unknown site";

      // No silent suppression: every alert must be operator-ACKed.
      // Follow-up bundling on the same camera is handled below in setAlerts.

      const alert: Alert = {
        key,
        event: e,
        clip,
        snapshot,
        camera,
        site,
        label,
        ts: e.ts,
        receivedAt: Date.now(),
      };
      newOnes.push(alert);
      if (new Date(e.ts).getTime() >= mountedAtRef.current - 5_000) freshOnes.push(alert);
    }
    if (newOnes.length) {
      freshOnes.forEach((a) => void logAudit({ alert_key: a.key, event_id: a.event?.id ?? null, action: "created", note: `${a.label} · ${a.camera}` }));
      setAlerts((prev) => [...newOnes, ...prev].slice(0, 200));
      if (freshOnes.length && !muted) {
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
  }, [store.events, store.media, store.loaded, muted, disarmedLoaded, disarmedKeys]);

  // Also pop up standalone media (e.g. polled clips with no paired event row).
  useEffect(() => {
    if (!store.loaded) return;
    if (!disarmedLoaded) return;
    const newOnes: Alert[] = [];
    const freshOnes: Alert[] = [];
    for (const m of store.media) {
      if (m.kind !== "clip") continue;
      const key = `m:${m.id}`;
      if (seenRef.current.has(key)) continue;
      // Skip muted NVR (by source or instance)
      if (isSourceMuted(m.source_id, m.instance_id)) { seenRef.current.add(key); continue; }
      // Skip cameras that are currently disarmed
      if (isCameraDisarmed(m.source_id, m.instance_id, m.camera)) { seenRef.current.add(key); continue; }
      // Persist standalone clip alerts until ACKed (no staleness drop).
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
      const camera = m.camera ?? "unknown";
      const label = "motion";
      const inst = store.frigates.find((f) =>
        (m.instance_id && f.id === m.instance_id) || f.source_id === m.source_id
      );
      const site = inst?.name ?? "Unknown site";
      const mMs = new Date(m.ts).getTime();

      // No silent suppression — handled by setAlerts follow-up logic below.

      const alert: Alert = {
        key,
        event: null,
        clip: m,
        snapshot,
        camera,
        site,
        label,
        ts: m.ts,
        receivedAt: Date.now(),
      };
      newOnes.push(alert);
      if (mMs >= mountedAtRef.current - 5_000) freshOnes.push(alert);
    }
    if (newOnes.length) {
      freshOnes.forEach((a) => void logAudit({ alert_key: a.key, event_id: a.event?.id ?? null, action: "created", note: `${a.label} · ${a.camera}` }));
      setAlerts((prev) => [...newOnes, ...prev].slice(0, 200));
    }
  }, [store.media, store.events, store.loaded, disarmedLoaded, disarmedKeys]);

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

  // Lightbox for opening the clip when an alert is clicked.
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);

  const archive = async (a: Alert) => {
    setAlerts((prev) => prev.filter((x) => x.key !== a.key));
    void logAudit({ alert_key: a.key, event_id: a.event?.id ?? null, action: "ack" });
    if (a.event) {
      await supabase.from("webhook_events").update({ archived: true, read: true }).eq("id", a.event.id);
    }
  };

  // Dismiss = ACK. Operators must explicitly acknowledge alerts; there is
  // no silent dismissal. The X on the card and the ACK button both archive
  // the event in the database so it can never be lost on sign-out.
  const dismiss = (a: Alert) => { void archive(a); };

  // Sync ACKs across users: if an event becomes archived in the store
  // (e.g. another user pressed ACK), remove it from this user's wall too.
  useEffect(() => {
    const archivedIds = new Set(
      store.events.filter((e) => e.archived).map((e) => e.id)
    );
    if (!archivedIds.size) return;
    setAlerts((prev) => prev.filter((a) => !(a.event && archivedIds.has(a.event.id))));
  }, [store.events]);

  // Per-camera follow-up: when a new alert arrives for the same camera within
  // CAMERA_FOLLOWUP_MS, the previous un-ACKed alert for that camera is
  // auto-ACKed and replaced by the newest one. Outside that window, alerts
  // persist until an operator explicitly ACKs them.
  useEffect(() => {
    setAlerts((prev) => {
      const byCamera = new Map<string, Alert[]>();
      prev.forEach((a) => {
        const arr = byCamera.get(a.camera) ?? [];
        arr.push(a);
        byCamera.set(a.camera, arr);
      });
      const drop = new Set<string>();
      byCamera.forEach((arr) => {
        if (arr.length < 2) return;
        const sorted = [...arr].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
        for (let i = 1; i < sorted.length; i++) {
          const older = sorted[i];
          const newer = sorted[i - 1];
          if (new Date(newer.ts).getTime() - new Date(older.ts).getTime() < CAMERA_FOLLOWUP_MS) {
            if (autoArchivedRef.current.has(older.key)) { drop.add(older.key); continue; }
            autoArchivedRef.current.add(older.key);
            void logAudit({
              alert_key: older.key,
              event_id: older.event?.id ?? null,
              action: "ack",
              note: `auto-acked: superseded by newer motion on ${older.camera} within ${Math.round(CAMERA_FOLLOWUP_MS / 1000)}s`,
            });
            if (older.event) {
              void supabase.from("webhook_events").update({ archived: true, read: true }).eq("id", older.event.id);
            }
            drop.add(older.key);
          }
        }
      });
      if (!drop.size) return prev;
      return prev.filter((a) => !drop.has(a.key));
    });
  }, [alerts, CAMERA_FOLLOWUP_MS]);

  const recentCount = useMemo(
    () => store.events.filter((e) => !e.archived && Date.now() - new Date(e.ts).getTime() < 5 * 60_000).length,
    [store.events]
  );


  return (
    <DashboardLayout
      title="Live Wall"
      subtitle="Idle screen — incoming snapshots pop up here"
      hideSidebar={sidebarHidden}
      actions={
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8"
            onClick={() => setSidebarHidden((v) => !v)}
            aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
          >
            {sidebarHidden ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
            {sidebarHidden ? "Show menu" : "Hide menu"}
          </Button>
          <Badge variant="secondary" className="gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success pulse-dot" />
            {recentCount} in last 5m
          </Badge>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 h-8">
                <Filter className="h-3.5 w-3.5" />
                Filter
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-0">
              <div className="p-3 border-b border-border flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Filter alerts</span>
                {activeFilterCount > 0 && (
                  <button
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => { setCameraFilter(new Set()); setLabelFilter(new Set()); }}
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-auto">
                <div className="p-2">
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Cameras
                  </div>
                  {availableCameras.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No cameras yet</div>
                  )}
                  {availableCameras.map((c) => {
                    const active = cameraFilter.has(c);
                    return (
                      <button
                        key={c}
                        onClick={() => toggleSet(setCameraFilter, c)}
                        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs rounded hover:bg-secondary/60 text-foreground"
                      >
                        <span className="truncate capitalize">{c}</span>
                        {active && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                </div>
                <div className="p-2 border-t border-border">
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Labels
                  </div>
                  {availableLabels.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No labels yet</div>
                  )}
                  {availableLabels.map((l) => {
                    const active = labelFilter.has(l);
                    return (
                      <button
                        key={l}
                        onClick={() => toggleSet(setLabelFilter, l)}
                        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs rounded hover:bg-secondary/60 text-foreground"
                      >
                        <span className="truncate capitalize">{l}</span>
                        {active && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            <Switch checked={!muted} onCheckedChange={(v) => setMuted(!v)} />
          </div>
        </div>
      }
    >
      <div className="relative h-[calc(100vh-10rem)] rounded-lg border border-border bg-gradient-to-br from-background via-background to-secondary/30 overflow-hidden">
        {(() => {
          const visibleAlerts = alerts.filter((a) => matchesFilter(a.camera, a.label));
          return (
            <>
              {visibleAlerts.length === 0 && (
                <div className="absolute inset-0 grid place-items-center pointer-events-none">
                  <div className="text-center space-y-3">
                    <div className="mx-auto h-16 w-16 rounded-full bg-secondary/50 grid place-items-center">
                      <Camera className="h-7 w-7 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {activeFilterCount > 0 ? "No alerts match the current filter" : "Waiting for motion…"}
                    </p>
                    <p className="text-[11px] text-muted-foreground/70">New events will pop up here automatically.</p>
                  </div>
                </div>
              )}

              <div className="absolute inset-0 overflow-y-auto p-4">
                <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(240px,1fr))] auto-rows-min">
                  {visibleAlerts.map((a, i) => {
                    const openMedia = (preferred: "clip" | "snapshot") => {
                      const m = preferred === "clip" ? (a.clip ?? a.snapshot) : (a.snapshot ?? a.clip);
                      if (!m) return;
                      const inst = store.frigates.find((f) =>
                        (m.instance_id && f.id === m.instance_id) || f.source_id === m.source_id
                      );
                      setLightbox({
                        kind: m.kind,
                        url: resolveMediaUrl(m.url),
                        camera: a.camera,
                        topic: m.topic ?? null,
                        ts: m.ts,
                        thumbnail: a.snapshot && m.kind === "clip" ? resolveMediaUrl(a.snapshot.url) : undefined,
                        frigateUrl: inst ? `${inst.base_url}/cameras/${a.camera}` : null,
                        mediaId: m.id,
                        eventId: a.event?.id ?? m.event_id ?? null,
                      });
                    };
                    return (
                      <AlertCard
                        key={a.key}
                        alert={a}
                        index={i}
                        onArchive={() => archive(a)}
                        onDismiss={() => dismiss(a)}
                        onComment={() => setAuditFor(a)}
                        onOpen={() => openMedia("clip")}
                        onTag={() => openMedia("snapshot")}
                      />
                    );
                  })}
                </div>
              </div>
            </>
          );
        })()}
      </div>
      <MediaLightbox item={lightbox} onClose={() => setLightbox(null)} />
      {auditFor && (
        <AlertAuditDialog
          open={!!auditFor}
          onOpenChange={(v) => { if (!v) setAuditFor(null); }}
          alertKey={auditFor.key}
          eventId={auditFor.event?.id ?? null}
          title={`${auditFor.label} · ${auditFor.camera}`}
        />
      )}
    </DashboardLayout>
  );
};

function AlertCard({
  alert,
  index,
  onArchive,
  onDismiss,
  onComment,
  onOpen,
  onTag,
}: {
  alert: Alert;
  index: number;
  onArchive: () => void;
  onDismiss: () => void;
  onComment: () => void;
  onOpen: () => void;
  onTag: () => void;
}) {
  const withBbox = (raw: string) => {
    const resolved = resolveMediaUrl(raw);
    if (/\/api\/events\/[^/]+\/snapshot\.jpg/.test(raw) || /\/api\/events\/[^/]+\/snapshot\.jpg/.test(resolved)) {
      return resolved + (resolved.includes("?") ? "&" : "?") + "bbox=1";
    }
    return resolved;
  };
  const snapUrl = alert.snapshot ? withBbox(alert.snapshot.url) : null;
  const hasClip = !!alert.clip;

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
        onClick={hasClip ? onOpen : undefined}
        className={cn(
          "relative aspect-video bg-black w-full block",
          hasClip ? "cursor-pointer group" : "cursor-default"
        )}
        aria-label={hasClip ? "Open clip" : "Alert"}
      >
        {snapUrl ? (
          <img src={snapUrl} alt={alert.camera} className="w-full h-full object-cover" />
        ) : (
          <div className="grid place-items-center h-full text-muted-foreground text-[10px]">
            Waiting for snapshot…
          </div>
        )}
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-destructive/90 text-destructive-foreground px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold">
          <span className="h-1 w-1 rounded-full bg-destructive-foreground pulse-dot" />
          Live
        </div>
        {hasClip && (
          <div className="absolute bottom-1.5 left-1.5 bg-black/70 text-foreground/90 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
            Play clip
          </div>
        )}
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
            {alert.event?.score != null && ` · ${(alert.event.score * 100).toFixed(0)}%`}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={onTag}
            disabled={!alert.snapshot && !alert.clip}
            className="gap-1 h-7 px-2 text-[11px]"
            title="Add tag"
          >
            <TagIcon className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onComment}
            className="gap-1 h-7 px-2 text-[11px]"
            title="Add comment / view audit trail"
          >
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

export default Wall;
