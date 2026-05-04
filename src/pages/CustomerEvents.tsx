import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { supabase } from "@/integrations/supabase/client";
import { frigateUrl, type FrigateInstance } from "@/lib/webhookStore";
import { MediaLightbox, type LightboxItem } from "@/components/MediaLightbox";
import { Activity, ImageOff, Radio, Loader2 } from "lucide-react";

// Fetch enough recent events to find at least one per camera, then dedupe to latest per camera.
const FETCH_LIMIT = 200;

type EvRow = {
  id: string;
  ts: string;
  camera: string | null;
  label: string | null;
  score: number | null;
  source_id: string;
  frigate_event_id: string | null;
};

function snapshotUrl(inst: FrigateInstance, camera: string) {
  const safe = camera.replace(/[^a-zA-Z0-9_-]/g, "_");
  return supabase.storage.from("camera-snapshots").getPublicUrl(`${inst.id}/${safe}.jpg`).data?.publicUrl ?? null;
}

function EventThumb({ inst, camera }: { inst: FrigateInstance; camera: string }) {
  const stored = snapshotUrl(inst, camera);
  const live = frigateUrl(inst, `/api/${encodeURIComponent(camera)}/latest.jpg?h=120`);
  const [src, setSrc] = useState<string | null>(live ?? stored ?? null);
  const [errored, setErrored] = useState(false);
  if (!src || errored) {
    return (
      <div className="h-14 w-24 shrink-0 rounded bg-muted border border-border flex items-center justify-center">
        <ImageOff className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={camera}
      loading="lazy"
      className="h-14 w-24 shrink-0 rounded object-cover border border-border bg-muted"
      onError={() => {
        if (live && src === live && stored) setSrc(stored);
        else setErrored(true);
      }}
    />
  );
}

/** Keep only the latest event per camera. Input is sorted newest-first; we keep the first
 *  occurrence of each camera (which is the most recent). */
function latestPerCamera(rows: EvRow[]): EvRow[] {
  const seen = new Set<string>();
  const kept: EvRow[] = [];
  for (const r of rows) {
    const cam = r.camera ?? "unknown";
    if (seen.has(cam)) continue;
    seen.add(cam);
    kept.push(r);
  }
  return kept;
}

const CustomerEvents = () => {
  const { user } = useAuth();
  const store = useWebhookStore();
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [rawEvents, setRawEvents] = useState<EvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("customer_nvr_assignments")
      .select("instance_id")
      .eq("user_id", user.id)
      .then(({ data }) => setAssignedIds((data ?? []).map((d) => d.instance_id)));
  }, [user]);

  const assignedSourceIds = useMemo(
    () => store.frigates.filter((f) => assignedIds.includes(f.id)).map((f) => f.source_id).filter(Boolean),
    [store.frigates, assignedIds]
  );

  const load = useCallback(async () => {
    if (assignedSourceIds.length === 0) { setRawEvents([]); setLoading(false); return; }
    const { data } = await supabase
      .from("webhook_events")
      .select("id, ts, camera, label, score, source_id, frigate_event_id")
      .in("source_id", assignedSourceIds)
      .eq("kind", "event")
      .order("ts", { ascending: false })
      .limit(FETCH_LIMIT);
    setRawEvents((data ?? []) as EvRow[]);
    setLoading(false);
  }, [assignedSourceIds]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (assignedSourceIds.length === 0) return;
    const ch = supabase
      .channel("customer-events-page")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "webhook_events" }, (payload) => {
        const row = payload.new as EvRow & { kind?: string };
        if (row?.kind !== "event") return;
        if (!assignedSourceIds.includes(row.source_id)) return;
        setRawEvents((p) => [row, ...p].slice(0, FETCH_LIMIT));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [assignedSourceIds]);

  // One row per camera — the latest detection for each.
  const events = useMemo(() => latestPerCamera(rawEvents), [rawEvents]);

  const openSnapshot = (e: EvRow) => {
    const inst = store.frigates.find((f) => f.source_id === e.source_id);
    if (!inst) {
      console.warn("[CustomerEvents] No NVR instance for event", e);
      return;
    }
    const camera = e.camera ?? "unknown";
    // Prefer DB-stored snapshot media (matches by frigate_event_id)
    const mediaSnap = e.frigate_event_id
      ? store.media?.find((m) => m.kind === "snapshot" && m.frigate_event_id === e.frigate_event_id)
      : null;
    // Then Frigate's per-event snapshot (the actual detection frame)
    // Then the cached latest snapshot from storage
    // Then the camera's live latest.jpg
    const url = mediaSnap?.url
      ?? (e.frigate_event_id ? frigateUrl(inst, `/api/events/${encodeURIComponent(e.frigate_event_id)}/snapshot.jpg`) : null)
      ?? snapshotUrl(inst, camera)
      ?? frigateUrl(inst, `/api/${encodeURIComponent(camera)}/latest.jpg`);
    setLightbox({
      kind: "snapshot",
      url,
      camera,
      topic: inst.name,
      ts: e.ts,
      mediaId: mediaSnap?.id,
      eventId: e.id,
      readOnly: true,
    });
  };

  return (
    <DashboardLayout
      title="Recent Detections"
      subtitle="Latest detection per camera"
    >
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-card/60 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Latest detection per camera</h3>
          </div>
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Radio className="h-3 w-3 text-success animate-pulse" /> Live
          </span>
        </div>
        {loading ? (
          <p className="px-4 py-10 text-xs text-muted-foreground text-center">
            <Loader2 className="h-4 w-4 inline animate-spin mr-2" /> Loading…
          </p>
        ) : events.length === 0 ? (
          <p className="px-4 py-10 text-xs text-muted-foreground text-center">No detections yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((e) => {
              const inst = store.frigates.find((f) => f.source_id === e.source_id);
              return (
                <li
                  key={e.id}
                  className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => openSnapshot(e)}
                >
                  {inst && e.camera ? (
                    <EventThumb inst={inst} camera={e.camera} />
                  ) : (
                    <div className="h-14 w-24 shrink-0 rounded bg-muted border border-border" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground capitalize truncate">
                        {e.label || "detection"}
                      </span>
                      {typeof e.score === "number" && (
                        <Badge variant="outline" className="text-[10px]">
                          {Math.round(Number(e.score) * 100)}%
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {inst?.name ?? "Unknown NVR"}{e.camera ? ` · ${e.camera}` : ""} · {new Date(e.ts).toLocaleString()}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <MediaLightbox item={lightbox} onClose={() => setLightbox(null)} />
    </DashboardLayout>
  );
};

export default CustomerEvents;
