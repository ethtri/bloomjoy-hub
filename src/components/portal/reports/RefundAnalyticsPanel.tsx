import { toast } from 'sonner';
import { assertCompanyExportScope, companyBasis, groupCompanyRows, type CompanyDimension } from '@/lib/companyReporting';
import { CompanySummary } from './CompanySummary';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Download, ArrowUpRight, RotateCcw, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { fetchRefundAnalyticsAccess, fetchRefundAnalytics, refundAnalyticsCsv, type RefundAnalyticsScope } from '@/lib/refundAnalytics';

const money = (cents: number | null) => cents === null ? 'Unavailable'
  : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const categoryLabel = (value: string) => value.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <div className="min-w-0 rounded-xl border border-border/70 bg-background p-4">
    <p className="text-sm text-muted-foreground">{label}</p>
    <p className="mt-2 break-words text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
  </div>;
}

export function RefundAnalyticsPanel({ scope, showQueueLink = true, showHeading = true, dimensions = [], onCompany, onMachine }: { dimensions?: CompanyDimension[]; onCompany?: (id: string) => void; onMachine?: (machineId: string, locationId: string) => void; scope: RefundAnalyticsScope; showQueueLink?: boolean; showHeading?: boolean }) {
  const SectionHeading = showHeading ? 'h3' : 'h2';
  const MachineHeading = showHeading ? 'h4' : 'h3';
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['refund-analytics', user?.id, scope.dateFrom, scope.dateTo,
      [...(scope.machineIds ?? [])].sort(), [...(scope.locationIds ?? [])].sort(), scope.companyId ?? 'all'],
    queryFn: () => fetchRefundAnalytics(scope), enabled: Boolean(user), staleTime: 60_000,
  });
  if (query.isPending) return <div className="rounded-xl border p-6" role="status">Loading refund analytics…</div>;
  if (query.isError) return <div className="rounded-xl border p-6" role="alert">
    <p className="font-medium">Refund report could not load</p>
    <p className="mt-2 text-sm text-muted-foreground">Try again to refresh this report.</p>
    <Button variant="outline" className="mt-4 min-h-11" onClick={() => query.refetch()}><RotateCcw className="mr-2 h-4 w-4" />Try again</Button>
  </div>;
  const report = query.data;
  const accountingUnavailable = report.period.requestDeductionExTaxCents === null
    || report.period.reversalExTaxCents === null || report.period.legacyPaidDeductionExTaxCents === null;
  const coverage = [
    report.cohort.unknownAmountCount > 0 && `${report.cohort.unknownAmountCount} request amounts in this period unknown`,
    report.asOf.unknownBalanceCount > 0 && `${report.asOf.unknownBalanceCount} balances across all requests unknown`,
    report.coverage.unknownRequestDateCount > 0 && `${report.coverage.unknownRequestDateCount} received dates unknown`,
    report.coverage.unknownPaymentDateCount > 0 && `${report.coverage.unknownPaymentDateCount} recorded payment dates unknown`,
    report.period.unresolvedAccountingCount > 0 && `${report.period.unresolvedAccountingCount} accounting components unresolved`,
  ].filter(Boolean);
  const exportCsv = async () => {
    try {
    const access = await fetchRefundAnalyticsAccess(); if (!access.hasAccess) throw new Error('Refund report access is unavailable.');
    const current = assertCompanyExportScope(access.dimensions, scope.companyId ?? 'all', report.machines, scope.locationIds?.[0] ?? 'all', scope.machineIds?.length === 1 ? scope.machineIds[0] : 'all');
    const blob = new Blob([refundAnalyticsCsv(report, { ...scope, companyName: current.companies.find(row => row.id === scope.companyId)?.name ?? 'All companies' }, access.dimensions)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `refund-analytics-${scope.dateFrom}-${scope.dateTo}.csv`; anchor.click();
    URL.revokeObjectURL(url);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to export this report.'); }
  };
  return <section className="space-y-6" aria-label="Refunds and recovery analytics">
    <div className="flex flex-wrap items-start justify-between gap-3">
      {showHeading && <h2 className="text-xl font-semibold tracking-tight">Refunds & recovery</h2>}
      <Button variant="outline" className="min-h-11" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
    </div>
    {scope.companyId !== 'all' && <p className="text-xs text-muted-foreground">{companyBasis}</p>}
    {scope.companyId === 'all' && onCompany && <CompanySummary onCompany={onCompany} rows={groupCompanyRows(report.machines, dimensions).map(group => ({ id: group.id, name: group.name, detail: `${group.rows.reduce((sum, row) => sum + row.requestCount, 0)} recorded requests in period`, value: `Known outstanding ${money(group.rows.reduce((sum, row) => sum + row.outstandingCents, 0))}`, note: `${group.rows.reduce((sum, row) => sum + row.unknownAmountCount, 0)} unknown request amounts; ${group.rows.reduce((sum, row) => sum + row.unknownBalanceCount, 0)} unknown balances` }))}/>}
    {coverage.length > 0 && <p className="text-sm text-muted-foreground">Known amounts shown; some records are incomplete. See report details below.</p>}
    <div>
      <SectionHeading className="mb-3 text-sm font-semibold">Requests received in this period</SectionHeading>
      {report.coverage.unknownRequestDateCount > 0 && <p className="mb-3 text-xs text-muted-foreground">{report.coverage.unknownRequestDateCount} received dates unknown; these requests cannot be assigned to a period.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Unique requests" value={report.cohort.requestCount} detail="Duplicates counted once. Requests do not confirm a failed purchase." />
        <Metric label="Requested purchase value" value={money(report.cohort.requestedCents)} detail={`Purchase amounts when requests were received.${report.cohort.unknownAmountCount > 0 ? ` ${report.cohort.unknownAmountCount} unknown amounts excluded.` : ''}`} />
        <Metric label="Resolved by period end" value={money(report.cohort.resolvedCashCents + report.cohort.resolvedGiftPurchaseCents)} detail={`${money(report.cohort.resolvedCashCents)} recorded money refunds; ${money(report.cohort.resolvedGiftPurchaseCents)} purchase value resolved by gifts.`} />
        <Metric label="Outstanding from these requests" value={money(report.cohort.outstandingCents)} detail="Known remaining purchase value at period end, for requests received in this period." />
      </div>
    </div>
    <div>
      <SectionHeading className="mb-3 text-sm font-semibold">Activity recorded in this period</SectionHeading>
      {report.period.unresolvedAccountingCount > 0 && <p className="mb-3 text-xs text-muted-foreground">{report.period.unresolvedAccountingCount} accounting components unresolved; {accountingUnavailable ? 'accounting totals unavailable.' : 'known accounting totals shown.'}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Recorded money refunds" value={money(report.period.cashPaidCents)} detail={`Cash/card payments by recorded date, not confirmed bank settlement.${report.coverage.unknownPaymentDateCount > 0 ? ` ${report.coverage.unknownPaymentDateCount} recorded payment dates unknown.` : ''}`} />
        <Metric label="Purchase resolved by gifts" value={money(report.period.giftPurchaseCents)} detail={`${money(report.period.giftFaceCents)} gift face value; ${money(report.period.goodwillCents)} Bloomjoy goodwill. Issuance is not cash paid or redemption.`} />
        <Metric label="Request deductions" value={money(report.period.requestDeductionExTaxCents)} detail="Sales deductions excluding tax, recorded when requests or amounts change. Later payments do not deduct again." />
        <Metric label="Reversals" value={money(report.period.reversalExTaxCents)} detail="Sales deductions reversed in this period, excluding tax." />
      </div>
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border p-4 sm:p-5">
        <SectionHeading className="font-semibold">Outstanding across all requests</SectionHeading>
        <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{money(report.asOf.outstandingCents)}</p>
        <p className="mt-1 text-sm text-muted-foreground">At period end: {report.asOf.openRequestCount} known balances{report.asOf.unknownBalanceCount > 0 && ` · ${report.asOf.unknownBalanceCount} unknown balances excluded`}</p>
        <div className="mt-5 space-y-3">{report.aging.map(row => <div key={row.band} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{row.band} <span className="text-muted-foreground">({row.requestCount})</span></span>
          <span className="tabular-nums">{money(row.outstandingCents)}{row.unknownBalanceCount > 0 && ` · ${row.unknownBalanceCount} unknown`}</span>
        </div>)}{report.aging.length === 0 && <p className="text-sm text-muted-foreground">No outstanding requests in the available history.</p>}</div>
        <p className="mt-4 text-xs text-muted-foreground">Age is measured from the received business date.</p>
      </div>
      <div className="rounded-xl border p-4 sm:p-5">
        <SectionHeading className="font-semibold">Reported issue categories</SectionHeading>
        <p className="mt-1 text-sm text-muted-foreground">Requests received in this period; customer-reported categories.</p>
        <div className="mt-5 space-y-4">{report.categories.map(row => <div key={row.category}>
          <div className="flex flex-wrap justify-between gap-2 text-sm"><span>{categoryLabel(row.category)}</span><span className="tabular-nums">{row.requestCount} requests · {money(row.requestedCents)}</span></div>
          <div className="mt-2 h-1.5 rounded-full bg-muted" aria-hidden="true"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, report.cohort.requestCount ? row.requestCount / report.cohort.requestCount * 100 : 0))}%` }} /></div>
          {row.unknownAmountCount > 0 && <p className="mt-1 text-xs text-muted-foreground">{row.unknownAmountCount} unknown amounts</p>}
        </div>)}{report.categories.length === 0 && <p className="text-sm text-muted-foreground">No requests received in the selected period.</p>}</div>
      </div>
    </div>
    <div className="rounded-xl border p-4 sm:p-5">
      <div className="flex flex-wrap justify-between gap-2"><SectionHeading className="font-semibold">Machine patterns</SectionHeading>{showQueueLink && <Link className="inline-flex min-h-11 items-center gap-1 text-sm text-primary underline-offset-4 hover:underline" to={scope.companyId && scope.companyId !== 'all' ? `/refunds?company=${encodeURIComponent(scope.companyId)}` : '/refunds'}>Open authorized refund queue <ArrowUpRight className="h-4 w-4" /></Link>}</div>
      <div className="mt-4 divide-y sm:hidden">{report.machines.map(row => <article key={`${row.machineId}:${row.locationId}`} className="min-w-0 space-y-3 py-4">
        <div><MachineHeading className="break-words text-sm font-medium">{onMachine ? <Button variant="link" className="h-auto min-h-11 max-w-full whitespace-normal break-words px-0 text-left" onClick={() => onMachine(row.machineId, row.locationId)}>{row.machineLabel}</Button> : row.machineLabel}</MachineHeading></div>
        <dl className="space-y-2 text-sm"><div className="flex flex-wrap justify-between gap-2"><dt>Requests</dt><dd className="tabular-nums">{row.requestCount}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt>Requested</dt><dd className="tabular-nums">{money(row.requestedCents)}{row.unknownAmountCount > 0 && <span className="block text-xs text-muted-foreground">{row.unknownAmountCount} unknown</span>}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt>Outstanding</dt><dd className="tabular-nums">{money(row.outstandingCents)}{row.unknownBalanceCount > 0 && <span className="block text-xs text-muted-foreground">{row.unknownBalanceCount} unknown</span>}</dd></div>
        </dl>
      </article>)}</div>
      <div className="mt-4 hidden sm:block"><table className="w-full text-left text-sm">
        <caption className="sr-only">Machine request cohort and known as-of outstanding balances</caption>
        <thead><tr className="border-b text-muted-foreground"><th scope="col" className="pb-3 pr-4 font-medium">Machine / location</th><th scope="col" className="pb-3 pr-4 font-medium">Requests</th><th scope="col" className="pb-3 pr-4 font-medium">Requested</th><th scope="col" className="pb-3 font-medium">Outstanding</th></tr></thead>
        <tbody>{report.machines.map(row => <tr key={`${row.machineId}:${row.locationId}`} className="border-b last:border-0">
          <th scope="row" className="py-3 pr-4 font-medium">{onMachine ? <Button variant="link" className="h-auto min-h-11 max-w-full whitespace-normal break-words px-0 text-left" onClick={() => onMachine(row.machineId, row.locationId)}>{row.machineLabel}</Button> : row.machineLabel}</th>
          <td className="py-3 pr-4 tabular-nums">{row.requestCount}</td><td className="py-3 pr-4 tabular-nums">{money(row.requestedCents)}{row.unknownAmountCount > 0 && <span className="block text-xs text-muted-foreground">{row.unknownAmountCount} unknown</span>}</td>
          <td className="py-3 tabular-nums">{money(row.outstandingCents)}{row.unknownBalanceCount > 0 && <span className="block text-xs text-muted-foreground">{row.unknownBalanceCount} unknown</span>}</td>
        </tr>)}</tbody>
      </table></div>{report.machines.length === 0 && <p className="py-4 text-sm text-muted-foreground">No received refund cases for the selected authorized scope.</p>}
    </div>
    <details className="group rounded-lg border px-4 text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Report details<ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 group-open:rotate-180" /></summary>
      <div className="space-y-3 pb-4 text-muted-foreground">
        <p>Requests use machine-local received dates, including both period endpoints. Payments and accounting use their own recorded dates. Balances are measured at the end of the selected period.</p>
        <p>Payments and gifts explain how purchases were resolved; they are not another sales deduction. API confirmation does not establish bank settlement or gift redemption.</p>
        <p>Missing amounts and history are excluded from known totals, never treated as zero. Age bands do not set a service deadline.</p>
        <p className="text-xs text-muted-foreground">{companyBasis}</p>
        {coverage.length > 0 && <p>Incomplete records: {coverage.join(' · ')}.</p>}
        <p>{money(report.period.legacyPaidDeductionExTaxCents)} in historical payment-based deductions is shown separately in CSV. Historical accounting rules are preserved.</p>
        <p>{report.machineCount} {report.machineCount === 1 ? 'machine' : 'machines'} in this report. Periods support up to 367 days.</p>
        <p>Generated {new Date(report.generatedAt).toLocaleString()}</p>
      </div>
    </details>
  </section>;
}
