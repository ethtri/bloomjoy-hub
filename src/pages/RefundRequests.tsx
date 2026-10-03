import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, ReceiptText, RefreshCw } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRefundRequests } from '@/hooks/useRefundRequests';
import { validRefundRequestPeriod, validRefundRequestId, refundRequestIssueLabel, type RefundRequest } from '@/lib/refundRequests';

const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const defaultPeriod = () => { const to = new Date(); const from = new Date(to); from.setDate(from.getDate() - 6); return { from: day(from), to: day(to) }; };
const money = (request: RefundRequest) => request.requestedAmountCents === null ? 'Unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(request.requestedAmountCents / 100);
const date = (value: string | null, timezone: string) => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value)) : 'Not provided';

export function RefundRequestDetail({ request }: { request: RefundRequest }) {
  return <div className="space-y-5 p-4 sm:p-5" data-testid="refund-request-detail">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold">Request {request.publicReference}</h2><p className="mt-1 text-sm text-muted-foreground">{request.machineLabel}{request.locationName ? ` · ${request.locationName}` : ''}</p></div><span className="rounded-md bg-muted px-2.5 py-1 text-sm">{request.statusLabel}</span></div>
    <dl className="grid grid-cols-1 gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Reported issue</dt><dd className="mt-1 font-medium">{refundRequestIssueLabel(request.issueCategory)}</dd></div>
      <div><dt className="text-muted-foreground">Requested</dt><dd className="mt-1 font-medium tabular-nums">{money(request)}</dd></div>
      <div><dt className="text-muted-foreground">Received</dt><dd className="mt-1">{date(request.receivedAt, request.timezone)}</dd></div>
      <div><dt className="text-muted-foreground">Incident time</dt><dd className="mt-1">{date(request.incidentAt, request.timezone)}</dd></div>
    </dl>
    <div><h3 className="text-sm font-medium">Customer’s description</h3><p className="mt-2 max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{request.comment || 'No additional description provided.'}</p>{request.commentTruncated && <p className="mt-1 text-xs text-muted-foreground">Comment shortened.</p>}</div>
    {request.outcomeLabel && <p className="text-sm"><span className="text-muted-foreground">Refund outcome: </span>{request.outcomeLabel}</p>}
    <p className="text-xs text-muted-foreground">Times shown in {request.timezone}. A completed refund does not mean the machine has been repaired.</p>
    {request.canOpenManagerWorkspace && <Button asChild variant="outline" className="min-h-11"><Link to={`/refunds?view=manage&case=${encodeURIComponent(request.caseId)}`}>Open manager workspace</Link></Button>}
  </div>;
}

export default function RefundRequests() {
  const [params, setParams] = useSearchParams();
  const defaults = defaultPeriod();
  const from = params.get('from') ?? defaults.from; const to = params.get('to') ?? defaults.to;
  const machineId = params.get('machine') ?? ''; const caseId = params.get('case');
  const parsedOffset = Number(params.get('offset'));
  const offset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
  const valid = validRefundRequestPeriod(from, to);
  const state = useRefundRequests({ from, to, machineId, offset }, caseId, valid);
  const change = (values: Record<string, string | null>) => setParams(previous => { const next = new URLSearchParams(previous); next.set('view', 'requests'); for (const [key, value] of Object.entries(values)) { if (value === null) next.delete(key); else next.set(key, value); } return next; });
  const busy = state.access.isPending || (state.verified && valid && state.machineAllowed && state.list.isPending);
  const detailHeading = useRef<HTMLSpanElement>(null);
  const loadedCaseId = state.request?.caseId;
  useEffect(() => { if (loadedCaseId) detailHeading.current?.focus(); }, [loadedCaseId]);
  const noAccess = state.access.isSuccess && !state.access.data.hasAccess;
  const rows = state.requests;
  const canManage = state.access.data?.machines.some(machine => machine.canOpenManagerWorkspace) === true;
  return <AppLayout><section className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">Refunds</h1><p className="mt-1 text-sm text-muted-foreground">Customer requests for your machines.</p></div><div className="flex flex-wrap gap-2">{state.verified && canManage && <Button asChild variant="outline" className="min-h-11"><Link to="/refunds">Manager queue</Link></Button>}<Button variant="outline" className="min-h-11" onClick={state.refresh} disabled={busy || state.access.isFetching}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true"/>Refresh</Button></div></header>
    <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"><div className="col-span-2 min-w-0 sm:col-span-1"><Label htmlFor="refund-request-machine">Machine</Label><select id="refund-request-machine" className="mt-1 flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={machineId} onChange={event => change({ machine: event.target.value || null, offset: null, case: null })}><option value="">All assigned machines</option>{!state.access.isError && state.access.data?.hasAccess && state.access.data.machines.map(machine => <option key={machine.machineId} value={machine.machineId}>{machine.machineLabel}{machine.locationName ? ` · ${machine.locationName}` : ''}</option>)}</select></div><div className="min-w-0"><Label htmlFor="refund-request-from">Received from</Label><Input id="refund-request-from" className="mt-1 min-h-11 min-w-0 px-2 text-xs sm:px-3 sm:text-sm" type="date" value={from} onChange={event => change({ from: event.target.value, offset: null, case: null })}/></div><div className="min-w-0"><Label htmlFor="refund-request-to">Through</Label><Input id="refund-request-to" className="mt-1 min-h-11 min-w-0 px-2 text-xs sm:px-3 sm:text-sm" type="date" value={to} onChange={event => change({ to: event.target.value, offset: null, case: null })}/></div></div>
    {!valid && <p role="alert" className="text-sm text-destructive">Choose a valid date range of up to one year.</p>}
    {state.protectedError ? <div role="alert" className="rounded-lg border p-6"><h2 className="font-medium">Requests couldn’t be loaded</h2><p className="mt-2 text-sm text-muted-foreground">We couldn’t verify current access. Request details are hidden. Try refreshing.</p></div> : noAccess ? <div className="rounded-lg border p-6"><h2 className="font-medium">No assigned machines</h2><p className="mt-2 text-sm text-muted-foreground">Refund requests appear when you have an active machine assignment. Ask your manager to check your access.</p></div> : !state.machineAllowed && state.verified ? <p role="alert" className="rounded-lg border p-6 text-sm">This machine is no longer available. Choose an assigned machine.</p> : <>
      {caseId && <section aria-label="Selected request" className="overflow-hidden rounded-lg border bg-card"><div className="flex items-center justify-between border-b px-4 py-2"><span ref={detailHeading} tabIndex={-1} className="text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Selected request</span><Button variant="ghost" className="min-h-11" onClick={() => change({ case: null })}>Close details</Button></div>{state.request ? <RefundRequestDetail request={state.request}/> : (validRefundRequestId(caseId) && (state.detail.isFetching || state.access.isFetching || state.detail.isPending)) ? <p role="status" className="p-5 text-sm text-muted-foreground">Checking request access…</p> : <p className="p-5 text-sm">This request is no longer available or isn’t part of your current machine assignments.</p>}</section>}
      {busy ? <div role="status" className="space-y-3 py-4"><p className="text-sm text-muted-foreground">Checking your machines and requests…</p>{[1,2,3].map(item => <div key={item} className="h-16 rounded bg-muted"/>)}</div> : state.verified && valid && rows.length === 0 ? <div className="rounded-lg border border-dashed py-12 text-center"><ReceiptText className="mx-auto mb-3 h-6 w-6 text-muted-foreground" aria-hidden="true"/><h2 className="font-medium">No requests in this period</h2><p className="mt-2 text-sm text-muted-foreground">Try another date range or machine. Completed refunds are included.</p></div> : <div className="overflow-hidden rounded-lg border bg-card"><div className="hidden grid-cols-[1.2fr_1.6fr_1.5fr_.7fr_1.2fr_2rem] gap-4 border-b bg-muted/40 px-4 py-3 text-xs font-medium text-muted-foreground lg:grid"><span>Received</span><span>Machine / location</span><span>Reported issue</span><span className="text-right">Requested</span><span>Refund status</span><span/></div><ul className="divide-y">{rows.map(request => <li key={request.caseId}><button type="button" aria-expanded={caseId === request.caseId} className="grid w-full grid-cols-[1fr_auto] items-center gap-3 p-4 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:grid-cols-[1.2fr_1.6fr_1.5fr_.7fr_1.2fr_2rem] lg:gap-4" onClick={() => change({ case: caseId === request.caseId ? null : request.caseId })} aria-label={`View request ${request.publicReference} for ${request.machineLabel}`}><span className="text-xs text-muted-foreground lg:text-sm">{date(request.receivedAt, request.timezone)}</span><span className="col-start-1 row-start-2 min-w-0 text-sm lg:col-auto lg:row-auto"><span className="block break-words font-medium">{request.machineLabel}</span><span className="block break-words text-xs text-muted-foreground">{request.locationName}</span></span><span className="col-start-1 text-sm lg:col-auto">{refundRequestIssueLabel(request.issueCategory)}</span><span className="col-start-2 row-start-2 text-right text-sm font-medium tabular-nums lg:col-auto lg:row-auto">{money(request)}</span><span className="col-start-1 text-xs text-muted-foreground lg:col-auto">{request.statusLabel}</span><span className="col-start-2 row-start-1 justify-self-end lg:col-auto lg:row-auto">{caseId === request.caseId ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}</span></button></li>)}</ul></div>}
      {state.verified && !busy && !state.protectedError && (offset > 0 || state.list.data?.hasMore) && <nav aria-label="Request pages" className="flex items-center justify-between gap-4"><Button variant="outline" className="min-h-11" disabled={offset === 0} onClick={() => change({ offset: String(Math.max(0, offset - 50)), case: null })}>Previous</Button><span className="text-sm text-muted-foreground">Page {Math.floor(offset / 50) + 1}</span><Button variant="outline" className="min-h-11" disabled={!state.list.data?.hasMore} onClick={() => change({ offset: String(offset + 50), case: null })}>Next</Button></nav>}
    </>}
  </section></AppLayout>;
}
