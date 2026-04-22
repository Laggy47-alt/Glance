import { DashboardLayout } from "@/components/DashboardLayout";
import { useMqttStore } from "@/hooks/useMqttStore";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const Settings = () => {
  const store = useMqttStore();
  const cfg = store.config;

  const update = (patch: Partial<typeof cfg>) => store.setConfig(patch);

  const apply = () => {
    store.disconnect();
    setTimeout(() => store.connect(), 100);
    toast.success("Reconnecting…");
  };

  return (
    <DashboardLayout title="Settings" subtitle="Broker connection & runtime options">
      <div className="grid lg:grid-cols-2 gap-4 max-w-5xl">
        <Card className="bg-gradient-card border-border shadow-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Demo Mode</h3>
              <p className="text-xs text-muted-foreground">Generate fake MQTT traffic — no broker needed</p>
            </div>
            <Switch checked={cfg.demoMode} onCheckedChange={(v) => update({ demoMode: v })} />
          </div>
        </Card>

        <Card className="bg-gradient-card border-border shadow-card p-5 space-y-4">
          <h3 className="text-sm font-semibold">Broker (MQTT over WebSocket)</h3>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Host</Label>
              <Input value={cfg.host} onChange={(e) => update({ host: e.target.value })} placeholder="192.168.1.100" className="bg-secondary border-border font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Port</Label>
              <Input type="number" value={cfg.port} onChange={(e) => update({ port: Number(e.target.value) })} className="bg-secondary border-border font-mono" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Path</Label>
            <Input value={cfg.path} onChange={(e) => update({ path: e.target.value })} placeholder="/mqtt" className="bg-secondary border-border font-mono" />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs">TLS (wss://)</Label>
            <Switch checked={cfg.secure} onCheckedChange={(v) => update({ secure: v })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Username</Label>
              <Input value={cfg.username ?? ""} onChange={(e) => update({ username: e.target.value })} className="bg-secondary border-border" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Password</Label>
              <Input type="password" value={cfg.password ?? ""} onChange={(e) => update({ password: e.target.value })} className="bg-secondary border-border" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Client ID</Label>
            <Input value={cfg.clientId} onChange={(e) => update({ clientId: e.target.value })} className="bg-secondary border-border font-mono" />
          </div>

          <Button onClick={apply} className="w-full bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-glow">
            Apply & Reconnect
          </Button>

          {store.error && <p className="text-xs text-destructive">{store.error}</p>}
        </Card>

        <Card className="lg:col-span-2 bg-warning/10 border-warning/30 p-4 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div className="text-xs text-foreground/90 space-y-1">
            <p className="font-semibold text-warning">Mosquitto WebSocket setup required</p>
            <p>Browsers cannot connect to raw MQTT on port <code className="text-accent">1883</code>. You must enable a WebSocket listener in <code className="text-accent">mosquitto.conf</code>:</p>
            <pre className="bg-background/60 border border-border rounded p-2 mt-2 font-mono text-[11px] leading-relaxed">{`listener 1883
protocol mqtt

listener 9001
protocol websockets`}</pre>
            <p>Then restart mosquitto and connect this dashboard to <code className="text-accent">your-host:9001</code>.</p>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default Settings;
