import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { lazyRoute } from '@/lib/lazyRoute';
import { fetchRefundRequest, validRefundRequestId } from '@/lib/refundRequests';
import { AppLayout } from '@/components/layout/AppLayout';

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
  const detail = useQuery({ queryKey: ['refund-workspace-request', user?.id, caseId], queryFn: () => fetchRefundRequest(caseId!), enabled: checkCase, retry: false, staleTime: 0, gcTime: 0, refetchInterval: 30000, refetchOnWindowFocus: 'always' });
  if (view === 'reports') return <RefundReports />;
  if (!manager || view === 'requests') return <RefundRequests />;
  if (!caseId || !validRefundRequestId(caseId)) return <ManagerRefunds />;
  if (checkCase && detail.isPending) return <AppLayout><p role="status" className="p-8 text-sm text-muted-foreground">Checking request access…</p></AppLayout>;
  // Null can be a legacy/internal case deliberately excluded from the operational projection.
  // Its existing manager workspace still performs its own server authorization.
  if (checkCase && detail.isSuccess && (detail.data === null || detail.data.canOpenManagerWorkspace)) return <ManagerRefunds />;
  return <RefundRequests />;
}
