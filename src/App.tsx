import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { AuthGate } from "@/components/AuthGate";
import Index from "./pages/Index.tsx";
import Sources from "./pages/Sources.tsx";
import Frigate from "./pages/Frigate.tsx";
import Messages from "./pages/Messages.tsx";
import AutoRead from "./pages/AutoRead.tsx";
import Archive from "./pages/Archive.tsx";
import Audit from "./pages/Audit.tsx";
import Cameras from "./pages/Cameras.tsx";
import Media from "./pages/Media.tsx";
import Wall from "./pages/Wall.tsx";
import Login from "./pages/Login.tsx";
import ChangePassword from "./pages/ChangePassword.tsx";
import Users from "./pages/Users.tsx";
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
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/change-password" element={protect(<ChangePassword />)} />
            <Route path="/" element={protect(<Index />)} />
            <Route path="/sources" element={protect(<Sources />)} />
            <Route path="/frigate" element={protect(<Frigate />)} />
            <Route path="/messages" element={protect(<Messages />)} />
            <Route path="/wall" element={protect(<Wall />)} />
            <Route path="/cameras" element={protect(<Cameras />)} />
            <Route path="/media" element={protect(<Media />)} />
            <Route path="/auto-read" element={protect(<AutoRead />)} />
            <Route path="/archive" element={protect(<Archive />)} />
            <Route path="/audit" element={protect(<Audit />)} />
            <Route path="/users" element={protect(<Users />, true)} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
