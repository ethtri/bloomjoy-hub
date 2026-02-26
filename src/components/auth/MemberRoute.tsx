import { Link, Outlet } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { Button } from '@/components/ui/button';

export function MemberRoute() {
  const { loading, isMember, isAdmin } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (isMember || isAdmin) {
    return <Outlet />;
  }

  return (
    <PortalLayout>
      <section className="section-padding">
        <div className="container-page">
          <div className="mx-auto max-w-2xl card-elevated p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Lock className="h-7 w-7 text-primary" />
            </div>
            <h1 className="mt-6 font-display text-3xl font-bold text-foreground">
              Bloomjoy Plus Required
            </h1>
            <p className="mt-3 text-muted-foreground">
              This area is part of Plus membership. Baseline access still includes order history
              and account basics.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild>
                <Link to="/plus">View Plus Membership</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/portal/orders">Go to Order History</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}
