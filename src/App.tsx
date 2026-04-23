import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import Sources from "./pages/Sources.tsx";
import Frigate from "./pages/Frigate.tsx";
import Messages from "./pages/Messages.tsx";
import AutoRead from "./pages/AutoRead.tsx";
import Archive from "./pages/Archive.tsx";
import Cameras from "./pages/Cameras.tsx";
import Media from "./pages/Media.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/sources" element={<Sources />} />
          <Route path="/frigate" element={<Frigate />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/cameras" element={<Cameras />} />
          <Route path="/media" element={<Media />} />
          <Route path="/auto-read" element={<AutoRead />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
