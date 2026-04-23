import { DashboardLayout } from "@/components/DashboardLayout";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMemo, useState } from "react";
import { Check, CheckCheck, Trash2 } from "lucide-react";

const Messages = () => {
  const store = useWebhookStore();
  const [filter, setFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const sourceMap = new Map(store.sources.map((s) => [s.id, s]));

  const visible = useMemo(
    () =>
      store.events
        .filter((m) => !m.archived)
        .filter((m) => sourceFilter === "all" || m.source_id === sourceFilter)
        .filter((m) => {
          if (!filter) return true;
          const f = filter.toLowerCase();
          return m.topic.toLowerCase().includes(f) || JSON.stringify(m.payload).toLowerCase().includes(f);
        }),
    [store.events, filter, sourceFilter]
  );

  const renderPayload = (p: unknown) => {
    if (typeof p === "string") return p;
    return JSON.stringify(p);
  };

  return (
    <DashboardLayout
      title="Messages"
      subtitle="Live webhook event stream"
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => store.markAllRead()}>
            <CheckCheck className="h-4 w-4 mr-2" /> Mark all read
          </Button>
          <Button variant="outline" size="sm" onClick={() => store.clearEvents()}>
            <Trash2 className="h-4 w-4 mr-2" /> Clear
          </Button>
        </>
      }
    >
      <Card className="bg-gradient-card border-border shadow-card p-4 flex flex-col min-h-[60vh]">
        <div className="flex flex-wrap gap-2 mb-3">
          <Input placeholder="Filter by topic or payload…" value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-secondary border-border flex-1 min-w-[200px]" />
          <div className="flex bg-secondary/50 rounded-md p-1 border border-border">
            <button onClick={() => setSourceFilter("all")} className={`px-3 py-1 text-xs rounded ${sourceFilter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              All
            </button>
            {store.sources.map((s) => (
              <button key={s.id} onClick={() => setSourceFilter(s.id)} className={`px-3 py-1 text-xs rounded ${sourceFilter === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {s.name}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-auto -mx-4 px-4">
          {visible.length === 0 ? (
            <div className="text-sm text-muted-foreground py-12 text-center">No messages.</div>
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((m) => {
                const src = sourceMap.get(m.source_id);
                return (
                  <li key={m.id} className="py-3 flex items-start gap-3">
                    <button
                      onClick={() => store.markRead(m.id, !m.read)}
                      className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 transition ${m.read ? "bg-muted-foreground" : "bg-primary shadow-glow"}`}
                      title={m.read ? "Mark unread" : "Mark read"}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        {src && (
                          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0" style={{ background: src.color + "22", color: src.color }}>
                            {src.name}
                          </span>
                        )}
                        <code className="text-xs text-accent font-medium truncate">{m.topic}</code>
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 ml-auto">{new Date(m.ts).toLocaleTimeString()}</span>
                      </div>
                      <div className="text-sm text-foreground/90 break-all font-mono line-clamp-3">{renderPayload(m.payload)}</div>
                    </div>
                    {!m.read && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => store.markRead(m.id, true)}>
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>
    </DashboardLayout>
  );
};

export default Messages;
