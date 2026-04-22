import { DashboardLayout } from "@/components/DashboardLayout";
import { useMqttStore } from "@/hooks/useMqttStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";
import { Plus, Trash2, Filter } from "lucide-react";
import { toast } from "sonner";

const AutoRead = () => {
  const store = useMqttStore();
  const [pattern, setPattern] = useState("");

  const add = () => {
    const p = pattern.trim();
    if (!p) return;
    store.setRules([...store.rules, { id: crypto.randomUUID(), pattern: p, enabled: true }]);
    setPattern("");
    toast.success("Rule added");
  };

  const toggle = (id: string, enabled: boolean) => {
    store.setRules(store.rules.map((r) => (r.id === id ? { ...r, enabled } : r)));
  };

  const remove = (id: string) => store.setRules(store.rules.filter((r) => r.id !== id));

  return (
    <DashboardLayout title="Auto-Read Rules" subtitle="Topic patterns that get auto-acknowledged and routed to the Archive">
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
              {store.rules.map((r) => (
                <li key={r.id} className="py-3 flex items-center gap-3">
                  <Switch checked={r.enabled} onCheckedChange={(v) => toggle(r.id, v)} />
                  <code className="flex-1 text-sm text-accent font-mono">{r.pattern}</code>
                  <span className={`text-[10px] uppercase tracking-wider ${r.enabled ? "text-success" : "text-muted-foreground"}`}>
                    {r.enabled ? "Active" : "Paused"}
                  </span>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => remove(r.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="bg-gradient-card border-border shadow-card p-5">
            <h3 className="text-sm font-semibold mb-3">Add Rule</h3>
            <div className="space-y-2">
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
