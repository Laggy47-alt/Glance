import { useState } from "react";

export const AUTHOR_NAME = "Charl Pretorius";

export function AuthorBadge() {
  const [show, setShow] = useState(false);
  return (
    <div className="fixed bottom-2 left-2 z-50 flex items-center gap-2 print:hidden">
      <button
        type="button"
        aria-label="Show author"
        title=""
        onClick={() => setShow((s) => !s)}
        className="h-3 w-3 rounded-full bg-transparent hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring opacity-30 hover:opacity-60 transition-opacity"
      />
      {show && (
        <span className="text-xs text-muted-foreground bg-background/80 backdrop-blur px-2 py-1 rounded border border-border shadow-sm">
          Author name = {AUTHOR_NAME}
        </span>
      )}
    </div>
  );
}
