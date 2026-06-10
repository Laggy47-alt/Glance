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
import Index from "./pages/Index.tsx";
import Sources from "./pages/Sources.tsx";
import Frigate from "./pages/Frigate.tsx";

import AutoRead from "./pages/AutoRead.tsx";
import Archive from "./pages/Archive.tsx";
import Audit from "./pages/Audit.tsx";
import Cameras from "./pages/Cameras.tsx";
import Media from "./pages/Media.tsx";
import Wall from "./pages/Wall.tsx";
import Login from "./pages/Login.tsx";
import ChangePassword from "./pages/ChangePassword.tsx";
import Users from "./pages/Users.tsx";
import Customization from "./pages/Customization.tsx";
import NvrStatus from "./pages/NvrStatus.tsx";
import CameraStatus from "./pages/CameraStatus.tsx";
import DailyReports from "./pages/DailyReports.tsx";
import WhatsAppAlerts from "./pages/WhatsAppAlerts.tsx";

import Customer from "./pages/Customer.tsx";
import CustomerEvents from "./pages/CustomerEvents.tsx";
import CustomerInstructions from "./pages/CustomerInstructions.tsx";
import Callouts from "./pages/Callouts.tsx";
import SuperAdmin from "./pages/SuperAdmin.tsx";
import RequestSupportCallout from "./pages/RequestSupportCallout.tsx";
import NotFound from "./pages/NotFound.tsx";
import Demo from "./pages/Demo.tsx";
import Offline from "./pages/Offline.tsx";
import Terms from "./pages/Terms.tsx";
import RefundPolicy from "./pages/RefundPolicy.tsx";
import Privacy from "./pages/Privacy.tsx";
import { BackendWatchdog } from "./components/BackendWatchdog";

const queryClient = new QueryClient();

const protect = (el: JSX.Element, adminOnly = false) => (
  <AuthGate adminOnly={adminOnly}>{el}</AuthGate>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <BrandingProvider>
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
              <Route path="/cameras" element={protect(<Cameras />)} />
              <Route path="/media" element={protect(<Media />)} />
              <Route path="/auto-read" element={protect(<AutoRead />, true)} />
              <Route path="/archive" element={protect(<Archive />, true)} />
              <Route path="/audit" element={protect(<Audit />, true)} />
              <Route path="/users" element={protect(<Users />, true)} />
              <Route path="/customization" element={protect(<Customization />, true)} />
              <Route path="/daily-reports" element={protect(<DailyReports />, true)} />
              <Route path="/whatsapp-alerts" element={protect(<WhatsAppAlerts />, true)} />

              <Route path="/callouts" element={protect(<Callouts />, true)} />
              <Route path="/request-support" element={protect(<RequestSupportCallout />, true)} />
              <Route path="/customer" element={protect(<Customer />)} />
              <Route path="/customer/events" element={protect(<CustomerEvents />)} />
              <Route path="/customer/instructions" element={protect(<CustomerInstructions />)} />
              <Route path="*" element={protect(<NotFound />)} />
            </Routes>
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
