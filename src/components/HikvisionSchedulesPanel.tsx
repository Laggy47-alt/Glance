import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { CameraScheduleDialog } from "@/components/CameraScheduleDialog";
import type { HikvisionInstance, HikvisionChannel } from "@/lib/webhookStore";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export function HikvisionSchedulesPanel({
  inst,
  channels,
}: {
  inst: HikvisionInstance;
  channels: HikvisionChannel[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());

  const loadCounts = async () => {
    const { data } = await supabase
      .from("camera_arm_schedules")
      .select("camera, enabled")
      .eq("instance_id", inst.id);
    const m = new Map<string, number>();
    for (const r of data ?? []) {
      if (!r.enabled) continue;
      m.set(r.camera, (m.get(r.camera) ?? 0) + 1);
    }
    setCounts(m);
  };

  useEffect(() => { void loadCounts(); }, [inst.id]);

  if (channels.length === 0) return null;

  const cameraNames = channels.map((c) => c.name);

  return (
    <div className="rounded-md border border-border bg-secondary/30 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Auto arm/disarm schedules</span>
        <Badge variant="secondary" className="text-[9px]">SAST</Badge>
      </div>
      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
        {channels.map((c) => {
          const days = counts.get(c.name) ?? 0;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpen(c.name)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded border border-border bg-background/50 hover:bg-background transition-colors text-left"
              >
                <span className="text-xs capitalize truncate flex-1">{c.name}</span>
                {days > 0 ? (
                  <Badge variant="outline" className="text-[10px] gap-1">
                    <Clock className="h-2.5 w-2.5" /> {days}d
                  </Badge>
                ) : (
                  <span className="text-[10px] text-muted-foreground">No schedule</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {open && (
        <CameraScheduleDialog
          open={!!open}
          onOpenChange={(v) => { if (!v) { setOpen(null); void loadCounts(); } }}
          instanceId={inst.id}
          camera={open}
          instanceName={inst.name}
          availableCameras={cameraNames}
        />
      )}
    </div>
  );
}
