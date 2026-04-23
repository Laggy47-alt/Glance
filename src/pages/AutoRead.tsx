import { DashboardLayout } from "@/components/DashboardLayout";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { Plus, Trash2, Filter } from "lucide-react";
import { toast } from "sonner";

const AutoRead = () => {
  const store = useWebhookStore();
  const [pattern, setPattern] = useState("");
  const [sourceId, setSourceId] = useState<string>("__all__");
  const sourceMap = new Map(store.sources.map((s) => [s.id, s]));

  const add = async () => {
    const p = pattern.trim();
    if (!p) return;
    try {
      await store.addRule(p, sourceId === "__all__" ? null : sourceId);
      setPattern("");
      toast.success("Rule added");
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <DashboardLayout title="Auto-Read Rules" subtitle="Topic patterns that auto-acknowledge matching events into the Archive">
      <div className="grid lg:grid-cols-[1fr_360px] gap-4">
        <Card className="bg-gradient-card border-border shadow-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Active Rules</h3>
          </div>
          {store.rules.length === 0 ? (
            <div className="text-sm text-muted-foreground py-12 text-center">No rules yet. Add one to silence noisy topics.</div>
          ) : (
            <ul className="divide-y divide-border">
              {store.rules.map((r) => {
                const src = r.source_id ? sourceMap.get(r.source_id) : null;
                return (
                  <li key={r.id} className="py-3 flex items-center gap-3">
                    <Switch checked={r.enabled} onCheckedChange={(v) => store.toggleRule(r.id, v)} />
                    {src ? (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0" style={{ background: src.color + "22", color: src.color }}>
                        {src.name}
                      </span>
                    ) : (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 bg-secondary text-muted-foreground">All</span>
                    )}
                    <code className="flex-1 text-sm text-accent font-mono">{r.pattern}</code>
                    <span className={`text-[10px] uppercase tracking-wider ${r.enabled ? "text-success" : "text-muted-foreground"}`}>
                      {r.enabled ? "Active" : "Paused"}
                    </span>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => store.removeRule(r.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="bg-gradient-card border-border shadow-card p-5">
            <h3 className="text-sm font-semibold mb-3">Add Rule</h3>
            <div className="space-y-2">
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All sources</SelectItem>
                  {store.sources.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                placeholder="sensors/+/heartbeat"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
                className="bg-secondary border-border font-mono"
              />
              <Button onClick={add} className="w-full bg-gradient-primary text-primary-foreground hover:opacity-90">
                <Plus className="h-4 w-4 mr-2" /> Add Rule
              </Button>
            </div>
          </Card>

          <Card className="bg-secondary/40 border-border p-4 text-xs text-muted-foreground space-y-2">
            <p className="text-foreground font-semibold text-sm">Wildcard syntax</p>
            <p><code className="text-accent">+</code> matches a single topic level</p>
            <p><code className="text-accent">#</code> matches all remaining levels</p>
            <p className="pt-2 text-foreground">Examples:</p>
            <p><code className="text-accent">sensors/+/heartbeat</code></p>
            <p><code className="text-accent">logs/#</code></p>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AutoRead;
