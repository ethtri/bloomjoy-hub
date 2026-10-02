import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { RefundAnalyticsPanel } from '@/components/portal/reports/RefundAnalyticsPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/auth-context';
import { fetchRefundAnalyticsAccess } from '@/lib/refundAnalytics';
import { readWorkspaceState, validDate } from '@/lib/reportingWorkspace';

/** Read-only report host. Never mounts the case queue or its payment capabilities. */
export default function RefundReports() {
  const { user, adminAccess, capabilities, isSuperAdmin } = useAuth();
  const canUseQueue = isSuperAdmin || adminAccess.allowedSurfaces.includes('*') || adminAccess.allowedSurfaces.includes('refunds') || capabilities.includes('refunds.manage');
  const [params, setParams] = useSearchParams();
  const state = readWorkspaceState(params);
  const access = useQuery({ queryKey: ['reporting-refund-access', user?.id], queryFn: fetchRefundAnalyticsAccess,
    enabled: Boolean(user?.id), staleTime: 60_000, retry: false });
  // A failed recheck must hide cached dimensions and unmount cached report data.
  const allowed = access.isSuccess && access.data?.hasAccess === true;
  const dimensions = allowed ? access.data.dimensions : [];
  const locations = [...new Map(dimensions.map(item => [item.locationId, item.locationName])).entries()];
  const machines = dimensions.filter(item => state.locationId === 'all' || item.locationId === state.locationId);
  const invalidScope = (state.locationId !== 'all' && !locations.some(([id]) => id === state.locationId))
    || (state.machineId !== 'all' && !machines.some(item => item.machineId === state.machineId));
  const from = params.get('from'); const to = params.get('to');
  const invalidDates = (params.has('from') || params.has('to')) && (!validDate(from) || !validDate(to) || from > to);
  const tooLong = (Date.parse(state.dateTo) - Date.parse(state.dateFrom)) / 86400000 > 366;
  const update = (values: Record<string, string>) => {
    const next = new URLSearchParams(params); next.set('view', 'reports');
    Object.entries(values).forEach(([key, value]) => value === 'all' ? next.delete(key) : next.set(key, value));
    setParams(next);
  };
  const reportingLink = new URLSearchParams(params); reportingLink.set('view', 'overview'); reportingLink.delete('case');
  return <AppLayout><main className="mx-auto w-full min-w-0 max-w-[1600px] space-y-6 px-4 py-5 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight">Refund reports</h1><p className="mt-1 text-sm text-muted-foreground">Requests, resolutions and outstanding recovery.</p></div>
      <div className="flex flex-wrap gap-2">{canUseQueue && <Button variant="outline" asChild className="min-h-11"><Link to="/refunds">Refund queue</Link></Button>}<Button variant="outline" asChild className="min-h-11"><Link to={`/portal/reports?${reportingLink}`}>Business overview</Link></Button></div>
    </header>
    {access.isPending ? <p role="status">Checking refund reporting access…</p> : access.isError ? <div role="alert" className="space-y-3 rounded-xl border p-4"><p>Refund reporting access could not be verified.</p><Button variant="outline" onClick={() => void access.refetch()}>Retry access</Button></div> : !allowed ? <p role="alert">Refund reports are not available to your account. A saved link does not grant access.</p> : <>
      <section aria-label="Refund report filters" className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0 space-y-2"><Label htmlFor="refund-report-from">From</Label><Input id="refund-report-from" type="date" className="min-h-11 min-w-0 max-w-full" value={from ?? state.dateFrom} onChange={event => update({ from: event.target.value, to: to ?? state.dateTo })}/></div>
        <div className="min-w-0 space-y-2"><Label htmlFor="refund-report-to">Through</Label><Input id="refund-report-to" type="date" className="min-h-11 min-w-0 max-w-full" value={to ?? state.dateTo} onChange={event => update({ from: from ?? state.dateFrom, to: event.target.value })}/></div>
        <div className="min-w-0 space-y-2"><Label htmlFor="refund-report-location">Location</Label><Select value={state.locationId} onValueChange={value => update({ location: value, machine: 'all' })}><SelectTrigger id="refund-report-location" className="min-h-11"><SelectValue placeholder="Unavailable location"/></SelectTrigger><SelectContent><SelectItem value="all">All authorized locations</SelectItem>{locations.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent></Select></div>
        <div className="min-w-0 space-y-2"><Label htmlFor="refund-report-machine">Machine</Label><Select value={state.machineId} onValueChange={value => update({ machine: value })}><SelectTrigger id="refund-report-machine" className="min-h-11"><SelectValue placeholder="Unavailable machine"/></SelectTrigger><SelectContent><SelectItem value="all">All authorized machines</SelectItem>{machines.map(item => <SelectItem key={item.machineId} value={item.machineId}>{item.machineLabel}</SelectItem>)}</SelectContent></Select></div>
      </section>
      <p className="text-xs text-muted-foreground">Business dates, inclusive. Reports support up to 367 days.</p>
      {(invalidDates || tooLong) && <p role="alert">Choose valid dates in order, spanning no more than 367 days.</p>}
      {invalidScope && <div role="alert"><p>The linked location or machine is outside your authorized refund reporting scope.</p><Button variant="link" onClick={() => update({ location: 'all', machine: 'all' })}>Choose all authorized locations</Button></div>}
      {!invalidDates && !tooLong && !invalidScope && <RefundAnalyticsPanel showQueueLink={false} scope={{ dateFrom: state.dateFrom, dateTo: state.dateTo,
        locationIds: state.locationId === 'all' ? undefined : [state.locationId], machineIds: state.machineId === 'all' ? undefined : [state.machineId] }}/>} 
    </>}
  </main></AppLayout>;
}
