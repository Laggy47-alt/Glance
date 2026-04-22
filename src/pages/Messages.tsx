import { DashboardLayout } from "@/components/DashboardLayout";
import { useMqttStore } from "@/hooks/useMqttStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useMemo, useState } from "react";
import { Check, CheckCheck, Send, Trash2, Plus, X } from "lucide-react";
import { toast } from "sonner";

const Messages = () => {
  const store = useMqttStore();
  const [filter, setFilter] = useState("");
  const [pubTopic, setPubTopic] = useState("test/hello");
  const [pubPayload, setPubPayload] = useState("hello world");
  const [newSub, setNewSub] = useState("");

  const visible = useMemo(
    () =>
      store.messages
        .filter((m) => !m.archived)
        .filter((m) => !filter || m.topic.includes(filter) || m.payload.includes(filter))
        .slice()
        .reverse(),
    [store.messages, filter]
  );

  const addSub = () => {
    const t = newSub.trim();
    if (!t) return;
    if (store.subscriptions.includes(t)) return;
    store.setSubscriptions([...store.subscriptions, t]);
    setNewSub("");
  };

  const removeSub = (t: string) => store.setSubscriptions(store.subscriptions.filter((s) => s !== t));

  const publish = () => {
    if (!pubTopic.trim()) return;
    store.publish(pubTopic.trim(), pubPayload);
    toast.success(`Published to ${pubTopic}`);
  };

  return (
    <DashboardLayout
      title="Messages"
      subtitle="Live MQTT message stream"
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => store.markAllRead()}>
            <CheckCheck className="h-4 w-4 mr-2" /> Mark all read
          </Button>
          <Button variant="outline" size="sm" onClick={() => store.clearMessages()}>
            <Trash2 className="h-4 w-4 mr-2" /> Clear
          </Button>
        </>
      }
    >
      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <Card className="bg-gradient-card border-border shadow-card p-4 flex flex-col min-h-[60vh]">
          <div className="flex gap-2 mb-3">
            <Input placeholder="Filter by topic or payload…" value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-secondary border-border" />
          </div>
          <div className="flex-1 overflow-auto -mx-4 px-4">
            {visible.length === 0 ? (
              <div className="text-sm text-muted-foreground py-12 text-center">No messages.</div>
            ) : (
              <ul className="divide-y divide-border">
                {visible.map((m) => (
                  <li key={m.id} className="py-3 flex items-start gap-3">
                    <button
                      onClick={() => store.markRead(m.id, !m.read)}
                      className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 transition ${m.read ? "bg-muted-foreground" : "bg-primary shadow-glow"}`}
                      title={m.read ? "Mark unread" : "Mark read"}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <code className="text-xs text-accent font-medium truncate">{m.topic}</code>
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{new Date(m.ts).toLocaleTimeString()}</span>
                      </div>
                      <div className="text-sm text-foreground/90 break-all font-mono">{m.payload}</div>
                    </div>
                    {!m.read && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => store.markRead(m.id, true)}>
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="bg-gradient-card border-border shadow-card p-4">
            <h3 className="text-sm font-semibold mb-3">Subscriptions</h3>
            <div className="flex gap-2 mb-3">
              <Input placeholder="topic/+/wildcard" value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSub()} className="bg-secondary border-border" />
              <Button size="icon" onClick={addSub} className="bg-primary text-primary-foreground hover:bg-primary/90"><Plus className="h-4 w-4" /></Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {store.subscriptions.map((s) => (
                <Badge key={s} variant="secondary" className="bg-secondary text-secondary-foreground gap-1.5 pr-1">
                  <code className="text-xs">{s}</code>
                  <button onClick={() => removeSub(s)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                </Badge>
              ))}
              {store.subscriptions.length === 0 && <span className="text-xs text-muted-foreground">No subscriptions.</span>}
            </div>
          </Card>

          <Card className="bg-gradient-card border-border shadow-card p-4">
            <h3 className="text-sm font-semibold mb-3">Publish</h3>
            <div className="space-y-2">
              <Input placeholder="topic" value={pubTopic} onChange={(e) => setPubTopic(e.target.value)} className="bg-secondary border-border" />
              <Input placeholder="payload" value={pubPayload} onChange={(e) => setPubPayload(e.target.value)} className="bg-secondary border-border font-mono" />
              <Button onClick={publish} className="w-full bg-gradient-primary text-primary-foreground hover:opacity-90">
                <Send className="h-4 w-4 mr-2" /> Publish
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Messages;
