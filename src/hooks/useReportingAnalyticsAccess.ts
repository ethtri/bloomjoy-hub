import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { fetchLaborAnalyticsAccess } from '@/lib/laborAnalytics';
import { fetchRefundAnalyticsAccess } from '@/lib/refundAnalytics';

/** Independent domain permissions; sales access never implies time, pay or refunds. */
export function useReportingAnalyticsAccess(enabled = true) {
  const { user } = useAuth();
  const options = { enabled: enabled && Boolean(user?.id), staleTime: 60000, retry: false };
  const labor = useQuery({ ...options, queryKey: ['reporting-labor-access', user?.id], queryFn: fetchLaborAnalyticsAccess });
  const refunds = useQuery({ ...options, queryKey: ['reporting-refund-access', user?.id], queryFn: fetchRefundAnalyticsAccess });
  return {
    labor, refunds,
    canUseLabor: labor.isSuccess && (labor.data?.hasAccess === true || labor.data?.canViewPay === true),
    canUseRefunds: refunds.isSuccess && refunds.data?.hasAccess === true,
    isLoading: options.enabled && (labor.isPending || refunds.isPending),
  };
}
