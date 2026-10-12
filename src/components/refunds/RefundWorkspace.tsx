import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { lazyRoute } from '@/lib/lazyRoute';
import { fetchRefundRequest, validRefundRequestId } from '@/lib/refundRequests';

const ManagerRefunds = lazyRoute(() => import('@/pages/admin/Refunds'));
const RefundReports = lazyRoute(() => import('@/pages/admin/RefundReports'));
const RefundRequests = lazyRoute(() => import('@/pages/RefundRequests'));

export default function RefundWorkspace() {
  const { search } = useLocation();
  const { user, adminAccess, capabilities, isSuperAdmin } = useAuth();
  const params = new URLSearchParams(search);
  const view = params.get('view'); const caseId = params.get('case');
  const manager = isSuperAdmin || adminAccess.allowedSurfaces.some(value => ['*', 'refunds'].includes(value)) || capabilities.includes('refunds.manage');
  const checkCase = manager && validRefundRequestId(caseId) && view !== 'requests' && view !== 'reports';
  const detail = useQuery({ queryKey: ['refund-workspace-request', user?.id, caseId], queryFn: ({ signal }) => fetchRefundRequest(caseId!, signal), enabled: checkCase, retry: false, staleTime: 0, gcTime: 30_000, refetchInterval: 30000, refetchOnWindowFocus: 'always' });
  if (view === 'reports') return <RefundReports />;
  if (!manager || view === 'requests') return <RefundRequests />;
  if (!caseId || !validRefundRequestId(caseId)) return <ManagerRefunds key={user?.id} />;
  // Null can be a legacy/internal case deliberately excluded from the operational projection.
  // Its existing manager workspace still performs its own server authorization.
  if (detail.isSuccess && detail.data && !detail.data.canOpenManagerWorkspace) return <RefundRequests />;
  // Keep the Manager shell mounted. Its protected case RPC enforces current
  // case access independently, including while this routing check is pending.
  return <ManagerRefunds key={user?.id} />;
}
