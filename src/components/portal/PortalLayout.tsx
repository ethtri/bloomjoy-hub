import type { ReactNode } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';

interface PortalLayoutProps {
  children: ReactNode;
}

export function PortalLayout({ children }: PortalLayoutProps) {
  return (
    <AppLayout>
      <div className="portal-shell">{children}</div>
    </AppLayout>
  );
}
