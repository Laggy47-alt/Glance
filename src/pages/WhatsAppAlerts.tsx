import { DashboardLayout } from "@/components/DashboardLayout";
import { useEffect, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MessageCircle, Save, Send, Plus, X, Server, Megaphone } from "lucide-react";
import { toast } from "sonner";

// Compute offline cameras live from Frigate /api/stats, same heuristic as NvrStatus page.
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
  default_recipients: string[];
  alert_template: string;
  recovery_template: string;
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
};

const DEFAULTS: WAS = {
  enabled: false,
  mudslide_url: "",
  mudslide_token: "",
  default_recipients: [],
  alert_template: "🚨 *{{nvr}}* — {{count}} camera(s) offline ≥ {{minutes}}m:\n{{cameras}}",
  recovery_template: "✅ *{{nvr}}* — {{camera}} back online",
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
          placeholder={placeholder ?? "+27821234567"} className="bg-secondary border-border" />
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


  useEffect(() => {
    if (!activeOrg?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: s }, { data: n }] = await Promise.all([
        supabase.from("whatsapp_settings").select("*")
          .eq("organization_id", activeOrg.id).maybeSingle(),
        supabase.from("frigate_instances")
          .select("id, name, whatsapp_alert_enabled, whatsapp_recipients, whatsapp_alert_minutes, offline_alert_minutes, multi_client, camera_whatsapp_recipients")
          .eq("organization_id", activeOrg.id)
          .order("name"),
      ]);
      if (cancelled) return;
      if (s) setSettings({ ...DEFAULTS, ...(s as any) });
      const list = ((n ?? []) as any[]).map((x) => ({
        ...x,
        camera_whatsapp_recipients: (x.camera_whatsapp_recipients ?? {}) as Record<string, string[]>,
      })) as Nvr[];
      setNvrs(list);
      setLoading(false);

      // Defer the camera list fetch — it's only needed when a multi-client NVR is expanded,
      // and pulling camera_status was blocking the initial render.
      if (list.length) {
        const { data: cs } = await supabase
          .from("camera_status")
          .select("instance_id, camera")
          .in("instance_id", list.map((x) => x.id));
        if (cancelled) return;
        const map: Record<string, string[]> = {};
        for (const r of cs ?? []) {
          (map[(r as any).instance_id] ??= []).push((r as any).camera);
        }
        for (const k of Object.keys(map)) map[k] = Array.from(new Set(map[k])).sort();
        setNvrCameras(map);
      }
    })();
    return () => { cancelled = true; };
  }, [activeOrg?.id]);


  const save = async () => {
    if (!activeOrg?.id) return;
    setSaving(true);
    const payload = { ...settings, organization_id: activeOrg.id };
    delete (payload as any).last_sent_at;
    const { error } = await supabase
      .from("whatsapp_settings")
      .upsert(payload, { onConflict: "organization_id" });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("WhatsApp settings saved");
  };

  const saveNvr = async (n: Nvr) => {
    const { error } = await supabase
      .from("frigate_instances")
      .update({
        whatsapp_alert_enabled: n.whatsapp_alert_enabled,
        whatsapp_recipients: n.whatsapp_recipients,
        whatsapp_alert_minutes: n.whatsapp_alert_minutes,
        multi_client: n.multi_client,
        camera_whatsapp_recipients: n.camera_whatsapp_recipients,
      })
      .eq("id", n.id);
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
      // Format to match the offline-alert look.
      const header = chosen.length === 1 ? `🚨 *${chosen[0].name}*` : `🚨 *Broadcast*`;
      const formatted = `${header}\n${msg}`;
      const { data, error } = await supabase.functions.invoke("escalate-offline-whatsapp", {
        body: {
          organization_id: activeOrg.id,
          recipients: recips,
          message: formatted,
          test: true, // one-time manual send: bypass quiet hours / rate limit, no schedule
        },
      });
      if (error) throw error;
      const errs = (data as any)?.errors ?? [];
      if (errs.length) toast.error(errs.join("\n"));
      else { toast.success(`Sent to ${recips.length} recipient(s)`); setCustomMsg(""); }
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setCustomSending(false);
    }
  };

  const sendTest = async () => {
    if (!activeOrg?.id) return;
    const recipient = testNum.trim();
    if (!/^\+?\d{6,}$/.test(recipient)) { toast.error("Enter a valid E.164 number to test"); return; }
    const { data, error } = await supabase.functions.invoke("escalate-offline-whatsapp", {
      body: {
        organization_id: activeOrg.id,
        recipients: [recipient],
        message: "✅ ABC Glance — Mudslide WhatsApp test from settings",
        test: true,
      },
    });
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.errors?.length) { toast.error(JSON.stringify((data as any).errors)); return; }
    toast.success("Test message sent");
  };

  const broadcastOffline = async () => {
    if (!activeOrg?.id) return;
    const target = broadcastTo.trim();
    const recipients = target ? [target] : settings.default_recipients;
    if (!recipients.length) { toast.error("Add a recipient/group or set default recipients"); return; }
    for (const r of recipients) {
      if (!isValidRecipient(r)) { toast.error(`Invalid recipient: ${r}`); return; }
    }
    setBroadcasting(true);
    try {
      // Poll each enabled NVR live (same approach as the NVR Status page).
      const enabledFrigates = store.frigates.filter((f) => f.enabled);
      console.log("[broadcast] enabled NVRs:", enabledFrigates.map((f) => ({ id: f.id, name: f.name, base_url: f.base_url, is_local: f.is_local })));
      if (!enabledFrigates.length) { toast.error("No enabled NVRs to query"); setBroadcasting(false); return; }

      const results = await Promise.all(enabledFrigates.map(async (f) => {
        try {
          const stats = await fetchFrigateStats(f);
          const offlineCameras = parseOfflineCams(stats);
          console.log(`[broadcast] ${f.name} stats keys:`, Object.keys((stats as any) ?? {}), "→ offline:", offlineCameras);
          return { name: f.name, reachable: true, offlineCameras };
        } catch (e) {
          console.warn(`[broadcast] ${f.name} unreachable:`, e);
          return { name: f.name, reachable: false, offlineCameras: [] as string[] };
        }
      }));

      const totalOffline = results.reduce((a, r) => a + r.offlineCameras.length, 0);
      const anyUnreachable = results.some((r) => !r.reachable);
      console.log("[broadcast] results:", results, "totalOffline:", totalOffline, "anyUnreachable:", anyUnreachable);
      if (totalOffline === 0 && !anyUnreachable) {
        toast.success("No cameras are currently offline");
        setBroadcasting(false);
        return;
      }

      // Only include NVRs that have something to report.
      const nvrsPayload = results.filter((r) => !r.reachable || r.offlineCameras.length > 0);

      const { data, error } = await supabase.functions.invoke("escalate-offline-whatsapp", {
        body: {
          organization_id: activeOrg.id,
          recipients,
          nvrs: nvrsPayload,
          minutes: 0,
          test: true, // bypass quiet hours / rate limit for manual broadcast
        },
      });
      if (error) throw error;
      const errs = (data as any)?.errors ?? [];
      if (errs.length) toast.error(errs.join("\n"));
      else toast.success(`Sent summary of ${totalOffline} offline camera(s) to ${recipients.length} recipient(s)`);
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setBroadcasting(false);
    }
  };

  if (loading) {
    return <DashboardLayout title="WhatsApp Alerts" subtitle="Loading…"><div className="text-sm text-muted-foreground">Loading…</div></DashboardLayout>;
  }

  return (
    <DashboardLayout
      title="WhatsApp Alerts"
      subtitle="Send offline-camera alerts via your self-hosted Mudslide instance"
    >
      <Card className="bg-gradient-card border-border shadow-card p-5 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <MessageCircle className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-foreground">Global WhatsApp settings</h3>
          <div className="ml-auto flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Enabled</Label>
            <Switch checked={settings.enabled} onCheckedChange={(v) => setSettings({ ...settings, enabled: v })} />
          </div>
        </div>

        <Tabs defaultValue="connection">
          <TabsList>
            <TabsTrigger value="connection">Connection</TabsTrigger>
            <TabsTrigger value="recipients">Recipients</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="schedule">Schedule & limits</TabsTrigger>
          </TabsList>

          <TabsContent value="connection" className="space-y-3 pt-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Mudslide URL</Label>
              <Input value={settings.mudslide_url ?? ""} placeholder="https://wa.example.com"
                onChange={(e) => setSettings({ ...settings, mudslide_url: e.target.value })}
                className="bg-secondary border-border font-mono text-sm" />
              <p className="text-[11px] text-muted-foreground">Public HTTPS URL of your Mudslide proxy. No trailing slash.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bearer token</Label>
              <Input type="password" value={settings.mudslide_token ?? ""} placeholder="Long random token"
                onChange={(e) => setSettings({ ...settings, mudslide_token: e.target.value })}
                className="bg-secondary border-border font-mono text-sm" />
              <p className="text-[11px] text-muted-foreground">Sent as <code>Authorization: Bearer ...</code> on every request.</p>
            </div>
            <div className="pt-2 border-t border-border space-y-1.5">
              <Label className="text-xs">Send test message</Label>
              <div className="flex gap-2">
                <Input value={testNum} onChange={(e) => setTestNum(e.target.value)} placeholder="+27821234567" className="bg-secondary border-border" />
                <Button size="sm" variant="secondary" onClick={sendTest}><Send className="h-3.5 w-3.5 mr-1" />Test</Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="recipients" className="space-y-3 pt-4">
            <Label className="text-xs">Default recipients (E.164)</Label>
            <RecipientList value={settings.default_recipients} onChange={(v) => setSettings({ ...settings, default_recipients: v })} />
            <p className="text-[11px] text-muted-foreground">Used when an NVR has no per-NVR recipients set.</p>
          </TabsContent>

          <TabsContent value="templates" className="space-y-3 pt-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Alert template</Label>
              <Textarea rows={4} value={settings.alert_template} onChange={(e) => setSettings({ ...settings, alert_template: e.target.value })}
                className="bg-secondary border-border font-mono text-xs" />
              <p className="text-[11px] text-muted-foreground">Variables: <code>{"{{nvr}}"}</code>, <code>{"{{count}}"}</code>, <code>{"{{minutes}}"}</code>, <code>{"{{cameras}}"}</code>, <code>{"{{status}}"}</code></p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Recovery template</Label>
              <Textarea rows={2} value={settings.recovery_template} onChange={(e) => setSettings({ ...settings, recovery_template: e.target.value })}
                className="bg-secondary border-border font-mono text-xs" />
              <p className="text-[11px] text-muted-foreground">Variables: <code>{"{{nvr}}"}</code>, <code>{"{{camera}}"}</code></p>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-2.5">
              <div><div className="text-sm">Send recovery messages</div><div className="text-[11px] text-muted-foreground">Notify when an offline camera comes back</div></div>
              <Switch checked={settings.send_recovery} onCheckedChange={(v) => setSettings({ ...settings, send_recovery: v })} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-2.5">
              <div><div className="text-sm">Alert on NVR unreachable</div><div className="text-[11px] text-muted-foreground">Send when the NVR itself stops responding</div></div>
              <Switch checked={settings.include_nvr_unreachable} onCheckedChange={(v) => setSettings({ ...settings, include_nvr_unreachable: v })} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-2.5">
              <div><div className="text-sm">Batch multiple cameras</div><div className="text-[11px] text-muted-foreground">Combine cameras of the same NVR into one message</div></div>
              <Switch checked={settings.batch_alerts} onCheckedChange={(v) => setSettings({ ...settings, batch_alerts: v })} />
            </div>
          </TabsContent>

          <TabsContent value="schedule" className="space-y-3 pt-4">
            <div className="flex items-center justify-between rounded-md border border-border p-2.5">
              <div><div className="text-sm">Quiet hours</div><div className="text-[11px] text-muted-foreground">Suppress alerts in this window (test sends still go through)</div></div>
              <Switch checked={settings.quiet_hours_enabled} onCheckedChange={(v) => setSettings({ ...settings, quiet_hours_enabled: v })} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Quiet start</Label>
                <Input type="time" value={settings.quiet_start ?? ""} onChange={(e) => setSettings({ ...settings, quiet_start: e.target.value })} className="bg-secondary border-border" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Quiet end</Label>
                <Input type="time" value={settings.quiet_end ?? ""} onChange={(e) => setSettings({ ...settings, quiet_end: e.target.value })} className="bg-secondary border-border" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Timezone</Label>
                <Input value={settings.quiet_timezone} onChange={(e) => setSettings({ ...settings, quiet_timezone: e.target.value })} className="bg-secondary border-border" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Max alerts per hour</Label>
                <Input type="number" min={0} value={settings.max_alerts_per_hour}
                  onChange={(e) => setSettings({ ...settings, max_alerts_per_hour: Number(e.target.value) })}
                  className="bg-secondary border-border" />
                <p className="text-[11px] text-muted-foreground">0 = unlimited</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Per-camera cooldown (minutes)</Label>
                <Input type="number" min={0} value={settings.cooldown_minutes}
                  onChange={(e) => setSettings({ ...settings, cooldown_minutes: Number(e.target.value) })}
                  className="bg-secondary border-border" />
                <p className="text-[11px] text-muted-foreground">Won't re-alert the same camera within this window</p>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end pt-4">
          <Button onClick={save} disabled={saving}><Save className="h-3.5 w-3.5 mr-1" />{saving ? "Saving…" : "Save settings"}</Button>
        </div>
      </Card>

      <Card className="bg-gradient-card border-border shadow-card p-5 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Megaphone className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-foreground">Scheduled daily broadcast</h3>
          <div className="ml-auto flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Enabled</Label>
            <Switch checked={settings.daily_broadcast_enabled}
              onCheckedChange={(v) => setSettings({ ...settings, daily_broadcast_enabled: v })} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Once per day at the time below (in the timezone on the Schedule tab), a summary of every currently-offline camera is sent to the recipients/group below.
        </p>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Send at (HH:MM, {settings.quiet_timezone})</Label>
            <Input type="time" value={settings.daily_broadcast_time}
              onChange={(e) => setSettings({ ...settings, daily_broadcast_time: e.target.value || "08:00" })}
              className="bg-secondary border-border w-40" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Recipients / group(s)</Label>
            <RecipientList value={settings.daily_broadcast_recipients}
              onChange={(v) => setSettings({ ...settings, daily_broadcast_recipients: v })}
              placeholder="+27821234567 or 12345-67890@g.us" />
            <p className="text-[11px] text-muted-foreground">If empty, the global default recipients are used.</p>
          </div>
        </div>
        <div className="flex justify-end pt-3">
          <Button size="sm" onClick={save} disabled={saving}>
            <Save className="h-3.5 w-3.5 mr-1" />{saving ? "Saving…" : "Save daily broadcast"}
          </Button>
        </div>
      </Card>

      <Card className="bg-gradient-card border-border shadow-card p-5 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Megaphone className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-foreground">Broadcast offline summary now</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Sends a single message listing every camera currently offline across all NVRs. Leave the recipient blank to use your default recipients, or enter one phone number (E.164) or WhatsApp group JID (e.g. <code className="font-mono">12345-67890@g.us</code>).
        </p>
        <div className="flex gap-2">
          <Input value={broadcastTo} onChange={(e) => setBroadcastTo(e.target.value)}
            placeholder="+27821234567  or  12345-67890@g.us"
            className="bg-secondary border-border font-mono text-sm" />
          <Button onClick={broadcastOffline} disabled={broadcasting}>
            <Send className="h-3.5 w-3.5 mr-1" />{broadcasting ? "Sending…" : "Send now"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Tip: to get a group JID, send a message in the group from the Mudslide host and run <code className="font-mono">mudslide groups</code>.
        </p>
      </Card>

      <Card className="bg-gradient-card border-border shadow-card p-5 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Megaphone className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-foreground">Broadcast message</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          One-time custom message sent to every WhatsApp recipient on the NVRs you select. Formatted to match the offline-alert style. Quiet hours and rate limits are bypassed.
        </p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Message</Label>
            <Textarea rows={4} value={customMsg} onChange={(e) => setCustomMsg(e.target.value)}
              placeholder="Type the message to broadcast…"
              className="bg-secondary border-border text-sm" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Send to recipients of these NVRs</Label>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" type="button"
                  onClick={() => setCustomSelected(Object.fromEntries(nvrs.map((n) => [n.id, true])))}>
                  Select all
                </Button>
                <Button size="sm" variant="ghost" type="button"
                  onClick={() => setCustomSelected({})}>
                  Clear
                </Button>
              </div>
            </div>
            <div className="rounded-md border border-border p-2 grid sm:grid-cols-2 gap-1.5 max-h-56 overflow-auto">
              {nvrs.length === 0 && <span className="text-xs text-muted-foreground italic">No NVRs configured.</span>}
              {nvrs.map((n) => {
                const count = (n.whatsapp_recipients ?? []).filter(isValidRecipient).length;
                return (
                  <label key={n.id} className="flex items-center gap-2 text-sm px-1.5 py-1 rounded hover:bg-secondary cursor-pointer">
                    <input type="checkbox" className="accent-primary"
                      checked={!!customSelected[n.id]}
                      onChange={(e) => setCustomSelected({ ...customSelected, [n.id]: e.target.checked })} />
                    <span className="flex-1 truncate">{n.name}</span>
                    <span className="text-[11px] text-muted-foreground">{count} recipient{count === 1 ? "" : "s"}</span>
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
      </Card>





      <Card className="bg-gradient-card border-border shadow-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Server className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-foreground">Per-NVR overrides</h3>
        </div>
        {nvrs.length === 0 && <p className="text-sm text-muted-foreground italic">No NVRs configured.</p>}
        <div className="space-y-3">
          {nvrs.map((n, i) => (
            <div key={n.id} className="rounded-md border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="font-medium text-sm flex-1">{n.name}</div>
                <Label className="text-xs text-muted-foreground">WhatsApp on</Label>
                <Switch checked={n.whatsapp_alert_enabled}
                  onCheckedChange={(v) => setNvrs(nvrs.map((x, j) => j === i ? { ...x, whatsapp_alert_enabled: v } : x))} />
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Recipients (overrides default)</Label>
                  <RecipientList value={n.whatsapp_recipients ?? []}
                    onChange={(v) => setNvrs(nvrs.map((x, j) => j === i ? { ...x, whatsapp_recipients: v } : x))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Alert after (minutes, blank = same as email)</Label>
                  <Input type="number" min={1} value={n.whatsapp_alert_minutes ?? ""}
                    placeholder={String(n.offline_alert_minutes)}
                    onChange={(e) => setNvrs(nvrs.map((x, j) => j === i ? { ...x, whatsapp_alert_minutes: e.target.value === "" ? null : Number(e.target.value) } : x))}
                    className="bg-secondary border-border w-40" />
                </div>
              </div>

              {/* Multi-client per-camera routing */}
              <div className="flex items-center justify-between rounded-md border border-border p-2.5">
                <div>
                  <div className="text-sm">Multi-client NVR</div>
                  <div className="text-[11px] text-muted-foreground">Route each camera's offline alert to its own recipients (falls back to the NVR recipients above).</div>
                </div>
                <Switch checked={n.multi_client}
                  onCheckedChange={(v) => setNvrs(nvrs.map((x, j) => j === i ? { ...x, multi_client: v } : x))} />
              </div>

              {n.multi_client && (
                <div className="rounded-md border border-border p-3 space-y-2">
                  <div className="text-xs font-medium">Per-camera recipients</div>
                  {(nvrCameras[n.id] ?? []).length === 0 && (
                    <p className="text-[11px] text-muted-foreground italic">No cameras seen yet for this NVR. They'll appear here after the next status poll (max ~1 min).</p>
                  )}
                  <div className="space-y-2">
                    {(nvrCameras[n.id] ?? []).map((cam) => (
                      <div key={cam} className="grid md:grid-cols-[180px_1fr] gap-2 items-start">
                        <div className="text-xs font-mono pt-2">{cam}</div>
                        <RecipientList
                          value={n.camera_whatsapp_recipients?.[cam] ?? []}
                          onChange={(v) => setNvrs(nvrs.map((x, j) => j === i ? {
                            ...x,
                            camera_whatsapp_recipients: { ...(x.camera_whatsapp_recipients ?? {}), [cam]: v },
                          } : x))}
                          placeholder="+27821234567 or 12345-67890@g.us"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}


              <div className="flex justify-end">
                <Button size="sm" variant="secondary" onClick={() => saveNvr(n)}><Save className="h-3.5 w-3.5 mr-1" />Save</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </DashboardLayout>
  );
}
