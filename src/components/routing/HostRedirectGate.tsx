import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getHostRedirectTarget } from '@/lib/appSurface';

interface HostRedirectGateProps {
  children: ReactNode;
}

export function HostRedirectGate({ children }: HostRedirectGateProps) {
  const location = useLocation();
  const redirectTarget = getHostRedirectTarget(
    window.location,
    location.pathname,
    location.search,
    location.hash
  );

  useEffect(() => {
    if (!redirectTarget) {
      return;
    }

    window.location.replace(redirectTarget);
  }, [redirectTarget]);

  if (redirectTarget) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Redirecting to the correct Bloomjoy surface...
      </div>
    );
  }

  return <>{children}</>;
}
