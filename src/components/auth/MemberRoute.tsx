import { Link, Outlet, useLocation } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { PortalPageIntro } from '@/components/portal/PortalPageIntro';
import {
  canAccessPortalLevel,
  getAccessLevelLabel,
  getPortalDestinationByPath,
} from '@/components/portal/portalNavigation';
import { Button } from '@/components/ui/button';
import { usePortalTechnicianManagement } from '@/hooks/usePortalTechnicianManagement';

export function MemberRoute() {
  const {
    adminAccess,
    canManageTechnicians,
    capabilities,
    hasReportingAccess,
    loading,
    portalAccessTier,
  } = useAuth();
  const location = useLocation();
  const lockedDestination = getPortalDestinationByPath(location.pathname);
  const accessLabel = getAccessLevelLabel(lockedDestination.access);
  const isReportingRoute = lockedDestination.access === 'reporting';
  const isTeamRoute = lockedDestination.access === 'team';
  const { canUsePortalTeam, isResolvingPortalTeam } = usePortalTechnicianManagement();
  const canUseAdminAccess =
    adminAccess.canAccessAdmin ||
    adminAccess.allowedSurfaces.includes('*') ||
    adminAccess.allowedSurfaces.includes('access');

  if (loading || (isTeamRoute && isResolvingPortalTeam)) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  const canAccessRoute = isTeamRoute
    ? canUsePortalTeam
    : canAccessPortalLevel(
      portalAccessTier,
      lockedDestination.access,
      hasReportingAccess,
      capabilities,
      false,
      canManageTechnicians,
      adminAccess.isScopedAdmin
    );

  if (canAccessRoute) {
    return <Outlet />;
  }

  return (
    <PortalLayout>
      <section className="portal-section">
        <div className="container-page">
          <div className="mx-auto max-w-3xl">
            <PortalPageIntro
              title={`${lockedDestination.label} requires ${accessLabel} access`}
              description={
                lockedDestination.upsellCopy ??
                'This area is not included with the current portal access level.'
              }
              badges={[
                { label: `Locked for ${portalAccessTier} access`, tone: 'accent', icon: Lock },
                { label: `${accessLabel} access required`, tone: 'muted' },
              ]}
            >
              <div className="rounded-[24px] border border-primary/15 bg-background p-6 shadow-[var(--shadow-sm)]">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <lockedDestination.icon className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-semibold text-foreground">
                      This workflow is outside your current access
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {isReportingRoute
                        ? 'Sales reporting access is granted by account, location, or specific machine. Ask Bloomjoy to add reporting permissions for the machines you should be able to view.'
                        : isTeamRoute
                          ? 'Team management is reserved for Plus account owners and eligible Corporate Partner managers. Technicians can use training and assigned reporting without access to customer team controls.'
                        : 'Technicians without assigned machines can use the training hub. Customer account tools, onboarding, support, and billing stay reserved for account owners and eligible partners.'}
                    </p>
                  </div>
                </div>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  {isTeamRoute && canUseAdminAccess && (
                    <Button asChild className="min-h-11">
                      <Link to="/admin/access?action=add-access&preset=technician">
                        Open Admin Access
                      </Link>
                    </Button>
                  )}
                  {lockedDestination.access !== 'baseline' && !isReportingRoute && !isTeamRoute && (
                    <Button asChild className="min-h-11">
                      <Link to="/plus">View Plus Membership</Link>
                    </Button>
                  )}
                  <Button asChild variant="outline" className="min-h-11">
                    <Link to="/portal">Back to Dashboard</Link>
                  </Button>
                </div>
              </div>
            </PortalPageIntro>
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}
