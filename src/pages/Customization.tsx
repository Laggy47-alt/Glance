import { useEffect, useRef, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useBranding } from "@/hooks/useBranding";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Upload, Trash2, Palette, Image as ImageIcon, Save } from "lucide-react";

export default function Customization() {
  const branding = useBranding();
  const { activeOrg } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [appName, setAppName] = useState(branding.appName);
  const [appSubtitle, setAppSubtitle] = useState(branding.appSubtitle);
  const [logoUrl, setLogoUrl] = useState<string | null>(branding.logoUrl);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setAppName(branding.appName);
    setAppSubtitle(branding.appSubtitle);
    setLogoUrl(branding.logoUrl);
  }, [branding.appName, branding.appSubtitle, branding.logoUrl]);

  const handleUpload = async (file: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image.", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max size is 2 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("branding").upload(path, file, {
        cacheControl: "3600",
        upsert: true,
      });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("branding").getPublicUrl(path);
      setLogoUrl(data.publicUrl);
      toast({ title: "Logo uploaded", description: "Don't forget to save your changes." });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!activeOrg?.id) { toast({ title: "No active organization", variant: "destructive" }); return; }
    setSaving(true);
    try {
      // Branding row for THIS org only — never touch another org's record.
      const { data: existing } = await supabase
        .from("app_settings")
        .select("id")
        .eq("organization_id", activeOrg.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const payload = {
        app_name: appName.trim() || "ABC Glance",
        app_subtitle: appSubtitle.trim() || "Event Dashboard",
        logo_url: logoUrl,
      };

      if (existing?.id) {
        const { error } = await supabase.from("app_settings").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("app_settings").insert({ ...payload, organization_id: activeOrg.id });
        if (error) throw error;
      }
      await branding.refresh();
      toast({ title: "Saved", description: "Branding updated." });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout title="Customization" subtitle="Personalize your dashboard branding">
      <div className="max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-gradient-primary grid place-items-center shadow-glow">
            <Palette className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Customization</h1>
            <p className="text-xs text-muted-foreground">Personalize your dashboard branding</p>
          </div>
        </div>

        <Card className="p-6 space-y-5">
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-primary" /> App Logo
            </h2>
            <p className="text-xs text-muted-foreground">PNG/SVG recommended. Max 2 MB.</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="h-20 w-20 rounded-lg border border-border bg-muted/30 grid place-items-center overflow-hidden">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo preview" className="h-full w-full object-contain" />
              ) : (
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                {uploading ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
              </Button>
              {logoUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLogoUrl(null)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Card className="p-6 space-y-5">
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold">App Identity</h2>
            <p className="text-xs text-muted-foreground">Shown in the sidebar and browser tab.</p>
          </div>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="appName">App name</Label>
              <Input
                id="appName"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="ABC Glance"
                maxLength={40}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appSubtitle">Subtitle</Label>
              <Input
                id="appSubtitle"
                value={appSubtitle}
                onChange={(e) => setAppSubtitle(e.target.value)}
                placeholder="Event Dashboard"
                maxLength={50}
              />
            </div>
          </div>
        </Card>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-1.5" />
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
