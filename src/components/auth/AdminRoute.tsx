import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { useAuth } from '@/contexts/auth-context';
import type { AdminSurface } from '@/components/layout/authenticatedNavigation';

const adminSurfaceByPath: Array<{ test: (pathname: string) => boolean; surface: AdminSurface }> = [
  { test: (pathname) => pathname === '/admin', surface: 'overview' },
  { test: (pathname) => pathname === '/admin/orders' || pathname.startsWith('/admin/orders/'), surface: 'orders' },
  { test: (pathname) => pathname === '/admin/support' || pathname.startsWith('/admin/support/'), surface: 'support' },
  { test: (pathname) => pathname === '/admin/accounts' || pathname.startsWith('/admin/accounts/'), surface: 'accounts' },
  { test: (pathname) => pathname === '/admin/machines' || pathname.startsWith('/admin/machines/'), surface: 'machines' },
  { test: (pathname) => pathname === '/admin/access' || pathname.startsWith('/admin/access/'), surface: 'access' },
  { test: (pathname) => pathname === '/admin/audit' || pathname.startsWith('/admin/audit/'), surface: 'audit' },
  { test: (pathname) => pathname === '/admin/partnerships' || pathname.startsWith('/admin/partnerships/'), surface: 'partnerships' },
  { test: (pathname) => pathname === '/admin/payouts' || pathname.startsWith('/admin/payouts/'), surface: 'payouts' },
];

const getAdminSurfaceForPath = (pathname: string) =>
  adminSurfaceByPath.find((entry) => entry.test(pathname))?.surface ?? null;

export function AdminRoute() {
  const { adminAccess, loading, isAdmin, isSuperAdmin } = useAuth();
  const location = useLocation();
  const allowedSurfaces = new Set(adminAccess.allowedSurfaces);
  const canAccessSurface = (surface: string) =>
    isSuperAdmin || allowedSurfaces.has('*') || allowedSurfaces.has(surface);
  const adminSurface = getAdminSurfaceForPath(location.pathname);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (isSuperAdmin) {
    return <Outlet />;
  }

  if (location.pathname === '/admin' && !canAccessSurface('overview') && canAccessSurface('refunds')) {
    return <Navigate to="/refunds" replace />;
  }

  if (adminSurface && canAccessSurface(adminSurface)) {
    return <Outlet />;
  }

  return (
    <PortalLayout>
      <section className="section-padding">
        <div className="container-page">
          <div className="mx-auto max-w-2xl card-elevated p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <ShieldAlert className="h-7 w-7 text-primary" />
            </div>
            <h1 className="mt-6 font-display text-3xl font-bold text-foreground">
              Admin Access Required
            </h1>
            <p className="mt-3 text-muted-foreground">
              This area is restricted to Bloomjoy operations administrators.
              {isAdmin
                ? ' Your current admin grant does not include this surface.'
                : ''}
            </p>
            <div className="mt-8 flex items-center justify-center gap-3">
              <Button asChild variant="outline" className="min-h-11">
                <Link to="/portal">Back to Portal</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}

export function RefundOperationsRoute() {
  const { adminAccess, capabilities, loading, isSuperAdmin } = useAuth();
  const allowedSurfaces = new Set(adminAccess.allowedSurfaces);
  const canAccessRefunds =
    isSuperAdmin ||
    allowedSurfaces.has('*') ||
    allowedSurfaces.has('refunds') ||
    capabilities.includes('refunds.manage');

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (canAccessRefunds) {
    return <Outlet />;
  }

  return (
    <PortalLayout>
      <section className="section-padding">
        <div className="container-page">
          <div className="mx-auto max-w-2xl card-elevated p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <ShieldAlert className="h-7 w-7 text-primary" />
            </div>
            <h1 className="mt-6 font-display text-3xl font-bold text-foreground">
              Refund Workflow Access Required
            </h1>
            <p className="mt-3 text-muted-foreground">
              This workflow is available to assigned machine managers and scoped operations admins.
            </p>
            <div className="mt-8 flex items-center justify-center gap-3">
              <Button asChild variant="outline" className="min-h-11">
                <Link to="/portal">Back to Portal</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}
