import { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/auth-context';
import { AdminPersonAccessConsole } from './accessPersonConsole';

export default function AdminAccessPage() {
  const { isScopedAdmin, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialShowActivity = searchParams.get('tab') === 'audit';
  const initialLauncher = useMemo(
    () => ({
      open: searchParams.get('action') === 'add-access',
      preset: searchParams.get('preset') ?? undefined,
      email: searchParams.get('email') ?? undefined,
      partnerId: searchParams.get('partnerId') ?? undefined,
      accountId: searchParams.get('accountId') ?? undefined,
    }),
    [searchParams]
  );

  useEffect(() => {
    if (!isScopedAdmin || isSuperAdmin) return;

    const legacyTab = searchParams.get('tab');
    if (!legacyTab || legacyTab === 'audit') return;

    const normalizedParams = new URLSearchParams(searchParams);
    normalizedParams.delete('tab');
    normalizedParams.set('action', 'add-access');
    normalizedParams.set('preset', 'technician');

    navigate(
      {
        pathname: '/admin/access',
        search: `?${normalizedParams.toString()}`,
      },
      { replace: true }
    );
  }, [isScopedAdmin, isSuperAdmin, navigate, searchParams]);

  return (
    <AppLayout>
      <section className="section-padding admin-touch-targets">
        <div className="container-page">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Admin
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground">
                People &amp; Permissions
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                {isSuperAdmin
                  ? 'See who has access, understand why, and make changes without hunting through separate tools.'
                  : 'See people in your scope, grant Technician access for assigned machines, and manage reporting visibility.'}
              </p>
              {isScopedAdmin && !isSuperAdmin && (
                <Badge className="mt-3" variant="secondary">
                  Scoped Admin
                </Badge>
              )}
            </div>
          </div>

          <div className="mt-6">
            {(isSuperAdmin || isScopedAdmin) && (
              <AdminPersonAccessConsole
                initialShowActivity={initialShowActivity}
                initialLauncher={initialLauncher}
              />
            )}

            {!isSuperAdmin && (
              <div className="mt-6">
                <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                  Your scoped admin grant limits this workspace to assigned machines. Use the
                  person workspace above to manage Technician grants inside that assigned-machine
                  scope.
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
