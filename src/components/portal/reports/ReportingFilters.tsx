import { useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { reportingPeriods, validDate, type WorkspaceState } from '@/lib/reportingWorkspace';

type Props = {
  state: WorkspaceState;
  salesView: boolean;
  locations: [string, string][];
  machines: { machineId: string; machineLabel: string }[];
  onChange: (patch: Partial<WorkspaceState>) => void;
};
const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const displayRange = (from: string, to: string) => {
  const end = fullDate.format(new Date(`${to}T00:00:00Z`));
  if (from === to) return end;
  const start = (from.slice(0, 4) === to.slice(0, 4) ? shortDate : fullDate).format(new Date(`${from}T00:00:00Z`));
  return `${start} – ${end}`;
};

export function ReportingFilters({ state, salesView, locations, machines, onChange }: Props) {
  const [more, setMore] = useState(false);
  const [editing, setEditing] = useState(false);
  const [from, setFrom] = useState(state.dateFrom);
  const [to, setTo] = useState(state.dateTo);
  const dateInput = useRef<HTMLInputElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const periods = reportingPeriods();
  const active = periods.find(period => period.dateFrom === state.dateFrom && period.dateTo === state.dateTo);
  const openDates = () => { setFrom(state.dateFrom); setTo(state.dateTo); setEditing(true); };
  const invalid = !validDate(from) || !validDate(to) ? 'Enter both dates.' : from > to ? 'The end date must be on or after the start date.' : (Date.parse(to) - Date.parse(from)) / 86400000 > 366 ? `Choose a reporting period of up to 367 days.${salesView ? ' For longer sales periods, open Sales.' : ''}` : '';
  const activeScopeCount = Number(state.machineId !== 'all') + Number(salesView && state.paymentMethod !== 'all');
  const machineLabel = machines.find(machine => machine.machineId === state.machineId)?.machineLabel ?? 'Unavailable machine';
  const paymentMethods = [['all', 'All payment methods'], ['cash', 'Cash'], ['credit', 'Card'], ['other', 'Other'], ['unknown', 'Unknown']];
  const paymentLabel = paymentMethods.find(([id]) => id === state.paymentMethod)?.[1];
  const removeFilter = (patch: Partial<WorkspaceState>) => { onChange(patch); requestAnimationFrame(() => document.getElementById('reporting-more-filter-button')?.focus()); };
  const focusPeriod = () => requestAnimationFrame(() => document.getElementById('reporting-period')?.focus());
  return <section className="mt-4" aria-label="Reporting filters">
    <div className="grid grid-cols-2 items-end gap-3 xl:grid-cols-[minmax(240px,1.25fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
      <div className="col-span-2 min-w-0 xl:col-span-1">
        <Label htmlFor="reporting-period" className="text-xs">Period</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button id="reporting-period" variant="outline" className="h-11 w-full justify-between gap-2 px-3 font-normal"><CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground"/><span className="min-w-0 truncate">{displayRange(state.dateFrom, state.dateTo)}</span><ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground"/></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-[var(--radix-dropdown-menu-trigger-width)] min-w-64 overflow-y-auto" onCloseAutoFocus={event => { if (editing) { event.preventDefault(); dateInput.current?.focus(); } }}>
            <DropdownMenuItem className="min-h-11 gap-2 font-medium" onSelect={openDates}><CalendarDays className="h-4 w-4"/>Custom range…</DropdownMenuItem>
            <DropdownMenuSeparator/>
            {periods.map(period => <DropdownMenuItem key={period.id} className="min-h-11 gap-2" onSelect={() => { setEditing(false); onChange({ dateFrom: period.dateFrom, dateTo: period.dateTo, comparison: state.comparison === 'none' || state.comparison === 'previous_year' ? state.comparison : period.id.startsWith('month_') || period.id === 'last_month' ? 'previous_month' : 'previous_period' }); }}><Check className={`h-4 w-4 ${active?.id === period.id ? '' : 'invisible'}`}/>{period.label}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="min-w-0"><Label className="text-xs" htmlFor="reporting-location">Location</Label><Select value={state.locationId} onValueChange={locationId => onChange({ locationId, machineId: 'all' })}><SelectTrigger className="h-11" id="reporting-location"><SelectValue placeholder="Select location"/></SelectTrigger><SelectContent><SelectItem value="all" className="min-h-11">All locations</SelectItem>{locations.map(([id, name]) => <SelectItem value={id} key={id} className="min-h-11">{name}</SelectItem>)}</SelectContent></Select></div>
      {salesView && <div className="min-w-0"><Label className="text-xs" htmlFor="reporting-comparison">Compare</Label><Select value={state.comparison} onValueChange={comparison => onChange({ comparison: comparison as WorkspaceState['comparison'] })}><SelectTrigger className="h-11" id="reporting-comparison"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="previous_period" className="min-h-11">Previous period</SelectItem><SelectItem value="previous_month" className="min-h-11">Same days, prior month</SelectItem><SelectItem value="previous_year" className="min-h-11">Same dates, prior year</SelectItem><SelectItem value="none" className="min-h-11">No comparison</SelectItem></SelectContent></Select></div>}
      <Button ref={moreButton} id="reporting-more-filter-button" variant="outline" className="h-11 gap-2" onClick={() => setMore(value => !value)} aria-expanded={more} aria-controls="reporting-more-filters"><SlidersHorizontal className="h-4 w-4"/>More filters{activeScopeCount > 0 && <span className="rounded bg-secondary px-1.5 text-xs">{activeScopeCount}</span>}</Button>
    </div>
    {activeScopeCount > 0 && <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Active report filters">
      {state.machineId !== 'all' && <Button variant="secondary" className="min-h-11 h-auto max-w-full gap-2 whitespace-normal py-2 text-left" aria-label={`Remove machine filter: ${machineLabel}`} onClick={() => removeFilter({ machineId: 'all' })}><span className="min-w-0 break-words">Machine: {machineLabel}</span><X className="h-4 w-4 shrink-0" aria-hidden="true"/></Button>}
      {salesView && state.paymentMethod !== 'all' && <Button variant="secondary" className="min-h-11 h-auto max-w-full gap-2 whitespace-normal py-2 text-left" aria-label={`Remove payment method filter: ${paymentLabel}`} onClick={() => removeFilter({ paymentMethod: 'all' })}><span className="min-w-0 break-words">Payment method: {paymentLabel}</span><X className="h-4 w-4 shrink-0" aria-hidden="true"/></Button>}
    </div>}
    {editing && <form className="mt-3 grid min-w-0 grid-cols-2 items-end gap-3 rounded-lg border border-border bg-secondary/25 p-3 sm:flex sm:flex-wrap" onSubmit={event => { event.preventDefault(); if (!invalid) { onChange({ dateFrom: from, dateTo: to }); setEditing(false); focusPeriod(); } }} aria-label="Custom reporting dates">
      <div className="min-w-0 sm:flex-1"><Label htmlFor="reporting-from">From</Label><Input ref={dateInput} id="reporting-from" type="date" className="h-11 min-w-0 max-w-full" value={from} onChange={event => setFrom(event.target.value)} aria-describedby={invalid ? 'reporting-date-error' : undefined}/></div>
      <div className="min-w-0 sm:flex-1"><Label htmlFor="reporting-to">Through</Label><Input id="reporting-to" type="date" className="h-11 min-w-0 max-w-full" value={to} onChange={event => setTo(event.target.value)} aria-describedby={invalid ? 'reporting-date-error' : undefined}/></div>
      <Button type="submit" className="h-11" disabled={Boolean(invalid)}>Apply dates</Button><Button type="button" variant="ghost" className="h-11" onClick={() => { setEditing(false); focusPeriod(); }}>Cancel</Button>
      {invalid && <p id="reporting-date-error" role="status" className="col-span-2 w-full text-sm text-destructive">{invalid}</p>}
    </form>}
    {more && <div id="reporting-more-filters" className="mt-3 grid gap-3 rounded-lg border border-border bg-secondary/25 p-3 sm:grid-cols-2">
      <div className="min-w-0"><Label htmlFor="reporting-machine">Machine</Label><Select value={state.machineId} onValueChange={machineId => onChange({ machineId })}><SelectTrigger id="reporting-machine" className="h-11"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all" className="min-h-11">All accessible machines</SelectItem>{machines.map(item => <SelectItem key={item.machineId} value={item.machineId} className="min-h-11">{item.machineLabel}</SelectItem>)}</SelectContent></Select></div>
      {salesView && <div className="min-w-0"><Label htmlFor="reporting-tender">Payment method</Label><Select value={state.paymentMethod} onValueChange={paymentMethod => onChange({ paymentMethod: paymentMethod as WorkspaceState['paymentMethod'] })}><SelectTrigger id="reporting-tender" className="h-11"><SelectValue/></SelectTrigger><SelectContent>{paymentMethods.map(([id,label]) => <SelectItem value={id} key={id} className="min-h-11">{label}</SelectItem>)}</SelectContent></Select></div>}
      {(state.locationId !== 'all' || activeScopeCount > 0) && <Button variant="link" className="h-11 justify-self-start px-0" onClick={() => onChange({ locationId: 'all', machineId: 'all', ...(salesView ? { paymentMethod: 'all' as const } : {}) })}>Reset filters</Button>}
    </div>}
  </section>;
}
