import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ExternalLink,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  User,
} from 'lucide-react';
import logo from '@/assets/logo.png';
import { LanguagePreferenceControl } from '@/components/i18n/LanguagePreferenceControl';
import {
  buildAuthenticatedNavSections,
  getAppContext,
  isAuthenticatedNavItemActive,
  type AuthenticatedNavItem,
} from '@/components/layout/authenticatedNavigation';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePortalTimekeepingAccess } from '@/hooks/usePortalTimekeepingAccess';
import { usePortalTechnicianManagement } from '@/hooks/usePortalTechnicianManagement';
import { getCanonicalUrlForSurface } from '@/lib/appSurface';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface AppLayoutProps {
  children: ReactNode;
}

type UtilityLinksProps = {
  marketingHomeUrl: string;
  onSignOut: () => void;
  showPortalSwitch: boolean;
  profileMenu: ReactNode;
};

export function AppLayout({ children }: AppLayoutProps) {
  const {
    adminAccess,
    canManageTechnicians,
    capabilities,
    hasReportingAccess,
    isAuthenticated,
    isCorporatePartner,
    isSuperAdmin,
    portalAccessTier,
    signOut,
    user,
  } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const appContext = getAppContext(location.pathname);
  const isAdminSurface = location.pathname.startsWith('/admin');
  const currentLocation = typeof window === 'undefined' ? undefined : window.location;
  const marketingHomeUrl = getCanonicalUrlForSurface('marketing', '/', '', '', currentLocation);
  const accountUrl = '/portal/account';
  const showAccountLink = portalAccessTier !== 'training' || adminAccess.isScopedAdmin;
  const accountLinkLabel = isCorporatePartner ? 'Account Settings' : t('app.account');
  const signedInEmail = user?.email ?? '';
  const profileMenuLabel = signedInEmail ? signedInEmail.split('@')[0] : t('app.profileMenu');
  const { canUsePortalTeam } = usePortalTechnicianManagement();
  const { canUsePortalTimekeeping } = usePortalTimekeepingAccess();
  const navSections = isAuthenticated
    ? buildAuthenticatedNavSections({
        adminAccess,
        canManageTechnicians,
        capabilities,
        hasReportingAccess,
        isSuperAdmin,
        portalAccessTier,
        canUsePortalTeam,
        canUsePortalTimekeeping,
        currentPathname: location.pathname,
        showAccountLink,
      })
    : [];

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const renderProfileMenu = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="min-h-9 max-w-full justify-between gap-2 rounded-lg"
          aria-label={t('app.openProfileMenu')}
        >
          <span className="flex min-w-0 items-center gap-2">
            <User className="h-4 w-4 shrink-0" />
            <span className="truncate">{profileMenuLabel}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="space-y-1">
          <span className="block text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {t('app.signedInAs')}
          </span>
          <span className="block truncate text-sm font-semibold text-foreground">
            {signedInEmail || profileMenuLabel}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {showAccountLink && (
          <>
            <DropdownMenuItem asChild>
              <Link to={accountUrl} className="cursor-pointer gap-2">
                <Settings className="h-4 w-4" />
                {accountLinkLabel}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          className="cursor-pointer gap-2"
          onSelect={(event) => {
            event.preventDefault();
            void handleSignOut();
          }}
        >
          <LogOut className="h-4 w-4" />
          {t('app.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const utilities = {
    marketingHomeUrl,
    onSignOut: () => void handleSignOut(),
    showPortalSwitch: isAdminSurface,
    profileMenu: renderProfileMenu(),
  };

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/20">
        <header className="sticky top-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <div className="container-page py-2.5 sm:py-4">
            <div className="flex items-center justify-between gap-4">
              <Link to="/login" className="flex min-h-11 min-w-0 items-center gap-2.5 sm:gap-3">
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
                    {t(appContext.titleKey)}
                  </p>
                  <span className="hidden truncate text-sm text-muted-foreground sm:block">
                    {t(appContext.descriptionKey)}
                  </span>
                </div>
              </Link>

              <div className="hidden items-center gap-3 md:flex">
                <LanguagePreferenceControl compact />
                <a
                  href={marketingHomeUrl}
                  className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                >
                  {t('app.mainSite')}
                  <ExternalLink className="h-4 w-4" />
                </a>
                <a href={marketingHomeUrl}>
                  <Button variant="outline" size="sm">
                    {t('app.viewMainSite')}
                  </Button>
                </a>
              </div>

              <div className="flex items-center gap-2 md:hidden">
                <LanguagePreferenceControl className="shrink-0" compact />
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
                  <SheetContent side="right" className="w-[min(92vw,360px)] border-border bg-background px-5 py-6">
                    <SheetHeader className="text-left">
                      <SheetTitle>{t('app.operatorAppTitle')}</SheetTitle>
                      <SheetDescription>{t(appContext.descriptionKey)}</SheetDescription>
                    </SheetHeader>
                    <div className="mt-6 space-y-3">
                      <LanguagePreferenceControl fullWidth />
                      <a
                        href={marketingHomeUrl}
                        className="flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
                      >
                        <span>{t('app.mainSite')}</span>
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <SheetClose asChild>
                        <Link
                          to="/login"
                          className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
                        >
                          <span>{t('app.operatorLogin')}</span>
                          <KeyRound className="h-4 w-4" />
                        </Link>
                      </SheetClose>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-border/70 bg-sidebar/80 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <AuthenticatedSidebar
          appTitle={t('app.operatorAppTitle')}
          currentPathname={location.pathname}
          navSections={navSections}
          utilities={utilities}
        />
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col bg-gradient-to-b from-background via-background to-muted/20">
        <header className="sticky top-0 z-40 border-b border-border/70 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 lg:static lg:bg-background/80">
          <div className="flex min-h-[4.25rem] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
                {t('app.operatorApp')}
              </p>
              <p className="truncate font-display text-lg font-semibold text-foreground sm:text-xl">
                {t(appContext.titleKey)}
              </p>
              <p className="hidden max-w-3xl truncate text-sm text-muted-foreground md:block">
                {t(appContext.descriptionKey)}
              </p>
            </div>

            <div className="flex items-center gap-2 lg:hidden">
              <Sheet>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground shadow-[var(--shadow-sm)] transition-colors hover:text-foreground"
                    aria-label={t('app.openNavigation')}
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                </SheetTrigger>
                <SheetContent
                  side="right"
                  className="flex w-[min(94vw,390px)] flex-col border-border bg-background px-0 py-0"
                  onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    window.setTimeout(() => {
                      document.querySelector<HTMLElement>('[data-auth-mobile-nav-first="true"]')?.focus();
                    }, 0);
                  }}
                >
                  <SheetHeader className="border-b border-border/70 px-5 py-5 text-left">
                    <SheetTitle>{t('app.operatorAppTitle')}</SheetTitle>
                    <SheetDescription className="truncate">{signedInEmail}</SheetDescription>
                  </SheetHeader>
                  <AuthenticatedSidebar
                    appTitle={t('app.operatorAppTitle')}
                    currentPathname={location.pathname}
                    mobile
                    navSections={navSections}
                    utilities={utilities}
                  />
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

type AuthenticatedSidebarProps = {
  appTitle: string;
  currentPathname: string;
  mobile?: boolean;
  navSections: Array<{
    id: string;
    labelKey: TranslationKey;
    items: AuthenticatedNavItem[];
  }>;
  utilities: UtilityLinksProps;
};

function AuthenticatedSidebar({
  appTitle,
  currentPathname,
  mobile = false,
  navSections,
  utilities,
}: AuthenticatedSidebarProps) {
  const { t } = useLanguage();
  const shell = (
    <div className={cn('flex min-h-0 flex-1 flex-col', mobile ? 'h-full overflow-y-auto' : 'h-screen')}>
      {!mobile && (
        <div className="border-b border-sidebar-border px-4 py-3">
          <Link to="/portal" className="flex min-w-0 items-center gap-3">
            <img
              src={logo}
              alt="Bloomjoy Sweets"
              width={44}
              height={44}
              decoding="async"
              className="h-10 w-10 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {t('app.operatorApp')}
              </p>
              <p className="truncate font-display text-base font-semibold text-foreground">
                {appTitle}
              </p>
            </div>
          </Link>
        </div>
      )}

      <nav
        aria-label={t('app.authenticatedNavigation')}
        className={cn('px-3 py-4', mobile ? 'flex-none' : 'min-h-0 flex-1 overflow-y-auto lg:py-3')}
      >
        <div className={cn(mobile ? 'space-y-5' : 'space-y-3.5')}>
          {navSections.map((section, sectionIndex) => (
            <div key={section.id}>
              <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t(section.labelKey)}
              </p>
              <div className="mt-2 space-y-1">
                {section.items.map((item, itemIndex) => {
                  const isActive = isAuthenticatedNavItemActive(currentPathname, item);
                  const Icon = item.icon;
                  const itemLink = (
                    <Link
                      to={item.href}
                      aria-current={isActive ? 'page' : undefined}
                      data-auth-mobile-nav-first={
                        mobile && sectionIndex === 0 && itemIndex === 0 ? 'true' : undefined
                      }
                      title={t(item.descriptionKey)}
                      className={cn(
                        'group flex items-center gap-3 rounded-xl border px-3 text-sm font-medium transition-colors',
                        mobile ? 'min-h-11 py-2.5' : 'min-h-10 py-2',
                        isActive
                          ? 'border-primary/20 bg-primary/10 text-primary shadow-[var(--shadow-sm)]'
                          : 'border-transparent text-muted-foreground hover:border-border hover:bg-background hover:text-foreground'
                      )}
                    >
                      <span
                        className={cn(
                          'flex shrink-0 items-center justify-center rounded-lg transition-colors',
                          mobile ? 'h-8 w-8' : 'h-7 w-7',
                          isActive
                            ? 'bg-primary/15 text-primary'
                            : 'bg-muted/70 text-muted-foreground group-hover:text-foreground'
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                    </Link>
                  );

                  return mobile ? (
                    <SheetClose asChild key={item.href}>
                      {itemLink}
                    </SheetClose>
                  ) : (
                    <div key={item.href}>{itemLink}</div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="rounded-xl border border-border bg-background p-2.5 shadow-[var(--shadow-sm)]">
          <div className="grid gap-1.5">
            <LanguagePreferenceControl
              compact={!mobile}
              fullWidth={mobile}
              className={mobile ? undefined : '[&_button]:min-h-8 [&_button]:min-w-9'}
            />
            {mobile ? (
              <MobileUtilityLinks {...utilities} />
            ) : (
              <>
                {utilities.profileMenu}
                {utilities.showPortalSwitch && (
                  <Link
                    to="/portal"
                    className="flex min-h-9 items-center justify-between rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  >
                    <span>{t('app.nav.switchToPortal')}</span>
                    <LayoutDashboard className="h-4 w-4" />
                  </Link>
                )}
                <a
                  href={utilities.marketingHomeUrl}
                  className="flex min-h-9 items-center justify-between rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  <span>{t('app.mainSite')}</span>
                  <ExternalLink className="h-4 w-4" />
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return mobile ? shell : <>{shell}</>;
}

function MobileUtilityLinks({
  marketingHomeUrl,
  onSignOut,
  showPortalSwitch,
}: UtilityLinksProps) {
  const { t } = useLanguage();

  return (
    <>
      {showPortalSwitch && (
        <SheetClose asChild>
          <Link
            to="/portal"
            className="flex min-h-10 items-center justify-between rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <span>{t('app.nav.switchToPortal')}</span>
            <LayoutDashboard className="h-4 w-4" />
          </Link>
        </SheetClose>
      )}
      <a
        href={marketingHomeUrl}
        className="flex min-h-10 items-center justify-between rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <span>{t('app.mainSite')}</span>
        <ExternalLink className="h-4 w-4" />
      </a>
      <button
        type="button"
        onClick={onSignOut}
        className="flex min-h-10 w-full items-center justify-between rounded-xl px-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <span>{t('app.signOut')}</span>
        <LogOut className="h-4 w-4" />
      </button>
    </>
  );
}
