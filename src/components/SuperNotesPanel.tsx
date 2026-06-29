import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Pin, PinOff, Trash2, Plus, Save, X, Pencil, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Note = {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
};

export function SuperNotesPanel() {
  const { user, profile } = useAuth() as any;
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [search, setSearch] = useState("");

  const authorName: string =
    profile?.display_name || profile?.username || user?.email || "Unknown";

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("super_notes")
      .select("*")
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) {
      toast.error(error.message);
    } else {
      setNotes((data ?? []) as Note[]);
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const startNew = () => {
    setEditingId("__new__");
    setDraftTitle("");
    setDraftContent("");
  };

  const startEdit = (n: Note) => {
    setEditingId(n.id);
    setDraftTitle(n.title);
    setDraftContent(n.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftTitle("");
    setDraftContent("");
  };

  const save = async () => {
    if (!draftTitle.trim() && !draftContent.trim()) {
      toast.error("Add a title or some content first");
      return;
    }
    setCreating(true);
    try {
      if (editingId === "__new__") {
        const { error } = await supabase.from("super_notes").insert({
          title: draftTitle.trim() || "Untitled",
          content: draftContent,
          author_id: user?.id ?? null,
          author_name: authorName,
        });
        if (error) throw error;
        toast.success("Note created");
      } else if (editingId) {
        const { error } = await supabase
          .from("super_notes")
          .update({
            title: draftTitle.trim() || "Untitled",
            content: draftContent,
            author_id: user?.id ?? null,
            author_name: authorName,
          })
          .eq("id", editingId);
        if (error) throw error;
        toast.success("Note saved");
      }
      cancelEdit();
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setCreating(false);
    }
  };

  const togglePin = async (n: Note) => {
    const { error } = await supabase
      .from("super_notes")
      .update({ pinned: !n.pinned })
      .eq("id", n.id);
    if (error) toast.error(error.message);
    else await load();
  };

  const remove = async (n: Note) => {
    if (!confirm(`Delete note "${n.title || "Untitled"}"?`)) return;
    const { error } = await supabase.from("super_notes").delete().eq("id", n.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Deleted");
      await load();
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        (n.author_name ?? "").toLowerCase().includes(q),
    );
  }, [notes, search]);

  const renderEditor = () => (
    <Card className="p-4 space-y-3 border-primary/40">
      <Input
        placeholder="Note title"
        value={draftTitle}
        onChange={(e) => setDraftTitle(e.target.value)}
      />
      <Textarea
        placeholder="Write your note here. Markdown supported (e.g. **bold**, lists, [links](https://…))."
        value={draftContent}
        onChange={(e) => setDraftContent(e.target.value)}
        className="min-h-[160px] font-mono text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={creating}>
          <X className="h-4 w-4 mr-1" /> Cancel
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={creating}>
          {creating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          Save
        </Button>
      </div>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex-1" />
        <Button size="sm" onClick={startNew} disabled={editingId === "__new__"} className="gap-1.5">
          <Plus className="h-4 w-4" /> New note
        </Button>
      </div>

      {editingId === "__new__" && renderEditor()}

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground text-center">
          {search ? "No notes match your search." : "No notes yet. Click \"New note\" to add one."}
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((n) =>
            editingId === n.id ? (
              <div key={n.id}>{renderEditor()}</div>
            ) : (
              <Card key={n.id} className={`p-4 ${n.pinned ? "border-primary/40" : ""}`}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold truncate">{n.title || "Untitled"}</h3>
                      {n.pinned && (
                        <Badge variant="secondary" className="gap-1">
                          <Pin className="h-3 w-3" /> Pinned
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {n.author_name ?? "Unknown"} · updated {new Date(n.updated_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title={n.pinned ? "Unpin" : "Pin"}
                      onClick={() => void togglePin(n)}
                    >
                      {n.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="Edit"
                      onClick={() => startEdit(n)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      title="Delete"
                      onClick={() => void remove(n)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {n.content ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{n.content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">(no content)</p>
                )}
              </Card>
            ),
          )}
        </div>
      )}
    </div>
  );
}
