import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, VideoOff, RefreshCw, ExternalLink } from "lucide-react";
import { AppSidebar } from "@/components/AppSidebar";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { fetchUnifiCameraStatus } from "@/lib/unifiHealthStore";
import type { UnifiCameraStatus } from "@/lib/webhookStore";
import { Link } from "react-router-dom";

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function UnifiCameraStatusPage() {
  const store = useWebhookStore();
  const [rows, setRows] = useState<UnifiCameraStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const load = () => {
    setLoading(true);
    fetchUnifiCameraStatus()
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const id = setInterval(load, 30_000);
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => { clearInterval(id); clearInterval(t); };
  }, []);

  const byInstance = useMemo(() => {
    const m = new Map<string, UnifiCameraStatus[]>();
    for (const r of rows) {
      const arr = m.get(r.instance_id) ?? [];
      arr.push(r);
      m.set(r.instance_id, arr);
    }
    return m;
  }, [rows]);

  const totalOffline = rows.filter((r) => !r.is_online).length;

  return (
    <div className="min-h-screen bg-background flex">
      <AppSidebar />
      <main className="flex-1 p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">UniFi Camera Status</h1>
            <p className="text-xs text-muted-foreground">
              Live camera health pushed from the on-site bridge every ~30 seconds.
              {" "}
              <span className="text-foreground">{totalOffline}</span> offline of {rows.length}.
              {tick /* re-render tick to refresh timeAgo */ ? "" : ""}
            </p>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {store.unifis.map((u) => {
          const cams = byInstance.get(u.id) ?? [];
          const offline = cams.filter((c) => !c.is_online).length;
          return (
            <Card key={u.id} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: u.color }} />
                  <h2 className="text-sm font-semibold">{u.name}</h2>
                  <Badge variant={offline > 0 ? "destructive" : "secondary"} className="text-[10px]">
                    {offline > 0 ? `${offline} offline` : `${cams.length} online`}
                  </Badge>
                </div>
                {u.bridge_public_url && (
                  <Link to={`/unifi-live?instance=${u.id}`}
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                    Live view <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </div>
              {cams.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No status yet. Make sure the bridge is running with STATUS_INTERVAL_SEC set.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                  {cams
                    .slice()
                    .sort((a, b) => Number(a.is_online) - Number(b.is_online) || (a.name ?? "").localeCompare(b.name ?? ""))
                    .map((c) => (
                    <div key={c.camera_id}
                         className={`rounded-md border px-3 py-2 flex items-center gap-2 ${
                           c.is_online ? "border-border bg-secondary/30" : "border-destructive/40 bg-destructive/10"
                         }`}>
                      {c.is_online
                        ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                        : <VideoOff className="h-4 w-4 text-destructive shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate">{c.name || c.camera_id}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {c.is_online
                            ? `Last seen ${timeAgo(c.last_seen_at ?? c.last_status_at)}`
                            : `Down since ${timeAgo(c.last_offline_at)}`}
                        </div>
                      </div>
                      <span className="text-[9px] uppercase text-muted-foreground">{c.state || (c.is_online ? "ok" : "off")}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
        {store.unifis.length === 0 && (
          <Card className="p-6 text-center text-xs text-muted-foreground">
            No UniFi NVRs configured. Add one under <Link to="/frigate" className="text-primary underline">NVRs</Link>.
          </Card>
        )}
      </main>
    </div>
  );
}
