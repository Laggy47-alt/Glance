import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Film, Camera, Tag as TagIcon, X, Plus, Check, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatDuration } from "@/lib/duration";

export type LightboxItem = {
  kind: "snapshot" | "clip";
  url: string;
  camera: string | null;
  topic: string | null;
  ts: string;
  thumbnail?: string;
  frigateUrl?: string | null;
  mediaId?: string;
  eventId?: string | null;
  /** When true, hide tagging UI and ack metadata — view-only mode (e.g. customer portal). */
  readOnly?: boolean;
};

type MediaTag = { id: string; tag: string; note: string | null };
type AckInfo = { actor: string | null; ts: string; createdTs: string | null };

const SUGGESTED_TAGS = ["positive incident", "false positive", "review", "important", "evidence"];

export function MediaLightbox({ item, onClose }: { item: LightboxItem | null; onClose: () => void }) {
  const [tags, setTags] = useState<MediaTag[]>([]);
  const [newTag, setNewTag] = useState("");
  const [loading, setLoading] = useState(false);
  const [ack, setAck] = useState<AckInfo | null>(null);

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

  // Load latest ACK + first 'created' for duration
  useEffect(() => {
    if (!item?.eventId) { setAck(null); return; }
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("event_audit_log")
        .select("action, actor, ts")
        .eq("event_id", item.eventId!)
        .in("action", ["ack", "created"])
        .order("ts", { ascending: true });
      if (!active) return;
      const rows = (data ?? []) as { action: string; actor: string | null; ts: string }[];
      const created = rows.find((r) => r.action === "created");
      const ackRow = [...rows].reverse().find((r) => r.action === "ack");
      setAck(ackRow ? { actor: ackRow.actor, ts: ackRow.ts, createdTs: created?.ts ?? null } : null);
    })();
  }, [item?.eventId]);


  const addTag = async (value: string) => {
    if (!item?.mediaId) return;
    const tag = value.trim();
    if (!tag) return;
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("media_tags")
      .insert({ media_id: item.mediaId, tag, created_by: user?.id ?? null })
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
      <DialogContent className="max-w-4xl bg-card border-border p-0 overflow-hidden">
        {item && (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-secondary/40">
              {item.kind === "clip" ? <Film className="h-4 w-4 text-primary" /> : <Camera className="h-4 w-4 text-primary" />}
              <span className="text-sm font-semibold text-foreground">{item.camera ?? "Unknown"}</span>
              <code className="text-xs text-accent ml-auto truncate">{item.topic}</code>
            </div>
            <div className="bg-black grid place-items-center min-h-[300px]">
              {item.kind === "snapshot" ? (
                <img src={item.url} alt={item.camera ?? ""} className="max-h-[70vh] w-auto" />
              ) : (
                <video src={item.url} controls autoPlay className="max-h-[70vh] w-full" poster={item.thumbnail} />
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
            {ack && (
              <div className="px-4 py-2.5 border-t border-border bg-success/10 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <div className="flex items-center gap-1.5 text-success font-semibold">
                  <Check className="h-3.5 w-3.5" /> Acknowledged
                </div>
                <div className="text-foreground">
                  by <span className="font-medium">{ack.actor ?? "unknown"}</span>
                </div>
                <div className="text-muted-foreground tabular-nums">
                  {new Date(ack.ts).toLocaleString()}
                </div>
                {ack.createdTs && (
                  <div className="flex items-center gap-1 text-muted-foreground ml-auto">
                    <Clock className="h-3 w-3" />
                    Response time: <span className="text-foreground font-medium">{formatDuration(new Date(ack.ts).getTime() - new Date(ack.createdTs).getTime())}</span>
                  </div>
                )}
              </div>
            )}
            <div className="px-4 py-2.5 text-xs text-muted-foreground border-t border-border flex justify-between items-center gap-3">
              <span>{new Date(item.ts).toLocaleString()}</span>
              {item.frigateUrl ? (
                <a href={item.frigateUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate max-w-[60%]">
                  Open in Frigate ↗
                </a>
              ) : (
                <a href={item.url} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate max-w-[60%]">{item.url}</a>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
