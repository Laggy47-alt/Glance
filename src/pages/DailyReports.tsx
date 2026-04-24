import { DashboardLayout } from "@/components/DashboardLayout";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Mail, Send, Save, Plus, X, Eye, Server, Clock, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Cfg = {
  id: string;
  instance_id: string;
  recipients: string[];
  subject: string;
  body_template: string;
  enabled: boolean;
  last_sent_at: string | null;
};

type Settings = {
  id: string;
  from_name: string;
  from_email: string;
  send_hour_utc: number;
  send_minute_utc: number;
  reply_to: string | null;
  smtp_host: string | null;
  smtp_port: number;
  smtp_username: string | null;
  smtp_password: string | null;
  smtp_secure: string; // 'none' | 'starttls' | 'tls'
};

const PLACEHOLDERS = [
  "{{nvr_name}}", "{{date}}",
  "{{cameras_online_count}}", "{{cameras_online_list}}",
  "{{cameras_offline_count}}", "{{cameras_offline_list}}",
  "{{positive_incidents_count}}", "{{positive_incidents_list}}",
];

const DEFAULT_SUBJECT = "Daily Report — {{nvr_name}} — {{date}}";
const DEFAULT_BODY = `Daily report for {{nvr_name}}

Date: {{date}}

Cameras online: {{cameras_online_count}}
{{cameras_online_list}}

Cameras offline: {{cameras_offline_count}}
{{cameras_offline_list}}

Positive incidents (last 24h): {{positive_incidents_count}}
{{positive_incidents_list}}`;

function ConfigCard({ cfg, instanceName, onChange, onDelete }: {
  cfg: Cfg;
  instanceName: string;
  onChange: (next: Cfg) => void;
  onDelete: () => void;
}) {
  const [local, setLocal] = useState<Cfg>(cfg);
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => { setLocal(cfg); }, [cfg.id]);

  const dirty = JSON.stringify(local) !== JSON.stringify(cfg);

  const addRecipient = () => {
    const e = newEmail.trim();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { toast.error("Invalid email"); return; }
    if (local.recipients.includes(e)) return;
    setLocal({ ...local, recipients: [...local.recipients, e] });
    setNewEmail("");
  };

  const removeRecipient = (e: string) => setLocal({ ...local, recipients: local.recipients.filter((x) => x !== e) });

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("daily_report_configs").update({
      recipients: local.recipients,
      subject: local.subject,
      body_template: local.body_template,
      enabled: local.enabled,
    }).eq("id", local.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved — will keep sending daily until edited again");
    onChange(local);
  };

  const previewEmail = async () => {
    setPreview("loading");
    const { data, error } = await supabase.functions.invoke("daily-report-send", {
      body: { config_id: local.id, preview: true },
    });
    if (error) { toast.error(error.message); setPreview(null); return; }
    const p = (data?.results?.[0]?.preview);
    if (!p) { toast.error("No preview returned"); setPreview(null); return; }
    setPreview(`Subject: ${p.subject}\n\n${p.text}`);
  };

  const sendTest = async () => {
    if (!local.recipients.length) { toast.error("Add at least one recipient first"); return; }
    setSending(true);
    const snapshots = await collectSnapshots(local.instance_id);
    const { data, error } = await supabase.functions.invoke("daily-report-send", {
      body: { config_id: local.id, recipients: local.recipients, snapshots },
    });
    setSending(false);
    if (error) { toast.error(error.message); return; }
    const r = data?.results?.[0];
    if (r?.status === "sent") toast.success(`Sent to ${r.recipients.length} recipient(s)`);
    else toast.error(r?.error || "Send failed");
  };

  return (
    <Card className="bg-gradient-card border-border shadow-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Server className="h-4 w-4 text-primary shrink-0" />
          <h3 className="font-semibold text-foreground truncate">{instanceName}</h3>
          {cfg.last_sent_at && (
            <Badge variant="outline" className="text-[10px]">
              Last sent {new Date(cfg.last_sent_at).toLocaleString()}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={local.enabled} onCheckedChange={(v) => setLocal({ ...local, enabled: v })} />
          <span className="text-xs text-muted-foreground">{local.enabled ? "Enabled" : "Paused"}</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Recipients (one list per NVR)</Label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {local.recipients.length === 0 && <span className="text-xs text-muted-foreground italic">No recipients yet</span>}
          {local.recipients.map((e) => (
            <Badge key={e} variant="secondary" className="gap-1 pr-1">
              {e}
              <button onClick={() => removeRecipient(e)} className="hover:text-destructive ml-0.5">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="add@example.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRecipient(); } }}
            className="bg-secondary border-border"
          />
          <Button variant="outline" size="sm" onClick={addRecipient} className="gap-1"><Plus className="h-3.5 w-3.5" />Add</Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Subject</Label>
        <Input value={local.subject} onChange={(e) => setLocal({ ...local, subject: e.target.value })} className="bg-secondary border-border" />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Body template</Label>
          <div className="flex flex-wrap gap-1">
            {PLACEHOLDERS.map((p) => (
              <button
                key={p}
                onClick={() => setLocal({ ...local, body_template: local.body_template + (local.body_template.endsWith("\n") || !local.body_template ? "" : "\n") + p })}
                className="text-[10px] px-1.5 py-0.5 rounded bg-secondary hover:bg-primary/20 border border-border text-muted-foreground hover:text-foreground transition"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <Textarea
          value={local.body_template}
          onChange={(e) => setLocal({ ...local, body_template: e.target.value })}
          rows={10}
          className="bg-secondary border-border font-mono text-xs"
        />
      </div>

      {preview && (
        <Card className="bg-secondary/40 border-border p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-foreground">Preview</span>
            <button onClick={() => setPreview(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
          </div>
          <pre className="text-xs whitespace-pre-wrap text-foreground font-mono">{preview === "loading" ? "Loading…" : preview}</pre>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 pt-1 border-t border-border">
        <Button size="sm" onClick={save} disabled={!dirty || saving} className="gap-1.5">
          <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save template"}
        </Button>
        <Button variant="outline" size="sm" onClick={previewEmail} className="gap-1.5">
          <Eye className="h-3.5 w-3.5" /> Preview
        </Button>
        <Button variant="outline" size="sm" onClick={sendTest} disabled={sending} className="gap-1.5">
          <Send className="h-3.5 w-3.5" /> {sending ? "Sending…" : "Send now"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete} className="ml-auto text-destructive hover:text-destructive">Remove</Button>
      </div>
    </Card>
  );
}

const DailyReports = () => {
  const store = useWebhookStore();
  const [configs, setConfigs] = useState<Cfg[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [{ data: cfgs }, { data: sett }] = await Promise.all([
      supabase.from("daily_report_configs").select("*").order("created_at", { ascending: true }),
      supabase.from("daily_report_settings").select("*").limit(1).maybeSingle(),
    ]);
    setConfigs((cfgs ?? []) as Cfg[]);
    setSettings(sett as Settings);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const instancesById = useMemo(() => new Map(store.frigates.map((f) => [f.id, f])), [store.frigates]);
  const unconfigured = useMemo(
    () => store.frigates.filter((f) => !configs.some((c) => c.instance_id === f.id)),
    [store.frigates, configs],
  );

  const addConfig = async (instance_id: string) => {
    const { data, error } = await supabase.from("daily_report_configs").insert({
      instance_id, subject: DEFAULT_SUBJECT, body_template: DEFAULT_BODY,
    }).select("*").single();
    if (error) { toast.error(error.message); return; }
    setConfigs((prev) => [...prev, data as Cfg]);
  };

  const removeConfig = async (id: string) => {
    if (!confirm("Remove this NVR's daily report?")) return;
    const { error } = await supabase.from("daily_report_configs").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setConfigs((prev) => prev.filter((c) => c.id !== id));
  };

  const updateLocal = (next: Cfg) => setConfigs((prev) => prev.map((c) => c.id === next.id ? next : c));

  const saveSettings = async () => {
    if (!settings) return;
    const { error } = await supabase.from("daily_report_settings").update({
      from_name: settings.from_name,
      from_email: settings.from_email,
      reply_to: settings.reply_to,
      smtp_host: settings.smtp_host,
      smtp_port: settings.smtp_port,
      smtp_username: settings.smtp_username,
      smtp_password: settings.smtp_password,
      smtp_secure: settings.smtp_secure,
    }).eq("id", settings.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Sender settings saved");
  };

  return (
    <DashboardLayout
      title="Daily Reports"
      subtitle="Per-NVR automated email digests sent every day at 08:00 SAST"
    >
      {/* Sender settings */}
      <Card className="bg-gradient-card border-border shadow-card p-5 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Mail className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-foreground">Sender settings</h3>
          <Badge variant="outline" className="text-[10px] ml-auto gap-1"><Clock className="h-3 w-3" /> Daily 08:00 SAST</Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">From name</Label>
            <Input value={settings?.from_name ?? ""} onChange={(e) => setSettings(settings && { ...settings, from_name: e.target.value })} className="bg-secondary border-border" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">From email</Label>
            <Input value={settings?.from_email ?? ""} onChange={(e) => setSettings(settings && { ...settings, from_email: e.target.value })} className="bg-secondary border-border" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Reply-to (optional)</Label>
            <Input value={settings?.reply_to ?? ""} onChange={(e) => setSettings(settings && { ...settings, reply_to: e.target.value })} className="bg-secondary border-border" />
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center gap-2 mb-3">
            <Server className="h-4 w-4 text-primary" />
            <h4 className="font-semibold text-foreground text-sm">SMTP server</h4>
            <span className="text-xs text-muted-foreground">— used to deliver every email above</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">Host</Label>
              <Input placeholder="smtp.gmail.com" value={settings?.smtp_host ?? ""} onChange={(e) => setSettings(settings && { ...settings, smtp_host: e.target.value })} className="bg-secondary border-border" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Port</Label>
              <Input type="number" placeholder="587" value={settings?.smtp_port ?? 587} onChange={(e) => setSettings(settings && { ...settings, smtp_port: Number(e.target.value) || 587 })} className="bg-secondary border-border" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Encryption</Label>
              <select
                value={settings?.smtp_secure ?? "starttls"}
                onChange={(e) => setSettings(settings && { ...settings, smtp_secure: e.target.value })}
                className="w-full h-10 rounded-md bg-secondary border border-border px-3 text-sm text-foreground"
              >
                <option value="starttls">STARTTLS (port 587)</option>
                <option value="tls">SSL/TLS (port 465)</option>
                <option value="none">None (not recommended)</option>
              </select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">Username</Label>
              <Input placeholder="user@example.com" value={settings?.smtp_username ?? ""} onChange={(e) => setSettings(settings && { ...settings, smtp_username: e.target.value })} className="bg-secondary border-border" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">Password</Label>
              <Input type="password" placeholder="••••••••" value={settings?.smtp_password ?? ""} onChange={(e) => setSettings(settings && { ...settings, smtp_password: e.target.value })} className="bg-secondary border-border" />
            </div>
          </div>
          <div className="flex items-start gap-2 mt-3 p-2 rounded bg-secondary/40 border border-border">
            <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Make sure the <strong className="text-foreground">From email</strong> above matches an address your SMTP server is allowed to send from. For Gmail, use an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-primary hover:underline">App Password</a>, not your account password.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={saveSettings} className="mt-3 gap-1.5"><Save className="h-3.5 w-3.5" /> Save sender settings</Button>
      </Card>

      {/* Per-NVR configs */}
      <div className="space-y-4">
        {loading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
        ) : configs.length === 0 && unconfigured.length === 0 ? (
          <Card className="p-8 text-center">
            <Server className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-foreground font-medium">No Frigate NVRs configured</p>
            <p className="text-xs text-muted-foreground mt-1">Add a Frigate instance first.</p>
          </Card>
        ) : (
          <>
            {configs.map((cfg) => (
              <ConfigCard
                key={cfg.id}
                cfg={cfg}
                instanceName={instancesById.get(cfg.instance_id)?.name ?? "(deleted NVR)"}
                onChange={updateLocal}
                onDelete={() => removeConfig(cfg.id)}
              />
            ))}
            {unconfigured.length > 0 && (
              <Card className="p-4 border-dashed border-border bg-secondary/30">
                <p className="text-xs text-muted-foreground mb-2">Add daily report for:</p>
                <div className="flex flex-wrap gap-2">
                  {unconfigured.map((f) => (
                    <Button key={f.id} variant="outline" size="sm" onClick={() => addConfig(f.id)} className="gap-1.5">
                      <Plus className="h-3.5 w-3.5" /> {f.name}
                    </Button>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default DailyReports;
