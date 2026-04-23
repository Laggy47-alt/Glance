import { DashboardLayout } from "@/components/DashboardLayout";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { Plus, Trash2, RefreshCw, Server, AlertCircle, CheckCircle2, Terminal, Copy, Eye, EyeOff, Webhook } from "lucide-react";
import { toast } from "sonner";
import type { FrigateInstance } from "@/lib/webhookStore";

const PALETTE = ["#3b82f6", "#06b6d4", "#a855f7", "#22c55e", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6"];

const Frigate = () => {
  const store = useWebhookStore();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FrigateInstance | null>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [secretRevealed, setSecretRevealed] = useState<Record<string, boolean>>({});
  const [polling, setPolling] = useState<Record<string, boolean>>({});

  const reset = () => { setEditing(null); setName(""); setBaseUrl(""); setApiKey(""); setColor(PALETTE[0]); };

  const openNew = () => { reset(); setOpen(true); };
  const openEdit = (f: FrigateInstance) => {
    setEditing(f); setName(f.name); setBaseUrl(f.base_url); setApiKey(f.api_key ?? ""); setColor(f.color); setOpen(true);
  };

  const save = async () => {
    if (!name.trim() || !baseUrl.trim()) { toast.error("Name and base URL are required"); return; }
    if (!/^https?:\/\//i.test(baseUrl.trim())) { toast.error("Base URL must start with http:// or https://"); return; }
    try {
      if (editing) {
        await store.updateFrigate(editing.id, { name: name.trim(), base_url: baseUrl.trim(), api_key: apiKey.trim() || null, color });
        toast.success("Instance updated");
      } else {
        await store.createFrigate({ name: name.trim(), base_url: baseUrl.trim(), api_key: apiKey.trim() || undefined, color });
        toast.success("Frigate instance added");
      }
      setOpen(false); reset();
    } catch (e) { toast.error((e as Error).message); }
  };

  const pollNow = async (id: string) => {
    setPolling((p) => ({ ...p, [id]: true }));
    try {
      const result = await store.pollFrigateNow(id);
      const r = result?.results?.[0];
      if (r?.error) toast.error(`Poll failed: ${r.error}`);
      else toast.success(`Pulled ${r?.events ?? 0} events, ${r?.reviews ?? 0} reviews`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setPolling((p) => ({ ...p, [id]: false })); }
  };

  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success("Copied"); };

  return (
    <DashboardLayout
      title="Frigate NVR"
      subtitle="Connect multiple Frigate instances — events stream in via push and polling"
      actions={
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
          <DialogTrigger asChild>
            <Button onClick={openNew} className="bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-glow">
              <Plus className="h-4 w-4 mr-2" /> Add Frigate
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle>{editing ? "Edit Frigate instance" : "Add Frigate instance"}</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Display name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Home Frigate" className="bg-secondary border-border" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Base URL</Label>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://frigate.mydomain.com" className="bg-secondary border-border font-mono" />
                <p className="text-[10px] text-muted-foreground">Public HTTPS URL. For localhost, expose via Cloudflare Tunnel or ngrok (see below).</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">API key <span className="text-muted-foreground">(optional)</span></Label>
                <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Bearer token if Frigate auth is enabled" className="bg-secondary border-border font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Color</Label>
                <div className="flex gap-2 flex-wrap">
                  {PALETTE.map((c) => (
                    <button key={c} onClick={() => setColor(c)} className="h-7 w-7 rounded-md border-2 transition-all" style={{ background: c, borderColor: color === c ? "hsl(var(--foreground))" : "transparent" }} />
                  ))}
                </div>
              </div>
              <Button onClick={save} className="w-full bg-gradient-primary text-primary-foreground hover:opacity-90">{editing ? "Save changes" : "Add instance"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      }
    >
      <LocalhostHelp />

      {store.frigates.length === 0 ? (
        <Card className="bg-gradient-card border-border shadow-card p-12 text-center mt-4">
          <Server className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-foreground font-medium">No Frigate instances yet</p>
          <p className="text-xs text-muted-foreground mt-1">Add one to start polling events, alerts and snapshots.</p>
        </Card>
      ) : (
        <div className="space-y-3 mt-4">
          {store.frigates.map((f) => {
            const src = store.sources.find((s) => s.id === f.source_id);
            const pushUrl = src ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhook-ingest/${src.slug}` : "";
            const isRevealed = revealed[f.id];
            return (
              <Card key={f.id} className="bg-gradient-card border-border shadow-card p-5">
                <div className="flex items-start gap-4">
                  <div className="h-10 w-10 rounded-md grid place-items-center shrink-0" style={{ background: f.color + "22", color: f.color }}>
                    <Server className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="text-sm font-semibold">{f.name}</h3>
                      <code className="text-xs text-muted-foreground truncate max-w-md">{f.base_url}</code>
                      {f.last_error ? (
                        <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> Error</Badge>
                      ) : f.last_polled_at ? (
                        <Badge variant="secondary" className="gap-1 bg-success/15 text-success border-success/30"><CheckCircle2 className="h-3 w-3" /> Healthy</Badge>
                      ) : (
                        <Badge variant="secondary">Pending</Badge>
                      )}
                      <div className="flex items-center gap-2 ml-auto">
                        <Switch checked={f.enabled} onCheckedChange={(v) => store.updateFrigate(f.id, { enabled: v })} />
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{f.enabled ? "Enabled" : "Disabled"}</span>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-3 text-xs">
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Last poll</Label>
                        <p className="tabular-nums">{f.last_polled_at ? new Date(f.last_polled_at).toLocaleString() : "—"}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Last event</Label>
                        <p className="tabular-nums">{f.last_event_ts ? new Date(f.last_event_ts).toLocaleString() : "—"}</p>
                      </div>
                      <div className="space-y-1 flex items-center gap-2">
                        <Switch checked={f.poll_enabled} onCheckedChange={(v) => store.updateFrigate(f.id, { poll_enabled: v })} />
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Auto-poll (60s)</span>
                      </div>
                    </div>

                    {f.last_error && (
                      <div className="text-xs bg-destructive/10 border border-destructive/30 rounded px-3 py-2 text-destructive font-mono break-all">{f.last_error}</div>
                    )}

                    {src && pushUrl && (
                      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <Webhook className="h-4 w-4 text-primary" />
                          <p className="text-xs font-semibold text-foreground">Webhook for your NVR</p>
                          <Badge variant="secondary" className="ml-auto text-[9px]">Paste into Frigate</Badge>
                        </div>

                        <div>
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Endpoint URL</Label>
                          <div className="flex gap-2 mt-1">
                            <code className="flex-1 text-xs bg-secondary border border-border rounded px-3 py-2 font-mono text-accent break-all">{pushUrl}</code>
                            <Button size="icon" variant="outline" onClick={() => copy(pushUrl)} title="Copy URL"><Copy className="h-4 w-4" /></Button>
                          </div>
                        </div>

                        <div>
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Secret <span className="normal-case text-muted-foreground/70">— send as <code className="text-accent">X-Webhook-Secret</code> header</span>
                          </Label>
                          <div className="flex gap-2 mt-1">
                            <code className="flex-1 text-xs bg-secondary border border-border rounded px-3 py-2 font-mono break-all">
                              {secretRevealed[f.id] ? src.secret : "•".repeat(32)}
                            </code>
                            <Button size="icon" variant="outline" onClick={() => setSecretRevealed((r) => ({ ...r, [f.id]: !r[f.id] }))} title={secretRevealed[f.id] ? "Hide" : "Reveal"}>
                              {secretRevealed[f.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                            <Button size="icon" variant="outline" onClick={() => copy(src.secret)} title="Copy secret"><Copy className="h-4 w-4" /></Button>
                          </div>
                        </div>

                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">frigate-notify config snippet</summary>
                          <div className="flex gap-2 mt-2 items-start">
                            <pre className="flex-1 bg-background/60 border border-border rounded p-3 font-mono text-[11px] overflow-auto whitespace-pre">{`webhook:
  enabled: true
  server: "${pushUrl}"
  method: POST
  headers:
    Content-Type: "application/json"
    X-Webhook-Secret: "${src.secret}"
  template: |
    {
      "event_id": "{{ .ID }}",
      "camera": "{{ .Camera }}",
      "label": "{{ .Label }}",
      "score": {{ .TopScore }},
      "severity": "event",
      "snapshot_url": "{{ .SnapshotURL }}",
      "clip_url": "{{ .ClipURL }}"
    }`}</pre>
                            <Button size="icon" variant="outline" onClick={() => copy(`webhook:
  enabled: true
  server: "${pushUrl}"
  method: POST
  headers:
    Content-Type: "application/json"
    X-Webhook-Secret: "${src.secret}"
  template: |
    {
      "event_id": "{{ .ID }}",
      "camera": "{{ .Camera }}",
      "label": "{{ .Label }}",
      "score": {{ .TopScore }},
      "severity": "event",
      "snapshot_url": "{{ .SnapshotURL }}",
      "clip_url": "{{ .ClipURL }}"
    }`)} title="Copy snippet"><Copy className="h-4 w-4" /></Button>
                          </div>
                        </details>

                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">curl test</summary>
                          <pre className="bg-background/60 border border-border rounded p-3 mt-2 font-mono text-[11px] overflow-auto">{`curl -X POST '${pushUrl}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Webhook-Secret: ${src.secret}' \\
  -d '{"event_id":"test-1","camera":"front_door","label":"person","score":0.9}'`}</pre>
                        </details>

                        <p className="text-[10px] text-muted-foreground">
                          Your NVR has internet access — paste the endpoint and secret directly into <code className="text-accent">frigate-notify</code> or any HTTP notifier. No tunnel needed for push (only required if you also want polling/media proxy).
                        </p>
                      </div>
                    )}

                    {f.api_key !== null && (
                      <div>
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">API key</Label>
                        <div className="flex gap-2 mt-1">
                          <code className="flex-1 text-xs bg-secondary border border-border rounded px-3 py-2 font-mono break-all">
                            {isRevealed ? f.api_key : "•".repeat(Math.min(32, (f.api_key ?? "").length || 0)) || "—"}
                          </code>
                          {f.api_key && (
                            <Button size="icon" variant="outline" onClick={() => setRevealed((r) => ({ ...r, [f.id]: !r[f.id] }))}>
                              {isRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end gap-2 flex-wrap">
                      <Button variant="outline" size="sm" onClick={() => pollNow(f.id)} disabled={polling[f.id]}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${polling[f.id] ? "animate-spin" : ""}`} /> Poll now
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEdit(f)}>Edit</Button>
                      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={async () => {
                        if (!confirm(`Delete "${f.name}"? Its paired webhook source, events and media will be removed.`)) return;
                        try { await store.deleteFrigate(f.id); toast.success("Removed"); }
                        catch (e) { toast.error((e as Error).message); }
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

const LocalhostHelp = () => {
  const [openHelp, setOpenHelp] = useState(false);
  return (
    <Card className="bg-gradient-card border-border shadow-card p-4">
      <button onClick={() => setOpenHelp((o) => !o)} className="w-full flex items-center gap-3 text-left">
        <Terminal className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <p className="text-sm font-semibold">Connecting localhost Frigate to Lovable</p>
          <p className="text-xs text-muted-foreground">Frigate runs on your LAN — give it a public HTTPS URL with a tunnel.</p>
        </div>
        <span className="text-xs text-muted-foreground">{openHelp ? "Hide" : "Show"}</span>
      </button>
      {openHelp && (
        <div className="mt-4 grid md:grid-cols-2 gap-3 text-xs">
          <div className="bg-secondary/50 border border-border rounded p-3 space-y-2">
            <p className="font-semibold text-foreground flex items-center gap-2">Cloudflare Tunnel <Badge variant="secondary" className="text-[9px]">recommended</Badge></p>
            <pre className="font-mono text-[11px] bg-background/60 border border-border rounded p-2 overflow-auto whitespace-pre">{`# 1. Install cloudflared
brew install cloudflared   # macOS
# or: https://pkg.cloudflare.com

# 2. Login + create a tunnel
cloudflared tunnel login
cloudflared tunnel create frigate
cloudflared tunnel route dns frigate frigate.your-domain.com

# 3. Run it pointing at Frigate
cloudflared tunnel --url http://localhost:5000 run frigate`}</pre>
            <p className="text-muted-foreground">Paste <code className="text-accent">https://frigate.your-domain.com</code> as the Base URL above.</p>
          </div>
          <div className="bg-secondary/50 border border-border rounded p-3 space-y-2">
            <p className="font-semibold text-foreground">ngrok (quick test)</p>
            <pre className="font-mono text-[11px] bg-background/60 border border-border rounded p-2 overflow-auto whitespace-pre">{`# 1. Install + auth
brew install ngrok
ngrok config add-authtoken <YOUR_TOKEN>

# 2. Start a tunnel to Frigate's port
ngrok http 5000`}</pre>
            <p className="text-muted-foreground">Copy the <code className="text-accent">https://xxxx.ngrok-free.app</code> URL into Base URL above.</p>
          </div>
          <div className="md:col-span-2 bg-secondary/50 border border-border rounded p-3 space-y-2">
            <p className="font-semibold text-foreground">Notes</p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>If your Frigate has auth enabled, paste the bearer token in the API key field — it's used for both polling and the media proxy.</li>
              <li>The dashboard polls <code className="text-accent">/api/events</code> and <code className="text-accent">/api/review</code> every minute. Use <strong>Poll now</strong> to test immediately.</li>
              <li>For realtime push, configure Frigate's HTTP notifier (or an MQTT→HTTP bridge like Node-RED) to POST to the push endpoint shown on each instance.</li>
              <li>Snapshots and clips load through a signed proxy so your tunnel URL never appears in the browser directly.</li>
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
};

export default Frigate;
