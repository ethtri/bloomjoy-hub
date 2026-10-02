import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fetchFinanceReportingAccess } from '@/lib/financeReporting';
import { fetchLaborAnalyticsAccess } from '@/lib/laborAnalytics';
import { fetchRefundAnalyticsAccess } from '@/lib/refundAnalytics';

const errorCode = (error: unknown): string => {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  return typeof error.code === 'string' ? error.code : '';
};

/** Checks availability only; successful responses never grant domain access. */
export function AdminReportingServiceStatus() {
  const { user, isSuperAdmin, isScopedAdmin } = useAuth();
  const enabled = Boolean(user?.id && (isSuperAdmin || isScopedAdmin));
  const options = { enabled, staleTime: 60_000, retry: false };
  const finance = useQuery({
    ...options, queryKey: ['reporting-finance-access', user?.id], queryFn: fetchFinanceReportingAccess,
  });
  const labor = useQuery({
    ...options, queryKey: ['reporting-labor-access', user?.id], queryFn: fetchLaborAnalyticsAccess,
  });
  const refunds = useQuery({
    ...options, queryKey: ['reporting-refund-access', user?.id], queryFn: fetchRefundAnalyticsAccess,
  });
  const checks = [
    { label: 'Finance', rpc: 'get_finance_reporting_access', query: finance },
    { label: 'Labor', rpc: 'get_labor_analytics_access', query: labor },
    { label: 'Refunds & Recovery', rpc: 'get_refund_analytics_access', query: refunds },
  ];
  const failed = checks.filter(check => check.query.isError);
  if (!enabled || failed.length === 0) return null;

  return (
    <Alert className="mt-6 border-amber-200 bg-amber-50/50" role="status">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Reporting services need attention</AlertTitle>
      <AlertDescription>
        <p className="mt-2">
          These reporting access checks failed on the connected backend. Ask the technical owner
          to check the reporting deployment before retrying.
        </p>
        <ul className="mt-3 space-y-2">
          {failed.map(({ label, rpc, query }) => {
            const code = errorCode(query.error);
            const missing = code === 'PGRST202' || code === '42883';
            return (
              <li key={rpc} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium text-foreground">{label}</span>
                <Badge variant="outline">{missing ? 'Service not found' : 'Check failed'}</Badge>
                <code className="break-all text-xs text-muted-foreground">{rpc}{code ? ` (${code})` : ''}</code>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          A service not found response can mean the reviewed database migration has not been deployed
          or the API schema cache needs refreshing. Account access remains separately controlled.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3 min-h-11"
          disabled={checks.some(check => check.query.isFetching)}
          onClick={() => { checks.forEach(check => { void check.query.refetch(); }); }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />Recheck services
        </Button>
      </AlertDescription>
    </Alert>
  );
}
