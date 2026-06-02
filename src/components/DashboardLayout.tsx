import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Webhook } from "lucide-react";
import { AppSidebar } from "./AppSidebar";
import { useSnapshotRefresher } from "@/hooks/useSnapshotRefresher";
import { useAuth } from "@/hooks/useAuth";
import { useBranding } from "@/hooks/useBranding";
import { Button } from "@/components/ui/button";

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
  const { isCustomer, signOut } = useAuth();
  const { appName, appSubtitle: _appSubtitle, logoUrl } = useBranding();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen flex w-full bg-background">
      {!hideSidebar && <AppSidebar />}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 border-b border-border bg-card/40 backdrop-blur px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-md bg-gradient-primary grid place-items-center shadow-glow overflow-hidden shrink-0">
              {logoUrl ? (
                <img src={logoUrl} alt={appName} className="h-full w-full object-contain" />
              ) : (
                <Webhook className="h-5 w-5 text-primary-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-foreground tracking-tight truncate">{title}</h1>
              {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {actions}
            {isCustomer && (
              <Button variant="outline" size="sm" onClick={handleSignOut} className="gap-1.5">
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </Button>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}

