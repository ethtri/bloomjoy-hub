import { useMemo, useState } from 'react';
import { ArrowRight, Database, TrendingDown, TrendingUp } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { knownMoney, salesGroups, alignedTrend, changeLabel, money, number, periodChange, type SalesGroup, type WorkspaceState } from '@/lib/reportingWorkspace';
import type { ReportingDimension, SalesReportRow } from '@/lib/reporting';

type Props = { rows: SalesReportRow[]; previous: SalesReportRow[]; state: WorkspaceState; priorFrom?: string; compareAvailable: boolean; dimensions: ReportingDimension[]; onNavigate: (patch: Partial<WorkspaceState>) => void };
const titleClass = 'text-xl font-semibold tracking-tight';
const noteClass = 'text-sm leading-relaxed text-muted-foreground';

export function SalesMetricBand({ rows, previous, compareAvailable }: Pick<Props, 'rows' | 'previous' | 'compareAvailable'>) {
  const current = knownMoney(rows, 'netSalesCents'); const prior = knownMoney(previous, 'netSalesCents');
  const transactions = rows.length ? rows.reduce((sum, row) => sum + row.transactionCount, 0) : null;
  const priorTransactions = previous.length ? previous.reduce((sum, row) => sum + row.transactionCount, 0) : null;
  const gross = knownMoney(rows, 'grossSalesCents').value; const priorGross = knownMoney(previous, 'grossSalesCents').value;
  const perTransaction = transactions && gross != null ? Math.round(gross / transactions) : null;
  const priorPerTransaction = priorTransactions && priorGross != null ? Math.round(priorGross / priorTransactions) : null;
  const metrics = [{ label: 'Net sales', value: money(current.value), now: current.value, prior: prior.value, monetary: true },
    { label: 'Transactions', value: number(transactions), now: transactions, prior: priorTransactions, monetary: false },
    { label: 'Sales per recorded transaction', value: money(perTransaction), now: perTransaction, prior: priorPerTransaction, monetary: true },
    { label: 'Refund accounting impact', value: money(knownMoney(rows, 'refundAmountCents').value), now: null, prior: null, monetary: true }];
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-b border-border py-4 lg:grid-cols-4">
    {metrics.map((metric, index) => <div key={metric.label} className={index ? 'lg:border-l lg:border-border lg:pl-6' : ''}>
      <dt className="text-sm text-muted-foreground">{metric.label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">{metric.value}</dd>
      <dd className="mt-2 text-xs leading-relaxed text-muted-foreground">{index === 3 ? 'Request deductions and reversals' : compareAvailable ? changeLabel(periodChange(metric.now, metric.prior), metric.monetary) : 'Comparison unavailable'}</dd>
      {index === 0 && current.omittedRows > 0 && <dd className="mt-1 text-xs text-amber-800">Known subtotal {money(current.knownValue)} · {current.omittedRows} unresolved rows</dd>}
    </div>)}
  </dl>;
}

export function SalesTrend({ rows, previous, state, priorFrom, compareAvailable }: Props) {
  const trend = useMemo(() => alignedTrend(rows, previous, state.dateFrom, state.dateTo, priorFrom), [rows, previous, state.dateFrom, state.dateTo, priorFrom]);
  return <section className="min-w-0" aria-labelledby="sales-trend-title"><h2 id="sales-trend-title" className={titleClass}>Sales over time</h2>
    <p className={`${noteClass} mt-1`}>Net sales by machine-local business date. Gaps mean no loaded rows.</p>
    <div className="mt-4 h-[240px] w-full" role="img" aria-label="Current and prior net sales by elapsed day. Exact values are in the table below.">
      <ResponsiveContainer width="100%" height="100%"><LineChart data={trend} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="hsl(var(--border))" vertical={false}/><XAxis dataKey="date" tickFormatter={date => String(date).slice(5)} tick={{ fontSize: 12 }} minTickGap={35} tickLine={false}/>
        <YAxis tickFormatter={value => `$${number(value / 100)}`} tick={{ fontSize: 12 }} tickLine={false} width={65}/>
        <Tooltip formatter={(value: number, name: string) => [money(value), name === 'current' ? 'Current' : 'Prior']} labelFormatter={date => String(date)}/>
        <Line name="current" dataKey="current" stroke="#c44c64" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false}/>
        {compareAvailable && <Line name="previous" dataKey="previous" stroke="#7b8494" strokeWidth={1.5} strokeDasharray="5 5" dot={false} connectNulls={false} isAnimationActive={false}/>}
      </LineChart></ResponsiveContainer>
    </div>
    <div className="flex flex-wrap gap-5 text-xs text-muted-foreground"><span><span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#c44c64]"/>Current period</span>{compareAvailable && <span><span className="mr-2 inline-block h-0.5 w-5 bg-[#7b8494]"/>Prior period, aligned by elapsed day</span>}</div>
    <details className="mt-4 rounded-lg border border-border"><summary className="cursor-pointer p-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Daily values and comparison dates</summary>
      <Table><TableHeader><TableRow><TableHead>Business date</TableHead><TableHead>Net sales</TableHead><TableHead>Transactions</TableHead>{compareAvailable && <><TableHead>Prior date</TableHead><TableHead>Prior net sales</TableHead></>}</TableRow></TableHeader><TableBody>{trend.map(item => <TableRow key={item.date}><TableCell>{item.date}</TableCell><TableCell>{money(item.current)}</TableCell><TableCell>{number(item.transactions)}</TableCell>{compareAvailable && <><TableCell>{item.priorDate}</TableCell><TableCell>{money(item.previous)}</TableCell></>}</TableRow>)}</TableBody></Table>
    </details><p className="mt-3 text-xs leading-relaxed text-muted-foreground">Sales exclude tax. Refund deductions use the request period; later payments add no second deduction. A sales record does not establish machine uptime.</p>
  </section>;
}

function GroupTable({ groups, kind, onNavigate, compact = false }: { groups: SalesGroup[]; kind: 'location' | 'machine'; onNavigate: Props['onNavigate']; compact?: boolean }) {
  return <Table><TableHeader><TableRow><TableHead>{kind === 'location' ? 'Location' : 'Machine'}</TableHead><TableHead className="text-right">Net sales</TableHead><TableHead className="text-right">Change</TableHead><TableHead className="hidden text-right sm:table-cell">Transactions</TableHead><TableHead className="hidden lg:table-cell">Loaded records</TableHead><TableHead><span className="sr-only">Open detail</span></TableHead></TableRow></TableHeader><TableBody>
    {(compact ? groups.slice(0, 5) : groups).map(group => <TableRow key={group.id} className="hover:bg-secondary/50"><TableCell className="font-medium"><button className="max-w-[180px] text-left underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onNavigate({ view: 'locations', ...(kind === 'location' ? { locationId: group.id, machineId: 'all' } : { machineId: group.id }) })}>{group.label}</button></TableCell><TableCell className="text-right tabular-nums">{money(group.current)}</TableCell><TableCell className="text-right text-xs tabular-nums">{changeLabel(group.change)}</TableCell><TableCell className="hidden text-right tabular-nums sm:table-cell">{number(group.transactions)}</TableCell><TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{group.cohort === 'both' ? 'Both periods' : group.cohort === 'current_only' ? 'Current period only' : 'Prior period only'}</TableCell><TableCell><Button variant="ghost" size="icon" aria-label={`Explore ${group.label}`} onClick={() => onNavigate({ view: 'locations', ...(kind === 'location' ? { locationId: group.id, machineId: 'all' } : { machineId: group.id }) })}><ArrowRight className="h-4 w-4"/></Button></TableCell></TableRow>)}
    {!groups.length && <TableRow><TableCell colSpan={6} className="py-6 text-muted-foreground">No loaded records for this scope. Feed completeness is unknown.</TableCell></TableRow>}
  </TableBody></Table>;
}

export function ReportingOverview(props: Props) {
  const groups = salesGroups(props.rows, props.previous, 'location');
  const comparable = groups.filter(group => group.change.absolute != null).sort((a, b) => Math.abs(b.change.absolute!) - Math.abs(a.change.absolute!));
  const unresolved = props.rows.reduce((sum, row) => sum + row.unresolvedSalesCount + row.unresolvedRefundCount, 0);
  return <div className="space-y-7"><SalesMetricBand {...props}/>
    <div className="grid gap-8 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]"><SalesTrend {...props}/><section className="xl:border-l xl:border-border xl:pl-6"><h2 className={titleClass}>Worth a closer look</h2>
      <div className="mt-3 divide-y divide-border">{props.compareAvailable && comparable.slice(0, 2).map(group => <div key={group.id} className="flex gap-3 py-4">{group.change.absolute! >= 0 ? <TrendingUp className="mt-1 h-5 w-5 shrink-0 text-muted-foreground"/> : <TrendingDown className="mt-1 h-5 w-5 shrink-0 text-muted-foreground"/>}<div><h3 className="text-sm font-semibold">{group.label}</h3><p className={`${noteClass} mt-1`}>Net sales changed {changeLabel(group.change)} in the loaded data.</p><Button className="mt-1 h-auto px-0 py-2 text-[#a93750]" variant="link" onClick={() => props.onNavigate({ view: 'locations', locationId: group.id, machineId: 'all' })}>Explore location <ArrowRight className="ml-2 h-4 w-4"/></Button></div></div>)}
        <div className="flex gap-3 py-4"><Database className="mt-1 h-5 w-5 shrink-0 text-muted-foreground"/><div><h3 className="text-sm font-semibold">{unresolved ? `${number(unresolved)} unresolved source records` : 'Coverage needs context'}</h3><p className={`${noteClass} mt-1`}>Imported records are available. Provider completeness and missing machine days are not established by a recent import.</p><a href="#reporting-coverage" className="mt-2 inline-flex py-1 text-sm font-medium text-[#a93750] underline-offset-4 hover:underline">Check coverage <ArrowRight className="ml-2 h-4 w-4"/></a></div></div>
      </div></section></div><section><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className={titleClass}>Location performance</h2><Button variant="link" onClick={() => props.onNavigate({ view: 'locations' })}>View all locations <ArrowRight className="ml-2 h-4 w-4"/></Button></div><GroupTable groups={groups} kind="location" onNavigate={props.onNavigate} compact/></section>
  </div>;
}

export function ReportingSales(props: Props) {
  const groups = salesGroups(props.rows, props.previous, 'machine');
  const commonIds = new Set(groups.filter(group => group.cohort === 'both').map(group => group.id));
  const commonCurrent = props.rows.filter(row => commonIds.has(row.machineId)); const commonPrior = props.previous.filter(row => commonIds.has(row.machineId));
  const cohortChange = periodChange(knownMoney(commonCurrent, 'netSalesCents').value, knownMoney(commonPrior, 'netSalesCents').value);
  return <div className="space-y-7"><SalesMetricBand {...props}/><SalesTrend {...props}/><section><h2 className={titleClass}>What drove the change?</h2><p className={`${noteClass} mt-2`}>{props.compareAvailable ? `${commonIds.size} machines with loaded records in both periods: ${changeLabel(cohortChange)}.` : 'Select a comparison to see movement.'} Current-only and prior-only records do not prove new or removed machines.</p>
    <GroupTable groups={[...groups].sort((a, b) => Math.abs(b.change.absolute ?? 0) - Math.abs(a.change.absolute ?? 0))} kind="machine" onNavigate={props.onNavigate}/></section>
    <section><h2 className={titleClass}>Tender mix</h2><Table><TableHeader><TableRow><TableHead>Tender</TableHead><TableHead>Transactions</TableHead><TableHead>Net sales</TableHead><TableHead>Prior net sales</TableHead></TableRow></TableHeader><TableBody>{(['cash', 'credit', 'other', 'unknown'] as const).map(method => { const rows = props.rows.filter(row => row.paymentMethod === method); const previous = props.previous.filter(row => row.paymentMethod === method); return <TableRow key={method}><TableCell>{method === 'credit' ? 'Card' : method[0].toUpperCase() + method.slice(1)}</TableCell><TableCell>{rows.length ? number(rows.reduce((sum, row) => sum + row.transactionCount, 0)) : 'No loaded rows'}</TableCell><TableCell>{money(knownMoney(rows, 'netSalesCents').value)}</TableCell><TableCell>{props.compareAvailable ? money(knownMoney(previous, 'netSalesCents').value) : 'Unavailable'}</TableCell></TableRow>; })}</TableBody></Table></section>
  </div>;
}

export function ReportingLocations(props: Props & { children?: React.ReactNode }) {
  const [search, setSearch] = useState('');
  const location = props.dimensions.find(item => item.locationId === props.state.locationId);
  const machine = props.dimensions.find(item => item.machineId === props.state.machineId);
  const isDetail = props.state.locationId !== 'all' || props.state.machineId !== 'all';
  const groups = salesGroups(props.rows, props.previous, isDetail ? 'machine' : 'location');
  const summary = props.rows.length ? { gross: knownMoney(props.rows, 'grossSalesCents').value, refund: knownMoney(props.rows, 'refundAmountCents').value, tax: knownMoney(props.rows, 'taxCents').value, net: knownMoney(props.rows, 'netSalesCents').value } : null;
  return <div className="space-y-7">{isDetail && <div className="mt-6"><Button variant="link" className="px-0" onClick={() => props.onNavigate({ locationId: 'all', machineId: 'all' })}>All locations</Button><h2 className="mt-2 text-2xl font-semibold">{machine?.machineLabel ?? location?.locationName ?? 'Selected scope'} 360</h2><p className={noteClass}>Sales movement and recorded activity for the selected scope. Associations do not establish cause.</p></div>}<SalesMetricBand {...props}/>
    {isDetail && <><SalesTrend {...props}/><section><h2 className={titleClass}>Sales to net sales</h2><dl className="mt-3 grid gap-4 border-y border-border py-5 sm:grid-cols-4">{[{ label: 'Sales before refunds', value: summary?.gross ?? null }, { label: 'Refund accounting impact', value: summary?.refund ?? null }, { label: 'Net sales', value: summary?.net ?? null }, { label: 'Tax, shown separately', value: summary?.tax ?? null }].map(item => <div key={item.label}><dt className="text-sm text-muted-foreground">{item.label}</dt><dd className="mt-2 text-lg font-semibold tabular-nums">{money(item.value)}</dd></div>)}</dl><p className={`${noteClass} mt-3`}>Canonical source calculations are preserved. Tax is separate under the shared sales basis; refund payments are context, not another deduction. No unallocated compensation or overlapping partner costs are subtracted.</p></section></>}
    <section><div className="flex flex-wrap items-center justify-between gap-4"><h2 className={titleClass}>{isDetail ? 'Machine contributors' : 'Location comparison'}</h2><Input aria-label="Search locations and machines" className="w-full sm:w-64" placeholder="Search by name" value={search} onChange={event => setSearch(event.target.value)}/></div><div className="mt-3"><GroupTable groups={groups.filter(group => group.label.toLowerCase().includes(search.toLowerCase()))} kind={isDetail ? 'machine' : 'location'} onNavigate={props.onNavigate}/></div></section>
    {isDetail && props.children}
  </div>;
}
