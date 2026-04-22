import { ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";
import { useMqttStore } from "@/hooks/useMqttStore";
import { Button } from "@/components/ui/button";
import { Power, PowerOff } from "lucide-react";

export function DashboardLayout({ children, title, subtitle, actions }: { children: ReactNode; title: string; subtitle?: string; actions?: ReactNode }) {
  const store = useMqttStore();
  return (
    <div className="min-h-screen flex w-full bg-background">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 border-b border-border bg-card/40 backdrop-blur px-6 flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground tracking-tight truncate">{title}</h1>
            {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            {store.status === "connected" || store.status === "connecting" ? (
              <Button variant="outline" size="sm" onClick={() => store.disconnect()}>
                <PowerOff className="h-4 w-4 mr-2" /> Disconnect
              </Button>
            ) : (
              <Button size="sm" onClick={() => store.connect()} className="bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-glow">
                <Power className="h-4 w-4 mr-2" /> Connect
              </Button>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
