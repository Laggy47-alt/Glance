import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Activity, Filter, Film, Webhook, Plug, Server, Bell, Users as UsersIcon, LogOut, KeyRound, Palette, HeartPulse, ChevronDown, Building2, Mail, VideoOff, ShieldAlert, Phone, Radio, MessageSquareWarning, AlertTriangle, MessageCircle, Video } from "lucide-react";
import { useWebhookStore } from "@/hooks/useWebhookStore";
import { useAuth } from "@/hooks/useAuth";
import { useBranding } from "@/hooks/useBranding";
import { useOfflineStatus } from "@/hooks/useOfflineStatus";

import { cn } from "@/lib/utils";


const adminItems = [
  { to: "/", label: "Overview", icon: Activity },
  { to: "/wall", label: "Live Wall", icon: Bell },
  { to: "/frigate", label: "NVRs", icon: Server },
  { to: "/cameras", label: "Cameras", icon: Video },
  { to: "/nvr-status", label: "NVR Status", icon: HeartPulse },
  { to: "/camera-status", label: "Camera Status", icon: VideoOff },
  { to: "/unifi-status", label: "UniFi Status", icon: Radio },
  { to: "/unifi-live", label: "UniFi Live", icon: Video },
  { to: "/media", label: "Media", icon: Film },

  { to: "/callouts", label: "Callout Requests", icon: Phone },
  { to: "/daily-reports", label: "Daily Reports", icon: Mail },
  { to: "/whatsapp-alerts", label: "WhatsApp Alerts", icon: MessageCircle },

  { to: "/customization", label: "Customization", icon: Palette },
];

const userItems = [
  { to: "/wall", label: "Live Wall", icon: Bell },
  { to: "/camera-status", label: "Camera Status", icon: VideoOff },
  { to: "/media", label: "Media", icon: Film },
];

const customerItems = [
  { to: "/customer", label: "My NVRs", icon: ShieldAlert },
  { to: "/customer/events", label: "Recent Detections", icon: Radio },
  { to: "/customer/instructions", label: "Operator Instructions", icon: MessageSquareWarning },
];

export function AppSidebar() {
  const store = useWebhookStore();
  const { profile, isAdmin, isSuperAdmin, isCustomer, signOut, activeOrg, orgs, setActiveOrgId } = useAuth();
  const { appName, appSubtitle, logoUrl } = useBranding();
  const { offlineCameras, unreachableNvrs, hasOffline } = useOfflineStatus();
  const location = useLocation();
  const navigate = useNavigate();
  const enabledSources = store.sources.filter((s) => s.enabled).length;
  const sites = [
    ...store.frigates.map((f) => ({ id: f.id, name: f.name, color: f.color, enabled: f.enabled, base_url: f.base_url, kind: "frigate" as const })),
    ...store.hikvisions.map((h) => ({ id: h.id, name: h.name, color: h.color, enabled: h.enabled, base_url: h.base_url, kind: "hikvision" as const })),
  ].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
  const [sitesOpen, setSitesOpen] = useState(true);

  const items = isAdmin
    ? [...adminItems, { to: "/users", label: "Users", icon: UsersIcon }]
    : isCustomer
      ? customerItems
      : userItems;
  const showSites = !isCustomer || isAdmin;
  const showOrgSwitcher = orgs.length > 1 || isSuperAdmin;


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

      {showOrgSwitcher && (
        <div className="px-3 pt-3">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground px-1">Organization</label>
          <select
            value={activeOrg?.id ?? ""}
            onChange={(e) => setActiveOrgId(e.target.value || null)}
            className="mt-1 w-full bg-sidebar-accent/40 border border-sidebar-border rounded-md px-2 py-1.5 text-xs text-sidebar-accent-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {!activeOrg && <option value="">Select org…</option>}
            {orgs.map((o) => (
              <option key={o.organization_id} value={o.organization_id}>
                {o.organization?.name ?? o.organization_id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
      )}


      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {items.map((it) => {
          const active = location.pathname === it.to;
          const showAlert = hasOffline && (it.to === "/nvr-status" || it.to === "/camera-status");
          const alertTitle = it.to === "/nvr-status"
            ? `${unreachableNvrs} NVR${unreachableNvrs === 1 ? "" : "s"} unreachable, ${offlineCameras} camera${offlineCameras === 1 ? "" : "s"} offline`
            : `${offlineCameras} camera${offlineCameras === 1 ? "" : "s"} offline`;
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
              {showAlert && (
                <span
                  title={alertTitle}
                  className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold animate-pulse"
                >
                  <AlertTriangle className="h-3 w-3" />
                </span>
              )}
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
            <span className="flex-1 text-left truncate">{activeOrg?.name ? `${activeOrg.name} Sites` : "Sites"}</span>
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
