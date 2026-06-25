import { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown, Handshake } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { NavLink } from '@/components/NavLink';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useAuth } from '@/contexts/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  canAccessPortalLevel,
  getAccessLevelLabelKey,
  getPortalDestinationByPath,
  portalDestinations,
} from '@/components/portal/portalNavigation';

interface PortalLayoutProps {
  children: ReactNode;
}

export function PortalLayout({ children }: PortalLayoutProps) {
  const {
    adminAccess,
    canManageTechnicians,
    capabilities,
    hasReportingAccess,
    isCorporatePartner,
    isSuperAdmin,
    portalAccessTier,
  } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const currentDestination = getPortalDestinationByPath(location.pathname);
  const allowedAdminSurfaces = new Set(adminAccess.allowedSurfaces);
  const hasRefundOperationsAccess =
    isSuperAdmin || allowedAdminSurfaces.has('*') || allowedAdminSurfaces.has('refunds');
  const sortedDestinations = [...portalDestinations].sort(
    (left, right) => left.mobileOrder - right.mobileOrder
  );
  const canAccessDestination = (access: (typeof portalDestinations)[number]['access']) =>
    canAccessPortalLevel(
      portalAccessTier,
      access,
      hasReportingAccess,
      capabilities,
      hasRefundOperationsAccess,
      canManageTechnicians,
      adminAccess.isScopedAdmin
    );
  const visibleDestinations = sortedDestinations
    .filter((destination) => destination.access !== 'reporting' || canAccessDestination(destination.access))
    .filter((destination) => destination.access !== 'refunds' || canAccessDestination(destination.access))
    .filter((destination) => destination.access !== 'team' || canAccessDestination(destination.access))
    .filter((destination) =>
      portalAccessTier === 'training'
        ? canAccessDestination(destination.access)
        : true
    );
  const accessStatusLabel =
    isCorporatePartner
      ? 'Corporate Partner'
      : portalAccessTier === 'plus'
      ? t('portal.plusActive')
      : portalAccessTier === 'training'
        ? t('portal.trainingAccess')
        : t('portal.baselineAccess');
  const AccessStatusIcon = isCorporatePartner ? Handshake : currentDestination.icon;
  const getDestinationLabel = (destination: (typeof portalDestinations)[number]) =>
    isCorporatePartner && destination.href === '/portal/account'
      ? 'Account Settings'
      : t(destination.labelKey);

  return (
    <AppLayout>
      <div className="border-b border-border bg-gradient-to-b from-background via-background to-muted/30">
        <div className="container-page py-3 sm:py-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {t('portal.memberPortal')}
                </p>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  {t('portal.description')}
                </p>
                {isCorporatePartner && (
                  <div className="mt-3 flex md:hidden">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                      <Handshake className="h-3.5 w-3.5" aria-hidden="true" />
                      Corporate Partner portal
                    </span>
                  </div>
                )}
              </div>
              <div className="hidden md:flex">
                <span
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium',
                    isCorporatePartner
                      ? 'border-primary/20 bg-primary/10 text-primary'
                      : portalAccessTier === 'plus'
                      ? 'border-sage/20 bg-sage-light text-sage'
                      : portalAccessTier === 'training'
                        ? 'border-amber/30 bg-amber/10 text-amber'
                        : 'border-primary/20 bg-primary/10 text-primary'
                  )}
                >
                  <AccessStatusIcon className="h-4 w-4" />
                  {accessStatusLabel}
                </span>
              </div>
              <div className="md:hidden">
                <Sheet>
                  <SheetTrigger asChild>
                    <button className="flex w-full items-center justify-between rounded-2xl border border-border bg-background px-4 py-3 text-left shadow-[var(--shadow-sm)]">
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                          <currentDestination.icon className="h-5 w-5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            {t('portal.currentSection')}
                          </span>
                          <span className="block truncate font-semibold text-foreground">
                            {getDestinationLabel(currentDestination)}
                          </span>
                        </span>
                      </span>
                      <span className="ml-3 flex items-center gap-2">
                        {!canAccessDestination(currentDestination.access) && (
                          <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
                            {t(getAccessLevelLabelKey(currentDestination.access))}
                          </span>
                        )}
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      </span>
                    </button>
                  </SheetTrigger>
                  <SheetContent
                    side="bottom"
                    className="max-h-[85vh] overflow-y-auto rounded-t-[28px] border-border bg-background px-5 pb-8 pt-6"
                  >
                    <SheetHeader className="text-left">
                      <SheetTitle>{t('portal.navigation')}</SheetTitle>
                      <SheetDescription>
                        {t('portal.navigationDescription')}
                      </SheetDescription>
                    </SheetHeader>
                    <div className="mt-6 space-y-2">
                      {visibleDestinations.map((destination) => {
                        const locked = !canAccessDestination(destination.access);

                        return (
                          <SheetClose asChild key={destination.href}>
                            <NavLink
                              to={destination.href}
                              end={destination.end}
                              className={cn(
                                'flex w-full items-start gap-3 rounded-2xl border px-4 py-4 transition-colors',
                                locked
                                  ? 'border-primary/15 bg-primary/5'
                                  : 'border-border bg-background hover:bg-muted/40'
                              )}
                              activeClassName="border-primary/20 bg-primary/10"
                            >
                              <span
                                className={cn(
                                  'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                                  locked
                                    ? 'bg-primary/10 text-primary'
                                    : 'bg-muted text-muted-foreground'
                                )}
                              >
                                <destination.icon className="h-5 w-5" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-foreground">
                                    {getDestinationLabel(destination)}
                                  </span>
                                  {locked && (
                                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
                                      {t(getAccessLevelLabelKey(destination.access))}
                                    </span>
                                  )}
                                </span>
                                <span className="mt-1 block text-sm text-muted-foreground">
                                  {locked
                                    ? t(destination.upsellCopyKey ?? destination.descriptionKey)
                                    : t(destination.descriptionKey)}
                                </span>
                              </span>
                            </NavLink>
                          </SheetClose>
                        );
                      })}
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </div>

            <nav className="hidden flex-wrap gap-2 md:flex">
              {visibleDestinations.map((destination) => {
                const locked = !canAccessDestination(destination.access);

                return (
                  <NavLink
                    key={destination.href}
                    to={destination.href}
                    end={destination.end}
                    className={cn(
                      'rounded-full border border-transparent bg-background px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                      locked && 'border-primary/10 bg-primary/5 text-foreground'
                    )}
                    activeClassName="border-primary/20 bg-primary/10 text-primary"
                  >
                    <span className="flex items-center gap-2">
                      <destination.icon className="h-4 w-4" />
                      <span>{getDestinationLabel(destination)}</span>
                      {locked && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                          {t(getAccessLevelLabelKey(destination.access))}
                        </span>
                      )}
                    </span>
                  </NavLink>
                );
              })}
            </nav>
          </div>
        </div>
      </div>
      <div className="portal-shell">{children}</div>
    </AppLayout>
  );
}
