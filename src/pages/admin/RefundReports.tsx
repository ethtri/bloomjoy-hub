import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { RefundAnalyticsPanel } from '@/components/portal/reports/RefundAnalyticsPanel';
import { Button } from '@/components/ui/button';
import { ReportingFilters } from '@/components/portal/reports/ReportingFilters';
import { useAuth } from '@/contexts/auth-context';
import { fetchRefundAnalyticsAccess } from '@/lib/refundAnalytics';
import { readWorkspaceState, writeWorkspaceState, validDate, type WorkspaceState } from '@/lib/reportingWorkspace';

/** Read-only report host. Never mounts the case queue or its payment capabilities. */
export default function RefundReports() {
  const { user, adminAccess, capabilities, isSuperAdmin, isScopedAdmin, isCorporatePartner, hasReportingAccess } = useAuth();
  const canUseQueue = isSuperAdmin || adminAccess.allowedSurfaces.includes('*') || adminAccess.allowedSurfaces.includes('refunds') || capabilities.includes('refunds.manage');
  const canUseCentralReporting = hasReportingAccess || isCorporatePartner || isScopedAdmin || isSuperAdmin;
  const [params, setParams] = useSearchParams();
  const state = readWorkspaceState(params);
  const access = useQuery({ queryKey: ['reporting-refund-access', user?.id], queryFn: fetchRefundAnalyticsAccess,
    enabled: Boolean(user?.id), staleTime: 60_000, retry: false });
  // A failed recheck must hide cached dimensions and unmount cached report data.
  const allowed = access.isSuccess && access.data?.hasAccess === true;
  const dimensions = allowed ? access.data.dimensions : [];
  const locations: [string, string][] = [...new Map(dimensions.map(item => [item.locationId, item.locationName])).entries()];
  const machines = dimensions.filter(item => state.locationId === 'all' || item.locationId === state.locationId);
  const invalidScope = (state.locationId !== 'all' && !locations.some(([id]) => id === state.locationId))
    || (state.machineId !== 'all' && !machines.some(item => item.machineId === state.machineId));
  const from = params.get('from'); const to = params.get('to');
  const invalidDates = (params.has('from') || params.has('to')) && (!validDate(from) || !validDate(to) || from > to);
  const tooLong = (Date.parse(state.dateTo) - Date.parse(state.dateFrom)) / 86400000 > 366;
  const update = (patch: Partial<WorkspaceState>) => {
    const next = writeWorkspaceState({ ...state, ...patch }, params); next.set('view', 'reports');
    // Scope changes must not turn a malformed linked period into default dates.
    if (invalidDates && patch.dateFrom === undefined && patch.dateTo === undefined) {
      for (const key of ['from', 'to']) {
        const linked = params.get(key); if (linked === null) next.delete(key); else next.set(key, linked);
      }
    }
    setParams(next);
  };
  const reportingLink = new URLSearchParams(params); reportingLink.set('view', 'overview'); reportingLink.delete('case');
  return <AppLayout><main className="mx-auto w-full min-w-0 max-w-[1600px] space-y-6 px-4 py-5 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight">Refund reports</h1><p className="mt-1 text-sm text-muted-foreground">Requests, resolutions and outstanding recovery.</p></div>
      <div className="flex flex-wrap gap-2">{canUseQueue && <Button variant="outline" asChild className="min-h-11"><Link to="/refunds">Refund queue</Link></Button>}{canUseCentralReporting && <Button variant="outline" asChild className="min-h-11"><Link to={`/portal/reports?${reportingLink}`}>Business overview</Link></Button>}</div>
    </header>
    {access.isPending ? <p role="status">Checking refund reporting access…</p> : access.isError ? <div role="alert" className="space-y-3 rounded-xl border p-4"><p>Refund reporting access could not be verified.</p><Button variant="outline" onClick={() => void access.refetch()}>Retry access</Button></div> : !allowed ? <p role="alert">Refund reports are not available to your account. A saved link does not grant access.</p> : <>
      <ReportingFilters key={`${state.dateFrom}:${state.dateTo}`} state={state} salesView={false} locations={locations} machines={machines} onChange={update} />
      <p className="text-xs text-muted-foreground">Business dates, inclusive. Reports support up to 367 days.</p>
      {(invalidDates || tooLong) && <p role="alert">Choose valid dates in order, spanning no more than 367 days.</p>}
      {invalidScope && <div role="alert"><p>The linked location or machine is outside your authorized refund reporting scope.</p><Button variant="link" onClick={() => update({ locationId: 'all', machineId: 'all' })}>Choose all authorized locations</Button></div>}
      {!invalidDates && !tooLong && !invalidScope && <RefundAnalyticsPanel showQueueLink={false} scope={{ dateFrom: state.dateFrom, dateTo: state.dateTo,
        locationIds: state.locationId === 'all' ? undefined : [state.locationId], machineIds: state.machineId === 'all' ? undefined : [state.machineId] }}/>} 
    </>}
  </main></AppLayout>;
}
