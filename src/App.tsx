import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { BrandingProvider } from "@/hooks/useBranding";
import { AuthGate } from "@/components/AuthGate";
import { AuthorBadge } from "@/components/AuthorBadge";
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
import DailyReports from "./pages/DailyReports.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const protect = (el: JSX.Element, adminOnly = false) => <AuthGate adminOnly={adminOnly}>{el}</AuthGate>;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <BrandingProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/change-password" element={protect(<ChangePassword />)} />
              <Route path="/" element={protect(<Index />, true)} />
              <Route path="/sources" element={protect(<Sources />, true)} />
              <Route path="/frigate" element={protect(<Frigate />, true)} />
              <Route path="/nvr-status" element={protect(<NvrStatus />, true)} />
              <Route path="/wall" element={protect(<Wall />)} />
              <Route path="/cameras" element={protect(<Cameras />)} />
              <Route path="/media" element={protect(<Media />)} />
              <Route path="/auto-read" element={protect(<AutoRead />, true)} />
              <Route path="/archive" element={protect(<Archive />, true)} />
              <Route path="/audit" element={protect(<Audit />, true)} />
              <Route path="/users" element={protect(<Users />, true)} />
              <Route path="/customization" element={protect(<Customization />, true)} />
              <Route path="/daily-reports" element={protect(<DailyReports />, true)} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            <AuthorBadge />
          </BrandingProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
