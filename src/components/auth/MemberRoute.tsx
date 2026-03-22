import { Link, Outlet, useLocation } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { PortalPageIntro } from '@/components/portal/PortalPageIntro';
import { getPortalDestinationByPath } from '@/components/portal/portalNavigation';
import { Button } from '@/components/ui/button';

export function MemberRoute() {
  const { loading, isMember, isAdmin } = useAuth();
  const location = useLocation();
  const lockedDestination = getPortalDestinationByPath(location.pathname);

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
      <section className="portal-section">
        <div className="container-page">
          <div className="mx-auto max-w-3xl">
            <PortalPageIntro
              title={`${lockedDestination.label} requires Bloomjoy Plus`}
              description={
                lockedDestination.upsellCopy ??
                'This area is part of Bloomjoy Plus. Baseline access still includes dashboard, orders, and account basics.'
              }
              badges={[
                { label: 'Locked for baseline access', tone: 'accent', icon: Lock },
                { label: 'Orders and account stay available', tone: 'muted' },
              ]}
            >
              <div className="rounded-[24px] border border-primary/15 bg-background p-6 shadow-[var(--shadow-sm)]">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <lockedDestination.icon className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-semibold text-foreground">
                      Upgrade to unlock this workflow
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Plus adds guided onboarding, the full training hub, and concierge support
                      lanes without changing your existing baseline access.
                    </p>
                  </div>
                </div>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <Button asChild>
                    <Link to="/plus">View Plus Membership</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/portal/orders">Go to Order History</Link>
                  </Button>
                </div>
              </div>
            </PortalPageIntro>

            <div className="mt-6 rounded-[24px] border border-border bg-background p-6 shadow-[var(--shadow-sm)]">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Still available with baseline access
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <Button asChild>
                  <Link to="/portal">Return to Dashboard</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/portal/account">Open Account Settings</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}
