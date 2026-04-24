import { DashboardLayout } from "@/components/DashboardLayout";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Camera, Users, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type AuditRow = {
  id: string;
  action: string;
  actor: string | null;
  ts: string;
};

const Overview = () => {
  const store = useWebhookStore();
  const { isAdmin } = useAuth();
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [adminNames, setAdminNames] = useState<Set<string>>(new Set());
  const [resetting, setResetting] = useState(false);
  const [statsResetAt, setStatsResetAt] = useState<number>(() => {
    const v = localStorage.getItem("overview.statsResetAt");
    return v ? Number(v) : 0;
  });


  // Total unique cameras (matches Cameras page logic)
  const totalCameras = useMemo(() => {
    const set = new Set<string>();
    for (const m of store.media) {
      const key = `${m.instance_id ?? "_"}::${m.camera ?? "unknown"}`;
      set.add(key);
    }
    return set.size;
  }, [store.media]);

  // Load audit log (last 30 days) for operator stats + peak hours
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("event_audit_log")
        .select("id, action, actor, ts")
        .gte("ts", since)
        .order("ts", { ascending: false })
        .limit(5000);
      if (!cancelled && data) setAudit(data as AuditRow[]);
    };
    void load();

    const channel = supabase
      .channel("audit_overview")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_audit_log" },
        () => void load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, []);

  // Operator stats — actions per actor
  const operators = useMemo(() => {
    const map = new Map<string, { actor: string; total: number; read: number; archived: number; other: number; lastTs: number }>();
    for (const a of audit) {
      const actor = (a.actor && a.actor.trim()) || "unknown";
      const t = new Date(a.ts).getTime();
      const row = map.get(actor) ?? { actor, total: 0, read: 0, archived: 0, other: 0, lastTs: 0 };
      row.total += 1;
      if (a.action === "read" || a.action === "mark_read") row.read += 1;
      else if (a.action === "archive" || a.action === "archived") row.archived += 1;
      else row.other += 1;
      row.lastTs = Math.max(row.lastTs, t);
      map.set(actor, row);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [audit]);

  const totalOperators = operators.length;

  // Peak hours — alerts (webhook events) grouped by hour-of-day, last 7 days
  const peakHours = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${h.toString().padStart(2, "0")}:00`, count: 0 }));
    for (const ev of store.events) {
      const t = new Date(ev.ts).getTime();
      if (t < cutoff) continue;
      const h = new Date(ev.ts).getHours();
      buckets[h].count += 1;
    }
    return buckets;
  }, [store.events]);

  // Peak hours per day-of-week (last 30 days)
  const peakByDay = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const buckets = labels.map((label) => ({ label, count: 0 }));
    for (const ev of store.events) {
      const d = new Date(ev.ts);
      if (d.getTime() < cutoff) continue;
      buckets[d.getDay()].count += 1;
    }
    return buckets;
  }, [store.events]);

  const cards = [
    { label: "Total Cameras", value: totalCameras, icon: Camera, color: "text-primary" },
    { label: "Operators (30d)", value: totalOperators, icon: Users, color: "text-accent" },
    { label: "Alerts (7d)", value: peakHours.reduce((s, b) => s + b.count, 0), icon: Activity, color: "text-warning" },
  ];

  return (
    <DashboardLayout title="Overview" subtitle="Operator activity and alert patterns">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {cards.map((c) => (
          <Card key={c.label} className="bg-gradient-card border-border shadow-card p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</div>
                <div className="text-3xl font-semibold mt-2 text-foreground tabular-nums">{c.value}</div>
              </div>
              <div className={`h-9 w-9 rounded-md bg-secondary grid place-items-center ${c.color}`}>
                <c.icon className="h-5 w-5" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2 bg-gradient-card border-border shadow-card p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Peak Hours — Alerts by Hour of Day</h3>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Last 7 days</span>
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={peakHours} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  interval={1}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                    color: "hsl(var(--popover-foreground))",
                  }}
                  labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="bg-gradient-card border-border shadow-card p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Alerts by Day</h3>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Last 30 days</span>
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={peakByDay} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                    color: "hsl(var(--popover-foreground))",
                  }}
                  labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                />
                <Bar dataKey="count" fill="hsl(var(--accent))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="bg-gradient-card border-border shadow-card p-5">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">Operator Stats</h3>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Last 30 days</span>
        </div>
        {operators.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">No operator activity yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4 font-medium">Operator</th>
                  <th className="py-2 px-4 font-medium tabular-nums">Total</th>
                  <th className="py-2 px-4 font-medium tabular-nums">Read</th>
                  <th className="py-2 px-4 font-medium tabular-nums">Archived</th>
                  <th className="py-2 px-4 font-medium tabular-nums">Other</th>
                  <th className="py-2 pl-4 font-medium tabular-nums">Last Action</th>
                </tr>
              </thead>
              <tbody>
                {operators.map((op) => (
                  <tr key={op.actor} className="border-b border-border/50 last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-foreground">{op.actor}</td>
                    <td className="py-2.5 px-4 tabular-nums text-foreground">{op.total}</td>
                    <td className="py-2.5 px-4 tabular-nums text-muted-foreground">{op.read}</td>
                    <td className="py-2.5 px-4 tabular-nums text-success">{op.archived}</td>
                    <td className="py-2.5 px-4 tabular-nums text-muted-foreground">{op.other}</td>
                    <td className="py-2.5 pl-4 tabular-nums text-muted-foreground text-xs">
                      {op.lastTs ? new Date(op.lastTs).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </DashboardLayout>
  );
};

export default Overview;
