import { useEffect, useState, useCallback } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { useUnifiInstances } from "@/hooks/useUnifi";
import { fetchUnifiEvents, unifiThumbnailUrl, type UnifiEventRow, type UnifiInstance } from "@/lib/unifiClient";
import { Loader2, Radio, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Row = UnifiEventRow & { instance: UnifiInstance };

export default function UnifiEvents() {
  const { activeOrg } = useAuth();
  const { instances, loading: instLoading } = useUnifiInstances(activeOrg?.id ?? null);
  const [events, setEvents] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!instances.length) { setEvents([]); return; }
    setLoading(true);
    const all: Row[] = [];
    await Promise.all(instances.filter((i) => i.enabled).map(async (i) => {
      try {
        const rows = await fetchUnifiEvents(i, { limit: 50 });
        for (const r of rows) all.push({ ...r, instance: i });
      } catch { /* ignore */ }
    }));
    all.sort((a, b) => b.start - a.start);
    setEvents(all);
    setLoading(false);
  }, [instances]);

  useEffect(() => { void load(); }, [load]);

  return (
    <DashboardLayout
      title="UniFi Detections"
      subtitle="Recent motion & smart-detect events from your UniFi Protect NVRs"
      actions={<Button size="sm" variant="outline" onClick={load} disabled={loading}><RefreshCcw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>}
    >
      {instLoading || loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 inline animate-spin mr-2" /> Loading…</div>
      ) : events.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <Radio className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No recent detections.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {events.map((e) => (
            <div key={`${e.instance.id}:${e.id}`} className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="aspect-video bg-muted">
                <img src={unifiThumbnailUrl(e.instance, e.id)} alt={e.type} className="w-full h-full object-cover" loading="lazy" />
              </div>
              <div className="px-3 py-2 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: e.instance.color }} />
                  <span className="text-xs truncate flex-1">{e.instance.name}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{new Date(e.start).toLocaleTimeString()}</span>
                </div>
                <div className="text-xs font-medium truncate">{e.type}{e.smartDetectTypes?.length ? ` · ${e.smartDetectTypes.join(", ")}` : ""}</div>
                {typeof e.score === "number" && <div className="text-[10px] text-muted-foreground">Score {e.score}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
