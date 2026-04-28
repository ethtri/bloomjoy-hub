import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { useAuth } from '@/contexts/AuthContext';
import { getAdminSurfaceForPath, hasAdminSurface } from '@/lib/adminAccess';

export function AdminRoute() {
  const { adminAccess, loading, isAdmin, isSuperAdmin } = useAuth();
  const location = useLocation();
  const currentSurface = getAdminSurfaceForPath(location.pathname);

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

  if (!isAdmin) {
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
              </p>
              <div className="mt-8 flex items-center justify-center gap-3">
                <Button asChild variant="outline">
                  <Link to="/portal">Back to Portal</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </PortalLayout>
    );
  }

  if (hasAdminSurface(adminAccess.allowedSurfaces, currentSurface)) {
    return <Outlet />;
  }

  if (location.pathname === '/admin' && hasAdminSurface(adminAccess.allowedSurfaces, 'machines')) {
    return <Navigate to="/admin/machines" replace />;
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
              {' Your current admin grant does not include this surface.'}
            </p>
            <div className="mt-8 flex items-center justify-center gap-3">
              <Button asChild variant="outline">
                <Link to="/portal">Back to Portal</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}
