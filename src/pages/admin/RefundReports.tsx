import { useState } from 'react';
import { companyChange, resolveCompanyScope } from '@/lib/companyReporting';
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
  const [scopeNotice, setScopeNotice] = useState('');
  const access = useQuery({ queryKey: ['reporting-refund-access', user?.id], queryFn: fetchRefundAnalyticsAccess,
    enabled: Boolean(user?.id), staleTime: 60_000, retry: false });
  // A failed recheck must hide cached dimensions and unmount cached report data.
  const allowed = access.isSuccess && access.data?.hasAccess === true;
  const dimensions = allowed ? access.data.dimensions : [];
  const companyScope = resolveCompanyScope(dimensions, state.companyId, state.locationId, state.machineId);
  const companyName = companyScope.companies.find(row => row.id === state.companyId)?.name ?? 'All companies';
  const locations: [string, string][] = [...new Map(companyScope.companyRows.map(item => [item.locationId, item.locationName])).entries()];
  const machines = companyScope.machineRows;
  const invalidScope = companyScope.invalid || companyScope.empty || (state.locationId !== 'all' && !locations.some(([id]) => id === state.locationId))
    || (state.machineId !== 'all' && !machines.some(item => item.machineId === state.machineId));
  const from = params.get('from'); const to = params.get('to');
  const invalidDates = (params.has('from') || params.has('to')) && (!validDate(from) || !validDate(to) || from > to);
  const tooLong = (Date.parse(state.dateTo) - Date.parse(state.dateFrom)) / 86400000 > 366;
  const update = (patch: Partial<WorkspaceState>) => {
    let adjusted = patch.companyId === undefined ? patch : { ...patch, ...companyChange(dimensions, patch.companyId, state.locationId, state.machineId) };
    if (patch.locationId !== undefined && state.machineId !== 'all' && patch.locationId !== 'all' && !companyScope.companyRows.some(row => row.machineId === state.machineId && row.locationId === patch.locationId)) adjusted = { ...adjusted, machineId: 'all' };
    setScopeNotice(adjusted.locationId !== undefined && (adjusted.locationId !== state.locationId || adjusted.machineId !== state.machineId) ? patch.companyId !== undefined ? 'Filters outside this company were cleared.' : 'Machine filter cleared because it is outside this location.' : '');
    const next = writeWorkspaceState({ ...state, ...adjusted }, params); next.set('view', 'reports');
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
      <div className="flex flex-wrap gap-2">{canUseQueue && <Button variant="outline" asChild className="min-h-11"><Link to={`/refunds?${new URLSearchParams([...params].filter(([key]) => !['view', 'case'].includes(key)))}`}>Refund queue</Link></Button>}{canUseCentralReporting && <Button variant="outline" asChild className="min-h-11"><Link to={`/portal/reports?${reportingLink}`}>Business overview</Link></Button>}</div>
    </header>
    {access.isPending ? <p role="status">Loading refund reports…</p> : access.isError ? <div role="alert" className="space-y-3 rounded-xl border p-4"><p>Refund reports could not load. Try again to refresh.</p><Button variant="outline" className="min-h-11" onClick={() => void access.refetch()}>Try again</Button></div> : !allowed ? <p role="alert">Refund reports are not available for your account.</p> : <>
      <ReportingFilters key={`${state.dateFrom}:${state.dateTo}`} state={state} salesView={false} companies={companyScope.companies} locations={locations} machines={machines} onChange={update} />
      {scopeNotice && <p role="status" className="text-sm text-muted-foreground">{scopeNotice}</p>}
      {(invalidDates || tooLong) && <p role="alert">Choose valid dates in order, spanning no more than 367 days.</p>}
      {invalidScope && <div role="alert"><p>This company, location or machine is unavailable, or has no accessible machines. Choose another scope.</p><Button variant="link" className="min-h-11" onClick={() => update({ companyId: 'all', locationId: 'all', machineId: 'all' })}>Choose all companies</Button></div>}
      {!invalidDates && !tooLong && !invalidScope && <RefundAnalyticsPanel showHeading={false} showQueueLink={false} dimensions={dimensions} onCompany={companyId => update({ companyId })} onMachine={(machineId, locationId) => update({ machineId, locationId })} scope={{ companyId: state.companyId, companyName, dateFrom: state.dateFrom, dateTo: state.dateTo,
        locationIds: state.locationId === 'all' ? undefined : [state.locationId], machineIds: state.companyId === 'all' && state.machineId === 'all' ? undefined : companyScope.machineIds }}/>}
    </>}
  </main></AppLayout>;
}
