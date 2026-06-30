import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/contexts/auth-context';
import { fetchMyOperatorTimekeepingContext } from '@/lib/operatorPayouts';

export function usePortalTimekeepingAccess() {
  const { capabilities, user } = useAuth();

  const query = useQuery({
    queryKey: ['operator-timekeeping-access', user?.id],
    queryFn: fetchMyOperatorTimekeepingContext,
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });

  const hasCapability = capabilities.some((capability) =>
    ['operator.timekeeping', 'timekeeping.submit', 'operator.payouts'].includes(capability),
  );
  const hasActiveProfile = query.data?.profiles.some((profile) => profile.status === 'active') ?? false;

  return {
    ...query,
    canUsePortalTimekeeping: hasCapability || hasActiveProfile,
    isResolvingPortalTimekeeping: Boolean(user?.id) && query.isLoading && !query.data && !query.error,
  };
}
