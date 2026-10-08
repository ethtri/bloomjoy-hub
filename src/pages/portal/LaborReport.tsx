import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { LaborAnalyticsPanel } from '@/components/portal/reports/LaborAnalyticsPanel';
import { ReportingFilters } from '@/components/portal/reports/ReportingFilters';
import { fetchLaborAnalyticsAccess } from '@/lib/laborAnalytics';
import { laborReportSelectionError } from '@/lib/laborReportSelection';
import { readWorkspaceState, writeWorkspaceState, type WorkspaceState } from '@/lib/reportingWorkspace';

export function TimekeepingReportNavigation({ reports = false }: { reports?: boolean }) {
  const { user, isSuperAdmin, adminAccess } = useAuth();
  const access = useQuery({ queryKey: ['reporting-labor-access', user?.id], queryFn: fetchLaborAnalyticsAccess, enabled: Boolean(user?.id), staleTime: 60000, retry: false });
  const canReview = isSuperAdmin || adminAccess.allowedSurfaces.includes('*') || adminAccess.allowedSurfaces.includes('payouts') || user?.capabilities.includes('timekeeping.review');
  const [params] = useSearchParams();
  const reportParams = new URLSearchParams(params); reportParams.set('view', 'reports');
  const workParams = new URLSearchParams(params); workParams.delete('view');
  if (reports && !canReview) return null;
  return <nav aria-label="Timekeeping views" className="flex flex-wrap gap-2">
    {canReview && <Button variant={reports ? 'outline' : 'secondary'} className="min-h-11" asChild><Link to={`/portal/time-review?${workParams}`} aria-current={!reports ? 'page' : undefined}>Time review</Link></Button>}
    {access.isSuccess && (access.data.hasAccess || access.data.canViewPay) && <Button variant={reports ? 'secondary' : 'outline'} className="min-h-11" asChild><Link to={`/portal/time-review?${reportParams}`} aria-current={reports ? 'page' : undefined}>Reports</Link></Button>}
  </nav>;
}

export default function LaborReportPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const state = readWorkspaceState(params);
  const access = useQuery({ queryKey: ['reporting-labor-access', user?.id], queryFn: fetchLaborAnalyticsAccess, enabled: Boolean(user?.id), staleTime: 60000, retry: false });
  const authorized = access.isSuccess && (access.data.hasAccess || access.data.canViewPay);
  const choices = access.data?.dimensions ?? [];
  const locations: [string, string][] = [...new Map(choices.map(item => [item.locationId, item.locationName])).entries()];
  const machines = choices.filter(item => state.locationId === 'all' || item.locationId === state.locationId);
  const selectionError = laborReportSelectionError(params, state, choices);
  const change = (patch: Partial<WorkspaceState>) => {
    const next = writeWorkspaceState({ ...state, ...patch }, params);
    // Scope edits cannot silently repair a malformed date link. Only a date action replaces it.
    if (patch.dateFrom === undefined && patch.dateTo === undefined) {
      for (const key of ['from', 'to']) {
        if (params.has(key)) next.set(key, params.get(key)!);
        else next.delete(key);
      }
    }
    next.set('view', 'reports'); setParams(next);
  };
  return <PortalLayout><section className="portal-section"><div className="container-page min-w-0 space-y-5">
    <header><h1 className="text-2xl font-semibold tracking-tight">Timekeeping reports</h1><p className="mt-1 text-sm text-muted-foreground">Recorded hours and paid shifts by location and machine.</p></header>
    <TimekeepingReportNavigation reports />
    {access.isPending || access.isFetching ? <p role="status" className="py-8 text-muted-foreground">Loading timekeeping reports…</p> : access.isError ? <div role="alert"><p>Timekeeping reports could not load. Try again to refresh.</p><Button variant="outline" className="mt-3 min-h-11" onClick={() => void access.refetch()}>Try again</Button></div> : !authorized ? <p>Timekeeping reports are not available for your account.</p> : <>
      <ReportingFilters state={state} salesView={false} locations={locations} machines={machines} onChange={change} />
      {selectionError === 'dates' ? <p role="alert">Choose a valid date range of up to 367 days to load timekeeping reports.</p> : selectionError === 'scope' ? <p role="alert">This location or machine is not available in your reports. Choose another location or machine above.</p> : <LaborAnalyticsPanel key={user?.id} dimensions={choices} showHeading={false} scope={{ dateFrom: state.dateFrom, dateTo: state.dateTo, ...(state.locationId !== 'all' ? { locationIds: [state.locationId] } : {}), ...(state.machineId !== 'all' ? { machineIds: [state.machineId] } : {}) }} />}
    </>}
  </div></section></PortalLayout>;
}
