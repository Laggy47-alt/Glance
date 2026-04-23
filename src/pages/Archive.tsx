import { DashboardLayout } from "@/components/DashboardLayout";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";

const Archive = () => {
  const store = useWebhookStore();
  const [filter, setFilter] = useState("");
  const sourceMap = new Map(store.sources.map((s) => [s.id, s]));

  const archived = useMemo(
    () =>
      store.events
        .filter((m) => m.archived)
        .filter((m) => {
          if (!filter) return true;
          const f = filter.toLowerCase();
          return m.topic.toLowerCase().includes(f) || JSON.stringify(m.payload).toLowerCase().includes(f);
        }),
    [store.events, filter]
  );

  return (
    <DashboardLayout
      title="Archive"
      subtitle={`${archived.length} auto-read events`}
      actions={
        <Button variant="outline" size="sm" onClick={() => store.clearEvents()}>
          <Trash2 className="h-4 w-4 mr-2" /> Clear all
        </Button>
      }
    >
      <Card className="bg-gradient-card border-border shadow-card p-4">
        <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-secondary border-border mb-3" />
        {archived.length === 0 ? (
          <div className="text-sm text-muted-foreground py-12 text-center">Nothing archived. Events matching auto-read rules will appear here.</div>
        ) : (
          <ul className="divide-y divide-border">
            {archived.map((m) => {
              const src = sourceMap.get(m.source_id);
              return (
                <li key={m.id} className="py-2.5 flex items-center gap-3 text-sm">
                  <div className="h-2 w-2 rounded-full bg-success shrink-0" />
                  {src && (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0" style={{ background: src.color + "22", color: src.color }}>
                      {src.name}
                    </span>
                  )}
                  <code className="text-xs text-accent font-mono truncate flex-1">{m.topic}</code>
                  <span className="text-muted-foreground font-mono truncate max-w-[200px] text-xs">{typeof m.payload === "string" ? m.payload : JSON.stringify(m.payload)}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{new Date(m.ts).toLocaleString()}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </DashboardLayout>
  );
};

export default Archive;
