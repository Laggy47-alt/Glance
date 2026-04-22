import { DashboardLayout } from "@/components/DashboardLayout";
import { useMqttStore } from "@/hooks/useMqttStore";
import { Card } from "@/components/ui/card";
import { Activity, Inbox, Filter, Archive } from "lucide-react";
import { useMemo } from "react";

const Overview = () => {
  const store = useMqttStore();

  const stats = useMemo(() => {
    const total = store.messages.length;
    const unread = store.messages.filter((m) => !m.read && !m.archived).length;
    const archived = store.messages.filter((m) => m.archived).length;
    const last60s = store.messages.filter((m) => Date.now() - m.ts < 60_000).length;
    return { total, unread, archived, last60s };
  }, [store.messages]);

  const topTopics = useMemo(() => {
    const map = new Map<string, number>();
    store.messages.forEach((m) => map.set(m.topic, (map.get(m.topic) || 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [store.messages]);

  const recent = [...store.messages].slice(-8).reverse();

  const cards = [
    { label: "Total Messages", value: stats.total, icon: Inbox, color: "text-primary" },
    { label: "Unread", value: stats.unread, icon: Activity, color: "text-warning" },
    { label: "Auto-Archived", value: stats.archived, icon: Archive, color: "text-success" },
    { label: "Last 60s", value: stats.last60s, icon: Filter, color: "text-accent" },
  ];

  return (
    <DashboardLayout title="Overview" subtitle="Live broker activity at a glance">
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
          <h3 className="text-sm font-semibold text-foreground mb-4">Recent Messages</h3>
          {recent.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">No messages yet. Connect to your broker or enable demo mode in Settings.</div>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((m) => (
                <li key={m.id} className="py-2.5 flex items-center gap-3 text-sm">
                  <div className={`h-2 w-2 rounded-full shrink-0 ${m.archived ? "bg-success" : m.read ? "bg-muted-foreground" : "bg-primary"}`} />
                  <code className="text-xs text-accent truncate flex-1">{m.topic}</code>
                  <span className="text-muted-foreground truncate max-w-[160px]">{m.payload}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{new Date(m.ts).toLocaleTimeString()}</span>
                </li>
              ))}
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
