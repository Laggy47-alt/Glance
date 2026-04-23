import { DashboardLayout } from "@/components/DashboardLayout";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ScrollText, RefreshCw, User as UserIcon, Filter as FilterIcon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AuditEntry } from "@/lib/auditLog";
import { formatDuration } from "@/lib/duration";

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
      return (
        (e.actor ?? "").toLowerCase().includes(f) ||
        (e.note ?? "").toLowerCase().includes(f) ||
        e.alert_key.toLowerCase().includes(f)
      );
    });
  }, [entries, filter, actionFilter]);

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
            placeholder="Filter by user, note, or alert…"
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
                  <th className="px-4 py-2.5 font-semibold">Alert</th>
                  <th className="px-4 py-2.5 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
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
                    <td className="px-4 py-2.5">
                      <code className="text-[10px] text-accent">{e.alert_key.slice(0, 12)}…</code>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-md truncate">
                      {e.note ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </Card>
    </DashboardLayout>
  );
};

export default Audit;
