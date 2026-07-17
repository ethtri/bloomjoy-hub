import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthenticatedShellSkeleton } from '@/components/auth/AuthenticatedShellSkeleton';
import { useAuth } from '@/contexts/auth-context';

export function ProtectedRoute() {
  const {
    bootstrapError,
    bootstrapStatus,
    hasAuthenticatedSession,
    isAuthenticated,
    retryBootstrap,
    signOut,
  } = useAuth();
  const location = useLocation();

  if (bootstrapStatus === 'error') {
    return (
      <AuthenticatedShellSkeleton
        status="error"
        errorMessage={bootstrapError}
        onRetry={() => void retryBootstrap()}
        onSignOut={() => void signOut()}
      />
    );
  }

  if (bootstrapStatus === 'signed-out' && !hasAuthenticatedSession) {
    const nextPath = `${location.pathname}${location.search}${location.hash}`;
    const loginSearch = new URLSearchParams({ next: nextPath }).toString();
    return <Navigate to={`/login?${loginSearch}`} replace state={{ from: location }} />;
  }

  if (!isAuthenticated) {
    return (
      <AuthenticatedShellSkeleton
        status={hasAuthenticatedSession ? 'hydrating-access' : 'checking-session'}
        onRetry={() => void retryBootstrap()}
        onSignOut={() => void signOut()}
      />
    );
  }

  return <Outlet />;
}
