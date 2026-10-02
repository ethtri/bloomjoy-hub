import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Download, ArrowUpRight, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { fetchRefundAnalytics, refundAnalyticsCsv, type RefundAnalyticsScope } from '@/lib/refundAnalytics';

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const categoryLabel = (value: string) => value.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <div className="min-w-0 rounded-xl border border-border/70 bg-background p-4">
    <p className="text-sm text-muted-foreground">{label}</p>
    <p className="mt-2 break-words text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
  </div>;
}

export function RefundAnalyticsPanel({ scope }: { scope: RefundAnalyticsScope }) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['refund-analytics', user?.id, scope.dateFrom, scope.dateTo,
      [...(scope.machineIds ?? [])].sort(), [...(scope.locationIds ?? [])].sort()],
    queryFn: () => fetchRefundAnalytics(scope), enabled: Boolean(user), staleTime: 60_000,
  });
  if (query.isPending) return <div className="rounded-xl border p-6" role="status">Loading refund analytics…</div>;
  if (query.isError) return <div className="rounded-xl border p-6" role="alert">
    <p className="font-medium">Refund analytics are unavailable</p>
    <p className="mt-2 text-sm text-muted-foreground">{query.error instanceof Error ? query.error.message : 'The report could not be loaded. Your refund manager access may have changed.'}</p>
    <Button variant="outline" className="mt-4" onClick={() => query.refetch()}><RotateCcw className="mr-2 h-4 w-4" />Retry</Button>
  </div>;
  const report = query.data;
  const exportCsv = () => {
    const blob = new Blob([refundAnalyticsCsv(report, scope)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `refund-analytics-${scope.dateFrom}-${scope.dateTo}.csv`; anchor.click();
    URL.revokeObjectURL(url);
  };
  return <section className="space-y-6" aria-label="Refunds and recovery analytics">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-semibold tracking-tight">Refunds & recovery</h2>
        <p className="mt-1 text-sm text-muted-foreground">{scope.dateFrom} through {scope.dateTo} · {report.machineCount} authorized machines</p>
      </div>
      <Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
    </div>
    <div className="rounded-xl bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground">
      Requests use machine-local received dates. Payments and accounting use their own recorded dates.
      Balances are as of {scope.dateTo}. Cash paid and gifts explain recovery; they are not another sales deduction.
      Missing history or amounts are omitted from known totals.
      {(report.coverage.unknownRequestDateCount + report.coverage.unknownPaymentDateCount + report.asOf.unknownBalanceCount + report.cohort.unknownAmountCount + report.period.unresolvedAccountingCount > 0) &&
        <p className="mt-2 font-medium text-foreground">Coverage: {report.cohort.unknownAmountCount} cohort amounts unknown · {report.asOf.unknownBalanceCount} balances unknown · {report.coverage.unknownRequestDateCount} received dates unknown · {report.coverage.unknownPaymentDateCount} payment settlement dates unknown · {report.period.unresolvedAccountingCount} accounting components unresolved.</p>}
    </div>
    <div>
      <h3 className="mb-3 text-sm font-semibold">Requests received in this period</h3>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Unique requests" value={report.cohort.requestCount} detail="Confirmed duplicate lineage counted once. A request is not a confirmed failed vend." />
        <Metric label="Requested purchase value" value={money(report.cohort.requestedCents)} detail={`Original received-event amounts; ${report.cohort.unknownAmountCount} unknown amounts omitted.`} />
        <Metric label="Resolved by period end" value={money(report.cohort.resolvedCashCents + report.cohort.resolvedGiftPurchaseCents)} detail={`${money(report.cohort.resolvedCashCents)} recorded money refunds; ${money(report.cohort.resolvedGiftPurchaseCents)} purchase value resolved by gifts.`} />
        <Metric label="Cohort outstanding" value={money(report.cohort.outstandingCents)} detail="Known remaining purchase value for this request cohort at period end." />
      </div>
    </div>
    <div>
      <h3 className="mb-3 text-sm font-semibold">Activity booked in this period</h3>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Recorded money refunds" value={money(report.period.cashPaidCents)} detail="Case-linked cash/card payments on recorded adjustment dates. Bank settlement is not established." />
        <Metric label="Purchase resolved by gifts" value={money(report.period.giftPurchaseCents)} detail={`${money(report.period.giftFaceCents)} gift face value; ${money(report.period.goodwillCents)} Bloomjoy goodwill. Issuance is not cash paid or redemption.`} />
        <Metric label="Request deductions" value={money(report.period.requestDeductionExTaxCents)} detail="Canonical tax-exclusive request/change-period deduction. Later payments do not deduct again." />
        <Metric label="Reversals" value={money(report.period.reversalExTaxCents)} detail={`${money(report.period.legacyPaidDeductionExTaxCents)} legacy paid deductions shown separately in CSV; historical accounting rules preserved.`} />
      </div>
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border p-4 sm:p-5">
        <h3 className="font-semibold">Outstanding at period end</h3>
        <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{money(report.asOf.outstandingCents)}</p>
        <p className="mt-1 text-sm text-muted-foreground">{report.asOf.openRequestCount} known balances · {report.asOf.unknownBalanceCount} unknown balances across all received cohorts</p>
        <div className="mt-5 space-y-3">{report.aging.map(row => <div key={row.band} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{row.band} <span className="text-muted-foreground">({row.requestCount})</span></span>
          <span className="tabular-nums">{money(row.outstandingCents)}{row.unknownBalanceCount > 0 && ` · ${row.unknownBalanceCount} unknown`}</span>
        </div>)}{report.aging.length === 0 && <p className="text-sm text-muted-foreground">No outstanding requests in the available history.</p>}</div>
        <p className="mt-4 text-xs text-muted-foreground">Aging uses received business dates, not an exact hourly clock or a new service deadline.</p>
      </div>
      <div className="rounded-xl border p-4 sm:p-5">
        <h3 className="font-semibold">Reported issue categories</h3>
        <p className="mt-1 text-sm text-muted-foreground">Requests received in this period; customer-reported categories.</p>
        <div className="mt-5 space-y-4">{report.categories.map(row => <div key={row.category}>
          <div className="flex flex-wrap justify-between gap-2 text-sm"><span>{categoryLabel(row.category)}</span><span className="tabular-nums">{row.requestCount} requests · {money(row.requestedCents)}</span></div>
          <div className="mt-2 h-1.5 rounded-full bg-muted" aria-hidden="true"><div className="h-full rounded-full bg-primary" style={{ width: `${report.cohort.requestCount ? row.requestCount / report.cohort.requestCount * 100 : 0}%` }} /></div>
          {row.unknownAmountCount > 0 && <p className="mt-1 text-xs text-muted-foreground">{row.unknownAmountCount} unknown amounts</p>}
        </div>)}{report.categories.length === 0 && <p className="text-sm text-muted-foreground">No requests received in the selected period.</p>}</div>
      </div>
    </div>
    <div className="rounded-xl border p-4 sm:p-5">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Machine patterns</h3><Link className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline" to="/portal/refunds">Open authorized refund queue <ArrowUpRight className="h-4 w-4" /></Link></div>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm">
        <caption className="sr-only">Machine request cohort and known as-of outstanding balances</caption>
        <thead><tr className="border-b text-muted-foreground"><th scope="col" className="pb-3 pr-4 font-medium">Machine / location</th><th scope="col" className="pb-3 pr-4 font-medium">Requests</th><th scope="col" className="pb-3 pr-4 font-medium">Requested</th><th scope="col" className="pb-3 font-medium">Outstanding</th></tr></thead>
        <tbody>{report.machines.map(row => <tr key={row.machineId} className="border-b last:border-0">
          <th scope="row" className="py-3 pr-4 font-medium">{row.machineLabel}<span className="block text-xs font-normal text-muted-foreground">{row.locationName}</span></th>
          <td className="py-3 pr-4 tabular-nums">{row.requestCount}</td><td className="py-3 pr-4 tabular-nums">{money(row.requestedCents)}{row.unknownAmountCount > 0 && <span className="block text-xs text-muted-foreground">{row.unknownAmountCount} unknown</span>}</td>
          <td className="py-3 tabular-nums">{money(row.outstandingCents)}{row.unknownBalanceCount > 0 && <span className="block text-xs text-muted-foreground">{row.unknownBalanceCount} unknown</span>}</td>
        </tr>)}</tbody>
      </table>{report.machines.length === 0 && <p className="py-4 text-sm text-muted-foreground">No received refund cases for the selected authorized scope.</p>}</div>
    </div>
    <p className="text-xs text-muted-foreground">{report.calculationVersion} · Generated {new Date(report.generatedAt).toLocaleString()} · Existing refund pages recheck access. API confirmation does not establish bank settlement or gift redemption.</p>
  </section>;
}
