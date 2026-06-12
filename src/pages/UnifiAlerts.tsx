import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Server, Loader2, CheckCheck, Archive, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { unifiCameraThumbnailUrl } from "@/lib/unifi";
import type { UnifiInstance } from "@/lib/unifi";

type UnifiEvent = {
  id: string;
  organization_id: string;
  instance_id: string;
  remote_event_id: string;
  event_type: string;
  smart_types: string[] | null;
  camera_id: string;
  camera_name: string | null;
  start_at: string;
  end_at: string | null;
  read: boolean;
  archived: boolean;
};

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

export default function UnifiAlerts() {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? null;
  const [instances, setInstances] = useState<UnifiInstance[]>([]);
  const [events, setEvents] = useState<UnifiEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterInstance, setFilterInstance] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) { setEvents([]); setInstances([]); setLoading(false); return; }
    setLoading(true);
    const [{ data: insts }, { data: evs }] = await Promise.all([
      supabase.from("unifi_instances")
        .select("id, organization_id, name, base_url, api_key, color, enabled, is_local, verify_tls")
        .eq("organization_id", orgId).order("name"),
      supabase.from("unifi_events")
        .select("id, organization_id, instance_id, remote_event_id, event_type, smart_types, camera_id, camera_name, start_at, end_at, read, archived")
        .eq("organization_id", orgId)
        .order("start_at", { ascending: false })
        .limit(500),
    ]);
    setInstances((insts ?? []) as UnifiInstance[]);
    setEvents((evs ?? []) as UnifiEvent[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!orgId) return;
    const ch = supabase
      .channel(`unifi-events-${orgId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "unifi_events", filter: `organization_id=eq.${orgId}` },
        () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [orgId, load]);

  const instById = useMemo(() => {
    const m = new Map<string, UnifiInstance>();
    instances.forEach((i) => m.set(i.id, i));
    return m;
  }, [instances]);

  const filtered = useMemo(() => {
    return events.filter((e) =>
      (showArchived ? e.archived : !e.archived) &&
      (filterInstance === "all" || e.instance_id === filterInstance)
    );
  }, [events, filterInstance, showArchived]);

  const unreadCount = events.filter((e) => !e.read && !e.archived).length;

  const markRead = async (id: string, read: boolean) => {
    const { error } = await supabase.from("unifi_events").update({ read }).eq("id", id);
    if (error) toast.error(error.message);
  };

  const archive = async (id: string, archived: boolean) => {
    const { error } = await supabase.from("unifi_events").update({ archived }).eq("id", id);
    if (error) toast.error(error.message);
  };

  const markAllRead = async () => {
    if (!orgId) return;
    const { error } = await supabase.from("unifi_events")
      .update({ read: true })
      .eq("organization_id", orgId)
      .eq("read", false)
      .eq("archived", false);
    if (error) toast.error(error.message); else toast.success("All marked read");
  };

  return (
    <DashboardLayout title="UniFi Alerts" subtitle="Alarm Manager webhook events from your UniFi ENVR">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={filterInstance === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterInstance("all")}
          >
            All <Badge variant="secondary" className="ml-2">{events.filter((e) => !e.archived).length}</Badge>
          </Button>
          {instances.map((i) => {
            const count = events.filter((e) => !e.archived && e.instance_id === i.id).length;
            return (
              <Button
                key={i.id}
                variant={filterInstance === i.id ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterInstance(i.id)}
                className="gap-2"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: i.color }} />
                {i.name}
                <Badge variant="secondary">{count}</Badge>
              </Button>
            );
          })}
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => setShowArchived((v) => !v)} className="gap-1.5">
            <Archive className="h-3.5 w-3.5" /> {showArchived ? "Hide archived" : "Show archived"}
          </Button>
          <Button variant="outline" size="sm" onClick={markAllRead} disabled={unreadCount === 0} className="gap-1.5">
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read {unreadCount > 0 && <Badge variant="secondary">{unreadCount}</Badge>}
          </Button>
        </div>

        {loading ? (
          <Card className="p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="p-10 text-center">
            <Server className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {showArchived ? "No archived alerts." : "No UniFi alerts yet. Point your UniFi Alarm Manager webhook at this app to start receiving events."}
            </p>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((e) => {
              const inst = instById.get(e.instance_id);
              const thumb = inst && e.camera_id && e.camera_id !== "unknown"
                ? unifiCameraThumbnailUrl(inst.id, e.camera_id)
                : null;
              return (
                <Card key={e.id} className={`overflow-hidden ${!e.read ? "ring-1 ring-primary/40" : ""}`}>
                  <div className="aspect-video bg-muted relative">
                    {thumb ? (
                      <img src={thumb} alt={e.camera_name ?? e.camera_id} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="h-full w-full grid place-items-center text-muted-foreground">
                        <Server className="h-8 w-8" />
                      </div>
                    )}
                    {inst && (
                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-medium backdrop-blur"
                        style={{ background: `${inst.color}cc`, color: "white" }}>
                        {inst.name}
                      </div>
                    )}
                    {!e.read && (
                      <div className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-primary shadow-glow" />
                    )}
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">
                          {e.camera_name ?? e.camera_id}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{timeAgo(e.start_at)}</div>
                      </div>
                      <Badge variant="outline" className="text-[10px]">{e.event_type}</Badge>
                    </div>
                    {e.smart_types && e.smart_types.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {e.smart_types.map((s) => (
                          <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-1 pt-1">
                      <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={() => markRead(e.id, !e.read)}>
                        {e.read ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        {e.read ? "Unread" : "Read"}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1 ml-auto" onClick={() => archive(e.id, !e.archived)}>
                        <Archive className="h-3 w-3" />
                        {e.archived ? "Restore" : "Archive"}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
