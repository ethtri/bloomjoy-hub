import { Link, Outlet, useLocation } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { PortalPageIntro } from '@/components/portal/PortalPageIntro';
import {
  canAccessPortalLevel,
  getPortalDestinationByPath,
} from '@/components/portal/portalNavigation';
import { Button } from '@/components/ui/button';
import { usePortalTimekeepingAccess } from '@/hooks/usePortalTimekeepingAccess';
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
  const isReportingRoute = lockedDestination.access === 'reporting';
  const isTeamRoute = lockedDestination.access === 'team';
  const isTimekeepingRoute = lockedDestination.access === 'timekeeping';
  const { canUsePortalTeam, isResolvingPortalTeam } = usePortalTechnicianManagement();
  const { canUsePortalTimekeeping, isResolvingPortalTimekeeping } = usePortalTimekeepingAccess();
  const canUseAdminAccess =
    adminAccess.canAccessAdmin ||
    adminAccess.allowedSurfaces.includes('*') ||
    adminAccess.allowedSurfaces.includes('access');

  if (
    loading ||
    (isTeamRoute && isResolvingPortalTeam) ||
    (isTimekeepingRoute && isResolvingPortalTimekeeping)
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  const canAccessRoute = isTeamRoute
    ? canUsePortalTeam
    : isTimekeepingRoute
      ? canUsePortalTimekeeping
      : canAccessPortalLevel(
        portalAccessTier,
        lockedDestination.access,
        hasReportingAccess,
        capabilities,
        false,
        canManageTechnicians,
        adminAccess.isScopedAdmin,
        canUsePortalTimekeeping
      );

  if (canAccessRoute) {
    return <Outlet />;
  }

  const lockedTitle = isTimekeepingRoute
    ? 'Timekeeping setup required'
    : isReportingRoute
      ? 'Reporting is not included with this account'
      : isTeamRoute
        ? 'Team management is not included with this account'
        : `${lockedDestination.label} is not included with this account`;
  const lockedDescription = isTimekeepingRoute
    ? 'Ask Bloomjoy to create an active operator payout profile before using Time.'
    : lockedDestination.upsellCopy ?? 'This area is not available for the signed-in account.';
  const workflowDescription = isReportingRoute
    ? 'Sales reporting is granted by account, location, or specific machine. Ask Bloomjoy to add the machines or locations this account should be able to review.'
    : isTeamRoute
      ? 'Team management is for account owners and partner managers who add Technicians or manage assigned-machine reporting access.'
      : isTimekeepingRoute
        ? 'Time opens after an operator profile is active. Assigned machines and payout-period details appear there once setup is complete.'
        : lockedDestination.access === 'refunds'
          ? 'Refund cases appear only for assigned refund reviewers and operations admins.'
          : 'The dashboard only shows workflows that are available for this account right now.';
  const showPlusLink = ['plus', 'support', 'training'].includes(lockedDestination.access);

  return (
    <PortalLayout>
      <section className="portal-section">
        <div className="container-page">
          <div className="mx-auto max-w-3xl">
            <PortalPageIntro
              title={lockedTitle}
              description={lockedDescription}
              badges={[
                { label: 'Not included with this account', tone: 'accent', icon: Lock },
                { label: isTimekeepingRoute ? 'Operator profile needed' : 'Ask Bloomjoy for access', tone: 'muted' },
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
                      {workflowDescription}
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
                  {showPlusLink && (
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
