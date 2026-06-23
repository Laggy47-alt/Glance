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
  Plus, Trash2, RefreshCw, Server, AlertCircle, CheckCircle2,
  Copy, Eye, EyeOff, Webhook, Wifi, WifiOff, ChevronDown, Camera,
  Search, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import {
  hikvisionIngestUrl, hikvisionProxyUrl, hikvisionSnapshotPublicUrl,
  type HikvisionInstance,
} from "@/lib/webhookStore";
import { HikvisionSchedulesPanel } from "@/components/HikvisionSchedulesPanel";

const PALETTE = ["#ef4444", "#f59e0b", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6"];

function ChannelThumb({ inst, channelId, fallbackPath }: { inst: HikvisionInstance; channelId: string; fallbackPath: string | null }) {
  const live = hikvisionProxyUrl(inst.id, `/ISAPI/Streaming/channels/${channelId}01/picture`);
  const fallback = fallbackPath ? hikvisionSnapshotPublicUrl(fallbackPath) : null;
  const [src, setSrc] = useState<string | null>(live);
  const [errored, setErrored] = useState(false);
  if (!src || errored) {
    return (
      <div className="h-12 w-20 shrink-0 rounded bg-muted border border-border flex items-center justify-center">
        <Camera className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={`Channel ${channelId}`}
      loading="lazy"
      className="h-12 w-20 shrink-0 rounded object-cover border border-border bg-muted"
      onError={() => {
        if (src === live && fallback) setSrc(fallback);
        else setErrored(true);
      }}
    />
  );
}

export function HikvisionSection() {
  const store = useWebhookStore();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HikvisionInstance | null>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [verifyTls, setVerifyTls] = useState(true);
  const [color, setColor] = useState(PALETTE[0]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [secretRevealed, setSecretRevealed] = useState<Record<string, boolean>>({});
  const [discovering, setDiscovering] = useState<Record<string, boolean>>({});
  const [polling, setPolling] = useState<Record<string, boolean>>({});

  const reset = () => {
    setEditing(null);
    setName(""); setBaseUrl(""); setAuthUsername(""); setAuthPassword("");
    setVerifyTls(true); setColor(PALETTE[0]);
  };
  const openNew = () => { reset(); setOpen(true); };
  const openEdit = (h: HikvisionInstance) => {
    setEditing(h);
    setName(h.name); setBaseUrl(h.base_url);
    setAuthUsername(h.auth_username ?? "");
    setAuthPassword(""); // never prefill; blank means keep
    setVerifyTls(h.verify_tls);
    setColor(h.color);
    setOpen(true);
  };

  const save = async () => {
    if (!name.trim() || !baseUrl.trim()) { toast.error("Name and base URL are required"); return; }
    if (!/^https?:\/\//i.test(baseUrl.trim())) { toast.error("Base URL must start with http:// or https://"); return; }
    if (!editing && !authPassword.trim()) { toast.error("Password is required for new NVRs"); return; }
    try {
      if (editing) {
        const patch: Parameters<typeof store.updateHikvision>[1] = {
          name: name.trim(),
          base_url: baseUrl.trim(),
          auth_username: authUsername.trim() || null,
          verify_tls: verifyTls,
          color,
        };
        if (authPassword.trim()) patch.auth_password = authPassword.trim();
        await store.updateHikvision(editing.id, patch);
        toast.success("NVR updated");
      } else {
        await store.createHikvision({
          name: name.trim(),
          base_url: baseUrl.trim(),
          auth_username: authUsername.trim() || null,
          auth_password: authPassword.trim(),
          verify_tls: verifyTls,
          color,
        });
        toast.success("Hikvision NVR added");
      }
      await store.refreshAll();
      setOpen(false); reset();
    } catch (e) { toast.error((e as Error).message); }
  };

  const discover = async (id: string) => {
    setDiscovering((s) => ({ ...s, [id]: true }));
    try {
      const r = await store.discoverHikvisionChannels(id);
      toast.success(`Discovered ${r?.channels?.length ?? 0} channel${r?.channels?.length === 1 ? "" : "s"}`);
    } catch (e) { toast.error(`Discovery failed: ${(e as Error).message}`); }
    finally { setDiscovering((s) => ({ ...s, [id]: false })); }
  };

  const pollNow = async (id: string) => {
    setPolling((s) => ({ ...s, [id]: true }));
    try {
      await store.pollHikvisionNow(id);
      toast.success("Polled");
    } catch (e) { toast.error((e as Error).message); }
    finally { setPolling((s) => ({ ...s, [id]: false })); }
  };

  const [registering, setRegistering] = useState<Record<string, boolean>>({});
  const registerListener = async (h: HikvisionInstance) => {
    setRegistering((s) => ({ ...s, [h.id]: true }));
    try {
      const url = hikvisionIngestUrl(h.id, h.webhook_secret);
      const r = await store.registerHikvisionListener(h.id, url);
      toast.success(`HTTP listener registered on NVR (slot ${r?.host_id ?? 1})`);
    } catch (e) { toast.error(`Register failed: ${(e as Error).message}`); }
    finally { setRegistering((s) => ({ ...s, [h.id]: false })); }
  };


  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success("Copied"); };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md grid place-items-center bg-destructive/15 text-destructive">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Hikvision AcuSense NVRs</h2>
            <p className="text-[11px] text-muted-foreground">ISAPI HTTP Host Notification + on-demand snapshots.</p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
          <DialogTrigger asChild>
            <Button onClick={openNew} size="sm" variant="outline" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add Hikvision
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Hikvision NVR" : "Add Hikvision NVR"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Display name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Site A NVR" className="bg-secondary border-border" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Base URL</Label>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://192.168.1.64" className="bg-secondary border-border font-mono" />
                <p className="text-[10px] text-muted-foreground">
                  Reachable from the server (LAN or VPN). Include port if non-default, e.g. <code>http://10.0.0.5:8000</code>.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Username</Label>
                  <Input value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} placeholder="admin" autoComplete="off" className="bg-secondary border-border font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Password</Label>
                  <Input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder={editing ? "Leave blank to keep" : "ISAPI password"} autoComplete="new-password" className="bg-secondary border-border font-mono" />
                </div>
              </div>
              <div className="rounded-md border border-border bg-secondary/40 px-3 py-2.5 flex items-start gap-3">
                <Switch checked={verifyTls} onCheckedChange={setVerifyTls} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">Verify TLS certificate</p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Turn off if your NVR uses a self-signed HTTPS cert. Has no effect for <code>http://</code>.
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
                {editing ? "Save changes" : "Add NVR"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {store.hikvisions.length === 0 ? (
        <Card className="bg-gradient-card border-border shadow-card p-8 text-center">
          <Server className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-foreground font-medium">No Hikvision NVRs yet</p>
          <p className="text-xs text-muted-foreground mt-1">Add one to receive AcuSense events on the Live Wall.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {store.hikvisions.map((h) => {
            const isOpen = !!expanded[h.id];
            const channels = store.hikvisionChannels.filter((c) => c.instance_id === h.id);
            const ingestUrl = hikvisionIngestUrl(h.id, h.webhook_secret);
            const reachable = !h.nvr_unreachable_since && !h.last_error;
            return (
              <Card key={h.id} id={h.id} className="bg-gradient-card border-border shadow-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded((e) => ({ ...e, [h.id]: !e[h.id] }))}
                  className="w-full flex items-center gap-4 text-left p-4 hover:bg-secondary/30 transition-colors"
                >
                  <div className="h-10 w-10 rounded-md grid place-items-center shrink-0" style={{ background: h.color + "22", color: h.color }}>
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
                    <h3 className="text-sm font-semibold">{h.name}</h3>
                    <code className="text-xs text-muted-foreground truncate max-w-md">{h.base_url}</code>
                    <Badge variant="secondary" className="gap-1 bg-destructive/15 text-destructive border-destructive/30">Hikvision</Badge>
                    {h.last_error ? (
                      <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> {h.last_error}</Badge>
                    ) : h.nvr_unreachable_since ? (
                      <Badge variant="destructive" className="gap-1"><WifiOff className="h-3 w-3" /> Unreachable</Badge>
                    ) : h.last_seen_at ? (
                      <Badge variant="secondary" className="gap-1 bg-success/15 text-success border-success/30"><CheckCircle2 className="h-3 w-3" /> Healthy</Badge>
                    ) : (
                      <Badge variant="secondary">Pending first contact</Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground">{channels.length} channel{channels.length === 1 ? "" : "s"}</span>
                    <div className="flex items-center gap-2 ml-auto" onClick={(e) => e.stopPropagation()} role="presentation">
                      <Switch checked={h.enabled} onCheckedChange={(v) => store.updateHikvision(h.id, { enabled: v })} />
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{h.enabled ? "Enabled" : "Disabled"}</span>
                      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform ml-1", isOpen && "rotate-180")} />
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="flex items-start gap-4 px-5 pb-5">
                    <div className="h-10 w-10 shrink-0" />
                    <div className="flex-1 min-w-0 space-y-3">

                      <div className="grid sm:grid-cols-3 gap-3 text-xs">
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Last poll</Label>
                          <p className="tabular-nums">{h.last_polled_at ? new Date(h.last_polled_at).toLocaleString() : "—"}</p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Last event</Label>
                          <p className="tabular-nums">{h.last_event_ts ? new Date(h.last_event_ts).toLocaleString() : "—"}</p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Polling</Label>
                          <div className="flex items-center gap-2">
                            <Switch checked={h.poll_enabled} onCheckedChange={(v) => store.updateHikvision(h.id, { poll_enabled: v })} />
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">runs every minute</span>
                          </div>
                        </div>
                      </div>

                      {/* Webhook URL panel — paste into NVR */}
                      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <Webhook className="h-4 w-4 text-primary" />
                          <p className="text-xs font-semibold text-foreground">HTTP Host Notification URL</p>
                          <Badge variant="secondary" className="ml-auto text-[9px]">Paste into NVR → Network → Advanced → HTTP Listening</Badge>
                        </div>

                        <div>
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Destination URL</Label>
                          <div className="flex gap-2 mt-1">
                            <code className="flex-1 text-xs bg-secondary border border-border rounded px-3 py-2 font-mono text-accent break-all">{ingestUrl}</code>
                            <Button size="icon" variant="outline" onClick={() => copy(ingestUrl)} title="Copy URL"><Copy className="h-4 w-4" /></Button>
                          </div>
                        </div>

                        <div>
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Webhook secret <span className="normal-case text-muted-foreground/70">— embedded in the URL above</span>
                          </Label>
                          <div className="flex gap-2 mt-1">
                            <code className="flex-1 text-xs bg-secondary border border-border rounded px-3 py-2 font-mono break-all">
                              {secretRevealed[h.id] ? h.webhook_secret : "•".repeat(32)}
                            </code>
                            <Button size="icon" variant="outline" onClick={() => setSecretRevealed((r) => ({ ...r, [h.id]: !r[h.id] }))} title={secretRevealed[h.id] ? "Hide" : "Reveal"}>
                              {secretRevealed[h.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                            <Button size="icon" variant="outline" onClick={() => copy(h.webhook_secret)} title="Copy secret"><Copy className="h-4 w-4" /></Button>
                          </div>
                        </div>

                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          On the NVR, enable each AcuSense event (Line Crossing / Intrusion / Region Entrance / etc.)
                          and under <strong>Linkage Method → Notify Surveillance Center</strong> select this HTTP listener.
                          The NVR will POST multipart/form-data with the alert XML and a JPEG snapshot.
                        </p>
                      </div>

                      {/* Channels */}
                      <div className="rounded-md border border-border bg-secondary/30 px-3 py-2.5 space-y-2">
                        <div className="flex items-center gap-2">
                          <Camera className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium text-foreground">Channels</span>
                          <span className="text-[10px] text-muted-foreground">{channels.length}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-auto h-7 text-xs gap-1.5"
                            onClick={() => discover(h.id)}
                            disabled={discovering[h.id]}
                          >
                            {discovering[h.id] ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                            Discover channels
                          </Button>
                        </div>
                        {channels.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No channels yet — click <em>Discover</em> to query the NVR.</p>
                        ) : (
                          <ul className="grid sm:grid-cols-2 gap-1.5">
                            {channels.map((c) => (
                              <li key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded border border-border bg-background/50">
                                <ChannelThumb inst={h} channelId={c.channel_id} fallbackPath={c.last_snapshot_path} />
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium text-foreground truncate">{c.name}</p>
                                  <p className="text-[10px] text-muted-foreground tabular-nums">
                                    ch {c.channel_id}
                                    {c.last_event_ts && <> · last {new Date(c.last_event_ts).toLocaleTimeString()}</>}
                                  </p>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <HikvisionSchedulesPanel inst={h} channels={channels} />

                      {/* Offline alerting */}
                      <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Switch
                            checked={h.offline_alert_enabled}
                            onCheckedChange={(v) => store.updateHikvision(h.id, { offline_alert_enabled: v })}
                          />
                          <span className="text-xs font-medium">Email when channel offline</span>
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground ml-2">After</span>
                          <Input
                            type="number"
                            min={1}
                            max={1440}
                            value={h.offline_alert_minutes}
                            onChange={(e) => {
                              const n = Math.max(1, Math.min(1440, Math.round(Number(e.target.value) || 5)));
                              if (n !== h.offline_alert_minutes) store.updateHikvision(h.id, { offline_alert_minutes: n });
                            }}
                            className="h-7 w-16 bg-secondary border-border text-xs tabular-nums"
                            disabled={!h.offline_alert_enabled}
                          />
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">minutes offline</span>
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 flex-wrap">
                        <Button variant="outline" size="sm" onClick={() => pollNow(h.id)} disabled={polling[h.id]}>
                          <RefreshCw className={`h-4 w-4 mr-2 ${polling[h.id] ? "animate-spin" : ""}`} /> Poll now
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openEdit(h)}>Edit</Button>
                        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={async () => {
                          if (!confirm(`Delete "${h.name}"? Its paired webhook source, channels, events and snapshots will be removed.`)) return;
                          try { await store.deleteHikvision(h.id); toast.success("Removed"); }
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
