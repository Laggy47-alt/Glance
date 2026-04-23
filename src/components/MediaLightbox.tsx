import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Film, Camera } from "lucide-react";

export type LightboxItem = {
  kind: "snapshot" | "clip";
  url: string;
  camera: string | null;
  topic: string | null;
  ts: string;
  thumbnail?: string;
  frigateUrl?: string | null;
};

export function MediaLightbox({ item, onClose }: { item: LightboxItem | null; onClose: () => void }) {
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
