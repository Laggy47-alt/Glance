import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Image as ImageIcon, Upload, Trash2, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Props = {
  title: string;
  description?: string;
  initial: { appName: string; appSubtitle: string; logoUrl: string | null };
  /** Storage path prefix in the `branding` bucket */
  pathPrefix: string;
  onSave: (next: { app_name: string; app_subtitle: string; logo_url: string | null }) => Promise<void>;
};

export function SuperBrandingEditor({ title, description, initial, pathPrefix, onSave }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [appName, setAppName] = useState(initial.appName);
  const [appSubtitle, setAppSubtitle] = useState(initial.appSubtitle);
  const [logoUrl, setLogoUrl] = useState<string | null>(initial.logoUrl);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAppName(initial.appName);
    setAppSubtitle(initial.appSubtitle);
    setLogoUrl(initial.logoUrl);
  }, [initial.appName, initial.appSubtitle, initial.logoUrl]);

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image"); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Max 2 MB"); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${pathPrefix}/logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("branding").upload(path, file, {
        cacheControl: "3600", upsert: true,
      });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("branding").getPublicUrl(path);
      setLogoUrl(data.publicUrl);
      toast.success("Logo uploaded — remember to save");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        app_name: appName.trim() || "Glance",
        app_subtitle: appSubtitle.trim() || "Event Dashboard",
        logo_url: logoUrl,
      });
      toast.success("Saved");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 space-y-5">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>

      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-lg border border-border bg-muted/30 grid place-items-center overflow-hidden shrink-0">
          {logoUrl ? <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" /> : <ImageIcon className="h-5 w-5 text-muted-foreground" />}
        </div>
        <div className="flex flex-col gap-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); e.target.value = ""; }}
          />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            {uploading ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
          </Button>
          {logoUrl && (
            <Button variant="ghost" size="sm" onClick={() => setLogoUrl(null)} className="text-destructive hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">App name</Label>
          <Input value={appName} onChange={(e) => setAppName(e.target.value)} maxLength={40} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Subtitle</Label>
          <Input value={appSubtitle} onChange={(e) => setAppSubtitle(e.target.value)} maxLength={50} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          Save
        </Button>
      </div>
    </Card>
  );
}
