import { useQuery } from '@tanstack/react-query';
import { Download, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/contexts/auth-context';
import { fetchFinanceReporting, financeReportingCsv, type FinanceReportingRow, type FinanceReportingScope } from '@/lib/financeReporting';
import { money } from '@/lib/reportingWorkspace';

type Props = { scope: FinanceReportingScope; onMachine: (machineId: string, locationId: string) => void };
type MoneyField = { [K in keyof FinanceReportingRow]: FinanceReportingRow[K] extends number | null ? K : never }[keyof FinanceReportingRow];

const total = (rows: FinanceReportingRow[], field: MoneyField) => rows.length && rows.every(row => row[field] != null)
  ? rows.reduce((sum, row) => sum + (row[field] as number), 0) : null;
const refundImpact = (row: FinanceReportingRow) => row.requestedDeductionExTaxCents == null || row.reversalExTaxCents == null || row.legacyPaidDeductionExTaxCents == null
  ? null : row.requestedDeductionExTaxCents - row.reversalExTaxCents + row.legacyPaidDeductionExTaxCents;
const totalImpact = (rows: FinanceReportingRow[]) => rows.length && rows.every(row => refundImpact(row) != null)
  ? rows.reduce((sum, row) => sum + refundImpact(row)!, 0) : null;

function Amount({ value, known }: { value: number | null; known?: number | null }) {
  return <><span className="tabular-nums">{money(value)}</span>{value == null && known != null && <span className="mt-1 block text-xs font-normal text-muted-foreground">Known subtotal {money(known)}</span>}</>;
}

export function ReportingFinance({ scope, onMachine }: Props) {
  const { user } = useAuth();
  const report = useQuery({ queryKey: ['reporting-finance', user?.id, scope], queryFn: () => fetchFinanceReporting(scope), staleTime: 30000 });
  if (report.isPending) return <div aria-label="Loading finance report" className="mt-6 space-y-5"><Skeleton className="h-32"/><Skeleton className="h-64"/></div>;
  if (report.isError) return <Alert variant="destructive" className="mt-6"><AlertTitle>Finance report unavailable</AlertTitle><AlertDescription>Sales and refund records could not be loaded. <Button variant="outline" className="ml-2 min-h-11" onClick={() => void report.refetch()}><RefreshCw className="mr-2 h-4 w-4"/>Retry</Button></AlertDescription></Alert>;
  const rows = report.data.rows;
  const count = (field: keyof FinanceReportingRow['coverage']) => rows.reduce((sum, row) => sum + row.coverage[field], 0);
  const uncertainAccounting = count('unresolvedSalesCount') + count('unresolvedRefundCount');
  const uncertainPayments = count('unknownPaymentDateCount');
  const uncertainBalance = count('unknownBalanceCount');
  const download = () => {
    const blob = new Blob([financeReportingCsv(report.data, scope)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `bloomjoy-finance-${scope.dateFrom}-${scope.dateTo}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const breakdown: { label: string; value: number | null; known?: number | null; note?: string }[] = [
    { label: 'Recorded card sales', value: total(rows, 'cardRecordedSalesCents') },
    { label: 'Recorded cash sales', value: total(rows, 'cashRecordedSalesCents') },
    { label: 'Other recorded sales', value: total(rows, 'otherRecordedSalesCents') },
    { label: 'Reporting tax removed', value: total(rows, 'reportingTaxRemovedCents'), note: 'Tax removed from sales for reporting. This does not establish tax collected or owed.' },
    { label: 'Requested deductions excluding tax', value: total(rows, 'requestedDeductionExTaxCents') },
    { label: 'Refund reversals excluding tax', value: total(rows, 'reversalExTaxCents') },
    { label: 'Older refunds deducted when paid', value: total(rows, 'legacyPaidDeductionExTaxCents'), note: 'Historical requests without a dated request deduction, counted once.' },
    { label: 'Money refunds paid in period', value: uncertainPayments ? null : total(rows, 'moneyPaidCents'), known: uncertainPayments ? total(rows, 'moneyPaidCents') : undefined },
    { label: 'Gift-card purchase value resolved', value: uncertainPayments ? null : total(rows, 'giftPurchaseCents'), known: uncertainPayments ? total(rows, 'giftPurchaseCents') : undefined },
    { label: 'Gift-card face value issued', value: uncertainPayments ? null : total(rows, 'giftFaceCents'), known: uncertainPayments ? total(rows, 'giftFaceCents') : undefined },
    { label: 'Bloomjoy-funded goodwill', value: uncertainPayments ? null : total(rows, 'goodwillCents'), known: uncertainPayments ? total(rows, 'goodwillCents') : undefined, note: 'Shown separately from the purchase deduction.' },
    { label: `Outstanding at ${scope.dateTo}`, value: uncertainBalance ? null : total(rows, 'asOfOutstandingCents'), known: uncertainBalance ? total(rows, 'asOfOutstandingCents') : undefined },
  ];
  return <div className="mt-6 space-y-6" data-reporting-finance>
    <section aria-labelledby="finance-heading">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="finance-heading" className="text-xl font-semibold">Sales to net sales</h2><Button variant="outline" className="min-h-11" onClick={download} disabled={!rows.length || report.isFetching}><Download className="mr-2 h-4 w-4"/>Export CSV</Button></div>
      {!rows.length ? <p className="mt-4 rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">No finance records loaded for this period and scope. Try another period or machine. Missing records do not prove zero sales or refunds.</p> : <>
        <dl className="mt-4 grid gap-5 border-y border-border py-5 sm:grid-cols-3">
          {[{ label: 'Sales excluding tax', value: total(rows, 'salesExTaxCents') }, { label: 'Refund deductions', value: totalImpact(rows) }, { label: 'Net sales', value: total(rows, 'netSalesExTaxCents') }].map(item => <div key={item.label} className="flex items-baseline justify-between gap-3 sm:block"><dt className="text-sm text-muted-foreground">{item.label}</dt><dd className="text-xl font-semibold sm:mt-2 sm:text-2xl"><Amount value={item.value}/></dd></div>)}
        </dl>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">Sales excluding tax, less refund deductions, equals net sales. Refund requests reduce sales when recorded. Reversals restore deductions; later payments and gift cards add no second deduction.</p>
        {uncertainAccounting > 0 && <p role="status" className="mt-3 text-sm text-muted-foreground">Some sales or refund calculations are unresolved. Affected amounts are unavailable.</p>}
      </>}
    </section>
    {rows.length > 0 && <>
      <details className="group border-b border-border pb-4"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Sales, tax and refund breakdown</summary>
        <dl className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-2">{breakdown.map(item => <div key={item.label} className="border-t border-border pt-3"><div className="flex items-baseline justify-between gap-4"><dt className="text-sm text-muted-foreground">{item.label}</dt><dd className="text-right text-sm font-medium"><Amount value={item.value} known={item.known}/></dd></div>{item.note && <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">{item.note}</p>}</div>)}</dl>
        <p className="mt-4 max-w-3xl text-xs leading-relaxed text-muted-foreground">Money paid uses recorded accounting dates; gift cards use issuance dates. Outstanding balance uses the end of the period. Payment activity does not establish bank settlement. These describe refund activity, not additional reductions to net sales.{uncertainPayments > 0 ? ' Some accounting or issuance dates are unknown; only known subtotals are shown.' : ''}{uncertainBalance > 0 ? ' Some balances are unknown; only the known subtotal is shown.' : ''}</p>
      </details>
      <section aria-labelledby="finance-machines-heading"><h3 id="finance-machines-heading" className="text-lg font-semibold">By machine</h3><p className="mt-1 text-sm text-muted-foreground">Select a machine to see its breakdown using the same period.</p>
        <div className="mt-3 hidden md:block"><Table><TableHeader><TableRow><TableHead>Machine / location</TableHead><TableHead className="text-right">Sales excluding tax</TableHead><TableHead className="text-right">Refund deductions</TableHead><TableHead className="text-right">Net sales</TableHead></TableRow></TableHeader><TableBody>{rows.map(row => <TableRow key={`${row.machineId}:${row.locationId}`}><TableCell><Button variant="link" className="h-auto max-w-full whitespace-normal px-0 py-2 text-left text-foreground" onClick={() => onMachine(row.machineId, row.locationId)} aria-label={`View ${row.machineLabel} finance`}>{row.machineLabel}</Button><span className="block text-xs text-muted-foreground">{row.locationName}</span></TableCell><TableCell className="text-right tabular-nums">{money(row.salesExTaxCents)}</TableCell><TableCell className="text-right tabular-nums">{money(refundImpact(row))}</TableCell><TableCell className="text-right font-medium tabular-nums">{money(row.netSalesExTaxCents)}</TableCell></TableRow>)}</TableBody></Table></div>
        <div className="mt-3 divide-y divide-border md:hidden">{rows.map(row => <article key={`${row.machineId}:${row.locationId}`} className="py-4"><Button variant="link" className="h-auto max-w-full whitespace-normal px-0 py-2 text-left font-medium text-foreground" onClick={() => onMachine(row.machineId, row.locationId)} aria-label={`View ${row.machineLabel} finance`}>{row.machineLabel}</Button><p className="text-xs text-muted-foreground">{row.locationName}</p><dl className="mt-3 space-y-2 text-sm">{[['Sales excluding tax', row.salesExTaxCents], ['Refund deductions', refundImpact(row)], ['Net sales', row.netSalesExTaxCents]].map(([label, value]) => <div key={label as string} className="flex justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{money(value as number | null)}</dd></div>)}</dl></article>)}</div>
      </section>
    </>}
    <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">Imported records only. Provider completeness and missing-day coverage are unknown.{count('estimatedComponentCount') > 0 ? ' Some calculations use reporting estimates.' : ''}{count('unknownRequestDateCount') > 0 ? ' Some request dates are unknown.' : ''}{count('unknownAmountCount') > 0 ? ' Some request amounts are unknown; refund activity totals may be incomplete.' : ''} Net sales is a reporting amount, not profit or a payment settlement.</p>
  </div>;
}
