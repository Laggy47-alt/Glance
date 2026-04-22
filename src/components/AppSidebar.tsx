import { NavLink, useLocation } from "react-router-dom";
import { Activity, Inbox, Archive, Filter, Settings, Radio, Camera, Film } from "lucide-react";
import { useMqttStore } from "@/hooks/useMqttStore";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Overview", icon: Activity },
  { to: "/messages", label: "Messages", icon: Inbox },
  { to: "/cameras", label: "Cameras", icon: Camera },
  { to: "/media", label: "Media", icon: Film },
  { to: "/auto-read", label: "Auto-Read Rules", icon: Filter },
  { to: "/archive", label: "Archive", icon: Archive },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar() {
  const store = useMqttStore();
  const location = useLocation();
  const unread = store.messages.filter((m) => !m.read && !m.archived).length;

  const statusColor =
    store.status === "connected"
      ? "bg-success text-success"
      : store.status === "connecting"
      ? "bg-warning text-warning"
      : store.status === "error"
      ? "bg-destructive text-destructive"
      : "bg-muted-foreground text-muted-foreground";

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col bg-sidebar border-r border-sidebar-border">
      <div className="px-5 py-5 border-b border-sidebar-border flex items-center gap-3">
        <div className="h-9 w-9 rounded-md bg-gradient-primary grid place-items-center shadow-glow">
          <Radio className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <div className="text-sm font-semibold text-sidebar-accent-foreground tracking-tight">MQTT Console</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Broker Dashboard</div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
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
              {it.to === "/messages" && unread > 0 && (
                <span className="text-[10px] font-semibold bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <div className="rounded-md bg-sidebar-accent/40 px-3 py-2.5 flex items-center gap-3">
          <div className={cn("relative h-2 w-2 rounded-full pulse-dot", statusColor)} />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-sidebar-accent-foreground capitalize">{store.status}</div>
            <div className="text-[10px] text-muted-foreground truncate">
              {store.config.demoMode ? "Demo simulator" : `${store.config.host}:${store.config.port}`}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
