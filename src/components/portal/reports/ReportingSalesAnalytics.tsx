import { useMemo, useRef, useState } from 'react';
import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { knownMoney, moneyCoverage, moneyCoverageNote, moneyCoverageText, refundImpactMoney, unresolvedComponents, salesGroups, alignedTrend, changeLabel, money, number, periodChange, type SalesGroup, type WorkspaceState } from '@/lib/reportingWorkspace';
import type { ReportingDimension, SalesReportRow } from '@/lib/reporting';

type Props = { rows: SalesReportRow[]; previous: SalesReportRow[]; state: WorkspaceState; priorFrom?: string; compareAvailable: boolean; dimensions: ReportingDimension[]; onNavigate: (patch: Partial<WorkspaceState>) => void };
const titleClass = 'text-xl font-semibold tracking-tight';
const noteClass = 'text-sm leading-relaxed text-muted-foreground';
function MoneyValue({ coverage, refundImpact = false }: { coverage: ReturnType<typeof moneyCoverage>; refundImpact?: boolean }) {
  return <><span>{moneyCoverageText(coverage, refundImpact ? refundImpactMoney : money)}</span>{coverage.status !== 'complete' && <span className="mt-1 block text-xs font-normal text-muted-foreground">{moneyCoverageNote(coverage)}</span>}</>;
}

export function SalesMetricBand({ rows, previous, compareAvailable }: Pick<Props, 'rows' | 'previous' | 'compareAvailable'>) {
  const current = moneyCoverage(rows); const prior = moneyCoverage(previous); const refunds = moneyCoverage(rows, 'refundAmountCents');
  const unresolved = unresolvedComponents(rows);
  const transactions = rows.length ? rows.reduce((sum, row) => sum + row.transactionCount, 0) : null;
  const priorTransactions = previous.length ? previous.reduce((sum, row) => sum + row.transactionCount, 0) : null;
  const gross = knownMoney(rows, 'grossSalesCents').value; const priorGross = knownMoney(previous, 'grossSalesCents').value;
  const perTransaction = transactions && gross != null ? Math.round(gross / transactions) : null;
  const priorPerTransaction = priorTransactions && priorGross != null ? Math.round(priorGross / priorTransactions) : null;
  const receipts = moneyCoverage(rows, 'customerReceiptsCents');
  const priorReceipts = moneyCoverage(previous, 'customerReceiptsCents');
  const metrics = [{ label: receipts.status === 'partial' && receipts.knownRows ? 'Known customer receipts incl. tax' : 'Customer receipts incl. tax', value: moneyCoverageText(receipts), now: receipts.value, prior: priorReceipts.value, monetary: true, note: receipts.status !== 'complete' || receipts.noSalesRecorded ? moneyCoverageNote(receipts) : 'What customers paid, before refunds' }, { label: current.status === 'partial' ? 'Known net sales subtotal' : 'Net sales', value: money(current.displayValue), now: current.value, prior: prior.value, monetary: true, note: current.status === 'partial' ? moneyCoverageNote(current) : null },
    { label: 'Transactions', value: number(transactions), now: transactions, prior: priorTransactions, monetary: false, note: !rows.length ? 'No loaded records' : current.status === 'partial' ? 'Includes transactions with missing amounts' : null },
    { label: 'Sales per recorded transaction', value: money(perTransaction), now: perTransaction, prior: priorPerTransaction, monetary: true, note: gross == null && rows.length ? 'Needs all sales amounts; subtotal is not an average' : null },
    { label: refunds.status === 'partial' ? 'Known refund impact subtotal' : 'Refund accounting impact', value: rows.every(row => row.calculationVersion === 'shared-sales-basis-v1') ? refundImpactMoney(refunds.displayValue) : money(refunds.displayValue), now: null, prior: null, monetary: true, note: refunds.status === 'partial' ? moneyCoverageNote(refunds) : 'Request deductions and reversals' }];
  const orderedMetrics = [metrics[1], metrics[0], ...metrics.slice(2)];
  return <><dl data-sales-metrics className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-x-6 gap-y-5 border-b border-border py-4 lg:grid-cols-5">
    {orderedMetrics.map((metric, index) => <div key={metric.label} className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 min-[400px]:block ${index ? 'lg:border-l lg:border-border lg:pl-6' : ''}`}>
      <dt className="text-sm text-muted-foreground">{metric.label}</dt><dd className="text-xl font-semibold tabular-nums tracking-tight min-[400px]:mt-1 min-[400px]:text-2xl sm:text-3xl">{metric.value}</dd>
      <dd className="col-span-2 mt-1 text-xs leading-relaxed text-muted-foreground min-[400px]:mt-2">{metric.note ?? (compareAvailable ? changeLabel(periodChange(metric.now, metric.prior), metric.monetary) : 'Comparison unavailable')}</dd>
      {index === 2 && compareAvailable && current.status === 'partial' && <dd className="col-span-2 mt-1 text-xs text-muted-foreground">{changeLabel(periodChange(metric.now, metric.prior), false)}</dd>}
    </div>)}
  </dl>{current.status === 'partial' && <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status" data-sales-partial>
    <p className="font-medium">Partial amounts, loaded transactions</p>
    <p>Known subtotals include the calculable amounts in loaded records. The complete net total is unavailable.</p>
    {(unresolved.sales > 0 || unresolved.refunds > 0) && <p>{number(unresolved.sales)} sales and {number(unresolved.refunds)} refund components need tax or source amount details.</p>}
    {unresolved.taxRows > 0 && <p>Tax breakdown is missing on {number(unresolved.taxRows)} {unresolved.taxRows === 1 ? 'row' : 'rows'}. Some records need tax or payment details.</p>}
  </div>}{!rows.length && <p role="status" className={noteClass}>No loaded sales records for these dates and filters. This does not confirm zero activity.</p>}</>;
}

export function SalesTrend({ rows, previous, state, priorFrom, compareAvailable }: Props) {
  const trend = useMemo(() => alignedTrend(rows, previous, state.dateFrom, state.dateTo, priorFrom, state.comparison), [rows, previous, state.dateFrom, state.dateTo, priorFrom, state.comparison]);
  const calendarComparison = state.comparison === 'previous_year';
  const partial = trend.some(item => item.currentCoverage.status === 'partial' || (compareAvailable && item.previousCoverage.status === 'partial'));
  const isolatedDot = (series: 'currentKnown' | 'previousKnown') => ({ cx, cy, index }: { cx?: number; cy?: number; index?: number }) => {
    const isolated = index != null && trend[index]?.[series] != null && trend[index - 1]?.[series] == null && trend[index + 1]?.[series] == null;
    return isolated && cx != null && cy != null
      ? <circle key={index} cx={cx} cy={cy} r={3} fill={series === 'currentKnown' ? '#c44c64' : '#7b8494'} data-sales-point={series === 'currentKnown' ? 'current' : 'previous'}/>
      : <g key={index}/>;
  };
  return <section className="min-w-0" aria-labelledby="sales-trend-title"><h2 id="sales-trend-title" className={titleClass}>Sales over time</h2>
    <p className={`${noteClass} mt-1`}>{partial ? 'Known net sales subtotals by business date. Missing amounts are excluded, so these are not complete daily totals.' : 'Net sales by machine-local business date.'} Gaps mean no loaded rows or no calculable amounts. See daily values for coverage.</p>
    <div className="mt-4 h-[240px] w-full" role="img" aria-label={`Current and prior ${partial ? 'known net sales subtotals' : 'net sales'} by ${calendarComparison ? 'calendar date' : 'elapsed day'}. Exact values and coverage are in the table below.`}>
      <ResponsiveContainer width="100%" height="100%"><LineChart data={trend} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="hsl(var(--border))" vertical={false}/><XAxis dataKey="date" tickFormatter={date => String(date).slice(5)} tick={{ fontSize: 12 }} minTickGap={35} tickLine={false}/>
        <YAxis tickFormatter={value => `$${number(value / 100)}`} tick={{ fontSize: 12 }} tickLine={false} width={65}/>
        <Tooltip formatter={(value: number, name: string) => [money(value), `${name === 'current' ? 'Current' : 'Prior'}${partial ? ' known subtotal' : ''}`]} labelFormatter={date => String(date)}/>
        <Line name="current" dataKey="currentKnown" stroke="#c44c64" strokeWidth={2} dot={isolatedDot('currentKnown')} connectNulls={false} isAnimationActive={false}/>
        {compareAvailable && <Line name="previous" dataKey="previousKnown" stroke="#7b8494" strokeWidth={1.5} strokeDasharray="5 5" dot={isolatedDot('previousKnown')} connectNulls={false} isAnimationActive={false}/>}
      </LineChart></ResponsiveContainer>
    </div>
    <div className="flex flex-wrap gap-5 text-xs text-muted-foreground"><span><span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#c44c64]"/>Current period{partial ? ', known subtotal' : ''}</span>{compareAvailable && <span><span className="mr-2 inline-block h-0.5 w-5 bg-[#7b8494]"/>{calendarComparison ? 'Same calendar dates, prior year' : 'Prior period, aligned by elapsed day'}</span>}</div>
    <details className="mt-4 rounded-lg border border-border"><summary className="cursor-pointer p-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Daily values and comparison dates</summary>
      <div className="hidden sm:block"><Table><TableHeader><TableRow><TableHead>Business date</TableHead><TableHead>Net sales</TableHead><TableHead>What customers paid</TableHead><TableHead>Transactions</TableHead>{compareAvailable && <><TableHead>Prior date</TableHead><TableHead>Prior net sales</TableHead></>}</TableRow></TableHeader><TableBody>{trend.map(item => <TableRow key={item.date}><TableCell>{item.date}</TableCell><TableCell><MoneyValue coverage={item.currentCoverage}/></TableCell><TableCell><MoneyValue coverage={moneyCoverage(rows.filter(row => row.periodStart === item.date), 'customerReceiptsCents')}/></TableCell><TableCell>{number(item.transactions)}</TableCell>{compareAvailable && <><TableCell>{item.priorDate}</TableCell><TableCell><MoneyValue coverage={item.previousCoverage}/></TableCell></>}</TableRow>)}</TableBody></Table></div>
      <div className="divide-y divide-border px-3 sm:hidden">{trend.map(item => <article key={item.date} className="py-3"><h3 className="text-sm font-medium">{item.date}</h3><dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm"><div><dt className="text-muted-foreground">What customers paid</dt><dd className="tabular-nums"><MoneyValue coverage={moneyCoverage(rows.filter(row => row.periodStart === item.date), 'customerReceiptsCents')}/></dd></div><div><dt className="text-muted-foreground">Net sales</dt><dd className="break-words tabular-nums"><MoneyValue coverage={item.currentCoverage}/></dd></div><div><dt className="text-muted-foreground">Transactions</dt><dd className="break-words tabular-nums">{number(item.transactions)}</dd></div>{compareAvailable && <div className="col-span-2"><dt className="text-muted-foreground">Prior net sales ({item.priorDate ?? 'No matching date'})</dt><dd className="tabular-nums"><MoneyValue coverage={item.previousCoverage}/></dd></div>}</dl></article>)}</div>
    </details><p className="mt-3 text-xs leading-relaxed text-muted-foreground">Sales exclude tax. Refund deductions use the request period; later payments add no second deduction. A sales record does not establish machine uptime.</p>
  </section>;
}

function GroupTable({ groups, kind, onNavigate, compact = false }: { groups: SalesGroup[]; kind: 'location' | 'machine'; onNavigate: Props['onNavigate']; compact?: boolean }) {
  const visibleGroups = compact ? groups.slice(0, 5) : groups;
  const explore = (group: SalesGroup) => onNavigate({ view: 'locations', ...(kind === 'location' ? { locationId: group.id, machineId: 'all' } : { machineId: group.id }) });
  return <><div className="divide-y divide-border sm:hidden">{visibleGroups.map(group => <article key={group.id} className="min-w-0 py-4"><h3 className="break-words text-base font-semibold">{group.label}</h3><dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm"><div><dt className="text-muted-foreground">Net sales</dt><dd className="break-words font-medium tabular-nums"><MoneyValue coverage={group.currentCoverage}/></dd></div><div><dt className="text-muted-foreground">Transactions</dt><dd className="break-words tabular-nums">{number(group.transactions)}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">Change</dt><dd className="tabular-nums">{changeLabel(group.change)}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">Loaded records</dt><dd>{group.cohort === 'both' ? 'Both periods' : group.cohort === 'current_only' ? 'Current period only' : 'Prior period only'}</dd></div></dl><Button variant="outline" className="mt-3 min-h-11 max-w-full" aria-label={`Explore ${group.label}`} onClick={() => explore(group)}>Explore {kind}<ArrowRight className="ml-2 h-4 w-4"/></Button></article>)}{!groups.length && <p className="py-6 text-sm text-muted-foreground">No loaded records for this scope. Feed completeness is unknown.</p>}</div><div className="hidden sm:block"><Table><TableHeader><TableRow><TableHead>{kind === 'location' ? 'Location' : 'Machine'}</TableHead><TableHead className="text-right">Net sales</TableHead><TableHead className="text-right">Change</TableHead><TableHead className="hidden text-right sm:table-cell">Transactions</TableHead><TableHead className="hidden lg:table-cell">Loaded records</TableHead><TableHead><span className="sr-only">Open detail</span></TableHead></TableRow></TableHeader><TableBody>
    {visibleGroups.map(group => <TableRow key={group.id} className="hover:bg-secondary/50"><TableCell className="font-medium"><button className="max-w-[180px] text-left underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => explore(group)}>{group.label}</button></TableCell><TableCell className="text-right tabular-nums"><MoneyValue coverage={group.currentCoverage}/></TableCell><TableCell className="text-right text-xs tabular-nums">{changeLabel(group.change)}</TableCell><TableCell className="hidden text-right tabular-nums sm:table-cell">{number(group.transactions)}</TableCell><TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{group.cohort === 'both' ? 'Both periods' : group.cohort === 'current_only' ? 'Current period only' : 'Prior period only'}</TableCell><TableCell><Button variant="ghost" size="icon" aria-label={`Explore ${group.label}`} onClick={() => explore(group)}><ArrowRight className="h-4 w-4"/></Button></TableCell></TableRow>)}
    {!groups.length && <TableRow><TableCell colSpan={6} className="py-6 text-muted-foreground">No loaded records for this scope. Feed completeness is unknown.</TableCell></TableRow>}
  </TableBody></Table></div></>;
}

export function ReportingOverview(props: Props) {
  const groups = salesGroups(props.rows, props.previous, 'location');
  const comparable = groups.filter(group => group.change.absolute != null).sort((a, b) => Math.abs(b.change.absolute!) - Math.abs(a.change.absolute!));
  const hasHighlights = props.compareAvailable && comparable.length > 0;
  return <div className="space-y-7"><SalesMetricBand {...props}/>
    <div className={hasHighlights ? 'grid gap-8 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]' : ''}><SalesTrend {...props}/>{hasHighlights && <section className="xl:border-l xl:border-border xl:pl-6"><h2 className={titleClass}>Worth a closer look</h2>
      <div className="mt-3 divide-y divide-border">{props.compareAvailable && comparable.slice(0, 2).map(group => <div key={group.id} className="flex gap-3 py-4">{group.change.absolute! >= 0 ? <TrendingUp className="mt-1 h-5 w-5 shrink-0 text-muted-foreground"/> : <TrendingDown className="mt-1 h-5 w-5 shrink-0 text-muted-foreground"/>}<div><h3 className="text-sm font-semibold">{group.label}</h3><p className={`${noteClass} mt-1`}>Net sales changed {changeLabel(group.change)} in the loaded data.</p><Button className="mt-1 h-auto px-0 py-2 text-[#a93750]" variant="link" onClick={() => props.onNavigate({ view: 'locations', locationId: group.id, machineId: 'all' })}>Explore location <ArrowRight className="ml-2 h-4 w-4"/></Button></div></div>)}
      </div></section>}</div><section><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className={titleClass}>Location performance</h2><Button variant="link" onClick={() => props.onNavigate({ view: 'locations' })}>View all locations <ArrowRight className="ml-2 h-4 w-4"/></Button></div><GroupTable groups={groups} kind="location" onNavigate={props.onNavigate} compact/></section><details className="border-t border-border pt-4"><summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Machine and payment breakdown</summary><div className="mt-5"><ReportingSalesBreakdown {...props}/></div></details>
  </div>;
}

function ReportingSalesBreakdown(props: Props) {
  const groups = salesGroups(props.rows, props.previous, 'machine');
  const commonIds = new Set(groups.filter(group => group.cohort === 'both').map(group => group.id));
  const commonCurrent = props.rows.filter(row => commonIds.has(row.machineId)); const commonPrior = props.previous.filter(row => commonIds.has(row.machineId));
  const paymentGroups = (['cash', 'credit', 'other', 'unknown'] as const).map(method => {
    const rows = props.rows.filter(row => row.paymentMethod === method); const previous = props.previous.filter(row => row.paymentMethod === method);
    return { method, label: method === 'credit' ? 'Card' : method[0].toUpperCase() + method.slice(1), transactions: rows.length ? number(rows.reduce((sum, row) => sum + row.transactionCount, 0)) : 'No loaded rows', current: moneyCoverage(rows), prior: props.compareAvailable ? moneyCoverage(previous) : moneyCoverage([]) };
  });
  const cohortChange = periodChange(knownMoney(commonCurrent, 'netSalesCents').value, knownMoney(commonPrior, 'netSalesCents').value);
  return <div className="space-y-7"><section><h2 className={titleClass}>What drove the change?</h2><p className={`${noteClass} mt-2`}>{props.compareAvailable ? `${commonIds.size} machines with loaded records in both periods: ${changeLabel(cohortChange)}.` : 'Select a comparison to see movement.'} Current-only and prior-only records do not prove new or removed machines.</p>
    <GroupTable groups={[...groups].sort((a, b) => Math.abs(b.change.absolute ?? 0) - Math.abs(a.change.absolute ?? 0))} kind="machine" onNavigate={props.onNavigate}/></section>
    <section><h2 className={titleClass}>Payment methods</h2><div className="divide-y divide-border sm:hidden">{paymentGroups.map(item => <article key={item.method} className="py-4"><h3 className="font-medium">{item.label}</h3><dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 text-sm"><div><dt className="text-muted-foreground">Net sales</dt><dd className="break-words tabular-nums"><MoneyValue coverage={item.current}/></dd></div><div><dt className="text-muted-foreground">Transactions</dt><dd className="tabular-nums">{item.transactions}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">Prior net sales</dt><dd className="tabular-nums"><MoneyValue coverage={item.prior}/></dd></div></dl></article>)}</div><div className="hidden sm:block"><Table><TableHeader><TableRow><TableHead>Payment method</TableHead><TableHead>Transactions</TableHead><TableHead>Net sales</TableHead><TableHead>Prior net sales</TableHead></TableRow></TableHeader><TableBody>{paymentGroups.map(item => <TableRow key={item.method}><TableCell>{item.label}</TableCell><TableCell>{item.transactions}</TableCell><TableCell><MoneyValue coverage={item.current}/></TableCell><TableCell><MoneyValue coverage={item.prior}/></TableCell></TableRow>)}</TableBody></Table></div></section>
  </div>;
}

export function ReportingLocations(props: Props & { children?: React.ReactNode }) {
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const location = props.dimensions.find(item => item.locationId === props.state.locationId);
  const machine = props.dimensions.find(item => item.machineId === props.state.machineId);
  const isDetail = props.state.locationId !== 'all' || props.state.machineId !== 'all';
  const groups = salesGroups(props.rows, props.previous, isDetail ? 'machine' : 'location');
  const matchingGroups = groups.filter(group => group.label.toLowerCase().includes(search.trim().toLowerCase()));
  const noSearchMatches = groups.length > 0 && search.trim().length > 0 && matchingGroups.length === 0;
  const summary = { gross: moneyCoverage(props.rows, 'grossSalesCents'), refund: moneyCoverage(props.rows, 'refundAmountCents'), tax: moneyCoverage(props.rows, 'taxCents'), net: moneyCoverage(props.rows) };
  return <div className="space-y-7">{isDetail && <div className="mt-6"><Button variant="link" className="px-0" onClick={() => props.onNavigate({ locationId: 'all', machineId: 'all' })}>All locations</Button><h2 className="mt-2 text-2xl font-semibold">{machine?.machineLabel ?? location?.locationName ?? 'Selected scope'} 360</h2><p className={noteClass}>Sales movement and recorded activity for the selected scope. Associations do not establish cause.</p></div>}<SalesMetricBand {...props}/>
    {isDetail && <><SalesTrend {...props}/><section><h2 className={titleClass}>Sales to net sales</h2><dl className="mt-3 grid gap-4 border-y border-border py-5 sm:grid-cols-4">{[{ label: 'Sales before refunds', value: summary.gross }, { label: 'Refund accounting impact', value: summary.refund }, { label: 'Net sales', value: summary.net }, { label: 'Tax, shown separately', value: summary.tax }].map(item => <div key={item.label}><dt className="text-sm text-muted-foreground">{item.label}</dt><dd className="mt-2 text-lg font-semibold tabular-nums"><MoneyValue coverage={item.value} refundImpact={item.label === 'Refund accounting impact' && props.rows.every(row => row.calculationVersion === 'shared-sales-basis-v1')}/></dd></div>)}</dl><p className={`${noteClass} mt-3`}>Canonical source calculations are preserved. Tax is separate under the shared sales basis; refund payments are context, not another deduction. No unallocated compensation or overlapping partner costs are subtracted.</p></section></>}
    <section><div className="flex flex-wrap items-center justify-between gap-4"><h2 className={titleClass}>{isDetail ? 'Machine contributors' : 'Location comparison'}</h2><Input ref={searchInput} aria-label="Search locations and machines" className="w-full sm:w-64" placeholder="Search by name" value={search} onChange={event => setSearch(event.target.value)}/></div><div className="mt-3">{noSearchMatches ? <div className="py-4"><p role="status" className="text-sm text-muted-foreground">No {isDetail ? 'machines' : 'locations'} match “{search.trim()}”.</p><Button variant="link" className="min-h-11 px-0" onClick={() => { setSearch(''); searchInput.current?.focus(); }}>Clear search</Button></div> : <GroupTable groups={matchingGroups} kind={isDetail ? 'machine' : 'location'} onNavigate={props.onNavigate}/>}</div></section>
    {isDetail && props.children}
  </div>;
}
