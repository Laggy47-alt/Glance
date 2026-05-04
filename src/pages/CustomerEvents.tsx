import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { supabase } from "@/integrations/supabase/client";
import { frigateUrl, type FrigateInstance } from "@/lib/webhookStore";
import { Activity, ImageOff, Radio, Loader2 } from "lucide-react";

function EventThumb({ inst, camera }: { inst: FrigateInstance; camera: string }) {
  const safe = camera.replace(/[^a-zA-Z0-9_-]/g, "_");
  const stored = supabase.storage.from("camera-snapshots").getPublicUrl(`${inst.id}/${safe}.jpg`).data?.publicUrl;
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

const CustomerEvents = () => {
  const { user } = useAuth();
  const store = useWebhookStore();
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
    if (assignedSourceIds.length === 0) { setEvents([]); setLoading(false); return; }
    const { data } = await supabase
      .from("webhook_events")
      .select("id, ts, camera, label, score, source_id, frigate_event_id")
      .in("source_id", assignedSourceIds)
      .eq("kind", "event")
      .order("ts", { ascending: false })
      .limit(10);
    setEvents(data ?? []);
    setLoading(false);
  }, [assignedSourceIds]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (assignedSourceIds.length === 0) return;
    const ch = supabase
      .channel("customer-events-page")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "webhook_events" }, (payload) => {
        const row: any = payload.new;
        if (row?.kind !== "event") return;
        if (!assignedSourceIds.includes(row.source_id)) return;
        setEvents((prev) => [row, ...prev].slice(0, 10));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [assignedSourceIds]);

  return (
    <DashboardLayout
      title="Recent Detections"
      subtitle="Latest 10 events from your cameras"
    >
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-card/60 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Latest 10 detections</h3>
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
                <li key={e.id} className="px-4 py-3 flex items-center gap-3">
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
    </DashboardLayout>
  );
};

export default CustomerEvents;
