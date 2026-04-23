import { DashboardLayout } from "@/components/DashboardLayout";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Card } from "@/components/ui/card";
import { Activity, Inbox, Filter, Archive, Plug } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const Overview = () => {
  const store = useWebhookStore();

  const stats = useMemo(() => {
    const total = store.events.length;
    const unread = store.events.filter((m) => !m.read && !m.archived).length;
    const archived = store.events.filter((m) => m.archived).length;
    const last60s = store.events.filter((m) => Date.now() - new Date(m.ts).getTime() < 60_000).length;
    return { total, unread, archived, last60s };
  }, [store.events]);

  const topTopics = useMemo(() => {
    const map = new Map<string, number>();
    store.events.forEach((m) => map.set(m.topic, (map.get(m.topic) || 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [store.events]);

  const recent = store.events.slice(0, 8);
  const sourceMap = new Map(store.sources.map((s) => [s.id, s]));

  const cards = [
    { label: "Total Events", value: stats.total, icon: Inbox, color: "text-primary" },
    { label: "Unread", value: stats.unread, icon: Activity, color: "text-warning" },
    { label: "Auto-Archived", value: stats.archived, icon: Archive, color: "text-success" },
    { label: "Last 60s", value: stats.last60s, icon: Filter, color: "text-accent" },
  ];

  return (
    <DashboardLayout title="Overview" subtitle="Live webhook activity at a glance">
      {store.sources.length === 0 && (
        <Card className="bg-gradient-card border-border shadow-card p-6 mb-6 flex items-center gap-4">
          <div className="h-10 w-10 rounded-md bg-primary/15 grid place-items-center text-primary"><Plug className="h-5 w-5" /></div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">No webhook sources yet</p>
            <p className="text-xs text-muted-foreground">Create your first source to receive events from external services.</p>
          </div>
          <Button asChild className="bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-glow">
            <Link to="/sources">Add Source</Link>
          </Button>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 bg-gradient-card border-border shadow-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Recent Events</h3>
          {recent.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">No events yet.</div>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((m) => {
                const src = sourceMap.get(m.source_id);
                return (
                  <li key={m.id} className="py-2.5 flex items-center gap-3 text-sm">
                    <div className={`h-2 w-2 rounded-full shrink-0 ${m.archived ? "bg-success" : m.read ? "bg-muted-foreground" : "bg-primary"}`} />
                    {src && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0" style={{ background: src.color + "22", color: src.color }}>
                        {src.name}
                      </span>
                    )}
                    <code className="text-xs text-accent truncate flex-1">{m.topic}</code>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{new Date(m.ts).toLocaleTimeString()}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="bg-gradient-card border-border shadow-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Top Topics</h3>
          {topTopics.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">—</div>
          ) : (
            <ul className="space-y-3">
              {topTopics.map(([topic, count]) => {
                const max = topTopics[0][1];
                const pct = (count / max) * 100;
                return (
                  <li key={topic}>
                    <div className="flex justify-between text-xs mb-1">
                      <code className="text-accent truncate">{topic}</code>
                      <span className="text-muted-foreground tabular-nums">{count}</span>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default Overview;
