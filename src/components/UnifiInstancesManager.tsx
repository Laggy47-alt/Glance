import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Plus, Trash2, Server, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

export type UnifiInstance = {
  id: string;
  organization_id: string;
  name: string;
  base_url: string;
  api_key: string;
  color: string;
  enabled: boolean;
  is_local: boolean;
  verify_tls: boolean;
  webhook_secret?: string | null;
};

const PALETTE = ["#06b6d4", "#a855f7", "#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#14b8a6"];

function webhookUrlFor(instanceId: string, token?: string | null) {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, "")
    ?? `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co`;
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${base}/functions/v1/unifi-webhook/${instanceId}${qs}`;
}

export function UnifiInstancesManager({ compact = false }: { compact?: boolean }) {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? null;
  const [items, setItems] = useState<UnifiInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSecret, setEditingSecret] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [isLocal, setIsLocal] = useState(false);
  const [verifyTls, setVerifyTls] = useState(true);

  const load = useCallback(async () => {
    if (!orgId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("unifi_instances")
      .select("id, organization_id, name, base_url, api_key, color, enabled, is_local, verify_tls, webhook_secret")
      .eq("organization_id", orgId)
      .order("name");
    setItems((data ?? []) as UnifiInstance[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!orgId) return;
    const uniq = `${orgId}-${Math.random().toString(36).slice(2, 10)}`;
    const ch = supabase
      .channel(`unifi-instances-${uniq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "unifi_instances", filter: `organization_id=eq.${orgId}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [orgId, load]);

  const reset = () => {
    setEditingId(null);
    setEditingSecret(null);
    setName(""); setBaseUrl(""); setApiKey(""); setColor(PALETTE[0]);
    setIsLocal(false); setVerifyTls(true);
  };

  const openCreate = () => { reset(); setOpen(true); };

  const openEdit = (it: UnifiInstance) => {
    setEditingId(it.id);
    setEditingSecret(it.webhook_secret ?? null);
    setName(it.name);
    setBaseUrl(it.base_url);
    setApiKey(it.api_key ?? "");
    setColor(it.color || PALETTE[0]);
    setIsLocal(!!it.is_local);
    setVerifyTls(!!it.verify_tls);
    setOpen(true);
  };

  const rotateSecret = async () => {
    if (!editingId) return;
    if (!confirm("Rotate webhook token? You'll need to paste the new token into UniFi.")) return;
    const newSecret = crypto.randomUUID();
    const { error } = await supabase.from("unifi_instances").update({ webhook_secret: newSecret }).eq("id", editingId);
    if (error) { toast.error(error.message); return; }
    setEditingSecret(newSecret);
    toast.success("Webhook token rotated");
    void load();
  };

  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${label} copied`); }
    catch { toast.error("Copy failed"); }
  };

  const save = async () => {
    if (!orgId) { toast.error("No active organization"); return; }
    if (!name.trim() || !baseUrl.trim()) { toast.error("Name and base URL required"); return; }
    setSaving(true);
    const payload = {
      name: name.trim(),
      base_url: baseUrl.trim().replace(/\/+$/, ""),
      api_key: apiKey.trim(),
      color,
      is_local: isLocal,
      verify_tls: verifyTls,
    };
    let error;
    if (editingId) {
      ({ error } = await supabase.from("unifi_instances").update(payload).eq("id", editingId));
    } else {
      ({ error } = await supabase.from("unifi_instances").insert({
        ...payload,
        organization_id: orgId,
        enabled: true,
      }));
    }
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editingId ? "Unifi ENVR updated" : "Unifi ENVR added");
    reset(); setOpen(false); void load();
  };

  const toggle = async (id: string, enabled: boolean) => {
    const { error } = await supabase.from("unifi_instances").update({ enabled }).eq("id", id);
    if (error) toast.error(error.message);
  };

  const remove = async (it: UnifiInstance) => {
    if (!confirm(`Delete "${it.name}"? All its events will be removed.`)) return;
    const { error } = await supabase.from("unifi_instances").delete().eq("id", it.id);
    if (error) toast.error(error.message); else toast.success("Deleted");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Unifi ENVR</h3>
          <p className="text-xs text-muted-foreground">Connect Unifi Protect / ENVR instances for this organization.</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Add Unifi ENVR
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Unifi ENVR" : "Add Unifi ENVR"}</DialogTitle>
            <DialogDescription>
              {editingId ? "Update this Unifi Protect / ENVR connection." : "Connect a Unifi Protect / ENVR instance."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main site ENVR" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Base URL</Label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://192.168.1.1" className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">API key</Label>
              <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Unifi local API key" className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Color</Label>
              <div className="flex gap-2 flex-wrap">
                {PALETTE.map((c) => (
                  <button key={c} type="button" onClick={() => setColor(c)} className="h-7 w-7 rounded-md border-2" style={{ background: c, borderColor: color === c ? "hsl(var(--foreground))" : "transparent" }} />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border border-border p-2">
              <div>
                <Label className="text-xs">Local network</Label>
                <p className="text-[10px] text-muted-foreground">Reachable only from inside this network.</p>
              </div>
              <Switch checked={isLocal} onCheckedChange={setIsLocal} />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border border-border p-2">
              <div>
                <Label className="text-xs">Verify TLS</Label>
                <p className="text-[10px] text-muted-foreground">Disable for self-signed certs.</p>
              </div>
              <Switch checked={verifyTls} onCheckedChange={setVerifyTls} />
            </div>

            {editingId && editingSecret && (
              <div className="space-y-2 rounded-md border border-border p-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">UniFi Alarm Manager webhook</Label>
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px]" onClick={rotateSecret}>
                    Rotate token
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  In UniFi: <span className="font-medium">Alarm Manager → Add Alarm → Send Webhook</span>. Use these values:
                </p>
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-muted-foreground">Delivery URL · Method: POST</Label>
                  <div className="flex gap-1.5">
                    <Input readOnly value={webhookUrlFor(editingId)} className="font-mono text-[11px] h-8" onFocus={(e) => e.currentTarget.select()} />
                    <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => copy(webhookUrlFor(editingId), "URL")}>Copy</Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-muted-foreground">Authentication: Bearer · Token</Label>
                  <div className="flex gap-1.5">
                    <Input readOnly value={editingSecret} className="font-mono text-[11px] h-8" onFocus={(e) => e.currentTarget.select()} />
                    <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => copy(editingSecret, "Token")}>Copy</Button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingId ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {loading ? (
        <Card className="p-4 text-xs text-muted-foreground">Loading…</Card>
      ) : items.length === 0 ? (
        <Card className="p-6 text-center">
          <Server className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No Unifi ENVR configured yet.</p>
        </Card>
      ) : (
        <div className={compact ? "space-y-2" : "grid sm:grid-cols-2 gap-2"}>
          {items.map((it) => (
            <Card key={it.id} className="p-3 flex items-center gap-3">
              <div className="h-8 w-8 rounded-md grid place-items-center shrink-0" style={{ background: `${it.color}22`, color: it.color }}>
                <Server className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground truncate">{it.name}</div>
                <div className="text-[11px] text-muted-foreground truncate font-mono">{it.base_url}</div>
              </div>
              <Switch checked={it.enabled} onCheckedChange={(v) => toggle(it.id, v)} />
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" onClick={() => openEdit(it)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => remove(it)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
