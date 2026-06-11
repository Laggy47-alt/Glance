import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { BrandingProvider } from "@/hooks/useBranding";
import { AuthGate } from "@/components/AuthGate";
import { AuthorBadge } from "@/components/AuthorBadge";
import { OperatorOfflinePopup } from "@/components/OperatorOfflinePopup";
import { BackendWatchdog } from "./components/BackendWatchdog";

// Lazy-load every route so the initial bundle only contains the shell.
const Index = lazy(() => import("./pages/Index.tsx"));
const Sources = lazy(() => import("./pages/Sources.tsx"));
const Frigate = lazy(() => import("./pages/Frigate.tsx"));
const AutoRead = lazy(() => import("./pages/AutoRead.tsx"));
const Audit = lazy(() => import("./pages/Audit.tsx"));
const Media = lazy(() => import("./pages/Media.tsx"));
const Wall = lazy(() => import("./pages/Wall.tsx"));
const Login = lazy(() => import("./pages/Login.tsx"));
const ChangePassword = lazy(() => import("./pages/ChangePassword.tsx"));
const Users = lazy(() => import("./pages/Users.tsx"));
const Customization = lazy(() => import("./pages/Customization.tsx"));
const NvrStatus = lazy(() => import("./pages/NvrStatus.tsx"));
const CameraStatus = lazy(() => import("./pages/CameraStatus.tsx"));
const DailyReports = lazy(() => import("./pages/DailyReports.tsx"));
const WhatsAppAlerts = lazy(() => import("./pages/WhatsAppAlerts.tsx"));
const Customer = lazy(() => import("./pages/Customer.tsx"));
const CustomerEvents = lazy(() => import("./pages/CustomerEvents.tsx"));
const CustomerInstructions = lazy(() => import("./pages/CustomerInstructions.tsx"));
const Callouts = lazy(() => import("./pages/Callouts.tsx"));
const SuperAdmin = lazy(() => import("./pages/SuperAdmin.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Demo = lazy(() => import("./pages/Demo.tsx"));
const Offline = lazy(() => import("./pages/Offline.tsx"));
const Terms = lazy(() => import("./pages/Terms.tsx"));
const RefundPolicy = lazy(() => import("./pages/RefundPolicy.tsx"));
const Privacy = lazy(() => import("./pages/Privacy.tsx"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cut redundant network chatter: cache for a minute and skip the
      // automatic refetch storm on every tab focus / reconnect.
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  },
});

const protect = (el: JSX.Element, adminOnly = false) => (
  <AuthGate adminOnly={adminOnly}>{el}</AuthGate>
);

const RouteFallback = () => (
  <div className="min-h-screen grid place-items-center text-xs text-muted-foreground">
    Loading…
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <BrandingProvider>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/offline" element={<Offline />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/refund-policy" element={<RefundPolicy />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Navigate to="/login" replace />} />
                <Route path="/pricing" element={<Navigate to="/login" replace />} />
                <Route path="/billing" element={<Navigate to="/" replace />} />
                <Route path="/demo" element={<Demo />} />
                <Route path="/super" element={protect(<SuperAdmin />)} />
                <Route path="/change-password" element={protect(<ChangePassword />)} />
                <Route path="/" element={protect(<Index />, true)} />
                <Route path="/sources" element={protect(<Sources />, true)} />
                <Route path="/frigate" element={protect(<Frigate />, true)} />
                <Route path="/nvr-status" element={protect(<NvrStatus />, true)} />
                <Route path="/camera-status" element={protect(<CameraStatus />)} />
                <Route path="/wall" element={protect(<Wall />)} />
                <Route path="/media" element={protect(<Media />)} />
                <Route path="/auto-read" element={protect(<AutoRead />, true)} />
                <Route path="/audit" element={protect(<Audit />, true)} />
                <Route path="/users" element={protect(<Users />, true)} />
                <Route path="/customization" element={protect(<Customization />, true)} />
                <Route path="/daily-reports" element={protect(<DailyReports />, true)} />
                <Route path="/whatsapp-alerts" element={protect(<WhatsAppAlerts />, true)} />

                <Route path="/callouts" element={protect(<Callouts />, true)} />
                <Route path="/customer" element={protect(<Customer />)} />
                <Route path="/customer/events" element={protect(<CustomerEvents />)} />
                <Route path="/customer/instructions" element={protect(<CustomerInstructions />)} />
                <Route path="*" element={protect(<NotFound />)} />
              </Routes>
            </Suspense>
            <AuthorBadge />
            <OperatorOfflinePopup />
            <BackendWatchdog />
          </BrandingProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
