import { useMemo, useState } from 'react';
import { ArrowRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ReportingDimension, SalesReportRow } from '@/lib/reporting';
import { moneyCoverage, moneyCoverageText, number, type WorkspaceState } from '@/lib/reportingWorkspace';
import { machineSalesCsv, machineSalesRows, machineSalesStatus, type MachineSalesSort } from '@/lib/machineSales';

type Props = { rows: SalesReportRow[]; dimensions: ReportingDimension[]; state: WorkspaceState; onNavigate: (patch: Partial<WorkspaceState>) => void };
function Amount({ coverage }: { coverage: ReturnType<typeof moneyCoverage> }) {
  return <span className="break-words tabular-nums">{coverage.status === 'empty' ? 'No loaded records' : moneyCoverageText(coverage)}</span>;
}
function Breakdown({ rows }: { rows: SalesReportRow[] }) {
  return <details className="mt-2 text-xs"><summary className="min-h-11 cursor-pointer py-3 font-medium">Cash, card, refunds and tax</summary><dl className="grid grid-cols-2 gap-3 pb-3">
    {([['Cash payments', rows.filter(row => row.paymentMethod === 'cash'), 'customerReceiptsCents'], ['Card payments', rows.filter(row => row.paymentMethod === 'credit'), 'customerReceiptsCents'], ['Refund impact before tax', rows, 'refundAmountCents'], ['Tax deducted from sales', rows, 'taxCents']] as const).map(([label, contributors, field]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1"><Amount coverage={moneyCoverage(contributors, field)}/></dd></div>)}
  </dl><p className="pb-3 leading-relaxed text-muted-foreground">Refund impact uses the report's sales calculation. Customer payments above are shown before refunds.</p></details>;
}
export function ReportingMachines({ rows, dimensions, state, onNavigate }: Props) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<MachineSalesSort>('receipts');
  const all = useMemo(() => machineSalesRows(rows, dimensions, state), [rows, dimensions, state]);
  const machines = useMemo(() => machineSalesRows(rows, dimensions, state, search, sort), [rows, dimensions, state, search, sort]);
  const open = (machine: typeof machines[number]) => onNavigate({ view: 'sales', machineId: machine.machineId });
  const exportCsv = () => {
    const content = machineSalesCsv(machines);
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `bloomjoy-machine-sales-${state.dateFrom}-${state.dateTo}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="mt-6 space-y-5" aria-labelledby="machine-sales-heading" data-reporting-machine-sales>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 id="machine-sales-heading" className="text-xl font-semibold tracking-tight">Sales by machine</h2>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">What customers paid includes tax and is shown before refunds. Sales excluding tax and net sales are calculated separately. No loaded records does not mean zero sales.</p></div>
      <Button variant="outline" className="min-h-11" onClick={exportCsv} disabled={!machines.length}><Download className="mr-2 h-4 w-4"/>Export machine CSV</Button></div>
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_240px]"><div><Label htmlFor="machine-sales-search">Find a machine</Label><Input id="machine-sales-search" className="mt-2 min-h-11" placeholder="Machine, location or company" value={search} onChange={event => setSearch(event.target.value)}/></div>
      <div><Label htmlFor="machine-sales-sort">Sort by</Label><Select value={sort} onValueChange={value => setSort(value as MachineSalesSort)}><SelectTrigger id="machine-sales-sort" className="mt-2 min-h-11"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="receipts">Customer receipts: highest first</SelectItem><SelectItem value="name">Machine name</SelectItem><SelectItem value="net">Net sales: highest first</SelectItem><SelectItem value="transactions">Transactions: highest first</SelectItem></SelectContent></Select></div></div>
    <p role="status" className="text-sm text-muted-foreground">Showing {machines.length} of {all.length} accessible machines in these filters.</p>
    {!machines.length && <div className="border-y border-border py-8"><p>{search.trim() ? 'No machines match this search.' : 'No accessible machines in these filters.'}</p>{search.trim() && <Button variant="link" className="mt-2 min-h-11 px-0" onClick={() => setSearch('')}>Clear search</Button>}</div>}
    <div className="divide-y divide-border lg:hidden">{machines.map(machine => <article key={machine.machineId} className="py-5"><h3 className="break-words font-semibold">{machine.machineLabel}</h3><p className="mt-1 break-words text-xs text-muted-foreground">{machine.locationName}  /  {machine.accountName}{machine.managementArchivedAt && <span className="mt-1 block">Archived machine - historical reporting</span>}</p><dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
      {[['What customers paid', machine.receipts], ['Sales excluding tax', machine.salesExTax], ['Net sales', machine.net]].map(([label, coverage]) => <div key={String(label)}><dt className="text-muted-foreground">{String(label)}</dt><dd className="mt-1 font-medium"><Amount coverage={coverage as ReturnType<typeof moneyCoverage>}/></dd></div>)}
      <div><dt className="text-muted-foreground">Recorded transactions</dt><dd className="mt-1 tabular-nums">{number(machine.transactions)}</dd></div></dl><p className="mt-4 text-xs leading-relaxed text-muted-foreground">{machineSalesStatus(machine)}</p><Breakdown rows={machine.rows}/><Button variant="link" className="mt-1 min-h-11 px-0" onClick={() => open(machine)}>View dated payment records<ArrowRight className="ml-2 h-4 w-4"/></Button></article>)}</div>
    <div className="hidden lg:block"><Table><TableHeader><TableRow><TableHead>Machine</TableHead><TableHead className="text-right">What customers paid</TableHead><TableHead className="text-right">Sales excluding tax</TableHead><TableHead className="text-right">Net sales</TableHead><TableHead className="text-right">Recorded transactions</TableHead></TableRow></TableHeader><TableBody>{machines.map(machine => <TableRow key={machine.machineId}><TableCell><Button variant="link" className="h-auto min-h-11 max-w-[240px] justify-start whitespace-normal break-words px-0 text-left" onClick={() => open(machine)}>{machine.machineLabel}</Button><p className="text-xs text-muted-foreground">{machine.locationName}  /  {machine.accountName}{machine.managementArchivedAt && <span className="mt-1 block">Archived machine - historical reporting</span>}</p><p className="mt-1 max-w-[280px] text-xs text-muted-foreground">{machineSalesStatus(machine)}</p><Breakdown rows={machine.rows}/><Button variant="link" className="h-auto min-h-11 whitespace-normal px-0 text-left text-xs" onClick={() => open(machine)}>View dated payment records<ArrowRight className="ml-2 h-3 w-3"/></Button></TableCell><TableCell className="text-right"><Amount coverage={machine.receipts}/></TableCell><TableCell className="text-right"><Amount coverage={machine.salesExTax}/></TableCell><TableCell className="text-right"><Amount coverage={machine.net}/></TableCell><TableCell className="text-right tabular-nums">{number(machine.transactions)}</TableCell></TableRow>)}</TableBody></Table></div>
  </section>;
}
