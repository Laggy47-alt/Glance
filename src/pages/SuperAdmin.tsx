import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Webhook, Building2, Server, Phone, Plus, Loader2, ExternalLink, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBranding } from "@/hooks/useBranding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

type Org = { id: string; slug: string; name: string; created_at: string };
type Site = { id: string; name: string; base_url: string; color: string; enabled: boolean; organization_id: string };
type Callout = {
  id: string; instance_id: string; camera: string | null; reason: string | null;
  status: string; requester_name: string | null; created_at: string; organization_id: string;
};

export default function SuperAdmin() {
  const navigate = useNavigate();
  const { signOut, impersonateOrg } = useAuth();
  const { appName, logoUrl } = useBranding();

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [callouts, setCallouts] = useState<Callout[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const orgById = useMemo(() => Object.fromEntries(orgs.map((o) => [o.id, o])), [orgs]);

  const load = async () => {
    setLoading(true);
    const [{ data: o }, { data: s }, { data: c }] = await Promise.all([
      supabase.from("organizations").select("id, slug, name, created_at").order("name"),
      supabase.from("frigate_instances").select("id, name, base_url, color, enabled, organization_id").order("name"),
      supabase.from("callout_requests").select("id, instance_id, camera, reason, status, requester_name, created_at, organization_id")
        .order("created_at", { ascending: false }).limit(200),
    ]);
    setOrgs((o ?? []) as Org[]);
    setSites((s ?? []) as Site[]);
    setCallouts((c ?? []) as Callout[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("super-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "callout_requests" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "frigate_instances" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "organizations" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const handleSignOut = async () => {
    impersonateOrg(null);
    await signOut();
    navigate("/login", { replace: true });
  };

  const enterSite = (site: Site) => {
    const org = orgById[site.organization_id];
    if (!org) {
      toast.error("Organization not found for this site");
      return;
    }
    impersonateOrg({ id: org.id, slug: org.slug, name: org.name });
    toast.success(`Entered ${org.name}`);
    navigate("/frigate");
  };

  const enterOrg = (org: Org) => {
    impersonateOrg({ id: org.id, slug: org.slug, name: org.name });
    toast.success(`Entered ${org.name}`);
    navigate("/");
  };

  const createOrg = async () => {
    const slug = newSlug.trim().toLowerCase();
    const name = newName.trim();
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) { toast.error("Slug: lowercase letters, numbers, dashes (2-40)"); return; }
    if (!name) { toast.error("Name required"); return; }
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("admin-users/create-org", {
      method: "POST",
      body: { slug, name },
    });
    setCreating(false);
    if (error || !(data as any)?.ok) {
      toast.error((data as any)?.error || error?.message || "Failed to create organization");
      return;
    }
    toast.success(`Created ${name}`);
    setCreateOpen(false);
    setNewSlug(""); setNewName("");
    void load();
  };

  const sitesByOrg = useMemo(() => {
    const map = new Map<string, Site[]>();
    for (const s of sites) {
      const arr = map.get(s.organization_id) ?? [];
      arr.push(s); map.set(s.organization_id, arr);
    }
    return map;
  }, [sites]);

  const openCallouts = callouts.filter((c) => c.status !== "resolved");

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-16 shrink-0 border-b border-border bg-card/40 backdrop-blur px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-md bg-gradient-primary grid place-items-center shadow-glow overflow-hidden shrink-0">
            {logoUrl ? <img src={logoUrl} alt={appName} className="h-full w-full object-contain" /> : <Webhook className="h-5 w-5 text-primary-foreground" />}
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground tracking-tight truncate">Super Admin Portal</h1>
            <p className="text-xs text-muted-foreground truncate">Platform-wide overview</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleSignOut} className="gap-1.5">
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </Button>
      </header>

      <main className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="sites" className="w-full">
          <TabsList>
            <TabsTrigger value="sites" className="gap-1.5"><Server className="h-4 w-4" /> Sites</TabsTrigger>
            <TabsTrigger value="orgs" className="gap-1.5"><Building2 className="h-4 w-4" /> Organizations</TabsTrigger>
            <TabsTrigger value="callouts" className="gap-1.5">
              <Phone className="h-4 w-4" /> Callouts
              {openCallouts.length > 0 && <Badge variant="secondary" className="ml-1">{openCallouts.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* SITES */}
          <TabsContent value="sites" className="space-y-4 mt-4">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : orgs.length === 0 ? (
              <Card className="p-6 text-sm text-muted-foreground">No organizations yet.</Card>
            ) : (
              orgs.map((org) => {
                const orgSites = sitesByOrg.get(org.id) ?? [];
                return (
                  <Card key={org.id} className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">{org.name}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">{org.slug}</div>
                      </div>
                      <Badge variant="outline">{orgSites.length} site{orgSites.length === 1 ? "" : "s"}</Badge>
                    </div>
                    {orgSites.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">No sites configured.</p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {orgSites.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => enterSite(s)}
                            className="text-left rounded-md border border-border bg-card hover:bg-accent/40 transition-colors p-3 flex items-center gap-3"
                          >
                            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-foreground truncate">{s.name}</div>
                              <div className="text-[11px] text-muted-foreground truncate">{s.base_url}</div>
                            </div>
                            {!s.enabled && <Badge variant="secondary" className="text-[9px]">OFF</Badge>}
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                          </button>
                        ))}
                      </div>
                    )}
                  </Card>
                );
              })
            )}
          </TabsContent>

          {/* ORGS */}
          <TabsContent value="orgs" className="space-y-4 mt-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">{orgs.length} organization{orgs.length === 1 ? "" : "s"}</p>
              <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
                <Plus className="h-4 w-4" /> Add Organization
              </Button>
            </div>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Slug (Org ID)</TableHead>
                    <TableHead>Sites</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgs.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No organizations yet.</TableCell></TableRow>
                  ) : orgs.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.name}</TableCell>
                      <TableCell className="font-mono text-xs">{o.slug}</TableCell>
                      <TableCell>{(sitesByOrg.get(o.id) ?? []).length}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => enterOrg(o)} className="gap-1.5">
                          Enter <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* CALLOUTS */}
          <TabsContent value="callouts" className="space-y-4 mt-4">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>Camera</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Requested By</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {callouts.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No callout requests.</TableCell></TableRow>
                  ) : callouts.map((c) => {
                    const org = orgById[c.organization_id];
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Badge variant={c.status === "resolved" ? "secondary" : "default"}>{c.status}</Badge>
                        </TableCell>
                        <TableCell>{org?.name ?? <span className="text-muted-foreground italic">unknown</span>}</TableCell>
                        <TableCell className="text-xs">{c.camera ?? "—"}</TableCell>
                        <TableCell className="text-xs max-w-[280px] truncate">{c.reason ?? "—"}</TableCell>
                        <TableCell className="text-xs">{c.requester_name ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          {org && (
                            <Button size="sm" variant="outline" onClick={() => { impersonateOrg({ id: org.id, slug: org.slug, name: org.name }); navigate("/callouts"); }}>
                              Open
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Organization</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Acme Corp" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Org ID (slug)</Label>
              <Input value={newSlug} onChange={(e) => setNewSlug(e.target.value.toLowerCase())} placeholder="acme" />
              <p className="text-[11px] text-muted-foreground">Lowercase letters, numbers, dashes. Users will type this at login.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={createOrg} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
