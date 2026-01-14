import { ReactNode } from 'react';
import { Layout } from '@/components/layout/Layout';
import { NavLink } from '@/components/NavLink';

const portalLinks = [
  { href: '/portal', label: 'Dashboard', end: true },
  { href: '/portal/training', label: 'Training' },
  { href: '/portal/onboarding', label: 'Onboarding' },
  { href: '/portal/support', label: 'Support' },
  { href: '/portal/orders', label: 'Orders' },
  { href: '/portal/account', label: 'Account' },
];

interface PortalLayoutProps {
  children: ReactNode;
}

export function PortalLayout({ children }: PortalLayoutProps) {
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
                  {link.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      </div>
      {children}
    </Layout>
  );
}
