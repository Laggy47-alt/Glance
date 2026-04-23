import { DashboardLayout } from "@/components/DashboardLayout";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { webhookUrl } from "@/lib/webhookStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";
import { Plus, Trash2, Copy, RefreshCw, Eye, EyeOff, Plug } from "lucide-react";
import { toast } from "sonner";

const PALETTE = ["#06b6d4", "#a855f7", "#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#14b8a6"];

const Sources = () => {
  const store = useWebhookStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const create = async () => {
    if (!name.trim() || !slug.trim()) return;
    try {
      await store.createSource({ name: name.trim(), slug: slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"), color });
      toast.success("Source created");
      setName(""); setSlug(""); setColor(PALETTE[0]); setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success("Copied"); };

  return (
    <DashboardLayout
      title="Webhook Sources"
      subtitle="Each source gets its own URL and secret — point any service at it"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-glow">
              <Plus className="h-4 w-4 mr-2" /> New Source
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle>Create webhook source</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Display name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Front Door Camera" className="bg-secondary border-border" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">URL slug</Label>
                <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="frontdoor-cam" className="bg-secondary border-border font-mono" />
                <p className="text-[10px] text-muted-foreground">Lowercase letters, numbers, dashes only</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Color</Label>
                <div className="flex gap-2 flex-wrap">
                  {PALETTE.map((c) => (
                    <button key={c} onClick={() => setColor(c)} className="h-7 w-7 rounded-md border-2 transition-all" style={{ background: c, borderColor: color === c ? "hsl(var(--foreground))" : "transparent" }} />
                  ))}
                </div>
              </div>
              <Button onClick={create} className="w-full bg-gradient-primary text-primary-foreground hover:opacity-90">Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      }
    >
      {store.sources.length === 0 ? (
        <Card className="bg-gradient-card border-border shadow-card p-12 text-center">
          <Plug className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-foreground font-medium">No sources yet</p>
          <p className="text-xs text-muted-foreground mt-1">Create one to get a public webhook URL.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {store.sources.map((s) => {
            const url = webhookUrl(s.slug);
            const isRevealed = revealed[s.id];
            return (
              <Card key={s.id} className="bg-gradient-card border-border shadow-card p-5">
                <div className="flex items-start gap-4">
                  <div className="h-10 w-10 rounded-md grid place-items-center shrink-0" style={{ background: s.color + "22", color: s.color }}>
                    <Plug className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="text-sm font-semibold">{s.name}</h3>
                      <code className="text-xs text-muted-foreground">/{s.slug}</code>
                      <div className="flex items-center gap-2 ml-auto">
                        <Switch checked={s.enabled} onCheckedChange={(v) => store.updateSource(s.id, { enabled: v })} />
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.enabled ? "Enabled" : "Disabled"}</span>
                      </div>
                    </div>

                    <div>
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Webhook URL</Label>
                      <div className="flex gap-2 mt-1">
                        <code className="flex-1 text-xs bg-secondary border border-border rounded px-3 py-2 font-mono text-accent break-all">{url}</code>
                        <Button size="icon" variant="outline" onClick={() => copy(url)}><Copy className="h-4 w-4" /></Button>
                      </div>
                    </div>

                    <div>
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Secret (send as <code className="text-accent">X-Webhook-Secret</code> header)</Label>
                      <div className="flex gap-2 mt-1">
                        <code className="flex-1 text-xs bg-secondary border border-border rounded px-3 py-2 font-mono break-all">
                          {isRevealed ? s.secret : "•".repeat(32)}
                        </code>
                        <Button size="icon" variant="outline" onClick={() => setRevealed((r) => ({ ...r, [s.id]: !r[s.id] }))}>
                          {isRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                        <Button size="icon" variant="outline" onClick={() => copy(s.secret)}><Copy className="h-4 w-4" /></Button>
                        <Button size="icon" variant="outline" onClick={async () => { await store.rotateSecret(s.id); toast.success("Secret rotated"); }}><RefreshCw className="h-4 w-4" /></Button>
                      </div>
                    </div>

                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Example curl</summary>
                      <pre className="bg-background/60 border border-border rounded p-3 mt-2 font-mono text-[11px] overflow-auto">{`curl -X POST '${url}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Webhook-Secret: ${s.secret}' \\
  -d '{"topic":"cameras/${s.slug}/motion","snapshot_url":"https://picsum.photos/640/360"}'`}</pre>
                    </details>

                    <div className="flex justify-end">
                      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={async () => {
                        if (!confirm(`Delete "${s.name}"? All its events and media will be removed.`)) return;
                        await store.deleteSource(s.id);
                        toast.success("Source deleted");
                      }}>
                        <Trash2 className="h-4 w-4 mr-2" /> Delete
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </DashboardLayout>
  );
};

export default Sources;
