import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchOfflineAlertSettings, upsertOfflineAlertSettings,
} from "@/lib/unifiHealthStore";
import type { UnifiInstance } from "@/lib/webhookStore";

type Recipient = { type: "number" | "group"; value: string; label?: string };

export function UnifiOfflineAlertsDialog({
  instance, open, onOpenChange,
}: {
  instance: UnifiInstance | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { activeOrg } = useAuth();
  const [enabled, setEnabled] = useState(true);
  const [threshold, setThreshold] = useState(5);
  const [cooldown, setCooldown] = useState(60);
  const [notifyRecovery, setNotifyRecovery] = useState(true);
  const [dailyBroadcast, setDailyBroadcast] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !instance) return;
    setLoading(true);
    fetchOfflineAlertSettings(instance.id)
      .then((s) => {
        if (s) {
          setEnabled(s.enabled);
          setThreshold(s.threshold_minutes);
          setCooldown(s.cooldown_minutes);
          setNotifyRecovery(s.notify_on_recovery);
          setDailyBroadcast(!!s.daily_broadcast_enabled);
          setRecipients((s.recipients ?? []) as Recipient[]);
        } else {
          setEnabled(true); setThreshold(5); setCooldown(60);
          setNotifyRecovery(true); setDailyBroadcast(false); setRecipients([]);
        }
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, instance]);

  const addRecipient = (type: "number" | "group") =>
    setRecipients((r) => [...r, { type, value: "", label: "" }]);
  const updateRecipient = (i: number, patch: Partial<Recipient>) =>
    setRecipients((r) => r.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  const removeRecipient = (i: number) =>
    setRecipients((r) => r.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!instance || !activeOrg) return;
    const clean = recipients
      .map((r) => ({ ...r, value: String(r.value ?? "").trim(), label: (r.label ?? "").trim() || undefined }))
      .filter((r) => r.value);
    try {
      await upsertOfflineAlertSettings(activeOrg.id, {
        unifi_instance_id: instance.id,
        enabled,
        threshold_minutes: Math.max(1, Math.floor(threshold) || 5),
        cooldown_minutes: Math.max(1, Math.floor(cooldown) || 60),
        notify_on_recovery: notifyRecovery,
        daily_broadcast_enabled: dailyBroadcast,
        recipients: clean,
      });
      toast.success("Offline alert settings saved");
      onOpenChange(false);
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle>Camera offline alerts — {instance?.name}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4 pt-2">
            <div className="rounded-md border border-border bg-secondary/40 px-3 py-2.5 flex items-start gap-3">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <div className="flex-1">
                <p className="text-xs font-medium">Enable WhatsApp alerts when cameras go offline</p>
                <p className="text-[10px] text-muted-foreground">
                  Uses the same Mudslide WhatsApp bridge as regular event alerts.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Offline threshold (min)</Label>
                <Input type="number" min={1} value={threshold}
                       onChange={(e) => setThreshold(Number(e.target.value))}
                       className="bg-secondary border-border" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Cooldown between alerts (min)</Label>
                <Input type="number" min={1} value={cooldown}
                       onChange={(e) => setCooldown(Number(e.target.value))}
                       className="bg-secondary border-border" />
              </div>
            </div>

            <div className="rounded-md border border-border bg-secondary/40 px-3 py-2.5 flex items-start gap-3">
              <Switch checked={notifyRecovery} onCheckedChange={setNotifyRecovery} />
              <div className="flex-1">
                <p className="text-xs font-medium">Send recovery notification when a camera comes back online</p>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs">Recipients</Label>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => addRecipient("number")}>
                    <Plus className="h-3 w-3" /> Number
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => addRecipient("group")}>
                    <Plus className="h-3 w-3" /> Group
                  </Button>
                </div>
              </div>
              {recipients.length === 0 ? (
                <p className="text-[11px] text-muted-foreground italic">
                  No recipients yet. Add a phone number (e.g. 2782…) or a WhatsApp group ID (…@g.us).
                </p>
              ) : (
                <div className="space-y-2">
                  {recipients.map((r, i) => (
                    <div key={i} className="flex gap-1.5 items-center">
                      <span className="text-[10px] uppercase text-muted-foreground w-12">{r.type}</span>
                      <Input
                        placeholder={r.type === "group" ? "1203…@g.us" : "27821234567"}
                        value={r.value}
                        onChange={(e) => updateRecipient(i, { value: e.target.value })}
                        className="bg-secondary border-border font-mono text-xs flex-1"
                      />
                      <Input
                        placeholder="Label (optional)"
                        value={r.label ?? ""}
                        onChange={(e) => updateRecipient(i, { label: e.target.value })}
                        className="bg-secondary border-border text-xs w-32"
                      />
                      <Button size="icon" variant="ghost" onClick={() => removeRecipient(i)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Button onClick={save} className="w-full bg-gradient-primary text-primary-foreground hover:opacity-90">
              Save settings
            </Button>
            <p className="text-[10px] text-muted-foreground">
              Run <span className="font-mono">unifi-offline-check</span> on a cron (every 1–2 min) to actually dispatch alerts.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
