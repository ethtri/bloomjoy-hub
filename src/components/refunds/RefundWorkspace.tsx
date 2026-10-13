import { useLocation } from 'react-router-dom';
import { Suspense, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { lazyRoute } from '@/lib/lazyRoute';
import { fetchRefundRequest, validRefundRequestId } from '@/lib/refundRequests';
import { fetchRefundPortalQueueProjection } from '@/lib/refundPortalReads';

const ManagerRefunds = lazyRoute(() => import('@/pages/admin/Refunds'));
const RefundReports = lazyRoute(() => import('@/pages/admin/RefundReports'));
const RefundRequests = lazyRoute(() => import('@/pages/RefundRequests'));

function RefundQueueWarmRead({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  useQuery({ queryKey: ['refund-portal-queue-projection', userId],
    queryFn: ({ signal }) => fetchRefundPortalQueueProjection(signal),
    retry: false, staleTime: 30_000, refetchOnWindowFocus: false,
  });
  useEffect(() => () => {
    // Check after the route commit: a disabled observer must not keep a
    // superseded read alive, while an active Manager observer still needs it.
    queueMicrotask(() => {
      const filter = { queryKey: ['refund-portal-queue-projection', userId], exact: true };
      if (!queryClient.getQueryCache().find(filter)?.isActive()) void queryClient.cancelQueries(filter);
    });
  }, [queryClient, userId]);
  return null;
}

export default function RefundWorkspace() {
  const { search } = useLocation();
  const { user, adminAccess, capabilities, isSuperAdmin } = useAuth();
  const params = new URLSearchParams(search);
  const view = params.get('view'); const caseId = params.get('case');
  const manager = isSuperAdmin || adminAccess.allowedSurfaces.some(value => ['*', 'refunds'].includes(value)) || capabilities.includes('refunds.manage');
  const checkCase = manager && validRefundRequestId(caseId) && view !== 'requests' && view !== 'reports';
  const detail = useQuery({ queryKey: ['refund-workspace-request', user?.id, caseId], queryFn: ({ signal }) => fetchRefundRequest(caseId!, signal), enabled: checkCase, retry: false, staleTime: 0, gcTime: 30_000, refetchInterval: 30000, refetchOnWindowFocus: 'always' });
  const warmUserId = user && manager && !caseId && view !== 'requests' && view !== 'reports' && params.get('demo') !== 'on' ? user.id : null;
  const renderWorkspace = (workspace: ReactNode) => <>
    {warmUserId && <RefundQueueWarmRead key={warmUserId} userId={warmUserId} />}
    <Suspense fallback={<p role="status" className="p-6 text-sm text-muted-foreground">Loading refunds…</p>}>
      {workspace}
    </Suspense>
  </>;
  if (view === 'reports') return renderWorkspace(<RefundReports />);
  if (!manager || view === 'requests') return renderWorkspace(<RefundRequests />);
  if (!caseId || !validRefundRequestId(caseId)) return renderWorkspace(<ManagerRefunds key={user?.id} />);
  // Null can be a legacy/internal case deliberately excluded from the operational projection.
  // Its existing manager workspace still performs its own server authorization.
  if (detail.isSuccess && detail.data && !detail.data.canOpenManagerWorkspace) return renderWorkspace(<RefundRequests />);
  // Keep the Manager shell mounted. Its protected case RPC enforces current
  // case access independently, including while this routing check is pending.
  return renderWorkspace(<ManagerRefunds key={user?.id}
    caseAccess={detail.isError ? 'error' : detail.isPending ? 'pending' : 'allowed'}
    retryCaseAccess={() => { void detail.refetch(); }} />);
}
