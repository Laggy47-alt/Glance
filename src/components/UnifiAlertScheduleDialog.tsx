import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Clock, Loader2, MoonStar, Trash2 } from "lucide-react";

type Row = {
  id?: string;
  weekday: number;
  start_time: string; // HH:MM
  end_time: string;   // HH:MM
  enabled: boolean;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const emptyRows = (): Row[] =>
  Array.from({ length: 7 }, (_, w) => ({
    weekday: w, start_time: "18:00", end_time: "06:00", enabled: false,
  }));

export function UnifiAlertScheduleDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user, activeOrg } = useAuth();
  const [rows, setRows] = useState<Row[]>(emptyRows());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user || !activeOrg?.id || !open) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("unifi_alert_schedules")
      .select("id, weekday, start_time, end_time, enabled")
      .eq("organization_id", activeOrg.id);
    const base = emptyRows();
    for (const r of (data ?? []) as any[]) {
      base[r.weekday] = {
        id: r.id,
        weekday: r.weekday,
        start_time: (r.start_time ?? "18:00").slice(0, 5),
        end_time: (r.end_time ?? "06:00").slice(0, 5),
        enabled: !!r.enabled,
      };
    }
    setRows(base);
    setLoading(false);
  }, [user, activeOrg?.id, open]);

  useEffect(() => { void load(); }, [load]);

  const update = (w: number, patch: Partial<Row>) =>
    setRows((p) => p.map((r) => (r.weekday === w ? { ...r, ...patch } : r)));

  const applyNightly = () => {
    setRows((p) => p.map((r) => ({ ...r, start_time: "18:00", end_time: "06:00", enabled: true })));
  };

  const clearAll = () => setRows(emptyRows());

  const save = async () => {
    if (!user || !activeOrg?.id) return;
    setSaving(true);
    try {
      const toUpsert = rows.map((r) => ({
        organization_id: activeOrg.id,
        weekday: r.weekday,
        start_time: r.start_time,
        end_time: r.end_time,
        enabled: r.enabled,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await (supabase as any)
        .from("unifi_alert_schedules")
        .upsert(toUpsert, { onConflict: "organization_id,weekday" });
      if (error) throw error;
      toast.success("UniFi alert schedule saved");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const enabledCount = rows.filter((r) => r.enabled).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" /> UniFi alert schedule
          </DialogTitle>
          <DialogDescription>
            Only UniFi events that fall inside an enabled window are ingested. Everything
            outside is silently dropped at the server before it reaches the wall, WhatsApp,
            or daily reports. Times are in site local time (Africa/Johannesburg). A window
            may cross midnight — set start 18:00 and end 06:00 to allow overnight only.
            Leave all days disabled to allow alerts 24/7 (default).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 inline animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{enabledCount} of 7 days scheduled</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={applyNightly}>
                  <MoonStar className="h-3 w-3" /> Nightly 18:00 → 06:00
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={clearAll}>
                  <Trash2 className="h-3 w-3" /> Disable all
                </Button>
              </div>
            </div>

            <ul className="divide-y divide-border rounded-md border border-border">
              {rows.map((r) => (
                <li key={r.weekday} className="grid grid-cols-[60px_1fr_1fr_auto] items-center gap-3 px-3 py-2.5">
                  <span className="text-sm font-medium text-foreground">{DAYS[r.weekday]}</span>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    From
                    <Input
                      type="time"
                      value={r.start_time}
                      disabled={!r.enabled}
                      onChange={(e) => update(r.weekday, { start_time: e.target.value || "18:00" })}
                      className="h-8 text-xs"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    To
                    <Input
                      type="time"
                      value={r.end_time}
                      disabled={!r.enabled}
                      onChange={(e) => update(r.weekday, { end_time: e.target.value || "06:00" })}
                      className="h-8 text-xs"
                    />
                  </label>
                  <Switch
                    checked={r.enabled}
                    onCheckedChange={(v) => update(r.weekday, { enabled: v })}
                  />
                </li>
              ))}
            </ul>

            <p className="text-[11px] text-muted-foreground">
              Tip: end &lt; start crosses midnight (e.g. Mon 18:00 → 06:00 covers Mon evening
              until Tue morning). Only the weekday the window <em>starts</em> needs to be enabled.
            </p>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading} className="gap-1.5">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
