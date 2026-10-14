import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { fetchLaborAnalytics, fetchLaborAnalyticsAccess } from '@/lib/laborAnalytics';
import { homeLaborPeriods, validateHomeLaborAccess, validateHomeLaborReport } from '@/lib/homeLaborSummary';
import { getTodayInTimekeepingZone } from '@/lib/timekeepingUi';
import { useQueuedReportingQuery } from './useQueuedReportingQuery';

export function useHomeLaborSummary() {
  const { user, adminAccess, capabilities, isSuperAdmin } = useAuth();
  const [today, setToday] = useState(getTodayInTimekeepingZone);
  useEffect(() => {
    const refreshDay = () => setToday(getTodayInTimekeepingZone());
    const interval = window.setInterval(refreshDay, 60_000);
    window.addEventListener('focus', refreshDay);
    document.addEventListener('visibilitychange', refreshDay);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshDay);
      document.removeEventListener('visibilitychange', refreshDay);
    };
  }, []);
  const periods = homeLaborPeriods(today);
  const authority = [isSuperAdmin, [...adminAccess.allowedSurfaces].sort(), [...adminAccess.scopedMachineIds].sort(), [...capabilities].sort()];
  const access = useQuery({
    queryKey: ['home-labor-summary', user?.id, authority, 'access'],
    queryFn: async () => validateHomeLaborAccess(await fetchLaborAnalyticsAccess()),
    enabled: Boolean(user), staleTime: 0, retry: false,
  });
  // Revalidate access on every return to Home. A new access response gets fresh reports,
  // including when account-pay scope changes without changing machine dimensions.
  const verified = access.isSuccess && !access.isFetching;
  const key = ['home-labor-summary', user?.id, authority, access.dataUpdatedAt];
  const current = useQueuedReportingQuery({
    queryKey: [...key, 'current', periods.current],
    queryFn: async () => validateHomeLaborReport(await fetchLaborAnalytics(periods.current), periods.current, 'time'),
    enabled: verified && access.data.hasAccess, staleTime: 0,
  });
  const previous = useQueuedReportingQuery({
    queryKey: [...key, 'previous', periods.previous],
    queryFn: async () => validateHomeLaborReport(await fetchLaborAnalytics(periods.previous), periods.previous, 'pay'),
    enabled: verified && access.data.canViewPay, staleTime: 0,
  });
  return {
    access, current, previous, periods, verified,
    canOpenAdminPay: adminAccess.canAccessAdmin && (
      isSuperAdmin || adminAccess.allowedSurfaces.includes('*') || adminAccess.allowedSurfaces.includes('payouts')
    ),
  };
}
