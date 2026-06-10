import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Mail, Check, RefreshCw, MessageSquare, Inbox } from "lucide-react";
import { toast } from "sonner";

type Msg = {
  id: string;
  sender: string;
  sender_name: string | null;
  message: string;
  created_at: string;
  read: boolean;
  notes: string | null;
};

export default function WhatsAppInbox({ organizationId }: { organizationId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const fetchMessages = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("whatsapp_incoming_messages")
      .select("id, sender, sender_name, message, created_at, read, notes")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      toast.error(error.message);
    } else {
      setMessages((data ?? []) as Msg[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMessages();
    // Poll every 30s
    const iv = setInterval(fetchMessages, 30000);
    return () => clearInterval(iv);
  }, [organizationId]);

  const markRead = async (id: string, read: boolean) => {
    const { error } = await supabase
      .from("whatsapp_incoming_messages")
      .update({ read })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, read } : m)));
  };

  const saveNote = async (id: string, notes: string) => {
    const { error } = await supabase
      .from("whatsapp_incoming_messages")
      .update({ notes })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, notes } : m)));
  };

  const filtered = filter === "unread" ? messages.filter((m) => !m.read) : messages;
  const unreadCount = messages.filter((m) => !m.read).length;

  return (
    <Card className="bg-gradient-card border-border shadow-card p-5 mb-5">
      <div className="flex items-center gap-2 mb-4">
        <Inbox className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-foreground">Reply Inbox</h3>
        {unreadCount > 0 && (
          <Badge variant="destructive" className="ml-2">{unreadCount} new</Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant={filter === "unread" ? "default" : "outline"} onClick={() => setFilter(filter === "unread" ? "all" : "unread")}>
            {filter === "unread" ? "Show all" : "Unread only"}
          </Button>
          <Button size="sm" variant="ghost" onClick={fetchMessages} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {loading && messages.length === 0 && (
        <div className="text-sm text-muted-foreground">Loading replies…</div>
      )}

      {filtered.length === 0 && !loading && (
        <div className="text-sm text-muted-foreground italic">
          {filter === "unread" ? "No unread replies." : "No replies yet. When a client replies to a WhatsApp alert, it will appear here."}
        </div>
      )}

      <div className="space-y-2 max-h-[500px] overflow-auto">
        {filtered.map((m) => {
          const isExpanded = !!expanded[m.id];
          const time = new Date(m.created_at).toLocaleString();
          return (
            <div key={m.id} className={`rounded-md border p-3 space-y-2 ${m.read ? "border-border bg-background" : "border-primary/30 bg-primary/5"}`}>
              <div className="flex items-start gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{m.sender_name ?? m.sender}</span>
                    <span className="text-[11px] text-muted-foreground font-mono">{m.sender}</span>
                    {!m.read && <Badge variant="secondary" className="text-[10px]">New</Badge>}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{time}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => markRead(m.id, !m.read)}>
                  <Check className="h-3.5 w-3.5 mr-1" />{m.read ? "Mark unread" : "Mark read"}
                </Button>
              </div>

              <div className="text-sm whitespace-pre-wrap">
                {isExpanded ? m.message : m.message.length > 200 ? m.message.slice(0, 200) + "…" : m.message}
              </div>
              {m.message.length > 200 && (
                <button className="text-xs text-primary hover:underline" onClick={() => setExpanded({ ...expanded, [m.id]: !isExpanded })}>
                  {isExpanded ? "Show less" : "Show more"}
                </button>
              )}

              <div className="pt-2 border-t border-border">
                <div className="text-[11px] text-muted-foreground mb-1">Internal notes</div>
                <Textarea
                  rows={2}
                  value={m.notes ?? ""}
                  onChange={(e) => saveNote(m.id, e.target.value)}
                  placeholder="Add a note for the Technical Team…"
                  className="bg-secondary border-border text-xs"
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
