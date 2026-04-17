import type { ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ExternalLink,
  KeyRound,
  LogOut,
  Menu,
  Settings,
  Shield,
  User,
} from 'lucide-react';
import logo from '@/assets/logo.png';
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
import { getCanonicalUrlForSurface } from '@/lib/appSurface';
import { cn } from '@/lib/utils';

interface AppLayoutProps {
  children: ReactNode;
}

type AppContext = {
  title: string;
  description: string;
};

const adminDestinations = [
  {
    href: '/admin',
    label: 'Admin dashboard',
    description: 'Operations modules, queue visibility, and internal governance tools.',
  },
  {
    href: '/admin/orders',
    label: 'Admin orders',
    description: 'Fulfillment updates, tracking links, and order operations.',
  },
  {
    href: '/admin/support',
    label: 'Admin support',
    description: 'Support triage, concierge intake, and request routing.',
  },
  {
    href: '/admin/accounts',
    label: 'Admin accounts',
    description: 'Memberships, machine counts, and account-level review.',
  },
  {
    href: '/admin/audit',
    label: 'Admin audit log',
    description: 'Sensitive action history and role change visibility.',
  },
];

const getAdminContext = (pathname: string): AppContext => {
  const matched =
    adminDestinations.find((destination) =>
      pathname === destination.href || pathname.startsWith(`${destination.href}/`)
    ) ?? adminDestinations[0];

  return {
    title: matched.label,
    description: matched.description,
  };
};

const getAppContext = (pathname: string): AppContext => {
  if (pathname.startsWith('/portal')) {
    const currentDestination = getPortalDestinationByPath(pathname);
    return {
      title: currentDestination.label,
      description: currentDestination.description,
    };
  }

  if (pathname.startsWith('/admin')) {
    return getAdminContext(pathname);
  }

  if (pathname === '/reset-password') {
    return {
      title: 'Reset password',
      description: 'Complete password recovery and return to the operator app.',
    };
  }

  return {
    title: 'Operator login',
    description: 'Sign in to reach orders, account, training, onboarding, and support.',
  };
};

const workspaceLinks = [
  {
    href: '/portal',
    label: 'Portal',
    match: (pathname: string) => pathname.startsWith('/portal'),
  },
  {
    href: '/admin',
    label: 'Admin',
    match: (pathname: string) => pathname.startsWith('/admin'),
    requiresAdmin: true,
  },
];

export function AppLayout({ children }: AppLayoutProps) {
  const { isAdmin, isAuthenticated, portalAccessTier, signOut, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const appContext = getAppContext(location.pathname);
  const currentLocation = typeof window === 'undefined' ? undefined : window.location;
  const marketingHomeUrl = getCanonicalUrlForSurface('marketing', '/', '', '', currentLocation);
  const accountUrl = '/portal/account';
  const showAccountLink = portalAccessTier !== 'training';
  const homeUrl = isAuthenticated ? '/portal' : '/login';

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
                <span>{item.label}</span>
                {item.label === 'Admin' && <Shield className="h-4 w-4" />}
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
            {item.label}
          </NavLink>
        );
      });

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
                  Operator App
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
                Main site
                <ExternalLink className="h-4 w-4" />
              </a>

              {isAuthenticated ? (
                <>
                  {showAccountLink && (
                    <Link to={accountUrl}>
                      <Button variant="outline" size="sm">
                        <Settings className="mr-2 h-4 w-4" />
                        Account
                      </Button>
                    </Link>
                  )}
                  <Button variant="outline" size="sm" onClick={handleSignOut}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign Out
                  </Button>
                </>
              ) : (
                <a href={marketingHomeUrl}>
                  <Button variant="outline" size="sm">
                    View Main Site
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
                    aria-label="Open operator navigation menu"
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                </SheetTrigger>
                <SheetContent
                  side="right"
                  className="w-[min(92vw,360px)] border-border bg-background px-5 py-6"
                >
                  <SheetHeader className="text-left">
                    <SheetTitle>Operator app</SheetTitle>
                    <SheetDescription>{appContext.description}</SheetDescription>
                  </SheetHeader>
                  <div className="mt-6 space-y-3">
                    {isAuthenticated && renderWorkspaceLinks(true)}
                    {isAuthenticated && showAccountLink && (
                      <SheetClose asChild>
                        <Link
                          to={accountUrl}
                          className="flex items-center justify-between rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
                        >
                          <span>Account</span>
                          <User className="h-4 w-4" />
                        </Link>
                      </SheetClose>
                    )}
                    <a
                      href={marketingHomeUrl}
                      className="flex items-center justify-between rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
                    >
                      <span>Main site</span>
                      <ExternalLink className="h-4 w-4" />
                    </a>
                    {isAuthenticated ? (
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="flex w-full items-center justify-between rounded-2xl border border-border bg-background px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
                      >
                        <span>Sign Out</span>
                        <LogOut className="h-4 w-4" />
                      </button>
                    ) : (
                      <SheetClose asChild>
                        <Link
                          to="/login"
                          className="flex items-center justify-between rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
                        >
                          <span>Operator login</span>
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
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
