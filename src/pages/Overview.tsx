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
import { Camera, Users, Server, Activity } from "lucide-react";
import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { frigateUrl } from "@/lib/webhookStore";

function parseCameraNames(stats: unknown): string[] {
  if (!stats || typeof stats !== "object") return [];
  const root = stats as Record<string, unknown>;
  const cameras = (root.cameras && typeof root.cameras === "object" ? root.cameras : root) as Record<string, unknown>;
  const reserved = new Set(["cpu_usages","gpu_usages","service","detectors","detection_fps","processes","bandwidth_usages","version"]);
  const out: string[] = [];
  for (const [name, val] of Object.entries(cameras)) {
    if (reserved.has(name)) continue;
    if (!val || typeof val !== "object") continue;
    const c = val as Record<string, unknown>;
    if ("camera_fps" in c || "process_fps" in c || "detection_fps" in c || "pid" in c) out.push(name);
  }
  return out;
}
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
  const { isAdmin, activeOrg } = useAuth();
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [viewers, setViewers] = useState<{ list: ViewerProfile[] }>({ list: [] });
  const [positiveTags, setPositiveTags] = useState<{ created_by: string | null; created_at: string }[]>([]);
  const [resetting, setResetting] = useState(false);
  const [statsResetAt, setStatsResetAt] = useState<number>(() => {
    const v = localStorage.getItem("overview.statsResetAt");
    return v ? Number(v) : 0;
  });


  // Total unique cameras configured across all enabled NVRs (live from Frigate stats).
  // Falls back to media-derived count if no NVRs respond.
  const [nvrCamCount, setNvrCamCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const enabled = store.frigates.filter((f) => f.enabled);
      if (enabled.length === 0) { if (!cancelled) setNvrCamCount(0); return; }
      const results = await Promise.all(enabled.map(async (f) => {
        try {
          const res = await fetch(frigateUrl(f, "/api/stats"));
          if (!res.ok) return [] as string[];
          return parseCameraNames(await res.json()).map((n) => `${f.id}::${n}`);
        } catch { return [] as string[]; }
      }));
      if (cancelled) return;
      const set = new Set<string>();
      for (const arr of results) for (const k of arr) set.add(k);
      setNvrCamCount(set.size);
    };
    void load();
    const t = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, [store.frigates]);

  const mediaCameraCount = useMemo(() => {
    const set = new Set<string>();
    for (const m of store.media) {
      const key = `${m.instance_id ?? "_"}::${m.camera ?? "unknown"}`;
      set.add(key);
    }
    return set.size;
  }, [store.media]);

  const totalCameras = nvrCamCount ?? mediaCameraCount;

  // Load viewer profiles for the ACTIVE org only (non-admin members with a login).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeOrg?.id) { if (!cancelled) setViewers({ list: [] }); return; }
      const { data: members } = await supabase
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", activeOrg.id);
      const memberIds = (members ?? []).map((m) => m.user_id);
      if (memberIds.length === 0) { if (!cancelled) setViewers({ list: [] }); return; }
      const [{ data: roles }, { data: profs }] = await Promise.all([
        supabase.from("user_roles").select("user_id, role").in("user_id", memberIds),
        supabase.from("profiles").select("user_id, username, display_name").in("user_id", memberIds),
      ]);
      const adminIds = new Set((roles ?? []).filter((r) => r.role === "admin" || r.role === "super_admin").map((r) => r.user_id));
      // Also exclude org-level admins
      for (const m of members ?? []) if (m.role === "admin") adminIds.add(m.user_id);
      const viewerProfiles = (profs ?? []).filter((p) => !adminIds.has(p.user_id));
      if (!cancelled) setViewers({ list: viewerProfiles.map((p) => ({ user_id: p.user_id, username: p.username, display_name: p.display_name })) });
    };
    void load();

    const ch = supabase
      .channel("overview_viewers")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "organization_members" }, () => void load())
      .subscribe();
    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, [activeOrg?.id]);

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
  // Load audit log (since reset cutoff, max 30 days) for operator stats — scoped to active org
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeOrg?.id) { if (!cancelled) setAudit([]); return; }
      const thirtyDays = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const since = new Date(Math.max(thirtyDays, statsResetAt)).toISOString();
      const { data } = await supabase
        .from("event_audit_log")
        .select("id, action, actor, ts")
        .eq("organization_id", activeOrg.id)
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
  }, [statsResetAt, activeOrg?.id]);

  // Load "positive incident" media tags (for positive-incident counter per operator)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const thirtyDays = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const since = new Date(Math.max(thirtyDays, statsResetAt)).toISOString();
      const { data } = await supabase
        .from("media_tags")
        .select("created_by, created_at, tag")
        .ilike("tag", "positive%")
        .gte("created_at", since)
        .limit(5000);
      if (!cancelled && data) setPositiveTags(data as { created_by: string | null; created_at: string }[]);
    };
    void load();

    const ch = supabase
      .channel("overview_positive_tags")
      .on("postgres_changes", { event: "*", schema: "public", table: "media_tags" }, () => void load())
      .subscribe();
    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, [statsResetAt]);

  // Operator stats — every viewer login is shown, even with zero activity.
  // Audit rows are matched by the actor name *recorded at the time of the action*,
  // so renaming a user or onboarding a new one never reassigns historical activity.
  const operators = useMemo(() => {
    type Row = { actor: string; total: number; read: number; archived: number; positive: number; other: number; lastTs: number };
    const map = new Map<string, Row>();

    const ensure = (key: string): Row => {
      let row = map.get(key);
      if (!row) {
        row = { actor: key, total: 0, read: 0, archived: 0, positive: 0, other: 0, lastTs: 0 };
        map.set(key, row);
      }
      return row;
    };

    // Seed with all current viewers so operators with 0 actions still appear
    for (const v of viewers.list) {
      ensure(v.display_name || v.username);
    }

    // user_id → current display name (only used to credit positive-incident tags,
    // which are stored by user_id rather than actor name).
    const idToCurrentKey = new Map<string, string>();
    for (const v of viewers.list) {
      idToCurrentKey.set(v.user_id, v.display_name || v.username);
    }

    for (const a of audit) {
      const actor = (a.actor && a.actor.trim()) || "";
      if (!actor) continue;
      const row = ensure(actor);
      row.total += 1;
      if (a.action === "read" || a.action === "mark_read") row.read += 1;
      else if (a.action === "archive" || a.action === "archived") row.archived += 1;
      else row.other += 1;
      const t = new Date(a.ts).getTime();
      row.lastTs = Math.max(row.lastTs, t);
    }

    for (const tag of positiveTags) {
      if (!tag.created_by) continue;
      const key = idToCurrentKey.get(tag.created_by);
      if (!key) continue;
      const row = ensure(key);
      row.positive += 1;
      row.total += 1;
      const t = new Date(tag.created_at).getTime();
      row.lastTs = Math.max(row.lastTs, t);
    }

    return [...map.values()].sort((a, b) => b.total - a.total || a.actor.localeCompare(b.actor));
  }, [audit, viewers, positiveTags]);

  const totalOperators = operators.length;

  // Peak hours — alerts (webhook events) grouped by hour-of-day, last 7 days (respect reset)
  const peakHours = useMemo(() => {
    const cutoff = Math.max(Date.now() - 7 * 24 * 60 * 60 * 1000, statsResetAt);
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${h.toString().padStart(2, "0")}:00`, count: 0 }));
    for (const ev of store.events) {
      if ((ev.label ?? "").toLowerCase() === "car") continue;
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
      if ((ev.label ?? "").toLowerCase() === "car") continue;
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

  const enabledNvrCount = useMemo(() => store.frigates.filter((f) => f.enabled).length, [store.frigates]);

  const alertsInWindow = useMemo(() => {
    const cutoff = Math.max(Date.now() - 30 * 24 * 60 * 60 * 1000, statsResetAt);
    let n = 0;
    for (const ev of store.events) {
      if ((ev.label ?? "").toLowerCase() === "car") continue;
      if (new Date(ev.ts).getTime() < cutoff) continue;
      n += 1;
    }
    return n;
  }, [store.events, statsResetAt]);

  const cards = [
    { label: "Total Cameras", value: totalCameras, hint: "Across all NVRs", icon: Camera, color: "text-primary" },
    { label: "NVRs", value: enabledNvrCount, hint: "Enabled instances", icon: Server, color: "text-accent" },
    { label: "Operators", value: totalOperators, hint: "With portal access", icon: Users, color: "text-success" },
    { label: "Alerts (30d)", value: alertsInWindow, hint: "Excluding cars", icon: Activity, color: "text-primary" },
  ];


  return (
    <DashboardLayout title="Overview" subtitle="Operator activity and alert patterns">
      <div className="flex items-center justify-between gap-4 mb-6">
        <p className="text-sm text-muted-foreground">
          {statsResetAt > 0 ? `Stats since ${new Date(statsResetAt).toLocaleString()}` : "Showing rolling window (last 7–30 days)"}
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {cards.map((c) => (
          <Card key={c.label} className="bg-gradient-card border-border shadow-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{c.label}</div>
                <div className="text-4xl font-semibold mt-2 text-foreground tabular-nums leading-none">{c.value}</div>
                <div className="text-xs text-muted-foreground mt-2">{c.hint}</div>
              </div>
              <div className={`h-10 w-10 rounded-lg bg-secondary grid place-items-center shrink-0 ${c.color}`}>
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
                  <th className="py-2 px-4 font-medium tabular-nums">Positive</th>
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
                    <td className="py-2.5 px-4 tabular-nums text-primary">{op.positive}</td>
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
