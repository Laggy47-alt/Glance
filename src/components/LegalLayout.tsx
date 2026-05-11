import { Link } from "react-router-dom";
import { ReactNode } from "react";

export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="font-semibold">First Glance Automation</Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground">Terms</Link>
            <Link to="/refund-policy" className="hover:text-foreground">Refunds</Link>
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
          </nav>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: 11 May 2026</p>
        <article className="prose prose-sm dark:prose-invert max-w-none space-y-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_h3]:font-semibold [&_h3]:mt-4 [&_ul]:list-disc [&_ul]:pl-6 [&_p]:leading-relaxed">
          {children}
        </article>
        <footer className="mt-16 pt-6 border-t text-sm text-muted-foreground">
          © {new Date().getFullYear()} First Glance Automation. All rights reserved.
        </footer>
      </main>
    </div>
  );
}
