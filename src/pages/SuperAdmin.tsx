import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Webhook, Building2, Server, Phone, Loader2, ExternalLink, ArrowRight, Palette, ChevronDown, Plus, Trash2, Download, Archive, RefreshCw, Eye, NotebookPen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePlatformBranding } from "@/hooks/usePlatformBranding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { SuperBrandingEditor } from "@/components/SuperBrandingEditor";
import { SuperFeaturesPanel } from "@/components/SuperFeaturesPanel";
import { SuperNotesPanel } from "@/components/SuperNotesPanel";
import { ToggleLeft } from "lucide-react";
import { toast } from "sonner";


type Org = { id: string; slug: string; name: string; created_at: string };
type Site = { id: string; name: string; base_url: string; color: string; enabled: boolean; organization_id: string };
type Callout = {
  id: string; subject: string; message: string | null; status: string;
  admin_note: string | null; requester_name: string | null;
  created_at: string; resolved_at: string | null; organization_id: string;
};
type OrgSettings = { id?: string; organization_id: string; app_name: string; app_subtitle: string; logo_url: string | null };

export default function SuperAdmin() {
  const navigate = useNavigate();
  const { signOut, impersonateOrg } = useAuth();
  const platform = usePlatformBranding();

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [callouts, setCallouts] = useState<Callout[]>([]);
  const [orgSettings, setOrgSettings] = useState<OrgSettings[]>([]);
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [replyFor, setReplyFor] = useState<Callout | null>(null);
  const [replyNote, setReplyNote] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);

  const [deleteOrg, setDeleteOrg] = useState<Org | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [backingUp, setBackingUp] = useState<string | null>(null);

  type BackupItem = {
    path: string; name: string; instance_id: string; instance_name: string | null;
    organization_id: string | null; size: number | null; created_at: string | null;
  };
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [viewing, setViewing] = useState<{ item: BackupItem; content: string } | null>(null);
  const [viewLoadingPath, setViewLoadingPath] = useState<string | null>(null);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

  const loadBackups = async () => {
    setBackupsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("frigate-list-backups", {
        body: { action: "list" },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Failed to load backups");
      setBackups((data.items ?? []) as BackupItem[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load backups");
    } finally {
      setBackupsLoading(false);
    }
  };

  const downloadBackup = async (item: BackupItem) => {
    setDownloadingPath(item.path);
    try {
      const { data, error } = await supabase.functions.invoke("frigate-list-backups", {
        body: { action: "sign", path: item.path },
      });
      if (error) throw error;
      if (!data?.ok || !data?.signedUrl) throw new Error(data?.error ?? "Sign failed");
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = item.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e: any) {
      toast.error(e?.message ?? "Download failed");
    } finally {
      setDownloadingPath(null);
    }
  };

  const viewBackup = async (item: BackupItem) => {
    setViewLoadingPath(item.path);
    try {
      const { data, error } = await supabase.functions.invoke("frigate-list-backups", {
        body: { action: "sign", path: item.path },
      });
      if (error) throw error;
      if (!data?.ok || !data?.signedUrl) throw new Error(data?.error ?? "Sign failed");
      const res = await fetch(data.signedUrl);
      if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
      const text = await res.text();
      setViewing({ item, content: text });
    } catch (e: any) {
      toast.error(e?.message ?? "View failed");
    } finally {
      setViewLoadingPath(null);
    }

  const formatBytes = (b: number | null) => {
    if (b == null) return "—";
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(2)} MB`;
  };

  const backupSiteConfig = async (site: Site) => {
    setBackingUp(site.id);
    try {
      const { data, error } = await supabase.functions.invoke("frigate-backup-config", {
        body: { instance_id: site.id },
      });
      if (error) throw error;
      if (!data?.ok || !data?.signedUrl) throw new Error(data?.error ?? "Backup failed");
      // Trigger download
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success(`Backup saved: ${data.filename}`);
      void loadBackups();
    } catch (e: any) {
      toast.error(e?.message ?? "Backup failed");
    } finally {
      setBackingUp(null);
    }
  };

  const orgById = useMemo(() => Object.fromEntries(orgs.map((o) => [o.id, o])), [orgs]);

  const load = async () => {
    setLoading(true);
    const [{ data: o }, { data: s }, { data: c }, { data: as }] = await Promise.all([
      supabase.from("organizations").select("id, slug, name, created_at").order("name"),
      supabase.from("frigate_instances").select("id, name, base_url, color, enabled, organization_id").order("name"),
      supabase.from("super_callout_requests")
        .select("id, subject, message, status, admin_note, requester_name, created_at, resolved_at, organization_id")
        .order("created_at", { ascending: false }).limit(200),
      supabase.from("app_settings").select("id, organization_id, app_name, app_subtitle, logo_url"),
    ]);
    setOrgs((o ?? []) as Org[]);
    setSites((s ?? []) as Site[]);
    setCallouts((c ?? []) as Callout[]);
    setOrgSettings((as ?? []) as OrgSettings[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    void loadBackups();
    const ch = supabase
      .channel("super-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "super_callout_requests" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "frigate_instances" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "organizations" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const resolveCallout = async () => {
    if (!replyFor) return;
    setReplyBusy(true);
    const { error } = await supabase.from("super_callout_requests").update({
      status: "resolved",
      admin_note: replyNote.trim() || null,
      resolved_at: new Date().toISOString(),
    }).eq("id", replyFor.id);
    setReplyBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Marked resolved");
    setReplyFor(null); setReplyNote("");
    void load();
  };

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

  const performDeleteOrg = async () => {
    if (!deleteOrg) return;
    if (deleteConfirm.trim().toLowerCase() !== deleteOrg.slug.toLowerCase()) {
      toast.error("Type the org slug to confirm");
      return;
    }
    setDeleting(true);
    const { data, error } = await supabase.functions.invoke("admin-users/delete-org", {
      method: "POST",
      body: { organization_id: deleteOrg.id },
    });
    setDeleting(false);
    if (error || !(data as any)?.ok) {
      toast.error((data as any)?.error || error?.message || "Failed to delete organization");
      return;
    }
    toast.success(`Deleted ${deleteOrg.name}`);
    setDeleteOrg(null); setDeleteConfirm("");
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
            {platform.logoUrl ? <img src={platform.logoUrl} alt={platform.appName} className="h-full w-full object-contain" /> : <Webhook className="h-5 w-5 text-primary-foreground" />}
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground tracking-tight truncate">{platform.appName} — Super Admin</h1>
            <p className="text-xs text-muted-foreground truncate">{platform.appSubtitle}</p>
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
            <TabsTrigger value="features" className="gap-1.5"><ToggleLeft className="h-4 w-4" /> Features</TabsTrigger>
            <TabsTrigger value="backups" className="gap-1.5"><Archive className="h-4 w-4" /> Backups</TabsTrigger>
            <TabsTrigger value="customization" className="gap-1.5"><Palette className="h-4 w-4" /> Customization</TabsTrigger>

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
                const open = expandedOrgs.has(org.id);
                const toggle = () => setExpandedOrgs((prev) => {
                  const next = new Set(prev);
                  if (next.has(org.id)) next.delete(org.id); else next.add(org.id);
                  return next;
                });
                return (
                  <Card key={org.id} className="overflow-hidden">
                    <button
                      type="button"
                      onClick={toggle}
                      className="w-full flex items-center justify-between gap-3 p-4 hover:bg-accent/40 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-foreground truncate">{org.name}</div>
                          <div className="text-[11px] text-muted-foreground font-mono truncate">{org.slug}</div>
                        </div>
                      </div>
                      <Badge variant="outline">{orgSites.length} site{orgSites.length === 1 ? "" : "s"}</Badge>
                    </button>
                    {open && (
                      <div className="px-4 pb-4 border-t border-border pt-3">
                        {orgSites.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No sites configured.</p>
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {orgSites.map((s) => (
                              <div
                                key={s.id}
                                className="text-left rounded-md border border-border bg-card hover:bg-accent/40 transition-colors p-3 flex items-center gap-2"
                              >
                                <button
                                  onClick={() => enterSite(s)}
                                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                                >
                                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-foreground truncate">{s.name}</div>
                                    <div className="text-[11px] text-muted-foreground truncate">{s.base_url}</div>
                                  </div>
                                  {!s.enabled && <Badge variant="secondary" className="text-[9px]">OFF</Badge>}
                                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                                </button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 shrink-0"
                                  title="Backup config.yml"
                                  disabled={backingUp === s.id}
                                  onClick={(e) => { e.stopPropagation(); void backupSiteConfig(s); }}
                                >
                                  {backingUp === s.id
                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : <Download className="h-4 w-4" />}
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
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
                <Plus className="h-4 w-4" /> Add organization
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
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => enterOrg(o)} className="gap-1.5">
                            Enter <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setDeleteOrg(o); setDeleteConfirm(""); }} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
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
                    <TableHead>Subject</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>From</TableHead>
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
                        <TableCell className="font-medium">{org?.name ?? <span className="text-muted-foreground italic">unknown</span>}</TableCell>
                        <TableCell className="text-sm">{c.subject}</TableCell>
                        <TableCell className="text-xs max-w-[320px]">
                          <div className="line-clamp-2 text-muted-foreground">{c.message ?? "—"}</div>
                          {c.admin_note && <div className="mt-1 text-[11px] text-primary">Reply: {c.admin_note}</div>}
                        </TableCell>
                        <TableCell className="text-xs">{c.requester_name ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(c.created_at).toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          {c.status !== "resolved" && (
                            <Button size="sm" variant="outline" onClick={() => { setReplyFor(c); setReplyNote(c.admin_note ?? ""); }}>
                              Resolve
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

          {/* FEATURES */}
          <TabsContent value="features" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">Toggle optional features per organization. Disabled features are hidden from that org's dashboard.</p>
            <SuperFeaturesPanel orgs={orgs} />
          </TabsContent>

          {/* BACKUPS */}
          <TabsContent value="backups" className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {backups.length} backup{backups.length === 1 ? "" : "s"} in storage
              </p>
              <Button size="sm" variant="outline" onClick={() => void loadBackups()} disabled={backupsLoading} className="gap-1.5">
                {backupsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            </div>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Site</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-20 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backupsLoading && backups.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading backups…
                    </TableCell></TableRow>
                  ) : backups.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                      No backups yet. Use the download icon on a site to create one.
                    </TableCell></TableRow>
                  ) : backups.map((b) => (
                    <TableRow key={b.path}>
                      <TableCell className="text-sm font-medium">{b.instance_name ?? <span className="text-muted-foreground italic">unknown</span>}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {b.organization_id ? (orgById[b.organization_id]?.name ?? "—") : "—"}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{b.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatBytes(b.size)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {b.created_at ? new Date(b.created_at).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title="Download"
                          disabled={downloadingPath === b.path}
                          onClick={() => void downloadBackup(b)}
                        >
                          {downloadingPath === b.path
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Download className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* CUSTOMIZATION */}


          <TabsContent value="customization" className="space-y-6 mt-4">
            <SuperBrandingEditor
              title="Platform branding (Super Admin Portal)"
              description="Logo, name, and subtitle shown on the Super Admin Portal itself."
              initial={{ appName: platform.appName, appSubtitle: platform.appSubtitle, logoUrl: platform.logoUrl }}
              pathPrefix="platform"
              onSave={async (payload) => {
                const { data: existing } = await supabase
                  .from("platform_settings").select("id").order("updated_at", { ascending: false }).limit(1).maybeSingle();
                if (existing?.id) {
                  const { error } = await supabase.from("platform_settings").update(payload).eq("id", existing.id);
                  if (error) throw error;
                } else {
                  const { error } = await supabase.from("platform_settings").insert(payload);
                  if (error) throw error;
                }
                await platform.refresh();
              }}
            />

            <Card className="p-4 text-xs text-muted-foreground">
              Organizations manage their own logo and branding from <span className="font-medium text-foreground">Customization</span> inside their dashboard.
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={!!replyFor} onOpenChange={(o) => { if (!o) { setReplyFor(null); setReplyNote(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Resolve callout</DialogTitle></DialogHeader>
          {replyFor && (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-card/50 p-3 text-sm">
                <div className="font-medium">{orgById[replyFor.organization_id]?.name} — {replyFor.subject}</div>
                {replyFor.message && <div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{replyFor.message}</div>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Reply / note (optional)</Label>
                <Textarea rows={4} value={replyNote} onChange={(e) => setReplyNote(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplyFor(null)} disabled={replyBusy}>Cancel</Button>
            <Button onClick={resolveCallout} disabled={replyBusy}>
              {replyBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Mark resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <Dialog open={!!deleteOrg} onOpenChange={(o) => { if (!o) { setDeleteOrg(null); setDeleteConfirm(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-destructive">Delete organization</DialogTitle></DialogHeader>
          {deleteOrg && (
            <div className="space-y-3">
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <p className="font-medium text-destructive">This action cannot be undone.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  All sites, cameras, events, callouts, schedules, daily reports, settings,
                  and users belonging only to <span className="font-semibold text-foreground">{deleteOrg.name}</span> will be permanently deleted.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Type <span className="font-mono font-semibold">{deleteOrg.slug}</span> to confirm</Label>
                <Input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder={deleteOrg.slug} autoFocus />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteOrg(null); setDeleteConfirm(""); }} disabled={deleting}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={performDeleteOrg}
              disabled={deleting || !deleteOrg || deleteConfirm.trim().toLowerCase() !== deleteOrg.slug.toLowerCase()}
            >
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
