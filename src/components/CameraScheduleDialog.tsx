import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Clock, Copy, Loader2, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

type Row = {
  id?: string;
  weekday: number;
  arm_time: string | null;
  disarm_time: string | null;
  enabled: boolean;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CameraScheduleDialog({
  open, onOpenChange, instanceId, camera, instanceName, availableCameras = [],
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  instanceId: string;
  camera: string;
  instanceName: string;
  availableCameras?: string[];
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>(
    Array.from({ length: 7 }, (_, w) => ({ weekday: w, arm_time: null, disarm_time: null, enabled: false }))
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user || !open) return;
    setLoading(true);
    const { data } = await supabase
      .from("camera_arm_schedules")
      .select("id, weekday, arm_time, disarm_time, enabled")
      .eq("instance_id", instanceId)
      .eq("camera", camera);
    const base: Row[] = Array.from({ length: 7 }, (_, w) => ({
      weekday: w, arm_time: null, disarm_time: null, enabled: false,
    }));
    for (const r of data ?? []) {
      base[r.weekday] = {
        id: r.id,
        weekday: r.weekday,
        arm_time: r.arm_time ? r.arm_time.slice(0, 5) : null,
        disarm_time: r.disarm_time ? r.disarm_time.slice(0, 5) : null,
        enabled: r.enabled,
      };
    }
    setRows(base);
    setLoading(false);
  }, [user, open, instanceId, camera]);

  useEffect(() => { void load(); }, [load]);

  const update = (w: number, patch: Partial<Row>) => {
    setRows((p) => p.map((r) => (r.weekday === w ? { ...r, ...patch } : r)));
  };

  const copyMonToFri = () => {
    const mon = rows[1];
    setRows((p) => p.map((r) => (r.weekday >= 1 && r.weekday <= 5
      ? { ...r, arm_time: mon.arm_time, disarm_time: mon.disarm_time, enabled: mon.enabled }
      : r)));
  };

  const clearAll = () => {
    setRows(Array.from({ length: 7 }, (_, w) => ({ weekday: w, arm_time: null, disarm_time: null, enabled: false })));
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const toUpsert = rows
        .filter((r) => r.enabled && (r.arm_time || r.disarm_time))
        .map((r) => ({
          instance_id: instanceId,
          camera,
          weekday: r.weekday,
          arm_time: r.arm_time,
          disarm_time: r.disarm_time,
          enabled: true,
          updated_by: user.id,
        }));
      const toDelete = rows.filter((r) => r.id && (!r.enabled || (!r.arm_time && !r.disarm_time))).map((r) => r.id!);

      if (toUpsert.length) {
        const { error } = await supabase
          .from("camera_arm_schedules")
          .upsert(toUpsert, { onConflict: "instance_id,camera,weekday" });
        if (error) throw error;
      }
      if (toDelete.length) {
        const { error } = await supabase.from("camera_arm_schedules").delete().in("id", toDelete);
        if (error) throw error;
      }
      toast({ title: "Schedule saved", description: `${camera} on ${instanceName}` });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Failed to save", description: e?.message ?? String(e), variant: "destructive" });
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
            <Clock className="h-4 w-4 text-primary" />
            Auto arm/disarm schedule
          </DialogTitle>
          <DialogDescription>
            <span className="capitalize font-medium">{camera}</span> on {instanceName}. Times are in
            site local time (Africa/Johannesburg). The schedule always wins — manual toggles will be
            overridden at the next scheduled time.
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
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={copyMonToFri}>
                  Copy Mon → Tue–Fri
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={clearAll}>
                  <Trash2 className="h-3 w-3" /> Clear all
                </Button>
              </div>
            </div>

            <ul className="divide-y divide-border rounded-md border border-border">
              {rows.map((r) => (
                <li key={r.weekday} className="grid grid-cols-[60px_1fr_1fr_auto] items-center gap-3 px-3 py-2.5">
                  <span className="text-sm font-medium text-foreground">{DAYS[r.weekday]}</span>

                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 text-success" /> Arm
                    <Input
                      type="time"
                      value={r.arm_time ?? ""}
                      disabled={!r.enabled}
                      onChange={(e) => update(r.weekday, { arm_time: e.target.value || null })}
                      className="h-8 text-xs"
                    />
                  </label>

                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-500" /> Disarm
                    <Input
                      type="time"
                      value={r.disarm_time ?? ""}
                      disabled={!r.enabled}
                      onChange={(e) => update(r.weekday, { disarm_time: e.target.value || null })}
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
              Tip: leave one field blank if you only want to arm OR disarm that day.
              Set both to create a window (e.g. arm 18:00, disarm 06:00 the next morning).
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

export function CameraScheduleBadge({ instanceId, camera }: { instanceId: string; camera: string }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("camera_arm_schedules")
      .select("id", { count: "exact", head: true })
      .eq("instance_id", instanceId)
      .eq("camera", camera)
      .eq("enabled", true)
      .then(({ count }) => { if (!cancelled) setCount(count ?? 0); });
    return () => { cancelled = true; };
  }, [instanceId, camera]);
  if (!count) return null;
  return <Badge variant="outline" className="text-[10px] gap-1"><Clock className="h-2.5 w-2.5" />{count}d</Badge>;
}
