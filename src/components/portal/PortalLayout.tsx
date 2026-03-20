import { ReactNode } from 'react';
import { Layout } from '@/components/layout/Layout';
import { NavLink } from '@/components/NavLink';
import { useAuth } from '@/contexts/AuthContext';

const portalLinks = [
  { href: '/portal', label: 'Dashboard', end: true, premium: false },
  { href: '/portal/training', label: 'Training', premium: true },
  { href: '/portal/onboarding', label: 'Onboarding', premium: true },
  { href: '/portal/support', label: 'Support', premium: true },
  { href: '/portal/orders', label: 'Orders', premium: false },
  { href: '/portal/account', label: 'Account', premium: false },
];

interface PortalLayoutProps {
  children: ReactNode;
}

export function PortalLayout({ children }: PortalLayoutProps) {
  const { isMember, isAdmin } = useAuth();

  return (
    <Layout>
      <div className="border-b border-border bg-muted/30">
        <div className="container-page py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Member Portal
          </p>
          <div className="mt-3 overflow-x-auto pb-2">
            <nav className="flex min-w-max gap-2">
              {portalLinks.map((link) => (
                <NavLink
                  key={link.href}
                  to={link.href}
                  end={link.end}
                  className="rounded-full border border-transparent bg-background px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  activeClassName="border-primary/20 bg-primary/10 text-primary"
                >
                  <span>{link.label}</span>
                  {link.premium && !isMember && (
                    <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                      Plus
                    </span>
                  )}
                </NavLink>
              ))}
              {isAdmin && (
                <NavLink
                  to="/admin"
                  className="rounded-full border border-transparent bg-background px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  activeClassName="border-primary/20 bg-primary/10 text-primary"
                >
                  <span>Admin</span>
                </NavLink>
              )}
            </nav>
          </div>
        </div>
      </div>
      {children}
    </Layout>
  );
}
