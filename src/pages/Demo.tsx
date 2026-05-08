import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useMemo, useState } from "react";
import { toast } from "@/hooks/use-toast";
import {
  Bell, BellOff, Camera, X, Archive as ArchiveIcon, MessageSquare, Tag as TagIcon,
  RotateCcw, Sparkles, Plus, Trash2, Server, Palette, Mail, Send, CheckCircle2, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Live Wall demo data
// ─────────────────────────────────────────────────────────────────────────────
type DemoAlert = {
  key: string; camera: string; site: string; label: string; ts: string;
  snapshotUrl: string; clipUrl: string; score?: number;
};

const STORAGE = "https://bgczubehzofjvjenozof.supabase.co/storage/v1/object/public/camera-snapshots/demo";
const SEED: DemoAlert[] = [
  { key: "demo-1", camera: "maritha_hof_6", site: "ABC · Hagerhof", label: "person", ts: "2026-05-08T09:11:35.121Z", score: 0.87, snapshotUrl: `${STORAGE}/snap-1.jpg`, clipUrl: `${STORAGE}/clip-1.mp4` },
  { key: "demo-2", camera: "eden_1", site: "ABC · Hagerhof", label: "person", ts: "2026-05-08T09:08:55.116Z", score: 0.79, snapshotUrl: `${STORAGE}/snap-2.jpg`, clipUrl: `${STORAGE}/clip-2.mp4` },
  { key: "demo-3", camera: "perimeter_5", site: "ABC · Eikenwater", label: "person", ts: "2026-05-08T09:07:24.216Z", score: 0.82, snapshotUrl: `${STORAGE}/snap-3.jpg`, clipUrl: `${STORAGE}/clip-3.mp4` },
  { key: "demo-4", camera: "3_peeka_front", site: "ABC · Peeka", label: "person", ts: "2026-05-08T09:03:32.611Z", score: 0.91, snapshotUrl: `${STORAGE}/snap-4.jpg`, clipUrl: `${STORAGE}/clip-4.mp4` },
  { key: "demo-5", camera: "3_peeka_front", site: "ABC · Peeka", label: "person", ts: "2026-05-08T09:02:15.882Z", score: 0.76, snapshotUrl: `${STORAGE}/snap-5.jpg`, clipUrl: `${STORAGE}/clip-5.mp4` },
];

type LB = { snapshotUrl: string; clipUrl: string; camera: string; site: string; ts: string; label: string };

// ─────────────────────────────────────────────────────────────────────────────
// NVR demo data
// ─────────────────────────────────────────────────────────────────────────────
type DemoNvr = {
  id: string; name: string; base_url: string; color: string;
  enabled: boolean; poll_enabled: boolean; mute_enabled: boolean;
  mute_start: string; mute_end: string; cameras: number; last_polled: string;
};

const NVR_SEED: DemoNvr[] = [
  { id: "n1", name: "ABC_NUK", base_url: "https://abc-nuk.firstglance.digital", color: "#3b82f6", enabled: true, poll_enabled: true, mute_enabled: true, mute_start: "06:00", mute_end: "17:30", cameras: 12, last_polled: "12s ago" },
  { id: "n2", name: "Hagerhof", base_url: "https://hagerhof-frigate.local", color: "#10b981", enabled: true, poll_enabled: true, mute_enabled: false, mute_start: "06:00", mute_end: "17:30", cameras: 8, last_polled: "9s ago" },
  { id: "n3", name: "Eikenwater", base_url: "https://eikenwater.firstglance.digital", color: "#f59e0b", enabled: true, poll_enabled: true, mute_enabled: true, mute_start: "07:00", mute_end: "18:00", cameras: 6, last_polled: "5s ago" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Daily Reports demo data
// ─────────────────────────────────────────────────────────────────────────────
type DemoReport = {
  id: string; nvr: string; recipients: string; cameras: string;
  enabled: boolean; last_sent: string;
};
const REPORT_SEED: DemoReport[] = [
  { id: "r1", nvr: "ABC_NUK", recipients: "ops@abc.com, manager@abc.com", cameras: "all (12)", enabled: true, last_sent: "Today 06:00" },
  { id: "r2", nvr: "Hagerhof", recipients: "guard@hagerhof.com", cameras: "perimeter_*, eden_1", enabled: true, last_sent: "Today 06:00" },
  { id: "r3", nvr: "Eikenwater", recipients: "alerts@eikenwater.com", cameras: "all (6)", enabled: false, last_sent: "—" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
const Demo = () => {
  const [tab, setTab] = useState("wall");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/40 backdrop-blur sticky top-0 z-20">
        <div className="px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Glance — Customer Demo</h1>
            <Badge variant="outline" className="ml-1 uppercase tracking-wider">Demo</Badge>
          </div>
          <p className="text-xs text-muted-foreground hidden md:block ml-2">
            Sandbox. No changes are saved.
          </p>
        </div>
        <div className="px-6 pb-2">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="wall"><Bell className="h-3.5 w-3.5 mr-1.5" />Live Wall</TabsTrigger>
              <TabsTrigger value="nvrs"><Server className="h-3.5 w-3.5 mr-1.5" />NVRs</TabsTrigger>
              <TabsTrigger value="brand"><Palette className="h-3.5 w-3.5 mr-1.5" />Customization</TabsTrigger>
              <TabsTrigger value="reports"><Mail className="h-3.5 w-3.5 mr-1.5" />Daily Reports</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      <main className="p-4">
        {tab === "wall" && <WallTab />}
        {tab === "nvrs" && <NvrsTab />}
        {tab === "brand" && <BrandTab />}
        {tab === "reports" && <ReportsTab />}
      </main>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Wall tab
// ─────────────────────────────────────────────────────────────────────────────
function WallTab() {
  const [alerts, setAlerts] = useState<DemoAlert[]>(SEED);
  const [muted, setMuted] = useState(false);
  const [lightbox, setLightbox] = useState<LB | null>(null);
  const ack = (key: string) => setAlerts((p) => p.filter((a) => a.key !== key));
  const reset = () => setAlerts(SEED);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold">Live Wall</h2>
          <p className="text-xs text-muted-foreground">Idle screen — incoming snapshots pop up here. Click an alert to play the clip; press ACK to dismiss.</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success pulse-dot" />
            {alerts.length} active
          </Badge>
          <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            <Switch checked={!muted} onCheckedChange={(v) => setMuted(!v)} />
          </div>
        </div>
      </div>

      <div className="relative h-[calc(100vh-12rem)] rounded-lg border border-border bg-gradient-to-br from-background via-background to-secondary/30 overflow-hidden">
        {alerts.length === 0 && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="text-center space-y-3">
              <div className="mx-auto h-16 w-16 rounded-full bg-secondary/50 grid place-items-center">
                <Camera className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">All ACKed — press Reset to repopulate the demo.</p>
            </div>
          </div>
        )}
        <div className="absolute inset-0 overflow-y-auto p-4">
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(240px,1fr))] auto-rows-min">
            {alerts.map((a) => (
              <DemoCard
                key={a.key}
                alert={a}
                onArchive={() => ack(a.key)}
                onDismiss={() => ack(a.key)}
                onOpen={() => setLightbox({ ...a })}
                onTag={() => setLightbox({ ...a })}
              />
            ))}
          </div>
        </div>
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur flex items-center justify-center p-6" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 p-2 rounded-full bg-card border border-border hover:bg-muted" onClick={() => setLightbox(null)} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
          <div className="max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold capitalize">{lightbox.camera}</h2>
              <Badge variant="outline">{lightbox.site}</Badge>
              <Badge variant="secondary" className="capitalize">{lightbox.label}</Badge>
              <span className="ml-auto text-sm text-muted-foreground">{new Date(lightbox.ts).toLocaleString()}</span>
            </div>
            <video key={lightbox.clipUrl} src={lightbox.clipUrl} poster={lightbox.snapshotUrl} controls autoPlay className="w-full rounded-lg border border-border bg-black" />
          </div>
        </div>
      )}
    </div>
  );
}

function DemoCard({ alert, onArchive, onDismiss, onOpen, onTag }: {
  alert: DemoAlert; onArchive: () => void; onDismiss: () => void; onOpen: () => void; onTag: () => void;
}) {
  const snapUrl = useMemo(() => alert.snapshotUrl, [alert.snapshotUrl]);
  return (
    <div className={cn("pointer-events-auto w-full rounded-lg border border-border bg-card/95 backdrop-blur shadow-lg overflow-hidden", "animate-in zoom-in-95 fade-in duration-300")}>
      <div className="px-2 py-1.5 border-b border-border bg-secondary/40">
        <div className="text-xs font-semibold text-foreground capitalize truncate" title={`${alert.site} · ${alert.camera}`}>{alert.camera}</div>
      </div>
      <button type="button" onClick={onOpen} className="relative aspect-video bg-black w-full block cursor-pointer group" aria-label="Open clip">
        <img src={snapUrl} alt={alert.camera} className="w-full h-full object-cover" />
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-destructive/90 text-destructive-foreground px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold">
          <span className="h-1 w-1 rounded-full bg-destructive-foreground pulse-dot" /> Live
        </div>
        <div className="absolute bottom-1.5 left-1.5 bg-black/70 text-foreground/90 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold opacity-0 group-hover:opacity-100 transition-opacity">Play clip</div>
        <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onDismiss(); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onDismiss(); } }} className="absolute top-1.5 right-1.5 h-6 w-6 grid place-items-center rounded-full bg-black/60 hover:bg-black/80 text-foreground/90" aria-label="Dismiss">
          <X className="h-3.5 w-3.5" />
        </span>
      </button>
      <div className="p-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-foreground capitalize truncate">{alert.site} · {alert.camera}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums truncate">
            {new Date(alert.ts).toLocaleTimeString()}
            {alert.score != null && ` · ${(alert.score * 100).toFixed(0)}%`}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={onTag} className="gap-1 h-7 px-2 text-[11px]" title="Open snapshot"><TagIcon className="h-3 w-3" /></Button>
          <Button size="sm" variant="ghost" className="gap-1 h-7 px-2 text-[11px]" title="Comment (disabled in demo)" disabled><MessageSquare className="h-3 w-3" /></Button>
          <Button size="sm" variant="secondary" onClick={onArchive} className="gap-1 h-7 px-2 text-[11px]"><ArchiveIcon className="h-3 w-3" /> ACK</Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NVRs tab
// ─────────────────────────────────────────────────────────────────────────────
function NvrsTab() {
  const [nvrs, setNvrs] = useState<DemoNvr[]>(NVR_SEED);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState("#3b82f6");

  const add = () => {
    if (!name.trim() || !url.trim()) {
      toast({ title: "Fill in name and URL", variant: "destructive" });
      return;
    }
    const next: DemoNvr = {
      id: `n${Date.now()}`, name: name.trim(), base_url: url.trim(), color,
      enabled: true, poll_enabled: true, mute_enabled: true,
      mute_start: "06:00", mute_end: "17:30",
      cameras: Math.floor(Math.random() * 8) + 4, last_polled: "just now",
    };
    setNvrs((p) => [...p, next]);
    toast({ title: `Added ${next.name}`, description: "Demo only — nothing was saved." });
    setName(""); setUrl(""); setColor("#3b82f6");
  };

  const remove = (id: string) => setNvrs((p) => p.filter((n) => n.id !== id));
  const toggle = (id: string, key: keyof DemoNvr) =>
    setNvrs((p) => p.map((n) => n.id === id ? { ...n, [key]: !n[key] } : n));
  const reset = () => setNvrs(NVR_SEED);

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">NVR Instances</h2>
          <p className="text-xs text-muted-foreground">Connect Frigate NVRs, set polling and after-hours mute windows. Demo only — no real connections.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> Add an NVR</CardTitle>
          <CardDescription>Name, base URL and a colour to tag it on the wall.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 grid-cols-1 md:grid-cols-[1fr_2fr_auto_auto]">
          <div>
            <Label htmlFor="nvr-name">Name</Label>
            <Input id="nvr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. North Yard" />
          </div>
          <div>
            <Label htmlFor="nvr-url">Base URL</Label>
            <Input id="nvr-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://nvr.example.com" />
          </div>
          <div>
            <Label htmlFor="nvr-color">Colour</Label>
            <Input id="nvr-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-16 p-1" />
          </div>
          <div className="flex items-end">
            <Button onClick={add} className="gap-1.5"><Plus className="h-4 w-4" /> Add</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {nvrs.map((n) => (
          <Card key={n.id}>
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                <span className="h-10 w-10 rounded-md border border-border shrink-0" style={{ backgroundColor: n.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{n.name}</h3>
                    <Badge variant={n.enabled ? "secondary" : "outline"}>{n.enabled ? "Enabled" : "Disabled"}</Badge>
                    {n.poll_enabled && <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" /> polling</Badge>}
                    {n.mute_enabled && <Badge variant="outline" className="gap-1"><BellOff className="h-3 w-3" /> {n.mute_start}–{n.mute_end}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{n.base_url}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span><Camera className="h-3 w-3 inline mr-1" />{n.cameras} cameras</span>
                    <span>last poll: {n.last_polled}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2 items-end shrink-0">
                  <div className="flex items-center gap-2 text-xs">
                    Enabled <Switch checked={n.enabled} onCheckedChange={() => toggle(n.id, "enabled")} />
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    Mute <Switch checked={n.mute_enabled} onCheckedChange={() => toggle(n.id, "mute_enabled")} />
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => remove(n.id)} className="text-destructive gap-1 h-7">
                    <Trash2 className="h-3 w-3" /> Remove
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Customization tab
// ─────────────────────────────────────────────────────────────────────────────
function BrandTab() {
  const [appName, setAppName] = useState("Glance");
  const [subtitle, setSubtitle] = useState("Event Dashboard");
  const [logoUrl, setLogoUrl] = useState("");
  const [primary, setPrimary] = useState("#3b82f6");

  const reset = () => { setAppName("Glance"); setSubtitle("Event Dashboard"); setLogoUrl(""); setPrimary("#3b82f6"); };

  return (
    <div className="grid gap-4 md:grid-cols-2 max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Palette className="h-4 w-4" /> Branding</CardTitle>
          <CardDescription>Change how your dashboard looks for your team.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="b-name">App name</Label>
            <Input id="b-name" value={appName} onChange={(e) => setAppName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="b-sub">Subtitle</Label>
            <Input id="b-sub" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="b-logo">Logo URL</Label>
            <Input id="b-logo" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" />
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label htmlFor="b-color">Primary colour</Label>
              <Input id="b-color" type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-10 w-full p-1" />
            </div>
            <Button variant="outline" onClick={reset} className="gap-1.5"><RotateCcw className="h-4 w-4" /> Reset</Button>
          </div>
          <p className="text-xs text-muted-foreground">Demo only — changes are not saved.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live Preview</CardTitle>
          <CardDescription>How operators see the header.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-border p-4 bg-card flex items-center gap-3">
            {logoUrl
              ? <img src={logoUrl} alt="logo" className="h-10 w-10 rounded object-cover bg-muted" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              : <div className="h-10 w-10 rounded grid place-items-center text-white font-bold" style={{ backgroundColor: primary }}>{appName.slice(0,1).toUpperCase()}</div>
            }
            <div>
              <div className="font-semibold leading-tight" style={{ color: primary }}>{appName || "App name"}</div>
              <div className="text-xs text-muted-foreground">{subtitle || "Subtitle"}</div>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button style={{ backgroundColor: primary, borderColor: primary }} className="text-white">Primary action</Button>
            <Button variant="outline">Secondary</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily Reports tab
// ─────────────────────────────────────────────────────────────────────────────
function ReportsTab() {
  const [reports, setReports] = useState<DemoReport[]>(REPORT_SEED);
  const [hour, setHour] = useState("06");
  const [minute, setMinute] = useState("00");
  const [subject, setSubject] = useState("Daily Report — {{nvr_name}} — {{date}}");
  const [body, setBody] = useState(`Daily report for {{nvr_name}}

Date: {{date}}

Cameras online: {{cameras_online_count}}
Cameras offline: {{cameras_offline_count}}

Positive incidents (last 24h): {{positive_incidents_count}}`);
  const [preview, setPreview] = useState<DemoReport | null>(null);

  const toggle = (id: string) => setReports((p) => p.map((r) => r.id === id ? { ...r, enabled: !r.enabled } : r));
  const sendNow = (r: DemoReport) => toast({
    title: `Pretend-sent to ${r.recipients.split(",").length} recipient(s)`,
    description: `${r.nvr} report — demo only.`,
  });
  const reset = () => setReports(REPORT_SEED);

  const renderTemplate = (tpl: string, r: DemoReport) =>
    tpl.replace(/\{\{nvr_name\}\}/g, r.nvr)
       .replace(/\{\{date\}\}/g, new Date().toLocaleDateString())
       .replace(/\{\{cameras_online_count\}\}/g, String(Math.max(0, parseInt(r.cameras) || 6)))
       .replace(/\{\{cameras_offline_count\}\}/g, "0")
       .replace(/\{\{positive_incidents_count\}\}/g, String(Math.floor(Math.random()*5)));

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Daily Reports</h2>
          <p className="text-xs text-muted-foreground">Auto-emailed every day to chosen recipients per NVR. Demo only — no emails go out.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send schedule & template</CardTitle>
          <CardDescription>When daily reports go out, and what they look like.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-3">
            <div>
              <Label>Send time (UTC)</Label>
              <div className="flex items-center gap-1">
                <Input className="w-16 text-center" value={hour} onChange={(e) => setHour(e.target.value)} />
                <span>:</span>
                <Input className="w-16 text-center" value={minute} onChange={(e) => setMinute(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground pb-2">Reports are sent at {hour}:{minute} UTC each day.</p>
          </div>
          <div>
            <Label htmlFor="r-subj">Subject</Label>
            <Input id="r-subj" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="r-body">Body template</Label>
            <Textarea id="r-body" value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="font-mono text-xs" />
            <p className="text-[11px] text-muted-foreground mt-1">
              Tokens: <code>{"{{nvr_name}}"}</code> <code>{"{{date}}"}</code> <code>{"{{cameras_online_count}}"}</code> <code>{"{{cameras_offline_count}}"}</code> <code>{"{{positive_incidents_count}}"}</code>
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {reports.map((r) => (
          <Card key={r.id}>
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                <Mail className="h-5 w-5 mt-1 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{r.nvr}</h3>
                    <Badge variant={r.enabled ? "secondary" : "outline"}>{r.enabled ? "Active" : "Paused"}</Badge>
                    <Badge variant="outline">Cameras: {r.cameras}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">To: {r.recipients}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" /> Last sent: {r.last_sent}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => setPreview(r)} className="gap-1 h-8">Preview</Button>
                  <Button size="sm" variant="outline" onClick={() => sendNow(r)} className="gap-1 h-8"><Send className="h-3 w-3" /> Send now</Button>
                  <div className="flex items-center gap-2 text-xs">
                    <Switch checked={r.enabled} onCheckedChange={() => toggle(r.id)} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur flex items-center justify-center p-6" onClick={() => setPreview(null)}>
          <div className="max-w-2xl w-full bg-card border border-border rounded-lg p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Email preview · {preview.nvr}</h3>
              <button onClick={() => setPreview(null)} className="p-1 rounded hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="text-xs text-muted-foreground mb-2">
              <div><strong>To:</strong> {preview.recipients}</div>
              <div><strong>Subject:</strong> {renderTemplate(subject, preview)}</div>
            </div>
            <pre className="rounded border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap font-mono">
{renderTemplate(body, preview)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default Demo;
