import type { ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Building2,
  ExternalLink,
  Handshake,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  MonitorCog,
  Settings,
  Shield,
  ShoppingBag,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';
import logo from '@/assets/logo.png';
import { LanguagePreferenceControl } from '@/components/i18n/LanguagePreferenceControl';
import { portalDestinations, getPortalDestinationByPath } from '@/components/portal/portalNavigation';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { hasAdminSurface } from '@/lib/adminAccess';
import { getCanonicalUrlForSurface } from '@/lib/appSurface';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface AppLayoutProps {
  children: ReactNode;
}

type AppContext = {
  title: string;
  description: string;
};

type AdminDestination = {
  href: string;
  label: string;
  labelKey: TranslationKey;
  shortLabel: string;
  shortLabelKey: TranslationKey;
  description: string;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
  surface: string;
  requiresSuperAdmin?: boolean;
};

const adminDestinations: AdminDestination[] = [
  {
    href: '/admin',
    label: 'Admin Home',
    labelKey: 'admin.home',
    shortLabel: 'Admin Home',
    shortLabelKey: 'admin.home',
    description: 'Operations modules, queue visibility, and internal governance tools.',
    descriptionKey: 'admin.homeDescription',
    icon: LayoutDashboard,
    surface: 'admin',
  },
  {
    href: '/admin/orders',
    label: 'Orders',
    labelKey: 'admin.orders',
    shortLabel: 'Orders',
    shortLabelKey: 'admin.orders',
    description: 'Fulfillment updates, tracking links, and order operations.',
    descriptionKey: 'admin.ordersDescription',
    icon: ShoppingBag,
    surface: 'orders',
    requiresSuperAdmin: true,
  },
  {
    href: '/admin/support',
    label: 'Support',
    labelKey: 'admin.support',
    shortLabel: 'Support',
    shortLabelKey: 'admin.support',
    description: 'Support triage, concierge intake, and request routing.',
    descriptionKey: 'admin.supportDescription',
    icon: LifeBuoy,
    surface: 'support',
    requiresSuperAdmin: true,
  },
  {
    href: '/admin/access',
    label: 'Access',
    labelKey: 'admin.access',
    shortLabel: 'Access',
    shortLabelKey: 'admin.access',
    description: 'People, Technician grants, roles, reporting access, and audit history.',
    descriptionKey: 'admin.accessDescription',
    icon: Users,
    surface: 'access',
  },
  {
    href: '/admin/partner-records',
    label: 'Partner records',
    labelKey: 'admin.partnerRecords',
    shortLabel: 'Partner Records',
    shortLabelKey: 'admin.partnerRecordsShort',
    description: 'Reusable external organizations and reporting contacts.',
    descriptionKey: 'admin.partnerRecordsDescription',
    icon: Building2,
    surface: 'partner_records',
    requiresSuperAdmin: true,
  },
  {
    href: '/admin/machines',
    label: 'Machines',
    labelKey: 'admin.machines',
    shortLabel: 'Machines',
    shortLabelKey: 'admin.machines',
    description: 'Machine aliases, external machine IDs, assignment readiness, and tax rates.',
    descriptionKey: 'admin.machinesDescription',
    icon: MonitorCog,
    surface: 'machines',
  },
  {
    href: '/admin/partnerships',
    label: 'Partnerships',
    labelKey: 'admin.partnerships',
    shortLabel: 'Partnerships',
    shortLabelKey: 'admin.partnerships',
    description: 'Guided agreement setup, participants, assigned machines, split terms, and preview.',
    descriptionKey: 'admin.partnershipsDescription',
    icon: Handshake,
    surface: 'partnerships',
  },
  {
    href: '/admin/reporting',
    label: 'Reporting',
    labelKey: 'admin.reporting',
    shortLabel: 'Reporting',
    shortLabelKey: 'admin.reporting',
    description: 'Report schedules, exports, and sync status.',
    descriptionKey: 'admin.reportingDescription',
    icon: BarChart3,
    surface: 'reporting',
    requiresSuperAdmin: true,
  },
];

const getAdminContext = (
  pathname: string,
  t: (key: TranslationKey) => string
): AppContext => {
  const matched =
    adminDestinations.find((destination) => pathname === destination.href) ??
    adminDestinations
      .filter((destination) => destination.href !== '/admin')
      .find((destination) => pathname.startsWith(`${destination.href}/`)) ??
    adminDestinations[0];

  return {
    title: t(matched.labelKey),
    description: t(matched.descriptionKey),
  };
};

const getAppContext = (
  pathname: string,
  t: (key: TranslationKey) => string
): AppContext => {
  if (pathname.startsWith('/portal')) {
    const currentDestination = getPortalDestinationByPath(pathname);
    return {
      title: t(currentDestination.labelKey),
      description: t(currentDestination.descriptionKey),
    };
  }

  if (pathname.startsWith('/admin')) {
    return getAdminContext(pathname, t);
  }

  if (pathname === '/reset-password') {
    return {
      title: t('app.resetPassword'),
      description: t('app.resetPasswordDescription'),
    };
  }

  return {
    title: t('app.operatorLogin'),
    description: t('app.operatorLoginDescription'),
  };
};

const workspaceLinks = [
  {
    href: '/portal',
    label: 'Portal',
    labelKey: 'app.portal' as const,
    match: (pathname: string) => pathname.startsWith('/portal'),
  },
  {
    href: '/admin',
    label: 'Admin',
    labelKey: 'app.admin' as const,
    match: (pathname: string) => pathname.startsWith('/admin'),
    requiresAdmin: true,
  },
];

const isActiveAdminDestination = (pathname: string, destination: AdminDestination) =>
  destination.href === '/admin'
    ? pathname === '/admin'
    : pathname === destination.href || pathname.startsWith(`${destination.href}/`);

export function AppLayout({ children }: AppLayoutProps) {
  const { adminAccess, isAdmin, isAuthenticated, isSuperAdmin, portalAccessTier, signOut, user } =
    useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const appContext = getAppContext(location.pathname, t);
  const currentLocation = typeof window === 'undefined' ? undefined : window.location;
  const marketingHomeUrl = getCanonicalUrlForSurface('marketing', '/', '', '', currentLocation);
  const accountUrl = '/portal/account';
  const showAccountLink = portalAccessTier !== 'training';
  const homeUrl = isAuthenticated ? '/portal' : '/login';
  const isAdminPath = location.pathname.startsWith('/admin');
  const visibleAdminDestinations = adminDestinations.filter(
    (item) =>
      isSuperAdmin ||
      (!item.requiresSuperAdmin && hasAdminSurface(adminAccess.allowedSurfaces, item.surface))
  );

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const renderWorkspaceLinks = (mobile = false) =>
    workspaceLinks
      .filter((item) => !item.requiresAdmin || isAdmin)
      .map((item) => {
        if (mobile) {
          const isActive = item.match(location.pathname);

          return (
            <SheetClose asChild key={item.href}>
              <Link
                to={item.href}
                className={cn(
                  'flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-primary/20 bg-primary/10 text-primary'
                    : 'border-border bg-background text-foreground hover:bg-muted/40'
                )}
              >
                <span>{t(item.labelKey)}</span>
                {item.requiresAdmin && <Shield className="h-4 w-4" />}
              </Link>
            </SheetClose>
          );
        }

        return (
          <NavLink
            key={item.href}
            to={item.href}
            className={({ isActive }) =>
              cn(
                'rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                isActive || item.match(location.pathname)
                  ? 'border-primary/20 bg-primary/10 text-primary'
                  : 'border-transparent bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
              )
            }
          >
            {t(item.labelKey)}
          </NavLink>
        );
      });

  const renderMobileAdminLinks = () => (
    <div className="rounded-2xl border border-border bg-muted/20 p-3">
      <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {t('app.adminTools')}
      </div>
      <div className="grid gap-2">
        {visibleAdminDestinations.map((item) => {
          const isActive = isActiveAdminDestination(location.pathname, item);
          const Icon = item.icon;

          return (
            <SheetClose asChild key={item.href}>
              <Link
                to={item.href}
                className={cn(
                  'flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-primary/20 bg-primary/10 text-primary'
                    : 'border-border bg-background text-foreground hover:bg-muted/40'
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t(item.shortLabelKey)}</span>
                </span>
                {isActive && <span className="shrink-0 text-xs text-primary">{t('app.current')}</span>}
              </Link>
            </SheetClose>
          );
        })}
      </div>
    </div>
  );

  const renderAdminSubnav = () => {
    if (!isAuthenticated || !isAdmin || !isAdminPath || visibleAdminDestinations.length === 0) {
      return null;
    }

    return (
      <div className="hidden border-t border-border/60 md:block">
        <div className="container-page">
          <nav
            aria-label={t('app.adminTools')}
            className="flex items-center gap-2 overflow-x-auto py-2.5"
          >
            <span className="shrink-0 pr-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t('app.adminTools')}
            </span>
            {visibleAdminDestinations.map((item) => {
              const isActive = isActiveAdminDestination(location.pathname, item);
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  to={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  title={t(item.descriptionKey)}
                  className={cn(
                    'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-primary/20 bg-primary/10 text-primary'
                      : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t(item.shortLabelKey)}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/20">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="container-page py-2.5 sm:py-4">
          <div className="flex items-center justify-between gap-4">
            <Link to={homeUrl} className="flex min-w-0 items-center gap-2.5 sm:gap-3">
              <img
                src={logo}
                alt="Bloomjoy Sweets"
                width={44}
                height={44}
                decoding="async"
                className="h-10 w-10 shrink-0 sm:h-11 sm:w-11"
              />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
                  {t('app.operatorApp')}
                </p>
                <p className="truncate font-display text-base font-semibold text-foreground sm:text-lg">
                  {appContext.title}
                </p>
                <p className="hidden truncate text-sm text-muted-foreground sm:block">
                  {user?.email || appContext.description}
                </p>
              </div>
            </Link>

            <div className="hidden items-center gap-3 md:flex">
              {isAuthenticated && <nav className="flex items-center gap-2">{renderWorkspaceLinks()}</nav>}

              <a
                href={marketingHomeUrl}
                className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('app.mainSite')}
                <ExternalLink className="h-4 w-4" />
              </a>

              {isAuthenticated ? (
                <>
                  {showAccountLink && (
                    <Link to={accountUrl}>
                      <Button variant="outline" size="sm">
                        <Settings className="mr-2 h-4 w-4" />
                        {t('app.account')}
                      </Button>
                    </Link>
                  )}
                  <Button variant="outline" size="sm" onClick={handleSignOut}>
                    <LogOut className="mr-2 h-4 w-4" />
                    {t('app.signOut')}
                  </Button>
                </>
              ) : (
                <a href={marketingHomeUrl}>
                  <Button variant="outline" size="sm">
                    {t('app.viewMainSite')}
                  </Button>
                </a>
              )}
            </div>

            <div className="md:hidden">
              <Sheet>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={t('app.openNavigation')}
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                </SheetTrigger>
                <SheetContent
                  side="right"
                  className="w-[min(92vw,360px)] border-border bg-background px-5 py-6"
                >
                  <SheetHeader className="text-left">
                    <SheetTitle>{t('app.operatorAppTitle')}</SheetTitle>
                    <SheetDescription>{appContext.description}</SheetDescription>
                  </SheetHeader>
                  <div className="mt-6 space-y-3">
                    <LanguagePreferenceControl fullWidth />
                    {isAuthenticated && renderWorkspaceLinks(true)}
                    {isAuthenticated && isAdmin && isAdminPath && renderMobileAdminLinks()}
                    {isAuthenticated && showAccountLink && (
                      <SheetClose asChild>
                        <Link
                          to={accountUrl}
                          className="flex items-center justify-between rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
                        >
                          <span>{t('app.account')}</span>
                          <User className="h-4 w-4" />
                        </Link>
                      </SheetClose>
                    )}
                    <a
                      href={marketingHomeUrl}
                      className="flex items-center justify-between rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
                    >
                      <span>{t('app.mainSite')}</span>
                      <ExternalLink className="h-4 w-4" />
                    </a>
                    {isAuthenticated ? (
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="flex w-full items-center justify-between rounded-2xl border border-border bg-background px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
                      >
                        <span>{t('app.signOut')}</span>
                        <LogOut className="h-4 w-4" />
                      </button>
                    ) : (
                      <SheetClose asChild>
                        <Link
                          to="/login"
                          className="flex items-center justify-between rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
                        >
                          <span>{t('app.operatorLogin')}</span>
                          <KeyRound className="h-4 w-4" />
                        </Link>
                      </SheetClose>
                    )}
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
        {renderAdminSubnav()}
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
