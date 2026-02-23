import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { MemberRoute } from "@/components/auth/MemberRoute";
import { AdminRoute } from "@/components/auth/AdminRoute";

import Index from "./pages/Index";

const Products = lazy(() => import("./pages/Products"));
const CommercialRobotic = lazy(() => import("./pages/products/CommercialRobotic"));
const Mini = lazy(() => import("./pages/products/Mini"));
const Micro = lazy(() => import("./pages/products/Micro"));
const Supplies = lazy(() => import("./pages/Supplies"));
const Plus = lazy(() => import("./pages/Plus"));
const Contact = lazy(() => import("./pages/Contact"));
const About = lazy(() => import("./pages/About"));
const Resources = lazy(() => import("./pages/Resources"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const BillingCancellation = lazy(() => import("./pages/BillingCancellation"));
const Cart = lazy(() => import("./pages/Cart"));
const Login = lazy(() => import("./pages/Login"));
const PortalDashboard = lazy(() => import("./pages/portal/Dashboard"));
const PortalTraining = lazy(() => import("./pages/portal/Training"));
const PortalTrainingDetail = lazy(() => import("./pages/portal/TrainingDetail"));
const PortalSupport = lazy(() => import("./pages/portal/Support"));
const PortalOnboarding = lazy(() => import("./pages/portal/Onboarding"));
const PortalOrders = lazy(() => import("./pages/portal/Orders"));
const PortalAccount = lazy(() => import("./pages/portal/Account"));
const AdminDashboard = lazy(() => import("./pages/admin/Dashboard"));
const AdminOrders = lazy(() => import("./pages/admin/Orders"));
const AdminSupport = lazy(() => import("./pages/admin/Support"));
const AdminAccounts = lazy(() => import("./pages/admin/Accounts"));
const AdminAudit = lazy(() => import("./pages/admin/Audit"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="container-page py-10 text-sm text-muted-foreground">Loading page...</div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/machines" element={<Products />} />
              <Route
                path="/machines/commercial-robotic-machine"
                element={<CommercialRobotic />}
              />
              <Route path="/machines/mini" element={<Mini />} />
              <Route path="/machines/micro" element={<Micro />} />
              <Route path="/products" element={<Navigate to="/machines" replace />} />
              <Route
                path="/products/commercial-robotic-machine"
                element={<Navigate to="/machines/commercial-robotic-machine" replace />}
              />
              <Route path="/products/mini" element={<Navigate to="/machines/mini" replace />} />
              <Route path="/products/micro" element={<Navigate to="/machines/micro" replace />} />
              <Route path="/supplies" element={<Supplies />} />
              <Route path="/plus" element={<Plus />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/about" element={<About />} />
              <Route path="/resources" element={<Resources />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/billing-cancellation" element={<BillingCancellation />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/login" element={<Login />} />
              <Route element={<ProtectedRoute />}>
                <Route path="/portal" element={<PortalDashboard />} />
                <Route path="/portal/orders" element={<PortalOrders />} />
                <Route path="/portal/account" element={<PortalAccount />} />
                <Route element={<MemberRoute />}>
                  <Route path="/portal/training" element={<PortalTraining />} />
                  <Route path="/portal/training/:id" element={<PortalTrainingDetail />} />
                  <Route path="/portal/support" element={<PortalSupport />} />
                  <Route path="/portal/onboarding" element={<PortalOnboarding />} />
                </Route>
                <Route element={<AdminRoute />}>
                  <Route path="/admin" element={<AdminDashboard />} />
                  <Route path="/admin/orders" element={<AdminOrders />} />
                  <Route path="/admin/support" element={<AdminSupport />} />
                  <Route path="/admin/accounts" element={<AdminAccounts />} />
                  <Route path="/admin/audit" element={<AdminAudit />} />
                </Route>
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
