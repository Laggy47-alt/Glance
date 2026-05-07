import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Webhook, ArrowLeft, Building2 } from "lucide-react";
import { AppSidebar } from "./AppSidebar";
import { useSnapshotRefresher } from "@/hooks/useSnapshotRefresher";
import { useAuth } from "@/hooks/useAuth";
import { useBranding } from "@/hooks/useBranding";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  const { isCustomer, isSuperAdmin, isImpersonating, impersonateOrg, signOut, orgs, activeOrg, setActiveOrgId } = useAuth();
  const { appName, appSubtitle, logoUrl } = useBranding();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const returnToPortal = () => {
    impersonateOrg(null);
    navigate("/super", { replace: true });
  };

  return (
    <div className="min-h-screen flex w-full bg-background">
      {!hideSidebar && <AppSidebar />}
      <div className="flex-1 flex flex-col min-w-0">
        {isSuperAdmin && isImpersonating && (
          <div className="bg-primary/15 border-b border-primary/30 px-6 py-2 flex items-center justify-between gap-3">
            <div className="text-xs text-foreground">
              <span className="font-semibold">Super Admin view</span> — impersonating organization
            </div>
            <Button size="sm" variant="outline" onClick={returnToPortal} className="gap-1.5 h-7">
              <ArrowLeft className="h-3.5 w-3.5" /> Return to Super Portal
            </Button>
          </div>
        )}
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
            {!isImpersonating && orgs.length > 1 && activeOrg && (
              <div className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                <Select value={activeOrg.id} onValueChange={(v) => setActiveOrgId(v)}>
                  <SelectTrigger className="h-8 w-[180px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {orgs.map((m) => m.organization && (
                      <SelectItem key={m.organization.id} value={m.organization.id}>
                        {m.organization.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
