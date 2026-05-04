import { ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";
import { useSnapshotRefresher } from "@/hooks/useSnapshotRefresher";

export function DashboardLayout({
  children,
  title,
  subtitle,
  actions,
  hideSidebar = false,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  hideSidebar?: boolean;
}) {
  useSnapshotRefresher();
  return (
    <div className="min-h-screen flex w-full bg-background">
      {!hideSidebar && <AppSidebar />}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 border-b border-border bg-card/40 backdrop-blur px-6 flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground tracking-tight truncate">{title}</h1>
            {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
            <OfflineNotifications />
            {actions}
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
