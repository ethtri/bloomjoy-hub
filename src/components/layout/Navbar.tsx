import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, ShoppingCart, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cart';
import { useAuth } from '@/contexts/AuthContext';
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
  const { getItemCount } = useCart();
  const { isAuthenticated, isAdmin } = useAuth();
  const itemCount = getItemCount();
  const operatorAppUrl = getCanonicalUrlForSurface('app', '/portal', '', '', window.location);
  const operatorLoginUrl = getCanonicalUrlForSurface('app', '/login', '', '', window.location);
  const adminAppUrl = getCanonicalUrlForSurface('app', '/admin', '', '', window.location);
  const cartLabel =
    itemCount > 0 ? `View cart with ${itemCount} item${itemCount === 1 ? '' : 's'}` : 'View cart';

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <nav className="container-page flex h-16 items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5">
          <img src={logo} alt="Bloomjoy Sweets" className="h-11 w-11" />
          <span className="font-display text-xl font-bold text-foreground">
            Bloomjoy Sweets
          </span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              to={link.href}
              className={cn(
                'px-4 py-2 text-sm font-medium transition-colors hover:text-primary',
                location.pathname === link.href || location.pathname.startsWith(link.href + '/')
                  ? 'text-primary'
                  : 'text-muted-foreground'
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Desktop Actions */}
        <div className="hidden items-center gap-3 md:flex">
          <Link
            to="/cart"
            className="relative p-2 text-muted-foreground hover:text-foreground"
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
              {isAdmin && (
                <a href={adminAppUrl}>
                  <Button variant="outline" size="sm">
                    Admin App
                  </Button>
                </a>
              )}
              <a href={operatorAppUrl}>
                <Button variant="outline" size="sm">
                  <User className="mr-1 h-4 w-4" />
                  Open App
                </Button>
              </a>
            </>
          ) : (
            <a href={operatorLoginUrl}>
              <Button variant="outline" size="sm">
                Operator Login
              </Button>
            </a>
          )}
        </div>

        {/* Mobile Menu Button */}
        <div className="flex items-center gap-3 md:hidden">
          <Link
            to="/cart"
            className="relative p-2 text-muted-foreground hover:text-foreground"
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
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 text-muted-foreground hover:text-foreground"
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
        <div id="mobile-navigation-menu" className="border-t border-border bg-background md:hidden">
          <div className="container-page py-4">
            <div className="flex flex-col gap-2">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'rounded-lg px-4 py-3 text-sm font-medium transition-colors',
                    location.pathname === link.href
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
                    {isAdmin && (
                      <a href={adminAppUrl} onClick={() => setMobileMenuOpen(false)}>
                        <Button variant="outline" className="w-full">
                          Admin App
                        </Button>
                      </a>
                    )}
                    <a href={operatorAppUrl} onClick={() => setMobileMenuOpen(false)}>
                      <Button variant="outline" className="w-full">
                        <User className="mr-2 h-4 w-4" />
                        Open App
                      </Button>
                    </a>
                  </div>
                ) : (
                  <a href={operatorLoginUrl} onClick={() => setMobileMenuOpen(false)}>
                    <Button variant="outline" className="w-full">
                      Operator Login
                    </Button>
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
