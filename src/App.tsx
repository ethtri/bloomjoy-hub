import { Suspense, useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  QueryClient,
  QueryClientProvider,
  type QueryClient as QueryClientInstance,
} from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { LanguageProvider, useLanguage } from "@/contexts/LanguageContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { MemberRoute } from "@/components/auth/MemberRoute";
import { AdminRoute } from "@/components/auth/AdminRoute";
import { HostRedirectGate } from "@/components/routing/HostRedirectGate";
import { RouteErrorBoundary } from "@/components/routing/RouteErrorBoundary";
import { RouteSeoManager } from "@/components/seo/RouteSeoManager";
import { lazyRoute } from "@/lib/lazyRoute";

import Index from "./pages/Index";

const Products = lazyRoute(() => import("./pages/Products"));
const CommercialRobotic = lazyRoute(() => import("./pages/products/CommercialRobotic"));
const Mini = lazyRoute(() => import("./pages/products/Mini"));
const Micro = lazyRoute(() => import("./pages/products/Micro"));
const Supplies = lazyRoute(() => import("./pages/Supplies"));
const Plus = lazyRoute(() => import("./pages/Plus"));
const Contact = lazyRoute(() => import("./pages/Contact"));
const About = lazyRoute(() => import("./pages/About"));
const Resources = lazyRoute(() => import("./pages/Resources"));
const BusinessPlaybookIndex = lazyRoute(
  () => import("./pages/resources/BusinessPlaybookIndex")
);
const BusinessPlaybookPlanner = lazyRoute(
  () => import("./pages/resources/BusinessPlaybookPlanner")
);
const BusinessPlaybookArticle = lazyRoute(
  () => import("./pages/resources/BusinessPlaybookArticle")
);
const Privacy = lazyRoute(() => import("./pages/Privacy"));
const Terms = lazyRoute(() => import("./pages/Terms"));
const BillingCancellation = lazyRoute(() => import("./pages/BillingCancellation"));
const Cart = lazyRoute(() => import("./pages/Cart"));
const Login = lazyRoute(() => import("./pages/Login"));
const ResetPassword = lazyRoute(() => import("./pages/ResetPassword"));
const PortalDashboard = lazyRoute(() => import("./pages/portal/Dashboard"));
const PortalTraining = lazyRoute(() => import("./pages/portal/Training"));
const PortalTrainingDetail = lazyRoute(() => import("./pages/portal/TrainingDetail"));
const PortalSupport = lazyRoute(() => import("./pages/portal/Support"));
const PortalOnboarding = lazyRoute(() => import("./pages/portal/Onboarding"));
const PortalOrders = lazyRoute(() => import("./pages/portal/Orders"));
const PortalAccount = lazyRoute(() => import("./pages/portal/Account"));
const PortalReports = lazyRoute(() => import("./pages/portal/Reports"));
const AdminDashboard = lazyRoute(() => import("./pages/admin/Dashboard"));
const AdminOrders = lazyRoute(() => import("./pages/admin/Orders"));
const AdminSupport = lazyRoute(() => import("./pages/admin/Support"));
const AdminAccess = lazyRoute(() => import("./pages/admin/Access"));
const AdminPartnerRecords = lazyRoute(() => import("./pages/admin/PartnerRecords"));
const AdminMachines = lazyRoute(() => import("./pages/admin/Machines"));
const AdminPartnerships = lazyRoute(() => import("./pages/admin/Partnerships"));
const AdminReporting = lazyRoute(() => import("./pages/admin/Reporting"));
const NotFound = lazyRoute(() => import("./pages/NotFound"));

const browserQueryClient = new QueryClient();

const RouteFallback = () => (
  <div className="container-page py-10 text-sm text-muted-foreground">Loading page...</div>
);

const isAppLanguageSurface = (pathname: string) =>
  pathname === "/login" ||
  pathname === "/reset-password" ||
  pathname.startsWith("/portal") ||
  pathname.startsWith("/admin");

const AppLanguageMetadata = () => {
  const { language, supportedLanguages } = useLanguage();
  const { pathname } = useLocation();

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const htmlLanguage = isAppLanguageSurface(pathname)
      ? supportedLanguages.find((supportedLanguage) => supportedLanguage.code === language)
          ?.htmlLang ?? "en"
      : "en";

    document.documentElement.lang = htmlLanguage;
  }, [language, pathname, supportedLanguages]);

  return null;
};

export const AppProviders = ({
  children,
  queryClient = browserQueryClient,
}: {
  children: ReactNode;
  queryClient?: QueryClientInstance;
}) => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <LanguageProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          {children}
        </TooltipProvider>
      </LanguageProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export const AppShell = () => (
  <HostRedirectGate>
    <AppLanguageMetadata />
    <RouteSeoManager />
    <RouteErrorBoundary>
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
          <Route path="/resources/business-playbook" element={<BusinessPlaybookIndex />} />
          <Route path="/resources/business-playbook/planner" element={<BusinessPlaybookPlanner />} />
          <Route
            path="/resources/business-playbook/:slug"
            element={<BusinessPlaybookArticle />}
          />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/billing-cancellation" element={<BillingCancellation />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/login" element={<Login />} />
          <Route path="/login/operator" element={<Navigate to="/login" replace />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/portal" element={<PortalDashboard />} />
            <Route element={<MemberRoute />}>
              <Route path="/portal/orders" element={<PortalOrders />} />
              <Route path="/portal/account" element={<PortalAccount />} />
              <Route path="/portal/reports" element={<PortalReports />} />
              <Route path="/portal/training" element={<PortalTraining />} />
              <Route path="/portal/training/:id" element={<PortalTrainingDetail />} />
              <Route path="/portal/support" element={<PortalSupport />} />
              <Route path="/portal/onboarding" element={<PortalOnboarding />} />
            </Route>
            <Route element={<AdminRoute />}>
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/orders" element={<AdminOrders />} />
              <Route path="/admin/support" element={<AdminSupport />} />
              <Route path="/admin/access" element={<AdminAccess />} />
              <Route path="/admin/partner-records" element={<AdminPartnerRecords />} />
              <Route path="/admin/machines" element={<AdminMachines />} />
              <Route
                path="/admin/accounts"
                element={<Navigate to="/admin/access?tab=users" replace />}
              />
              <Route path="/admin/partnerships" element={<AdminPartnerships />} />
              <Route path="/admin/reporting" element={<AdminReporting />} />
              <Route
                path="/admin/audit"
                element={<Navigate to="/admin/access?tab=audit" replace />}
              />
            </Route>
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  </HostRedirectGate>
);

const App = () => (
  <AppProviders>
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  </AppProviders>
);

export default App;
