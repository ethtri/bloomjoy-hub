import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { fetchLaborAnalytics, laborAnalyticsTotals } from '@/lib/laborAnalytics';
import { fetchRefundAnalytics } from '@/lib/refundAnalytics';
import { ReportingOperationsSummary } from './ReportingOperationsSummary';
import type { ReportingScope } from './ReportingWorkspace';

export function ReportingOperations({ scope, laborScope = scope, canUseLabor, canUseRefunds, onNavigate }: {
  scope: ReportingScope; laborScope?: ReportingScope; canUseLabor: boolean; canUseRefunds: boolean;
  onNavigate: (view: 'labor' | 'refunds') => void;
}) {
  const { user } = useAuth();
  const labor = useQuery({ queryKey: ['reporting-labor-summary', user?.id, laborScope], queryFn: () => fetchLaborAnalytics(laborScope), enabled: canUseLabor, staleTime: 60000 });
  const refunds = useQuery({ queryKey: ['refund-analytics', user?.id, scope.dateFrom, scope.dateTo, [...(scope.machineIds ?? [])].sort(), [...(scope.locationIds ?? [])].sort(), scope.companyId ?? 'all'], queryFn: () => fetchRefundAnalytics(scope), enabled: canUseRefunds, staleTime: 60000 });
  const totals = laborAnalyticsTotals(labor.data?.rows ?? []);
  return <div className="mt-7"><ReportingOperationsSummary onNavigate={onNavigate}
    labor={canUseLabor && labor.data?.access.hasAccess !== false ? { loading: labor.isPending, error: labor.isError, actualMinutes: totals.actualMinutes, paidShifts: totals.paidShifts, entries: totals.entryCount } : undefined}
    refunds={canUseRefunds ? { loading: refunds.isPending, error: refunds.isError, requestCount: refunds.data?.cohort.requestCount ?? 0, outstandingCents: refunds.data?.asOf.outstandingCents ?? 0, unknownBalanceCount: refunds.data?.asOf.unknownBalanceCount ?? 0, asOfDate: scope.dateTo } : undefined}
  /><p className="mt-4 text-xs leading-relaxed text-muted-foreground">Each measure uses its own authorized machine scope. Labor reports use their own filters. Sales tender and comparison selections apply to sales only.</p></div>;
}
