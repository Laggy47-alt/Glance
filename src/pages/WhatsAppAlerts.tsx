import { DashboardLayout } from "@/components/DashboardLayout";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { fetchFrigateStats } from "@/lib/frigateStats";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  MessageCircle, Save, Send, Plus, X, Server, Megaphone, Inbox,
  Settings2, Users, FileText, Clock, Radio, Activity,
} from "lucide-react";
import { toast } from "sonner";
import WhatsAppInbox from "@/components/WhatsAppInbox";
import { cn } from "@/lib/utils";

function parseOfflineCams(stats: unknown): string[] {
  if (!stats || typeof stats !== "object") return [];
  const root = stats as Record<string, unknown>;
  const cameras = (root.cameras && typeof root.cameras === "object" ? root.cameras : root) as Record<string, unknown>;
  const reserved = new Set(["cpu_usages","gpu_usages","service","detectors","detection_fps","processes","bandwidth_usages","version"]);
  const offline: string[] = [];
  for (const [name, val] of Object.entries(cameras)) {
    if (reserved.has(name)) continue;
    if (!val || typeof val !== "object") continue;
    const c = val as Record<string, any>;
    const hasShape = "camera_fps" in c || "process_fps" in c || "detection_fps" in c || "pid" in c;
    if (!hasShape) continue;
    const fps = typeof c.camera_fps === "number" ? c.camera_fps : undefined;
    const pid = typeof c.pid === "number" ? c.pid : undefined;
    const online = (pid === undefined || pid > 0) && (fps === undefined || fps > 0);
    if (!online) offline.push(name);
  }
  return offline.sort();
}

const isValidRecipient = (r: string) => /^\+?\d{6,}$/.test(r) || /@(g\.us|s\.whatsapp\.net|c\.us|broadcast)$/i.test(r);

type WAS = {
  id?: string;
  organization_id?: string;
  enabled: boolean;
  mudslide_url: string | null;
  mudslide_token: string | null;
  incoming_webhook_secret: string | null;
  default_recipients: string[];
  alert_template: string;
  recovery_template: string;
  reply_footer: string | null;
  send_recovery: boolean;
  include_nvr_unreachable: boolean;
  batch_alerts: boolean;
  quiet_hours_enabled: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
  quiet_timezone: string;
  max_alerts_per_hour: number;
  cooldown_minutes: number;
  last_sent_at: string | null;
  daily_broadcast_enabled: boolean;
  daily_broadcast_recipients: string[];
  daily_broadcast_time: string;
  daily_broadcast_template: string | null;
  last_heartbeat_at?: string | null;
  last_heartbeat_status?: string | null;
};

type Nvr = {
  id: string;
  name: string;
  whatsapp_alert_enabled: boolean;
  whatsapp_recipients: string[];
  whatsapp_alert_minutes: number | null;
  offline_alert_minutes: number;
  multi_client: boolean;
  camera_whatsapp_recipients: Record<string, string[]>;
  daily_broadcast_enabled: boolean;
};

const DEFAULTS: WAS = {
  enabled: false,
  mudslide_url: "",
  mudslide_token: "",
  incoming_webhook_secret: "",
  default_recipients: [],
  alert_template: "🚨 *{{nvr}}* — {{count}} camera(s) offline ≥ {{minutes}}m:\n{{cameras}}",
  recovery_template: "✅ *{{nvr}}* — {{camera}} back online",
  reply_footer: "Need help? Just reply to this message and our Technical Team will assist you! 👨‍💻🚀",
  send_recovery: true,
  include_nvr_unreachable: true,
  batch_alerts: true,
  quiet_hours_enabled: false,
  quiet_start: "22:00",
  quiet_end: "06:00",
  quiet_timezone: "Africa/Johannesburg",
  max_alerts_per_hour: 30,
  cooldown_minutes: 0,
  last_sent_at: null,
  daily_broadcast_enabled: false,
  daily_broadcast_recipients: [],
  daily_broadcast_time: "08:00",
  daily_broadcast_template:
    "Hey there! 👋😊\n\nI'm Glance, your friendly ABC CCTV sidekick! 🛡️🤖\n\nKeep an eye out for my updates — I'll ping you whenever something needs attention onsite. 🔔🔧\n\nNeed technical assistance? Just reply to this message and our team will be in touch! 👨‍💻🚀\n\nCheers for now! 🎉👍",
};

function RecipientList({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!isValidRecipient(t)) { toast.error("Enter E.164 number (+27821234567) or group JID (12345-67890@g.us)"); return; }
    if (value.includes(t)) return;
    onChange([...value, t]); setDraft("");
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder ?? "+27821234567"} className="bg-secondary border-border h-9" />
        <Button type="button" size="sm" variant="secondary" onClick={add}><Plus className="h-3.5 w-3.5" /></Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-xs text-muted-foreground italic">No recipients</span>}
        {value.map((r) => (
          <Badge key={r} variant="secondary" className="gap-1 font-mono text-[11px]">
            {r}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== r))} className="hover:text-destructive">
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}

type Section = "connection" | "recipients" | "templates" | "schedule" | "daily" | "broadcast" | "nvrs" | "inbox";

const NAV: { id: Section; label: string; icon: any }[] = [
  { id: "connection", label: "Connection", icon: Settings2 },
  { id: "recipients", label: "Global recipients", icon: Users },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "schedule", label: "Schedule & limits", icon: Clock },
  { id: "daily", label: "Daily broadcast", icon: Megaphone },
  { id: "broadcast", label: "Send message", icon: Radio },
  { id: "nvrs", label: "Per-NVR recipients", icon: Server },
  { id: "inbox", label: "Reply inbox", icon: Inbox },
];

export default function WhatsAppAlerts() {
  const { activeOrg } = useAuth();
  const [settings, setSettings] = useState<WAS>(DEFAULTS);
  const [nvrs, setNvrs] = useState<Nvr[]>([]);
  const [nvrCameras, setNvrCameras] = useState<Record<string, string[]>>({});
  const [customMsg, setCustomMsg] = useState("");
  const [customSelected, setCustomSelected] = useState<Record<string, boolean>>({});
  const [customSending, setCustomSending] = useState(false);
  const store = useWebhookStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testNum, setTestNum] = useState("");
  const [broadcastTo, setBroadcastTo] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [section, setSection] = useState<Section>("connection");
  const [nvrFilter, setNvrFilter] = useState("");

  useEffect(() => {
    if (!activeOrg?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: s }, { data: n }] = await Promise.all([
        supabase.from("whatsapp_settings").select("*").eq("organization_id", activeOrg.id).maybeSingle(),
        supabase.from("frigate_instances")
          .select("id, name, whatsapp_alert_enabled, whatsapp_recipients, whatsapp_alert_minutes, offline_alert_minutes, multi_client, camera_whatsapp_recipients, daily_broadcast_enabled")
          .eq("organization_id", activeOrg.id).order("name"),
      ]);
      if (cancelled) return;
      if (s) setSettings({ ...DEFAULTS, ...(s as any) });
      const list = ((n ?? []) as any[]).map((x) => ({
        ...x,
        camera_whatsapp_recipients: (x.camera_whatsapp_recipients ?? {}) as Record<string, string[]>,
      })) as Nvr[];
      setNvrs(list);
      setLoading(false);

      if (list.length) {
        const idByName = new Map(list.map((x) => [x.name, x.id]));
        const reserved = new Set(["cpu_usages","gpu_usages","service","detectors","detection_fps","processes","bandwidth_usages","version"]);
        const enabled = store.frigates.filter((f) => f.enabled && idByName.has(f.name));
        const liveResults = await Promise.all(enabled.map(async (f) => {
          try {
            const stats: any = await fetchFrigateStats(f);
            const root = (stats?.cameras && typeof stats.cameras === "object" ? stats.cameras : stats) as Record<string, unknown>;
            const cams = Object.keys(root ?? {}).filter((k) => !reserved.has(k) && root[k] && typeof root[k] === "object");
            return { id: idByName.get(f.name)!, cams };
          } catch { return { id: idByName.get(f.name)!, cams: [] as string[] }; }
        }));
        if (cancelled) return;
        const { data: cs } = await supabase.from("camera_status").select("instance_id, camera").in("instance_id", list.map((x) => x.id));
        if (cancelled) return;
        const map: Record<string, string[]> = {};
        for (const r of cs ?? []) (map[(r as any).instance_id] ??= []).push((r as any).camera);
        for (const { id, cams } of liveResults) (map[id] ??= []).push(...cams);
        for (const k of Object.keys(map)) map[k] = Array.from(new Set(map[k])).sort();
        setNvrCameras(map);
      }
    })();
    return () => { cancelled = true; };
  }, [activeOrg?.id, store.frigates.length]);

  const save = async () => {
    if (!activeOrg?.id) return;
    setSaving(true);
    const payload = { ...settings, organization_id: activeOrg.id };
    delete (payload as any).last_sent_at;
    const { error } = await supabase.from("whatsapp_settings").upsert(payload, { onConflict: "organization_id" });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("WhatsApp settings saved");
  };

  const saveNvr = async (n: Nvr) => {
    const { error } = await supabase.from("frigate_instances").update({
      whatsapp_alert_enabled: n.whatsapp_alert_enabled,
      whatsapp_recipients: n.whatsapp_recipients,
      whatsapp_alert_minutes: n.whatsapp_alert_minutes,
      multi_client: n.multi_client,
      camera_whatsapp_recipients: n.camera_whatsapp_recipients,
      daily_broadcast_enabled: n.daily_broadcast_enabled,
    }).eq("id", n.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Saved ${n.name}`);
  };

  const sendCustomBroadcast = async () => {
    if (!activeOrg?.id) return;
    const msg = customMsg.trim();
    if (!msg) { toast.error("Type a message first"); return; }
    const chosen = nvrs.filter((n) => customSelected[n.id]);
    if (!chosen.length) { toast.error("Select at least one NVR"); return; }
    const recips = Array.from(new Set(
      chosen.flatMap((n) => (n.whatsapp_recipients ?? []).map((r) => r.trim()).filter(isValidRecipient))
    ));
    if (!recips.length) { toast.error("Selected NVRs have no WhatsApp recipients"); return; }
    setCustomSending(true);
    try {
      const header = chosen.length === 1 ? `🚨 *${chosen[0].name}*` : `🚨 *Broadcast*`;
      const { data, error } = await supabase.functions.invoke("escalate-offline-whatsapp", {
        body: { organization_id: activeOrg.id, recipients: recips, message: `${header}\n${msg}`, test: true },
      });
      if (error) throw error;
      const errs = (data as any)?.errors ?? [];
      if (errs.length) toast.error(errs.join("\n"));
      else { toast.success(`Sent to ${recips.length} recipient(s)`); setCustomMsg(""); }
    } catch (e: any) { toast.error(e?.message ?? String(e)); }
    finally { setCustomSending(false); }
  };

  const sendTest = async () => {
    if (!activeOrg?.id) return;
    const recipient = testNum.trim();
    if (!/^\+?\d{6,}$/.test(recipient)) { toast.error("Enter a valid E.164 number to test"); return; }
    const { data, error } = await supabase.functions.invoke("escalate-offline-whatsapp", {
      body: { organization_id: activeOrg.id, recipients: [recipient], message: "✅ ABC Glance — Mudslide WhatsApp test", test: true },
    });
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.errors?.length) { toast.error(JSON.stringify((data as any).errors)); return; }
    toast.success("Test message sent");
  };

  const runHeartbeat = async () => {
    if (!activeOrg?.id) return;
    const { data, error } = await supabase.functions.invoke("whatsapp-heartbeat", { body: {} });
    if (error) { toast.error(error.message); return; }
    const mine = (data as any)?.results?.find((r: any) => r.organization_id === activeOrg.id);
    if (mine?.ok) toast.success(`Heartbeat ok (${mine.status})`);
    else if (mine) toast.error(`Heartbeat failed: ${mine.status}`);
    else toast.success("Heartbeat ran");
    const { data: row } = await supabase.from("whatsapp_settings")
      .select("last_heartbeat_at, last_heartbeat_status").eq("organization_id", activeOrg.id).maybeSingle();
    if (row) setSettings((s) => ({ ...s, last_heartbeat_at: (row as any).last_heartbeat_at, last_heartbeat_status: (row as any).last_heartbeat_status }));
  };

  const broadcastOffline = async () => {
    if (!activeOrg?.id) return;
    const target = broadcastTo.trim();
    const recipients = target ? [target] : settings.default_recipients;
    if (!recipients.length) { toast.error("Add a recipient/group or set default recipients"); return; }
    for (const r of recipients) if (!isValidRecipient(r)) { toast.error(`Invalid recipient: ${r}`); return; }
    setBroadcasting(true);
    try {
      const enabledFrigates = store.frigates.filter((f) => f.enabled);
      if (!enabledFrigates.length) { toast.error("No enabled NVRs to query"); setBroadcasting(false); return; }
      const results = await Promise.all(enabledFrigates.map(async (f) => {
        try { return { name: f.name, reachable: true, offlineCameras: parseOfflineCams(await fetchFrigateStats(f)) }; }
        catch { return { name: f.name, reachable: false, offlineCameras: [] as string[] }; }
      }));
      const totalOffline = results.reduce((a, r) => a + r.offlineCameras.length, 0);
      const anyUnreachable = results.some((r) => !r.reachable);
      if (totalOffline === 0 && !anyUnreachable) { toast.success("No cameras are currently offline"); setBroadcasting(false); return; }
      const nvrsPayload = results.filter((r) => !r.reachable || r.offlineCameras.length > 0);
      const { data, error } = await supabase.functions.invoke("escalate-offline-whatsapp", {
        body: { organization_id: activeOrg.id, recipients, nvrs: nvrsPayload, minutes: 0, test: true },
      });
      if (error) throw error;
      const errs = (data as any)?.errors ?? [];
      if (errs.length) toast.error(errs.join("\n"));
      else toast.success(`Sent summary of ${totalOffline} offline camera(s) to ${recipients.length} recipient(s)`);
    } catch (e: any) { toast.error(e?.message ?? String(e)); }
    finally { setBroadcasting(false); }
  };

  const filteredNvrs = useMemo(
    () => nvrFilter ? nvrs.filter((n) => n.name.toLowerCase().includes(nvrFilter.toLowerCase())) : nvrs,
    [nvrs, nvrFilter],
  );

  if (loading) {
    return <DashboardLayout title="WhatsApp Alerts" subtitle="Loading…"><div className="text-sm text-muted-foreground">Loading…</div></DashboardLayout>;
  }

  const connectionOk = !!settings.mudslide_url;
  const hbOk = settings.last_heartbeat_status?.startsWith("ok");

  return (
    <DashboardLayout title="WhatsApp Alerts" subtitle="Self-hosted Mudslide integration">
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
        {/* Sidebar */}
        <Card className="bg-gradient-card border-border shadow-card p-3 md:sticky md:top-4 self-start">
          <div className="flex items-center gap-2 px-2 py-1.5 mb-2">
            <MessageCircle className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">WhatsApp</span>
            <div className="ml-auto flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", settings.enabled && connectionOk ? "bg-emerald-500" : "bg-muted-foreground/40")} />
            </div>
          </div>
          <div className="px-2 mb-3 flex items-center justify-between rounded-md border border-border p-2">
            <Label className="text-[11px] text-muted-foreground">Enabled</Label>
            <Switch checked={settings.enabled} onCheckedChange={(v) => setSettings({ ...settings, enabled: v })} />
          </div>
          <nav className="space-y-0.5">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button key={item.id} onClick={() => setSection(item.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors",
                    active ? "bg-primary text-primary-foreground" : "hover:bg-secondary text-foreground",
                  )}>
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="mt-3 px-2 pt-3 border-t border-border space-y-1.5 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Activity className="h-3 w-3" />
              <span className={hbOk ? "text-emerald-500" : settings.last_heartbeat_status ? "text-red-500" : ""}>
                {settings.last_heartbeat_status ?? "no heartbeat"}
              </span>
            </div>
            <div>{nvrs.length} NVR{nvrs.length === 1 ? "" : "s"} · {settings.default_recipients.length} default recipient{settings.default_recipients.length === 1 ? "" : "s"}</div>
          </div>
        </Card>

        {/* Content */}
        <Card className="bg-gradient-card border-border shadow-card p-5">
          {section === "connection" && (
            <div className="space-y-4">
              <Header icon={Settings2} title="Mudslide connection" subtitle="Where to reach your self-hosted Mudslide instance." />
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Mudslide URL" hint="Public HTTPS URL, no trailing slash.">
                  <Input value={settings.mudslide_url ?? ""} placeholder="https://wa.example.com"
                    onChange={(e) => setSettings({ ...settings, mudslide_url: e.target.value })}
                    className="bg-secondary border-border font-mono text-sm" />
                </Field>
                <Field label="Bearer token" hint="Sent as Authorization header.">
                  <Input type="password" value={settings.mudslide_token ?? ""} placeholder="Long random token"
                    onChange={(e) => setSettings({ ...settings, mudslide_token: e.target.value })}
                    className="bg-secondary border-border font-mono text-sm" />
                </Field>
              </div>
              <div className="grid md:grid-cols-2 gap-3 pt-2 border-t border-border">
                <Field label="Send test message">
                  <div className="flex gap-2">
                    <Input value={testNum} onChange={(e) => setTestNum(e.target.value)} placeholder="+27821234567" className="bg-secondary border-border" />
                    <Button size="sm" variant="secondary" onClick={sendTest}><Send className="h-3.5 w-3.5 mr-1" />Test</Button>
                  </div>
                </Field>
                <Field label="Session heartbeat" hint={`Last: ${settings.last_heartbeat_at ? new Date(settings.last_heartbeat_at).toLocaleString() : "never"} · runs every 5 min.`}>
                  <div className="flex items-center gap-2">
                    <span className={cn("text-sm", hbOk ? "text-emerald-500" : settings.last_heartbeat_status ? "text-red-500" : "text-muted-foreground")}>
                      {settings.last_heartbeat_status ?? "—"}
                    </span>
                    <Button size="sm" variant="secondary" className="ml-auto" onClick={runHeartbeat}>Ping now</Button>
                  </div>
                </Field>
              </div>
              <SaveBar onSave={save} saving={saving} />
            </div>
          )}

          {section === "recipients" && (
            <div className="space-y-4">
              <Header icon={Users} title="Global recipients" subtitle="Receive the daily broadcast and every offline / online notification from all NVRs. Not included in custom 'Send message' sends." />
              <RecipientList value={settings.default_recipients} onChange={(v) => setSettings({ ...settings, default_recipients: v })} />
              <p className="text-[11px] text-muted-foreground">If you also set dedicated daily broadcast recipients below, those take priority for the daily report; otherwise this list is used.</p>
              <SaveBar onSave={save} saving={saving} />
            </div>
          )}

          {section === "templates" && (
            <div className="space-y-4">
              <Header icon={FileText} title="Message templates" subtitle="Variables in {{...}} are substituted at send time." />
              <Field label="Alert template" hint="Variables: {{nvr}}, {{count}}, {{minutes}}, {{cameras}}, {{status}}">
                <Textarea rows={3} value={settings.alert_template} onChange={(e) => setSettings({ ...settings, alert_template: e.target.value })}
                  className="bg-secondary border-border font-mono text-xs" />
              </Field>
              <Field label="Recovery template" hint="Variables: {{nvr}}, {{camera}}">
                <Textarea rows={2} value={settings.recovery_template} onChange={(e) => setSettings({ ...settings, recovery_template: e.target.value })}
                  className="bg-secondary border-border font-mono text-xs" />
              </Field>
              <Field label="Daily broadcast / welcome template" hint="Sent as-is (no variables).">
                <Textarea rows={5} value={settings.daily_broadcast_template ?? ""} onChange={(e) => setSettings({ ...settings, daily_broadcast_template: e.target.value })}
                  className="bg-secondary border-border text-sm" />
              </Field>
              <Field label="Reply footer" hint="Appended to every outgoing message.">
                <Textarea rows={2} value={settings.reply_footer ?? ""} onChange={(e) => setSettings({ ...settings, reply_footer: e.target.value })}
                  className="bg-secondary border-border text-xs" />
              </Field>
              <div className="grid md:grid-cols-3 gap-2">
                <ToggleRow label="Send recovery messages" hint="When a camera returns" checked={settings.send_recovery} onChange={(v) => setSettings({ ...settings, send_recovery: v })} />
                <ToggleRow label="Alert on NVR unreachable" hint="When the NVR itself stops responding" checked={settings.include_nvr_unreachable} onChange={(v) => setSettings({ ...settings, include_nvr_unreachable: v })} />
                <ToggleRow label="Batch cameras" hint="Combine into one message" checked={settings.batch_alerts} onChange={(v) => setSettings({ ...settings, batch_alerts: v })} />
              </div>
              <SaveBar onSave={save} saving={saving} />
            </div>
          )}

          {section === "schedule" && (
            <div className="space-y-4">
              <Header icon={Clock} title="Schedule & rate limits" />
              <ToggleRow label="Quiet hours" hint="Suppress alerts in this window (test sends still go through)" checked={settings.quiet_hours_enabled} onChange={(v) => setSettings({ ...settings, quiet_hours_enabled: v })} />
              <div className="grid grid-cols-3 gap-3">
                <Field label="Quiet start"><Input type="time" value={settings.quiet_start ?? ""} onChange={(e) => setSettings({ ...settings, quiet_start: e.target.value })} className="bg-secondary border-border" /></Field>
                <Field label="Quiet end"><Input type="time" value={settings.quiet_end ?? ""} onChange={(e) => setSettings({ ...settings, quiet_end: e.target.value })} className="bg-secondary border-border" /></Field>
                <Field label="Timezone"><Input value={settings.quiet_timezone} onChange={(e) => setSettings({ ...settings, quiet_timezone: e.target.value })} className="bg-secondary border-border" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Max alerts per hour" hint="0 = unlimited">
                  <Input type="number" min={0} value={settings.max_alerts_per_hour} onChange={(e) => setSettings({ ...settings, max_alerts_per_hour: Number(e.target.value) })} className="bg-secondary border-border" />
                </Field>
                <Field label="Per-camera cooldown (minutes)" hint="Won't re-alert within this window">
                  <Input type="number" min={0} value={settings.cooldown_minutes} onChange={(e) => setSettings({ ...settings, cooldown_minutes: Number(e.target.value) })} className="bg-secondary border-border" />
                </Field>
              </div>
              <SaveBar onSave={save} saving={saving} />
            </div>
          )}

          {section === "daily" && (
            <div className="space-y-4">
              <Header icon={Megaphone} title="Scheduled daily broadcast" subtitle="One summary per day of currently-offline cameras." />
              <ToggleRow label="Enabled" checked={settings.daily_broadcast_enabled} onChange={(v) => setSettings({ ...settings, daily_broadcast_enabled: v })} />
              <div className="grid md:grid-cols-2 gap-3">
                <Field label={`Send at (HH:MM, ${settings.quiet_timezone})`}>
                  <Input type="time" value={settings.daily_broadcast_time} onChange={(e) => setSettings({ ...settings, daily_broadcast_time: e.target.value || "08:00" })} className="bg-secondary border-border w-40" />
                </Field>
                <Field label="Org-wide recipients / group(s)" hint="If empty, default recipients are used.">
                  <RecipientList value={settings.daily_broadcast_recipients} onChange={(v) => setSettings({ ...settings, daily_broadcast_recipients: v })} placeholder="+27821234567 or 12345-67890@g.us" />
                </Field>
              </div>
              <p className="text-[11px] text-muted-foreground">Per-NVR client reports are configured under <button onClick={() => setSection("nvrs")} className="text-primary hover:underline">Per-NVR overrides</button>.</p>
              <SaveBar onSave={save} saving={saving} />
            </div>
          )}

          {section === "broadcast" && (
            <div className="space-y-5">
              <div>
                <Header icon={Radio} title="Broadcast offline summary now" subtitle="Lists every camera currently offline across all NVRs." />
                <div className="flex gap-2 mt-3">
                  <Input value={broadcastTo} onChange={(e) => setBroadcastTo(e.target.value)}
                    placeholder="Leave blank for default recipients, or +27821234567 / 12345-67890@g.us"
                    className="bg-secondary border-border font-mono text-sm" />
                  <Button onClick={broadcastOffline} disabled={broadcasting}>
                    <Send className="h-3.5 w-3.5 mr-1" />{broadcasting ? "Sending…" : "Send"}
                  </Button>
                </div>
              </div>
              <div className="pt-4 border-t border-border">
                <Header icon={Megaphone} title="Send to assigned NVR recipients" subtitle="Sends only to the recipients assigned to the NVRs you pick — global recipients are NOT included. Quiet hours & rate limits bypassed." />
                <div className="space-y-3 mt-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Message</Label>
                    <Button size="sm" variant="ghost" type="button"
                      onClick={() => setCustomMsg(settings.daily_broadcast_template ?? DEFAULTS.daily_broadcast_template!)}>
                      Use welcome template
                    </Button>
                  </div>
                  <Textarea rows={4} value={customMsg} onChange={(e) => setCustomMsg(e.target.value)} placeholder="Type the message to broadcast…" className="bg-secondary border-border text-sm" />
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <Label className="text-xs">Send to recipients of these NVRs</Label>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" type="button" onClick={() => setCustomSelected(Object.fromEntries(nvrs.map((n) => [n.id, true])))}>Select all</Button>
                        <Button size="sm" variant="ghost" type="button" onClick={() => setCustomSelected({})}>Clear</Button>
                      </div>
                    </div>
                    <div className="rounded-md border border-border p-2 grid sm:grid-cols-2 gap-1.5 max-h-56 overflow-auto">
                      {nvrs.length === 0 && <span className="text-xs text-muted-foreground italic">No NVRs configured.</span>}
                      {nvrs.map((n) => {
                        const count = (n.whatsapp_recipients ?? []).filter(isValidRecipient).length;
                        return (
                          <label key={n.id} className="flex items-center gap-2 text-sm px-1.5 py-1 rounded hover:bg-secondary cursor-pointer">
                            <input type="checkbox" className="accent-primary" checked={!!customSelected[n.id]}
                              onChange={(e) => setCustomSelected({ ...customSelected, [n.id]: e.target.checked })} />
                            <span className="flex-1 truncate">{n.name}</span>
                            <span className="text-[11px] text-muted-foreground">{count}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={sendCustomBroadcast} disabled={customSending}>
                      <Send className="h-3.5 w-3.5 mr-1" />{customSending ? "Sending…" : "Send broadcast"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {section === "nvrs" && (
            <div className="space-y-3">
              <Header icon={Server} title="Per-NVR overrides" subtitle={`${nvrs.length} NVR${nvrs.length === 1 ? "" : "s"}`} />
              {nvrs.length === 0 && <p className="text-sm text-muted-foreground italic">No NVRs configured.</p>}
              {nvrs.length > 0 && (
                <Input placeholder="Filter NVRs…" value={nvrFilter} onChange={(e) => setNvrFilter(e.target.value)} className="bg-secondary border-border h-9 max-w-xs" />
              )}
              <div className="space-y-2">
                {filteredNvrs.map((n, idx) => {
                  const i = nvrs.indexOf(n);
                  return (
                    <details key={n.id} className="rounded-md border border-border group" open={idx === 0 && filteredNvrs.length <= 3}>
                      <summary className="flex items-center gap-2 p-3 cursor-pointer hover:bg-secondary/40 list-none">
                        <Server className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium text-sm flex-1 truncate">{n.name}</span>
                        {n.whatsapp_alert_enabled && <Badge variant="secondary" className="text-[10px]">WA on</Badge>}
                        {n.daily_broadcast_enabled && <Badge variant="secondary" className="text-[10px]">Daily</Badge>}
                        {n.multi_client && <Badge variant="secondary" className="text-[10px]">Multi</Badge>}
                        <span className="text-[11px] text-muted-foreground">{(n.whatsapp_recipients ?? []).filter(isValidRecipient).length} recip</span>
                      </summary>
                      <div className="p-3 pt-0 space-y-3 border-t border-border">
                        <div className="grid md:grid-cols-2 gap-3 pt-3">
                          <ToggleRow label="WhatsApp alerts on" checked={n.whatsapp_alert_enabled}
                            onChange={(v) => setNvrs(nvrs.map((x, j) => j === i ? { ...x, whatsapp_alert_enabled: v } : x))} />
                          <Field label="Alert after (minutes)" hint={`Blank = ${n.offline_alert_minutes}m (email threshold)`}>
                            <Input type="number" min={1} value={n.whatsapp_alert_minutes ?? ""} placeholder={String(n.offline_alert_minutes)}
                              onChange={(e) => setNvrs(nvrs.map((x, j) => j === i ? { ...x, whatsapp_alert_minutes: e.target.value === "" ? null : Number(e.target.value) } : x))}
                              className="bg-secondary border-border" />
                          </Field>
                        </div>
                        <Field label="Recipients (overrides default)">
                          <RecipientList value={n.whatsapp_recipients ?? []}
                            onChange={(v) => setNvrs(nvrs.map((x, j) => j === i ? { ...x, whatsapp_recipients: v } : x))} />
                        </Field>
                        <div className="grid md:grid-cols-2 gap-2">
                          <ToggleRow label="Send daily report" hint="Per-NVR summary at the daily broadcast time"
                            checked={n.daily_broadcast_enabled}
                            onChange={(v) => setNvrs(nvrs.map((x, j) => j === i ? { ...x, daily_broadcast_enabled: v } : x))} />
                          <ToggleRow label="Multi-client NVR" hint="Route each camera to its own recipients"
                            checked={n.multi_client}
                            onChange={(v) => setNvrs(nvrs.map((x, j) => j === i ? { ...x, multi_client: v } : x))} />
                        </div>
                        {n.multi_client && (
                          <div className="rounded-md border border-border p-3 space-y-2">
                            <div className="text-xs font-medium">Per-camera recipients</div>
                            {(nvrCameras[n.id] ?? []).length === 0 && (
                              <p className="text-[11px] text-muted-foreground italic">No cameras seen yet. They'll appear after the next poll.</p>
                            )}
                            <div className="space-y-2">
                              {(nvrCameras[n.id] ?? []).map((cam) => (
                                <div key={cam} className="grid md:grid-cols-[180px_1fr] gap-2 items-start">
                                  <div className="text-xs font-mono pt-2">{cam}</div>
                                  <RecipientList value={n.camera_whatsapp_recipients?.[cam] ?? []}
                                    onChange={(v) => setNvrs(nvrs.map((x, j) => j === i ? {
                                      ...x, camera_whatsapp_recipients: { ...(x.camera_whatsapp_recipients ?? {}), [cam]: v },
                                    } : x))}
                                    placeholder="+27821234567 or 12345-67890@g.us" />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="flex justify-end">
                          <Button size="sm" variant="secondary" onClick={() => saveNvr(n)}><Save className="h-3.5 w-3.5 mr-1" />Save NVR</Button>
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>
          )}

          {section === "inbox" && activeOrg?.id && (
            <WhatsAppInbox organizationId={activeOrg.id} />
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
}

function Header({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-4 w-4 text-primary mt-0.5" />
      <div>
        <h3 className="font-semibold text-foreground leading-tight">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border p-2.5">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function SaveBar({ onSave, saving }: { onSave: () => void; saving: boolean }) {
  return (
    <div className="flex justify-end pt-2 border-t border-border">
      <Button onClick={onSave} disabled={saving}><Save className="h-3.5 w-3.5 mr-1" />{saving ? "Saving…" : "Save settings"}</Button>
    </div>
  );
}
