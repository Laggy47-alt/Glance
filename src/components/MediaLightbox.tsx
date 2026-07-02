import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Film, Camera, Tag as TagIcon, X, Plus, ImageOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export type LightboxItem = {
  kind: "snapshot" | "clip";
  url: string;
  camera: string | null;
  topic: string | null;
  ts: string;
  thumbnail?: string;
  frigateUrl?: string | null;
  mediaId?: string;
  organizationId?: string | null;
  eventId?: string | null;
  /** Optional ordered fallback URLs tried in sequence if `url` (and prior fallbacks) fail to load. */
  fallbackUrls?: string[];
  /** When true, hide tagging UI and ack metadata — view-only mode (e.g. customer portal). */
  readOnly?: boolean;
};

type MediaTag = { id: string; tag: string; note: string | null };

const SUGGESTED_TAGS = ["positive incident", "false positive", "review", "important", "evidence"];

export function MediaLightbox({ item, onClose }: { item: LightboxItem | null; onClose: () => void }) {
  const [tags, setTags] = useState<MediaTag[]>([]);
  const [newTag, setNewTag] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!item?.mediaId) { setTags([]); return; }
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("media_tags")
        .select("id, tag, note")
        .eq("media_id", item.mediaId!)
        .order("created_at", { ascending: false });
      if (active) setTags((data ?? []) as MediaTag[]);
    })();
    return () => { active = false; };
  }, [item?.mediaId]);



  const addTag = async (value: string) => {
    if (!item?.mediaId) return;
    const tag = value.trim();
    if (!tag) return;
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("media_tags")
      .insert({ organization_id: item.organizationId, media_id: item.mediaId, tag, created_by: user?.id ?? null })
      .select("id, tag, note")
      .single();
    setLoading(false);
    if (error) {
      toast.error("Failed to add tag");
      return;
    }
    setTags((prev) => [data as MediaTag, ...prev]);
    setNewTag("");
  };

  const removeTag = async (id: string) => {
    const { error } = await supabase.from("media_tags").delete().eq("id", id);
    if (error) {
      toast.error("Failed to remove tag");
      return;
    }
    setTags((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[95vw] w-[95vw] sm:max-w-6xl bg-card border-border p-0 overflow-hidden">
        {item && (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-secondary/40">
              {item.kind === "clip" ? <Film className="h-4 w-4 text-primary" /> : <Camera className="h-4 w-4 text-primary" />}
              <span className="text-sm font-semibold text-foreground">{item.camera ?? "Unknown"}</span>
              <code className="text-xs text-accent ml-auto truncate">{item.topic}</code>
            </div>
            <div className="bg-black grid place-items-center min-h-[300px] max-h-[80vh] overflow-hidden">
              {item.kind === "snapshot" ? (
                <SnapshotImage url={item.url} fallbacks={item.fallbackUrls ?? []} alt={item.camera ?? ""} />
              ) : (
                <video src={item.url} controls autoPlay className="w-full h-auto max-h-[80vh] object-contain" poster={item.thumbnail} />
              )}
            </div>

            {item.mediaId && !item.readOnly && (
              <div className="px-4 py-3 border-t border-border bg-secondary/20 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <TagIcon className="h-3.5 w-3.5 text-primary" /> Tags
                </div>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((t) => (
                      <Badge key={t.id} variant="secondary" className="gap-1 pr-1 bg-primary/15 text-primary border border-primary/30">
                        {t.tag}
                        <button
                          onClick={() => removeTag(t.id)}
                          className="hover:bg-primary/20 rounded-sm h-3.5 w-3.5 grid place-items-center"
                          aria-label="Remove tag"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTED_TAGS.filter((s) => !tags.some((t) => t.tag.toLowerCase() === s.toLowerCase())).map((s) => (
                    <button
                      key={s}
                      onClick={() => addTag(s)}
                      disabled={loading}
                      className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-dashed border-border hover:border-primary hover:text-primary text-muted-foreground transition-colors"
                    >
                      + {s}
                    </button>
                  ))}
                </div>
                <form
                  className="flex gap-1.5"
                  onSubmit={(e) => { e.preventDefault(); addTag(newTag); }}
                >
                  <Input
                    placeholder="Custom tag…"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    className="h-7 text-xs bg-background border-border"
                  />
                  <Button type="submit" size="sm" disabled={loading || !newTag.trim()} className="h-7 gap-1 px-2 text-xs">
                    <Plus className="h-3 w-3" /> Add
                  </Button>
                </form>
              </div>
            )}
            <div className="px-4 py-2.5 text-xs text-muted-foreground border-t border-border flex justify-between items-center gap-3">
              <span>{new Date(item.ts).toLocaleString()}</span>
              {!item.readOnly && (
                item.frigateUrl ? (
                  <a href={item.frigateUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate max-w-[60%]">
                    Open in Frigate ↗
                  </a>
                ) : (
                  <a href={item.url} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate max-w-[60%]">{item.url}</a>
                )
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SnapshotImage({ url, fallbacks, alt }: { url: string; fallbacks: string[]; alt: string }) {
  const candidates = useMemo(() => [url, ...fallbacks].filter(Boolean), [url, fallbacks]);
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);
  // Reset when url changes
  useEffect(() => { setIdx(0); setFailed(false); }, [url]);
  if (failed || candidates.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 text-muted-foreground py-16">
        <ImageOff className="h-8 w-8" />
        <span className="text-xs">Snapshot unavailable</span>
      </div>
    );
  }
  return (
    <img
      src={candidates[idx]}
      alt={alt}
      className="w-auto h-auto max-h-[80vh] max-w-full object-contain"
      onError={() => {
        if (idx + 1 < candidates.length) setIdx(idx + 1);
        else setFailed(true);
      }}
    />
  );

}