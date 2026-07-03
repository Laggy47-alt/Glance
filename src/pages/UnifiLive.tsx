import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { UnifiHlsPlayer } from "@/components/UnifiHlsPlayer";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { fetchUnifiCameraStatus } from "@/lib/unifiHealthStore";
import { supabase } from "@/integrations/supabase/client";
import type { UnifiCameraStatus } from "@/lib/webhookStore";

const db = supabase as unknown as { from: (t: string) => any };

export default function UnifiLive() {
  const store = useWebhookStore();
  const [params, setParams] = useSearchParams();
  const [cams, setCams] = useState<UnifiCameraStatus[]>([]);
  const [running, setRunning] = useState(false); // on-demand
  const [siteName, setSiteName] = useState<string | null>(null);
  const [siteCameraIds, setSiteCameraIds] = useState<Set<string> | null>(null);
  const [expanded, setExpanded] = useState<UnifiCameraStatus | null>(null);

  const instanceId = params.get("instance") || store.unifis[0]?.id || "";
  const siteId = params.get("site");
  const cameraFilterParam = params.get("cameras") || params.get("camera");
  const cameraFilter = useMemo(
    () => (cameraFilterParam ? new Set(cameraFilterParam.split(",").filter(Boolean)) : null),
    [cameraFilterParam],
  );
  const inst = useMemo(() => store.unifis.find((u) => u.id === instanceId), [store.unifis, instanceId]);

  useEffect(() => {
    if (!instanceId) return;
    fetchUnifiCameraStatus(instanceId).then(setCams).catch(() => {});
  }, [instanceId]);

  // Resolve site -> allowed camera ids
  useEffect(() => {
    let cancelled = false;
    if (!siteId || !instanceId) { setSiteCameraIds(null); setSiteName(null); return; }
    (async () => {
      const [{ data: siteRow }, { data: mapRows }] = await Promise.all([
        db.from("unifi_sites").select("name").eq("id", siteId).maybeSingle(),
        db.from("unifi_camera_sites").select("camera_id").eq("site_id", siteId).eq("unifi_instance_id", instanceId),
      ]);
      if (cancelled) return;
      setSiteName((siteRow as { name?: string } | null)?.name ?? null);
      setSiteCameraIds(new Set(((mapRows ?? []) as Array<{ camera_id: string }>).map((r) => r.camera_id)));
    })();
    return () => { cancelled = true; };
  }, [siteId, instanceId]);

  const visible = cams.filter((c) => {
    if (!c.is_online) return false;
    if (cameraFilter && !cameraFilter.has(c.camera_id)) return false;
    if (siteCameraIds && !siteCameraIds.has(c.camera_id)) return false;
    return true;
  });

  if (!inst) {
    return (
      <div className="min-h-screen bg-background flex">
        <AppSidebar />
        <main className="flex-1 p-6">
          <Card className="p-6 text-sm">
            Pick an NVR from the <Link className="text-primary underline" to="/unifi-status">Camera Status</Link> page.
          </Card>
        </main>
      </div>
    );
  }

  const bridge = (inst.bridge_public_url ?? "").replace(/\/+$/, "");
  const token = inst.live_token ?? "";
  const streamsReady = Boolean(bridge);
  const filterLabel = siteName
    ? `Site: ${siteName}`
    : cameraFilter
      ? `${cameraFilter.size} camera(s)`
      : "All cameras";

  const clearFilter = () => {
    const next = new URLSearchParams(params);
    next.delete("site");
    next.delete("camera");
    next.delete("cameras");
    setParams(next);
    setRunning(false);
  };

  return (
    <div className="min-h-screen bg-background flex">
      <AppSidebar />
      <main className="flex-1 p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold">Live view — {inst.name}</h1>
            <p className="text-xs text-muted-foreground">
              Fluid HLS video (falls back to MJPEG snapshots). Filter: <span className="font-medium">{filterLabel}</span>.
              {(siteId || cameraFilter) && (
                <button type="button" onClick={clearFilter} className="ml-2 underline text-primary">
                  clear filter
                </button>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={instanceId}
              onValueChange={(v) => {
                setRunning(false);
                setParams({ instance: v });
              }}
            >
              <SelectTrigger className="w-56 h-9 text-xs">
                <SelectValue placeholder="Pick NVR" />
              </SelectTrigger>
              <SelectContent>
                {store.unifis.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant={running ? "outline" : "default"}
              onClick={() => setRunning((r) => !r)}
              disabled={!streamsReady || visible.length === 0}
            >
              {running ? "Stop live" : `Start live (${visible.length})`}
            </Button>
          </div>
        </div>

        {!streamsReady && (
          <Card className="p-4 text-xs text-muted-foreground">
            Set <span className="font-mono">bridge_public_url</span> and <span className="font-mono">live_token</span>{" "}
            on this NVR (in <Link to="/frigate" className="text-primary underline">NVRs → Edit</Link>) to enable live view.
          </Card>
        )}

        {streamsReady && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {visible.length === 0 && (
              <Card className="p-4 text-xs text-muted-foreground col-span-full">No online cameras match this filter.</Card>
            )}
            {visible.map((c) => {
              const src = running
                ? `${bridge}/stream/${inst.id}/${c.camera_id}?token=${encodeURIComponent(token)}&w=640&fps=6`
                : "";
              return (
                <Card
                  key={c.camera_id}
                  className={`overflow-hidden ${running ? "cursor-zoom-in hover:ring-2 hover:ring-primary transition" : ""}`}
                  onClick={() => running && setExpanded(c)}
                >
                  <div className="aspect-video bg-black grid place-items-center">
                    {running ? (
                      <img src={src} alt={c.name ?? c.camera_id} className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-xs text-muted-foreground">Idle — press Start live</span>
                    )}
                  </div>
                  <div className="px-3 py-2 flex items-center justify-between">
                    <span className="text-xs font-medium truncate">{c.name ?? c.camera_id}</span>
                    <span className="text-[10px] text-muted-foreground">{c.state ?? "live"}</span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        <Dialog open={!!expanded} onOpenChange={(o) => !o && setExpanded(null)}>
          <DialogContent className="max-w-6xl p-0 overflow-hidden bg-black border-border">
            <DialogTitle className="sr-only">{expanded?.name ?? expanded?.camera_id ?? "Camera"}</DialogTitle>
            {expanded && running && (
              <div className="relative">
                <img
                  src={`${bridge}/stream/${inst.id}/${expanded.camera_id}?token=${encodeURIComponent(token)}&w=1280&fps=8&t=big`}
                  alt={expanded.name ?? expanded.camera_id}
                  className="w-full max-h-[85vh] object-contain bg-black"
                />
                <div className="absolute bottom-0 left-0 right-0 px-4 py-2 bg-black/60 text-xs text-white flex items-center justify-between">
                  <span className="font-medium">{expanded.name ?? expanded.camera_id}</span>
                  <span className="text-[10px] opacity-70">{expanded.state ?? "live"}</span>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
