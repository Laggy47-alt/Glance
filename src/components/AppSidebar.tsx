import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Activity, Archive, Filter, Camera, Film, Webhook, Plug, Server, Bell, Users as UsersIcon, LogOut, KeyRound, ScrollText, Palette, HeartPulse, ChevronDown, Building2, Mail, VideoOff, ShieldAlert, Phone, Radio, MessageSquareWarning } from "lucide-react";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { useAuth } from "@/hooks/useAuth";
import { useBranding } from "@/hooks/useBranding";
import { cn } from "@/lib/utils";

const adminItems = [
  { to: "/", label: "Overview", icon: Activity },
  { to: "/wall", label: "Live Wall", icon: Bell },
  { to: "/frigate", label: "Frigate NVR", icon: Server },
  { to: "/nvr-status", label: "NVR Status", icon: HeartPulse },
  { to: "/camera-status", label: "Camera Status", icon: VideoOff },
  { to: "/cameras", label: "Cameras", icon: Camera },
  { to: "/media", label: "Media", icon: Film },
  
  { to: "/archive", label: "Archive", icon: Archive },
  { to: "/audit", label: "Audit Trail", icon: ScrollText },
  { to: "/callouts", label: "Callout Requests", icon: Phone },
  { to: "/daily-reports", label: "Daily Reports", icon: Mail },
  { to: "/customization", label: "Customization", icon: Palette },
];

const userItems = [
  { to: "/wall", label: "Live Wall", icon: Bell },
  { to: "/camera-status", label: "Camera Status", icon: VideoOff },
  { to: "/cameras", label: "Cameras", icon: Camera },
  { to: "/media", label: "Media", icon: Film },
];

const customerItems = [
  { to: "/customer", label: "My NVRs", icon: ShieldAlert },
  { to: "/customer/events", label: "Recent Detections", icon: Radio },
  { to: "/customer/instructions", label: "Operator Instructions", icon: MessageSquareWarning },
];

export function AppSidebar() {
  const store = useWebhookStore();
  const { profile, isAdmin, isCustomer, signOut } = useAuth();
  const { appName, appSubtitle, logoUrl } = useBranding();
  const location = useLocation();
  const navigate = useNavigate();
  const enabledSources = store.sources.filter((s) => s.enabled).length;
  const sites = [...store.frigates].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
  const [sitesOpen, setSitesOpen] = useState(true);

  const items = isAdmin
    ? [...adminItems, { to: "/users", label: "Users", icon: UsersIcon }]
    : isCustomer
      ? customerItems
      : userItems;
  const showSites = !isCustomer || isAdmin;

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col bg-sidebar border-r border-sidebar-border">
      <div className="px-5 py-5 border-b border-sidebar-border flex items-center gap-3">
        <div className="h-9 w-9 rounded-md bg-gradient-primary grid place-items-center shadow-glow overflow-hidden">
          {logoUrl ? (
            <img src={logoUrl} alt={appName} className="h-full w-full object-contain" />
          ) : (
            <Webhook className="h-5 w-5 text-primary-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-sidebar-accent-foreground tracking-tight truncate">{appName}</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground truncate">{appSubtitle}</div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {items.map((it) => {
          const active = location.pathname === it.to;
          return (
            <NavLink
              key={it.to}
              to={it.to}
              end
              className={cn(
                "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )}
            >
              <it.icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground group-hover:text-sidebar-accent-foreground")} />
              <span className="flex-1">{it.label}</span>
            </NavLink>
          );
        })}

        {showSites && (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setSitesOpen((v) => !v)}
            className="w-full group flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground transition-colors"
          >
            <Building2 className="h-4 w-4 text-muted-foreground group-hover:text-sidebar-accent-foreground" />
            <span className="flex-1 text-left">ABC Sites</span>
            <span className="text-[10px] text-muted-foreground tabular-nums">{sites.length}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", sitesOpen && "rotate-180")} />
          </button>

          {sitesOpen && (
            <div className="mt-1 ml-3 pl-3 border-l border-sidebar-border space-y-0.5">
              {sites.length === 0 ? (
                <p className="px-3 py-1.5 text-[11px] text-muted-foreground italic">No sites yet</p>
              ) : (
                sites.map((s) => (
                  <a
                    key={s.id}
                    href={s.base_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground transition-colors text-left"
                  >
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className="flex-1 truncate">{s.name}</span>
                    {!s.enabled && <span className="text-[9px] uppercase text-muted-foreground">off</span>}
                  </a>
                ))
              )}
            </div>
          )}
        </div>
        )}
      </nav>

      <div className="p-3 border-t border-sidebar-border space-y-2">
        <div className="rounded-md bg-sidebar-accent/40 px-3 py-2.5 flex items-center gap-3">
          <div className="relative h-2 w-2 rounded-full pulse-dot bg-success" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-sidebar-accent-foreground truncate">
              {profile?.display_name ?? profile?.username ?? "Live"}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {isAdmin ? "Admin" : isCustomer ? "Customer" : `${enabledSources} active source${enabledSources === 1 ? "" : "s"}`}
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => navigate("/change-password")}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground transition-colors"
          >
            <KeyRound className="h-3 w-3" /> Password
          </button>
          <button
            onClick={handleSignOut}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground transition-colors"
          >
            <LogOut className="h-3 w-3" /> Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
