import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, ShoppingCart, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cart';
import { useAuth } from '@/contexts/auth-context';
import { getCanonicalUrlForSurface } from '@/lib/appSurface';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo.png';

const navLinks = [
  { href: '/machines', label: 'Machines' },
  { href: '/supplies', label: 'Supplies' },
  { href: '/plus', label: 'Plus' },
  { href: '/resources', label: 'Resources' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];

export function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const isCurrent = (href: string) => location.pathname === href || location.pathname.startsWith(href + '/');
  useEffect(() => setMobileMenuOpen(false), [location.key]);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMobileMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [mobileMenuOpen]);
  const { getItemCount } = useCart();
  const { adminAccess, isAuthenticated, isAdmin, isScopedAdmin, isSuperAdmin } = useAuth();
  const itemCount = getItemCount();
  const allowedAdminSurfaces = new Set(adminAccess.allowedSurfaces);
  const canOpenAdminWorkspace =
    isAdmin &&
    (isSuperAdmin ||
      allowedAdminSurfaces.has('*') ||
      (isScopedAdmin && allowedAdminSurfaces.has('access')) ||
      allowedAdminSurfaces.has('partnerships') ||
      allowedAdminSurfaces.has('payouts'));
  const currentLocation = typeof window === 'undefined' ? undefined : window.location;
  const operatorAppUrl = getCanonicalUrlForSurface('app', '/portal', '', '', currentLocation);
  const operatorLoginUrl = getCanonicalUrlForSurface('app', '/login', '', '', currentLocation);
  const adminAppUrl = getCanonicalUrlForSurface('app', '/admin', '', '', currentLocation);
  const cartLabel =
    itemCount > 0 ? `View cart with ${itemCount} item${itemCount === 1 ? '' : 's'}` : 'View cart';

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <nav aria-label="Main navigation" className="container-page flex h-16 items-center justify-between gap-2">
        {/* Logo */}
        <Link to="/" aria-label="Bloomjoy Sweets home" className="flex shrink-0 items-center gap-2">
          <img
            src={logo}
            alt=""
            width={44}
            height={44}
            decoding="async"
            className="h-11 w-11 shrink-0"
          />
          <span className="whitespace-nowrap font-display text-base font-bold text-foreground sm:text-xl">
            Bloomjoy Sweets
          </span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden items-center gap-1 xl:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              to={link.href}
              aria-current={isCurrent(link.href) ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center px-4 py-2 text-sm font-medium transition-colors hover:text-primary',
                isCurrent(link.href)
                  ? 'text-primary'
                  : 'text-muted-foreground'
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Desktop Actions */}
        <div className="hidden items-center gap-3 xl:flex">
          <Link
            to="/cart"
            className="relative flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={cartLabel}
          >
            <ShoppingCart className="h-5 w-5" />
            {itemCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {itemCount}
              </span>
            )}
          </Link>
          {isAuthenticated ? (
            <>
              {canOpenAdminWorkspace && (
                  <Button asChild variant="outline" size="sm">
                    <a href={adminAppUrl}>
                    Admin App
                    </a>
                  </Button>
              )}
                <Button asChild variant="outline" size="sm">
                  <a href={operatorAppUrl}>
                  <User className="mr-1 h-4 w-4" />
                  Open App
                  </a>
                </Button>
            </>
          ) : (
              <Button asChild variant="outline" size="sm">
                <a href={operatorLoginUrl}>
                Bloomjoy Hub Login
                </a>
              </Button>
          )}
        </div>

        {/* Mobile Menu Button */}
        <div className="flex shrink-0 items-center gap-1 xl:hidden">
          <Link
            to="/cart"
            className="relative flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={cartLabel}
          >
            <ShoppingCart className="h-5 w-5" />
            {itemCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {itemCount}
              </span>
            )}
          </Link>
          <button
            type="button"
            ref={menuButtonRef}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-controls="mobile-navigation-menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div id="mobile-navigation-menu" className="border-t border-border bg-background xl:hidden">
          <div className="container-page py-4">
            <div className="flex flex-col gap-2">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  aria-current={isCurrent(link.href) ? 'page' : undefined}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'rounded-lg px-4 py-3 text-sm font-medium transition-colors',
                    isCurrent(link.href)
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  {link.label}
                </Link>
              ))}
              <div className="mt-2 border-t border-border pt-4">
                {isAuthenticated ? (
                  <div className="flex flex-col gap-2">
                    {canOpenAdminWorkspace && (
                        <Button asChild variant="outline" className="w-full">
                          <a href={adminAppUrl} onClick={() => setMobileMenuOpen(false)}>
                          Admin App
                          </a>
                        </Button>
                    )}
                      <Button asChild variant="outline" className="w-full">
                        <a href={operatorAppUrl} onClick={() => setMobileMenuOpen(false)}>
                        <User className="mr-2 h-4 w-4" />
                        Open App
                        </a>
                      </Button>
                  </div>
                ) : (
                    <Button asChild variant="outline" className="w-full">
                      <a href={operatorLoginUrl} onClick={() => setMobileMenuOpen(false)}>
                      Bloomjoy Hub Login
                      </a>
                    </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
