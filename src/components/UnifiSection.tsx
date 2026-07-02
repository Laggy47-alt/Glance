import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus, Trash2, Server, AlertCircle, CheckCircle2,
  Copy, Eye, EyeOff, Webhook, WifiOff, ChevronDown, Wifi, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import type { UnifiInstance } from "@/lib/webhookStore";
import { UnifiAlertScheduleDialog } from "@/components/UnifiAlertScheduleDialog";

const PALETTE = ["#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#f59e0b", "#ef4444", "#14b8a6"];
const HEALTHY_WINDOW_MS = 5 * 60 * 1000;

function hostFromBaseUrl(raw: string) {
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withScheme).host;
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "") || "10.0.0.1";
  }
}

export function UnifiSection() {
  const store = useWebhookStore();
  const [open, setOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editing, setEditing] = useState<UnifiInstance | null>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [verifyTls, setVerifyTls] = useState(false);
  const [color, setColor] = useState(PALETTE[0]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [secretRevealed, setSecretRevealed] = useState<Record<string, boolean>>({});

  const reset = () => {
    setEditing(null);
    setName(""); setBaseUrl(""); setVerifyTls(false); setColor(PALETTE[0]);
  };
  const openNew = () => { reset(); setOpen(true); };
  const openEdit = (u: UnifiInstance) => {
    setEditing(u);
    setName(u.name); setBaseUrl(u.base_url); setVerifyTls(u.verify_tls); setColor(u.color);
    setOpen(true);
  };

  const save = async () => {
    if (!name.trim() || !baseUrl.trim()) { toast.error("Name and base URL are required"); return; }
    try {
      if (editing) {
        await store.updateUnifi(editing.id, {
          name: name.trim(),
          base_url: baseUrl.trim(),
          verify_tls: verifyTls,
          color,
        });
        toast.success("UniFi NVR updated");
      } else {
        await store.createUnifi({
          name: name.trim(),
          base_url: baseUrl.trim(),
          verify_tls: verifyTls,
          color,
        });
        toast.success("UniFi ENVR added");
      }
      await store.refreshAll();
      setOpen(false); reset();
    } catch (e) { toast.error((e as Error).message); }
  };

  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success("Copied"); };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md grid place-items-center bg-success/15 text-success">
            <Wifi className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">UniFi Protect ENVRs</h2>
            <p className="text-[11px] text-muted-foreground">Local WebSocket bridge pushes motion / smart-detect events.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setScheduleOpen(true)}>
            <Clock className="h-3.5 w-3.5" /> Alert schedule
          </Button>
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
          <DialogTrigger asChild>
            <Button onClick={openNew} size="sm" variant="outline" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add UniFi
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit UniFi ENVR" : "Add UniFi ENVR"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Display name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Site A UDM Pro" className="bg-secondary border-border" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Base URL (informational)</Label>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://10.0.0.1" className="bg-secondary border-border font-mono" />
                <p className="text-[10px] text-muted-foreground">
                  Stored for reference. The bridge on the on-site machine talks to the ENVR directly — Glance never connects to it.
                </p>
              </div>
              <div className="rounded-md border border-border bg-secondary/40 px-3 py-2.5 flex items-start gap-3">
                <Switch checked={verifyTls} onCheckedChange={setVerifyTls} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">Verify TLS certificate</p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    UniFi consoles ship with a self-signed cert — leave off unless you've installed a trusted cert.
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Color</Label>
                <div className="flex gap-2 flex-wrap">
                  {PALETTE.map((c) => (
                    <button key={c} type="button" onClick={() => setColor(c)} className="h-7 w-7 rounded-md border-2 transition-all" style={{ background: c, borderColor: color === c ? "hsl(var(--foreground))" : "transparent" }} />
                  ))}
                </div>
              </div>
              <Button onClick={save} className="w-full bg-gradient-primary text-primary-foreground hover:opacity-90">
                {editing ? "Save changes" : "Add ENVR"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {store.unifis.length === 0 ? (
        <Card className="bg-gradient-card border-border shadow-card p-8 text-center">
          <Server className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-foreground font-medium">No UniFi ENVRs yet</p>
          <p className="text-xs text-muted-foreground mt-1">Add one, then point the on-site bridge at its instance ID + webhook secret.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {store.unifis.map((u) => {
            const isOpen = !!expanded[u.id];
            const lastSeen = u.last_seen_at ? new Date(u.last_seen_at).getTime() : 0;
            const healthy = lastSeen && (Date.now() - lastSeen) < HEALTHY_WINDOW_MS;
            const bridgeConfig = JSON.stringify({
              id: u.id,
              host: hostFromBaseUrl(u.base_url),
              username: "glance",
              password: "CHANGE_ME",
              totp_secret: "BASE32_TOTP_SECRET_IF_MFA_ENABLED",
              webhook_secret: u.webhook_secret,
              verify_tls: u.verify_tls,
            }, null, 2);
            return (
              <Card key={u.id} id={u.id} className="bg-gradient-card border-border shadow-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded((e) => ({ ...e, [u.id]: !e[u.id] }))}
                  className="w-full flex items-center gap-4 text-left p-4 hover:bg-secondary/30 transition-colors"
                >
                  <div className="h-10 w-10 rounded-md grid place-items-center shrink-0" style={{ background: u.color + "22", color: u.color }}>
                    <Wifi className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
                    <h3 className="text-sm font-semibold">{u.name}</h3>
                    <code className="text-xs text-muted-foreground truncate max-w-md">{u.base_url}</code>
                    <Badge variant="secondary" className="gap-1 bg-success/15 text-success border-success/30">UniFi</Badge>
                    {u.last_error ? (
                      <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> {u.last_error}</Badge>
                    ) : healthy ? (
                      <Badge variant="secondary" className="gap-1 bg-success/15 text-success border-success/30"><CheckCircle2 className="h-3 w-3" /> Bridge online</Badge>
                    ) : lastSeen ? (
                      <Badge variant="destructive" className="gap-1"><WifiOff className="h-3 w-3" /> Bridge silent</Badge>
                    ) : (
                      <Badge variant="secondary">Awaiting bridge</Badge>
                    )}
                    <div className="flex items-center gap-2 ml-auto" onClick={(e) => e.stopPropagation()} role="presentation">
                      <Switch checked={u.enabled} onCheckedChange={(v) => store.updateUnifi(u.id, { enabled: v })} />
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{u.enabled ? "Enabled" : "Disabled"}</span>
                      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform ml-1", isOpen && "rotate-180")} />
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="flex items-start gap-4 px-5 pb-5">
                    <div className="h-10 w-10 shrink-0" />
                    <div className="flex-1 min-w-0 space-y-3">

                      <div className="grid sm:grid-cols-2 gap-3 text-xs">
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Last bridge contact</Label>
                          <p className="tabular-nums">{u.last_seen_at ? new Date(u.last_seen_at).toLocaleString() : "—"}</p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Last event</Label>
                          <p className="tabular-nums">{u.last_event_ts ? new Date(u.last_event_ts).toLocaleString() : "—"}</p>
                        </div>
                      </div>

                      {/* Bridge config panel */}
                      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <Webhook className="h-4 w-4 text-primary" />
                          <p className="text-xs font-semibold text-foreground">On-site bridge configuration</p>
                          <Badge variant="secondary" className="ml-auto text-[9px]">Paste into bridge instances.json</Badge>
                        </div>

                        <div>
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Instance ID</Label>
                          <div className="flex gap-2 mt-1">
                            <code className="flex-1 text-xs bg-secondary border border-border rounded px-3 py-2 font-mono text-accent break-all">{u.id}</code>
                            <Button size="icon" variant="outline" onClick={() => copy(u.id)} title="Copy ID"><Copy className="h-4 w-4" /></Button>
                          </div>
                        </div>

                        <div>
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Webhook secret</Label>
                          <div className="flex gap-2 mt-1">
                            <code className="flex-1 text-xs bg-secondary border border-border rounded px-3 py-2 font-mono break-all">
                              {secretRevealed[u.id] ? u.webhook_secret : "•".repeat(32)}
                            </code>
                            <Button size="icon" variant="outline" onClick={() => setSecretRevealed((r) => ({ ...r, [u.id]: !r[u.id] }))} title={secretRevealed[u.id] ? "Hide" : "Reveal"}>
                              {secretRevealed[u.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                            <Button size="icon" variant="outline" onClick={() => copy(u.webhook_secret)} title="Copy secret"><Copy className="h-4 w-4" /></Button>
                          </div>
                        </div>

                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          Install <code>scripts/unifi-bridge</code> on a machine with LAN access to the ENVR.
                          Add a block with this <strong>Instance ID</strong>, the ENVR host, a local Protect username/password, and the
                          <strong> Webhook secret</strong> above to <code>instances.json</code>, then start the systemd service.
                          See <code>scripts/unifi-bridge/README.md</code> for full steps.
                        </p>

                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">instances.json entry</Label>
                            <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => copy(bridgeConfig)}>
                              <Copy className="h-3.5 w-3.5" /> Copy block
                            </Button>
                          </div>
                          <pre className="text-[10px] leading-relaxed bg-black/30 border border-border rounded-md p-3 overflow-x-auto text-accent font-mono">{bridgeConfig}</pre>
                          <p className="text-[10px] text-muted-foreground mt-1.5">
                            After the bridge restarts, this NVR should show “Bridge online” here and its camera list will sync to the Cameras page automatically.
                          </p>
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 flex-wrap">
                        <Button variant="outline" size="sm" onClick={() => openEdit(u)}>Edit</Button>
                        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={async () => {
                          if (!confirm(`Delete "${u.name}"? Its paired webhook source, events and snapshots will be removed.`)) return;
                          try { await store.deleteUnifi(u.id); toast.success("Removed"); }
                          catch (e) { toast.error((e as Error).message); }
                        }}>
                          <Trash2 className="h-4 w-4 mr-2" /> Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
