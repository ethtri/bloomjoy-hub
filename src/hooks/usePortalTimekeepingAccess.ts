import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/contexts/auth-context';
import { fetchMyOperatorTimekeepingContext } from '@/lib/operatorPayouts';
import { getTodayInTimekeepingZone } from '@/lib/timekeepingUi';

export function usePortalTimekeepingAccess() {
  const { capabilities, user } = useAuth();
  const workDate = getTodayInTimekeepingZone();

  const query = useQuery({
    queryKey: ['operator-timekeeping-access', user?.id, workDate],
    queryFn: () => fetchMyOperatorTimekeepingContext(workDate),
    enabled: Boolean(user?.id),
    staleTime: 30_000,
    // A Pacific date rollover must not unmount an open time form while the
    // next day's access context loads. Never carry access across identities.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === user?.id ? previousData : undefined,
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
