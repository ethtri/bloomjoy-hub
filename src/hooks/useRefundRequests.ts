import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { fetchRefundRequestAccess, fetchRefundRequest, fetchRefundRequests, refundRequestAccessKey, validRefundRequestId, type RefundRequestPeriod } from '@/lib/refundRequests';

const protectedOptions = { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: 'always' as const, refetchInterval: 30000, refetchOnMount: false };
export function useRefundRequestAccess(enabled = true) {
  const { user } = useAuth();
  return useQuery({ queryKey: refundRequestAccessKey(user?.id), queryFn: fetchRefundRequestAccess, enabled: enabled && Boolean(user?.id), ...protectedOptions });
}
export function useRefundRequests(period: RefundRequestPeriod, caseId: string | null, validPeriod: boolean, enabled = true) {
  const { user } = useAuth();
  const client = useQueryClient();
  const access = useRefundRequestAccess(enabled);
  const verified = enabled && access.isSuccess && access.data.hasAccess;
  const scope = access.data?.machines.map(m => `${m.machineId}:${m.canOpenManagerWorkspace}`).sort().join('|') ?? '';
  const machineAllowed = !period.machineId || access.data?.machines.some(m => m.machineId === period.machineId);
  const list = useQuery({ queryKey: ['refund-requests', user?.id, scope, period], queryFn: () => fetchRefundRequests(period), enabled: verified && validPeriod && Boolean(machineAllowed), ...protectedOptions });
  const detail = useQuery({ queryKey: ['refund-request', user?.id, scope, caseId], queryFn: () => fetchRefundRequest(caseId!), enabled: verified && validRefundRequestId(caseId), ...protectedOptions });
  useEffect(() => {
    if (access.isError || (access.isSuccess && !access.data.hasAccess) || list.isError || detail.isError) {
      client.removeQueries({ queryKey: ['refund-requests', user?.id], type: 'inactive' });
      client.removeQueries({ queryKey: ['refund-request', user?.id], type: 'inactive' });
    }
  }, [access.isError, access.isSuccess, access.data?.hasAccess, list.isError, detail.isError, client, user?.id]);
  const protectedError = access.isError || list.isError || detail.isError;
  const scopedDetail = detail.data && access.data?.machines.some(m => m.machineId === detail.data?.machineId) ? detail.data : null;
  const refresh = async () => {
    const current = await access.refetch();
    if (current.isError || !current.data?.hasAccess) return;
    // Invalidation refetches only currently enabled observers. Disabled invalid
    // filters and stale scope keys are never manually forced to fetch.
    await Promise.all([
      client.invalidateQueries({ queryKey: ['refund-requests', user?.id], refetchType: 'active' }),
      client.invalidateQueries({ queryKey: ['refund-request', user?.id], refetchType: 'active' }),
      client.invalidateQueries({ queryKey: ['refund-workspace-request', user?.id], refetchType: 'active' }),
    ]);
  };
  return { access, list, detail, machineAllowed, verified, refresh,
    requests: verified && !protectedError ? list.data?.requests ?? [] : [],
    request: verified && !protectedError ? scopedDetail : null,
    protectedError,
  };
}
