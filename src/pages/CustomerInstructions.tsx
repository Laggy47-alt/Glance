import { useEffect, useState, useCallback, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { supabase } from "@/integrations/supabase/client";
import { frigateUrl } from "@/lib/webhookStore";
import { CustomerInstructionsCard } from "@/components/CustomerInstructionsCard";
import { Loader2, Server } from "lucide-react";

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

const CustomerInstructions = () => {
  const { user } = useAuth();
  const store = useWebhookStore();
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [camFilter, setCamFilter] = useState<Map<string, Set<string>>>(new Map());
  const [camerasByInstance, setCamerasByInstance] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    void Promise.all([
      supabase.from("customer_nvr_assignments").select("instance_id").eq("user_id", user.id),
      supabase.from("customer_camera_assignments").select("instance_id, camera").eq("user_id", user.id),
    ]).then(([{ data: nvrRows }, { data: camRows }]) => {
      setAssignedIds((nvrRows ?? []).map((d) => d.instance_id));
      const m = new Map<string, Set<string>>();
      for (const r of camRows ?? []) {
        if (!m.has(r.instance_id)) m.set(r.instance_id, new Set());
        m.get(r.instance_id)!.add(r.camera);
      }
      setCamFilter(m);
    });
  }, [user]);

  const myInstances = useMemo(
    () => store.frigates.filter((f) => assignedIds.includes(f.id)),
    [store.frigates, assignedIds]
  );

  const fetchCams = useCallback(async () => {
    if (myInstances.length === 0) { setCamerasByInstance(new Map()); setLoading(false); return; }
    const map = new Map<string, string[]>();
    await Promise.all(myInstances.map(async (inst) => {
      try {
        const res = await fetch(frigateUrl(inst, "/api/stats"));
        if (!res.ok) throw new Error();
        const all = parseCameras(await res.json());
        const allow = camFilter.get(inst.id);
        map.set(inst.id, allow ? all.filter((n) => allow.has(n)) : all);
      } catch {
        const allow = camFilter.get(inst.id);
        map.set(inst.id, allow ? Array.from(allow).sort() : []);
      }
    }));
    setCamerasByInstance(map);
    setLoading(false);
  }, [myInstances, camFilter]);

  useEffect(() => { void fetchCams(); }, [fetchCams]);

  return (
    <DashboardLayout
      title="Operator Instructions"
      subtitle="Leave a note for the control room when a camera or NVR goes offline"
    >
      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 inline animate-spin mr-2" /> Loading…
        </div>
      ) : myInstances.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <Server className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-foreground">No NVRs assigned</h3>
          <p className="text-xs text-muted-foreground mt-1">Contact your administrator to get access.</p>
        </div>
      ) : (
        <CustomerInstructionsCard
          instances={myInstances}
          camerasByInstance={camerasByInstance}
        />
      )}
    </DashboardLayout>
  );
};

export default CustomerInstructions;
