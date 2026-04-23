import { DashboardLayout } from "@/components/DashboardLayout";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ScrollText, RefreshCw, User as UserIcon, Filter as FilterIcon, Clock, Camera as CameraIcon, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AuditEntry } from "@/lib/auditLog";
import { formatDuration } from "@/lib/duration";

type EventMeta = { camera: string | null; topic: string | null; label: string | null };
type MediaMeta = { url: string; kind: string };

const ACTION_STYLES: Record<string, string> = {
  ack: "bg-success/15 text-success border-success/30",
  dismiss: "bg-muted text-muted-foreground border-border",
  created: "bg-primary/15 text-primary border-primary/30",
  comment: "bg-accent/15 text-accent border-accent/30",
};

const Audit = () => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [eventMeta, setEventMeta] = useState<Record<string, EventMeta>>({});
  const [mediaByEvent, setMediaByEvent] = useState<Record<string, MediaMeta>>({});

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("event_audit_log")
      .select("*")
      .order("ts", { ascending: false })
      .limit(1000);
    setEntries((data ?? []) as AuditEntry[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("audit-log")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "event_audit_log" }, (p) => {
        setEntries((prev) => [p.new as AuditEntry, ...prev].slice(0, 1000));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    const eventIds = Array.from(new Set(entries.map((e) => e.event_id).filter(Boolean) as string[]));
    if (eventIds.length === 0) return;
    const missingEvents = eventIds.filter((id) => !(id in eventMeta));
    const missingMedia = eventIds.filter((id) => !(id in mediaByEvent));
    (async () => {
      if (missingEvents.length) {
        const { data } = await supabase
          .from("webhook_events")
          .select("id, camera, topic, label")
          .in("id", missingEvents);
        if (data) {
          setEventMeta((prev) => {
            const next = { ...prev };
            data.forEach((r: any) => { next[r.id] = { camera: r.camera, topic: r.topic, label: r.label }; });
            return next;
          });
        }
      }
      if (missingMedia.length) {
        const { data } = await supabase
          .from("media_items")
          .select("event_id, url, kind, ts")
          .in("event_id", missingMedia)
          .order("ts", { ascending: false });
        if (data) {
          setMediaByEvent((prev) => {
            const next = { ...prev };
            const isImg = (k: string, u: string) => k === "snapshot" || k === "image" || /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(u);
            data.forEach((r: any) => {
              if (!r.event_id) return;
              const cur = next[r.event_id];
              if (!cur) next[r.event_id] = { url: r.url, kind: r.kind };
              else if (!isImg(cur.kind, cur.url) && isImg(r.kind, r.url)) next[r.event_id] = { url: r.url, kind: r.kind };
            });
            return next;
          });
        }
      }
    })();
  }, [entries, eventMeta, mediaByEvent]);

  const actions = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => set.add(e.action));
    return Array.from(set).sort();
  }, [entries]);

  // Earliest "created" timestamp per alert_key — used to compute ack response time
  const createdByKey = useMemo(() => {
    const map: Record<string, string> = {};
    entries.forEach((e) => {
      if (e.action !== "created") return;
      const t = e.ts;
      if (!map[e.alert_key] || t < map[e.alert_key]) map[e.alert_key] = t;
    });
    return map;
  }, [entries]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return entries.filter((e) => {
      if (actionFilter !== "all" && e.action !== actionFilter) return false;
      if (!f) return true;
      const cam = e.event_id ? eventMeta[e.event_id]?.camera ?? "" : "";
      return (
        (e.actor ?? "").toLowerCase().includes(f) ||
        (e.note ?? "").toLowerCase().includes(f) ||
        cam.toLowerCase().includes(f) ||
        e.alert_key.toLowerCase().includes(f)
      );
    });
  }, [entries, filter, actionFilter, eventMeta]);

  return (
    <DashboardLayout
      title="Audit Trail"
      subtitle="Every alert acknowledgement, dismissal and comment with the user who performed it"
      actions={
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-1 bg-secondary/50 rounded-md p-1 border border-border">
          {(["all", ...actions] as const).map((a) => (
            <button
              key={a}
              onClick={() => setActionFilter(a)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded transition-colors capitalize",
                actionFilter === a
                  ? "bg-primary text-primary-foreground shadow-glow"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {a}
            </button>
          ))}
        </div>
        <div className="relative ml-auto max-w-xs w-full">
          <FilterIcon className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter by user, camera, note…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-secondary border-border pl-8"
          />
        </div>
      </div>

      <Card className="bg-gradient-card border-border shadow-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <ScrollText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-foreground font-medium">No audit entries</p>
            <p className="text-xs text-muted-foreground mt-1">
              {entries.length === 0 ? "Activity will appear here as alerts are acknowledged or dismissed." : "Nothing matches the current filter."}
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-260px)]">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 sticky top-0 z-10">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Time</th>
                  <th className="px-4 py-2.5 font-semibold">User</th>
                  <th className="px-4 py-2.5 font-semibold">Action</th>
                  <th className="px-4 py-2.5 font-semibold">Response time</th>
                  <th className="px-4 py-2.5 font-semibold">Snapshot</th>
                  <th className="px-4 py-2.5 font-semibold">Camera</th>
                  <th className="px-4 py-2.5 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const createdTs = createdByKey[e.alert_key];
                  const showDuration = e.action === "ack" && createdTs;
                  const durationMs = showDuration ? new Date(e.ts).getTime() - new Date(createdTs).getTime() : null;
                  return (
                  <tr key={e.id} className="border-t border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {new Date(e.ts).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <UserIcon className="h-3 w-3 text-primary" />
                        {e.actor ?? "—"}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "capitalize text-[10px] font-semibold border",
                          ACTION_STYLES[e.action] ?? "bg-secondary text-foreground border-border"
                        )}
                      >
                        {e.action}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                      {durationMs != null ? (
                        <span className="inline-flex items-center gap-1 text-foreground tabular-nums">
                          <Clock className="h-3 w-3 text-primary" />
                          {formatDuration(durationMs)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {(() => {
                        const meta = e.event_id ? mediaByEvent[e.event_id] : null;
                        if (!meta) return <ImageOff className="h-4 w-4 text-muted-foreground/40" />;
                        const isVideo = meta.kind === "clip" || meta.kind === "video" || /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(meta.url);
                        return (
                          <a href={meta.url} target="_blank" rel="noreferrer" className="block relative w-20 h-12">
                            {isVideo ? (
                              <>
                                <video
                                  src={meta.url}
                                  muted
                                  playsInline
                                  preload="metadata"
                                  className="h-12 w-20 object-cover rounded border border-border hover:border-primary transition-colors bg-black"
                                />
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                  <div className="bg-black/60 rounded-full p-1">
                                    <CameraIcon className="h-3 w-3 text-white" />
                                  </div>
                                </div>
                              </>
                            ) : (
                              <img
                                src={meta.url}
                                alt="snapshot"
                                loading="lazy"
                                className="h-12 w-20 object-cover rounded border border-border hover:border-primary transition-colors"
                              />
                            )}
                          </a>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                      {(() => {
                        const meta = e.event_id ? eventMeta[e.event_id] : null;
                        const camera = meta?.camera || meta?.label;
                        if (camera) {
                          return (
                            <span className="inline-flex items-center gap-1.5 text-foreground font-medium">
                              <CameraIcon className="h-3 w-3 text-primary" />
                              {camera}
                            </span>
                          );
                        }
                        return <code className="text-[10px] text-muted-foreground">{e.alert_key.slice(0, 12)}…</code>;
                      })()}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-md truncate">
                      {e.note ?? "—"}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </Card>
    </DashboardLayout>
  );
};

export default Audit;
