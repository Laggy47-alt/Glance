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

type ViewerProfile = { user_id: string; username: string; display_name: string | null };

const Overview = () => {
  const store = useWebhookStore();
  const { isAdmin } = useAuth();
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [viewers, setViewers] = useState<{ list: ViewerProfile[] }>({ list: [] });
  const [positiveTags, setPositiveTags] = useState<{ created_by: string | null; created_at: string }[]>([]);
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

  // Load all viewer profiles (non-admin users with a login). They're the only ones shown in operator stats.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [{ data: roles }, { data: profs }] = await Promise.all([
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("profiles").select("user_id, username, display_name"),
      ]);
      const adminIds = new Set((roles ?? []).filter((r) => r.role === "admin").map((r) => r.user_id));
      const viewerProfiles = (profs ?? []).filter((p) => !adminIds.has(p.user_id));
      if (!cancelled) setViewers({ list: viewerProfiles.map((p) => ({ user_id: p.user_id, username: p.username, display_name: p.display_name })) });
    };
    void load();

    const ch = supabase
      .channel("overview_viewers")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => void load())
      .subscribe();
    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, []);

  // Load audit log (since reset cutoff, max 30 days) for operator stats
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const thirtyDays = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const since = new Date(Math.max(thirtyDays, statsResetAt)).toISOString();
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
  }, [statsResetAt]);

  // Operator stats — every viewer login is shown, even with zero activity.
  // Only audit rows whose actor matches a viewer's username/display_name are counted.
  const operators = useMemo(() => {
    type Row = { actor: string; total: number; read: number; archived: number; other: number; lastTs: number };
    const map = new Map<string, Row>();

    // Seed with all viewers so operators with 0 actions still appear
    for (const v of viewers.list) {
      const key = v.display_name || v.username;
      map.set(key, { actor: key, total: 0, read: 0, archived: 0, other: 0, lastTs: 0 });
    }

    // Build a lookup: any name (username OR display_name) → display key
    const nameToKey = new Map<string, string>();
    for (const v of viewers.list) {
      const key = v.display_name || v.username;
      nameToKey.set(v.username, key);
      if (v.display_name) nameToKey.set(v.display_name, key);
    }

    for (const a of audit) {
      const actor = (a.actor && a.actor.trim()) || "";
      const key = nameToKey.get(actor);
      if (!key) continue; // skip non-viewers (admins, unknown, legacy strings)
      const row = map.get(key)!;
      row.total += 1;
      if (a.action === "read" || a.action === "mark_read") row.read += 1;
      else if (a.action === "archive" || a.action === "archived") row.archived += 1;
      else row.other += 1;
      const t = new Date(a.ts).getTime();
      row.lastTs = Math.max(row.lastTs, t);
    }

    return [...map.values()].sort((a, b) => b.total - a.total || a.actor.localeCompare(b.actor));
  }, [audit, viewers]);

  const totalOperators = operators.length;

  // Peak hours — alerts (webhook events) grouped by hour-of-day, last 7 days (respect reset)
  const peakHours = useMemo(() => {
    const cutoff = Math.max(Date.now() - 7 * 24 * 60 * 60 * 1000, statsResetAt);
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${h.toString().padStart(2, "0")}:00`, count: 0 }));
    for (const ev of store.events) {
      const t = new Date(ev.ts).getTime();
      if (t < cutoff) continue;
      const h = new Date(ev.ts).getHours();
      buckets[h].count += 1;
    }
    return buckets;
  }, [store.events, statsResetAt]);

  // Peak hours per day-of-week (last 30 days, respect reset)
  const peakByDay = useMemo(() => {
    const cutoff = Math.max(Date.now() - 30 * 24 * 60 * 60 * 1000, statsResetAt);
    const buckets = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => ({ label, count: 0 }));
    for (const ev of store.events) {
      const d = new Date(ev.ts);
      if (d.getTime() < cutoff) continue;
      buckets[d.getDay()].count += 1;
    }
    return buckets;
  }, [store.events, statsResetAt]);

  const handleReset = () => {
    const now = Date.now();
    setResetting(true);
    try {
      localStorage.setItem("overview.statsResetAt", String(now));
      setStatsResetAt(now);
      toast({ title: "Stats reset", description: "Showing activity from this moment forward." });
    } finally {
      setResetting(false);
    }
  };

  const cards = [
    { label: "Total Cameras", value: totalCameras, icon: Camera, color: "text-primary" },
    { label: "Operators", value: totalOperators, icon: Users, color: "text-accent" },
  ];


  return (
    <DashboardLayout title="Overview" subtitle="Operator activity and alert patterns">
      <div className="flex items-center justify-between gap-4 mb-4">
        <p className="text-xs text-muted-foreground">
          {statsResetAt > 0 ? `Stats since ${new Date(statsResetAt).toLocaleString()}` : "Showing rolling window"}
        </p>
        {isAdmin && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={resetting}>
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Stats
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset overview stats?</AlertDialogTitle>
                <AlertDialogDescription>
                  This sets a new starting point for the operator stats and alert charts. Older
                  audit log entries are not deleted — they're just hidden from the dashboard from now on.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleReset}>Reset</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
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
