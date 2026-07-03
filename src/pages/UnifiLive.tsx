import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { fetchUnifiCameraStatus } from "@/lib/unifiHealthStore";
import type { UnifiCameraStatus } from "@/lib/webhookStore";

export default function UnifiLive() {
  const store = useWebhookStore();
  const [params, setParams] = useSearchParams();
  const [cams, setCams] = useState<UnifiCameraStatus[]>([]);
  const [running, setRunning] = useState(true);

  const instanceId = params.get("instance") || store.unifis[0]?.id || "";
  const inst = useMemo(() => store.unifis.find((u) => u.id === instanceId), [store.unifis, instanceId]);

  useEffect(() => {
    if (!instanceId) return;
    fetchUnifiCameraStatus(instanceId).then(setCams).catch(() => {});
  }, [instanceId]);

  const visible = cams.filter((c) => c.is_online);

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

  return (
    <div className="min-h-screen bg-background flex">
      <AppSidebar />
      <main className="flex-1 p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Live view — {inst.name}</h1>
            <p className="text-xs text-muted-foreground">
              MJPEG snapshot stream from the local bridge. LAN performance recommended.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={instanceId} onValueChange={(v) => setParams({ instance: v })}>
              <SelectTrigger className="w-56 h-9 text-xs">
                <SelectValue placeholder="Pick NVR" />
              </SelectTrigger>
              <SelectContent>
                {store.unifis.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => setRunning((r) => !r)}>
              {running ? "Pause" : "Resume"}
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
              <Card className="p-4 text-xs text-muted-foreground col-span-full">No online cameras.</Card>
            )}
            {visible.map((c) => {
              const src = running
                ? `${bridge}/stream/${inst.id}/${c.camera_id}?token=${encodeURIComponent(token)}`
                : "";
              return (
                <Card key={c.camera_id} className="overflow-hidden">
                  <div className="aspect-video bg-black grid place-items-center">
                    {running ? (
                      <img src={src} alt={c.name ?? c.camera_id} className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-xs text-muted-foreground">Paused</span>
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
      </main>
    </div>
  );
}
