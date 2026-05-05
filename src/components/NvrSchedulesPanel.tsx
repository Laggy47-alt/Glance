import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { frigateUrl, type FrigateInstance } from "@/lib/webhookStore";
import { CameraScheduleDialog } from "@/components/CameraScheduleDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, Loader2, RefreshCw } from "lucide-react";

function parseCameras(stats: unknown): string[] {
  if (!stats || typeof stats !== "object") return [];
  const root = stats as Record<string, unknown>;
  const cameras = (root.cameras && typeof root.cameras === "object" ? root.cameras : root) as Record<string, unknown>;
  const reserved = new Set([
    "cpu_usages", "gpu_usages", "service", "detectors", "detection_fps",
    "processes", "bandwidth_usages", "version",
  ]);
  const out: string[] = [];
  for (const [name, val] of Object.entries(cameras)) {
    if (reserved.has(name)) continue;
    if (!val || typeof val !== "object") continue;
    const c = val as Record<string, any>;
    if ("camera_fps" in c || "process_fps" in c || "detection_fps" in c || "pid" in c) out.push(name);
  }
  return out.sort();
}

export function NvrSchedulesPanel({ inst }: { inst: FrigateInstance }) {
  const [cameras, setCameras] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [open, setOpen] = useState<string | null>(null);

  const loadCameras = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(frigateUrl(inst, "/api/stats"));
      if (!res.ok) throw new Error();
      setCameras(parseCameras(await res.json()));
    } catch {
      setCameras([]);
    } finally {
      setLoading(false);
    }
  }, [inst]);

  const loadCounts = useCallback(async () => {
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
  }, [inst.id]);

  useEffect(() => { void loadCameras(); void loadCounts(); }, [loadCameras, loadCounts]);

  return (
    <div className="rounded-md border border-border bg-secondary/30 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Auto arm/disarm schedules</span>
        <Badge variant="secondary" className="text-[9px]">SAST</Badge>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 ml-auto"
          onClick={() => { void loadCameras(); void loadCounts(); }}
          title="Refresh cameras"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading && cameras === null ? (
        <div className="text-xs text-muted-foreground py-2">
          <Loader2 className="h-3 w-3 inline animate-spin mr-1" /> Loading cameras…
        </div>
      ) : !cameras || cameras.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No cameras detected on this NVR.</p>
      ) : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
          {cameras.map((cam) => {
            const days = counts.get(cam) ?? 0;
            return (
              <li key={cam}>
                <button
                  type="button"
                  onClick={() => setOpen(cam)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded border border-border bg-background/50 hover:bg-background transition-colors text-left"
                >
                  <span className="text-xs capitalize truncate flex-1">{cam}</span>
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
      )}

      {open && (
        <CameraScheduleDialog
          open={!!open}
          onOpenChange={(v) => { if (!v) { setOpen(null); void loadCounts(); } }}
          instanceId={inst.id}
          camera={open}
          instanceName={inst.name}
        />
      )}
    </div>
  );
}
