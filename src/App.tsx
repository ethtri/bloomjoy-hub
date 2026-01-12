import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

import Index from "./pages/Index";
import Products from "./pages/Products";
import CommercialRobotic from "./pages/products/CommercialRobotic";
import Mini from "./pages/products/Mini";
import Micro from "./pages/products/Micro";
import Supplies from "./pages/Supplies";
import Plus from "./pages/Plus";
import Contact from "./pages/Contact";
import About from "./pages/About";
import Resources from "./pages/Resources";
import Cart from "./pages/Cart";
import Login from "./pages/Login";
import PortalDashboard from "./pages/portal/Dashboard";
import PortalTraining from "./pages/portal/Training";
import PortalSupport from "./pages/portal/Support";
import PortalOnboarding from "./pages/portal/Onboarding";
import PortalOrders from "./pages/portal/Orders";
import PortalAccount from "./pages/portal/Account";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/products" element={<Products />} />
            <Route path="/products/commercial-robotic-machine" element={<CommercialRobotic />} />
            <Route path="/products/mini" element={<Mini />} />
            <Route path="/products/micro" element={<Micro />} />
            <Route path="/supplies" element={<Supplies />} />
            <Route path="/plus" element={<Plus />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/about" element={<About />} />
            <Route path="/resources" element={<Resources />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/portal" element={<PortalDashboard />} />
              <Route path="/portal/training" element={<PortalTraining />} />
              <Route path="/portal/support" element={<PortalSupport />} />
              <Route path="/portal/onboarding" element={<PortalOnboarding />} />
              <Route path="/portal/orders" element={<PortalOrders />} />
              <Route path="/portal/account" element={<PortalAccount />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
