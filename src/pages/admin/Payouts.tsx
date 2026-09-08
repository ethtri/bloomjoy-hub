import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  Clock3,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  UserRound,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  fetchTechnicianPayReportContext,
  type TechnicianPayReportTechnician,
} from '@/lib/operatorPayouts';
import { getTodayInTimekeepingZone } from '@/lib/timekeepingUi';
import { cn } from '@/lib/utils';

const currentMonthValue = () => getTodayInTimekeepingZone().slice(0, 7);

const formatCurrency = (cents: number | null | undefined) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(
    (cents ?? 0) / 100
  );

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  if (!remainder) return `${hours} hr${hours === 1 ? '' : 's'}`;
  return `${hours} hr ${remainder} min`;
};

const formatDate = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${value}T12:00:00.000Z`))
    : '—';

const formatMonth = (month: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T12:00:00.000Z`)
  );

const formatRate = (basisPoints: number | null | undefined) =>
  `${((basisPoints ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;

const Metric = ({
  label,
  value,
  helper,
  icon: Icon,
}: {
  label: string;
  value: string;
  helper: string;
  icon: typeof Clock3;
}) => (
  <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
      </div>
      <span className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></span>
    </div>
  </div>
);

const BreakdownRow = ({ label, detail, amount }: { label: string; detail: ReactNode; amount: string }) => (
  <div className="grid gap-1 border-t border-border py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_auto] sm:items-center sm:gap-4">
    <p className="font-medium text-foreground">{label}</p>
    <div className="text-sm text-muted-foreground">{detail}</div>
    <p className="text-base font-semibold text-foreground sm:text-right">{amount}</p>
  </div>
);

const issueKey = (issue: { code: string; message: string }, index: number) =>
  `${issue.code}-${issue.message}-${index}`;

function TechnicianReport({ technician }: { technician: TechnicianPayReportTechnician }) {
  const issues = [...technician.blockers, ...technician.warnings];

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <header className="border-b border-border bg-muted/25 p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">{technician.displayName}</h2>
              <Badge variant="outline">{technician.workerType || 'Contractor'}</Badge>
              {technician.publishable ? (
                <Badge className="border-sage/30 bg-sage-light text-foreground">Ready</Badge>
              ) : (
                <Badge variant="destructive">Needs attention</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {technician.workerIdentifier || technician.positionTitle || 'Technician'}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Current total</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{formatCurrency(technician.currentTotalCents)}</p>
          </div>
        </div>
      </header>

      {issues.length > 0 && (
        <section className="border-b border-border p-4 sm:p-5" aria-labelledby={`issues-${technician.operatorProfileId}`}>
          <h3 id={`issues-${technician.operatorProfileId}`} className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 text-amber-700" /> Calculation issues
          </h3>
          <div className="mt-3 space-y-2">
            {issues.map((issue, index) => (
              <div
                key={issueKey(issue, index)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-sm',
                  issue.severity === 'blocker'
                    ? 'border-destructive/30 bg-destructive/5 text-destructive'
                    : 'border-amber-300/60 bg-amber-50 text-amber-950'
                )}
                role={issue.severity === 'blocker' ? 'alert' : undefined}
              >
                <span className="font-semibold">{issue.severity === 'blocker' ? 'Blocks publishing: ' : 'Check: '}</span>
                {issue.message}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="p-4 sm:p-5" aria-labelledby={`shift-pay-${technician.operatorProfileId}`}>
        <h3 id={`shift-pay-${technician.operatorProfileId}`} className="font-semibold text-foreground">Shift pay</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Every started hour is one paid shift. A 61-minute entry is two shifts.
        </p>
        <div className="mt-3 rounded-lg border border-border px-3">
          {technician.shiftRateLines.length ? technician.shiftRateLines.map((line, index) => (
            <BreakdownRow
              key={`${line.shiftRateCents}-${line.firstWorkDate}-${index}`}
              label={`${line.paidShifts} shift${line.paidShifts === 1 ? '' : 's'} × ${formatCurrency(line.shiftRateCents)}`}
              detail={<>{formatDuration(line.actualDurationMinutes)} actual · {formatDate(line.firstWorkDate)}–{formatDate(line.lastWorkDate)}</>}
              amount={formatCurrency(line.shiftEarningsCents)}
            />
          )) : <p className="py-4 text-sm text-muted-foreground">No paid shifts in this month.</p>}
        </div>
      </section>

      <section className="border-t border-border p-4 sm:p-5" aria-labelledby={`commission-${technician.operatorProfileId}`}>
        <h3 id={`commission-${technician.operatorProfileId}`} className="font-semibold text-foreground">Machine sales and commission</h3>
        <p className="mt-1 text-sm text-muted-foreground">Sales are shown so the commission amount can be checked.</p>
        <div className="mt-3 rounded-lg border border-border px-3">
          {technician.machines.length ? technician.machines.map((machine) => (
            <BreakdownRow
              key={machine.machineId}
              label={machine.machineLabel}
              detail={
                <>
                  <span>{machine.locationName} · {formatCurrency(machine.commissionableSalesCents)} commissionable sales × {formatRate(machine.commissionBasisPoints)}</span>
                  {machine.refundAdjustmentCents !== 0 && <span className="mt-1 block">Includes {formatCurrency(machine.refundAdjustmentCents)} refund adjustment</span>}
                </>
              }
              amount={formatCurrency(machine.commissionEarningsCents)}
            />
          )) : <p className="py-4 text-sm text-muted-foreground">No commissionable machine sales in this month.</p>}
        </div>
      </section>

      <section className="border-t border-border p-4 sm:p-5" aria-labelledby={`other-pay-${technician.operatorProfileId}`}>
        <h3 id={`other-pay-${technician.operatorProfileId}`} className="font-semibold text-foreground">Other earnings</h3>
        <div className="mt-3 rounded-lg border border-border px-3">
          {technician.otherEarnings.length ? technician.otherEarnings.map((earning) => (
            <BreakdownRow
              key={earning.id}
              label={earning.type === 'bonus' ? 'Bonus' : earning.type === 'supply_credit' ? 'Supply Credit' : 'Expense Reimbursement'}
              detail={<>{earning.description || 'No description'} · {formatDate(earning.effectiveStartDate)}</>}
              amount={formatCurrency(earning.amountCents)}
            />
          )) : <p className="py-4 text-sm text-muted-foreground">No bonuses, supply credits, or expense reimbursements.</p>}
        </div>
      </section>

      <footer className="grid gap-2 border-t border-border bg-muted/20 p-4 text-sm sm:grid-cols-4 sm:p-5">
        <div><span className="text-muted-foreground">Shift earnings</span><strong className="mt-1 block text-foreground">{formatCurrency(technician.shiftEarningsCents)}</strong></div>
        <div><span className="text-muted-foreground">Commission</span><strong className="mt-1 block text-foreground">{formatCurrency(technician.commissionEarningsCents)}</strong></div>
        <div><span className="text-muted-foreground">Other earnings</span><strong className="mt-1 block text-foreground">{formatCurrency(technician.bonusCents + technician.supplyCreditCents + technician.expenseReimbursementCents)}</strong></div>
        <div><span className="text-muted-foreground">Current total</span><strong className="mt-1 block text-lg text-foreground">{formatCurrency(technician.currentTotalCents)}</strong></div>
      </footer>
    </article>
  );
}

export default function AdminPayoutsPage() {
  const [month, setMonth] = useState(currentMonthValue);
  const [accountId, setAccountId] = useState('all');
  const [technicianId, setTechnicianId] = useState('all');
  const [machineId, setMachineId] = useState('all');

  const { data: context, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['technician-pay-report', month],
    queryFn: () => fetchTechnicianPayReportContext(month),
    staleTime: 20_000,
    retry: false,
  });

  const technicians = useMemo(() => context?.technicians ?? [], [context?.technicians]);
  const machines = useMemo(
    () => [...new Map(technicians.flatMap((technician) => technician.machines.map((machine) => [machine.machineId, machine.machineLabel] as const))).entries()].map(([id, label]) => ({ id, label })).sort((left, right) => left.label.localeCompare(right.label)),
    [technicians]
  );
  const visibleTechnicians = useMemo(
    () => technicians.filter((technician) =>
      (accountId === 'all' || technician.accountId === accountId) &&
      (technicianId === 'all' || technician.operatorProfileId === technicianId) &&
      (machineId === 'all' || technician.machines.some((machine) => machine.machineId === machineId))
    ),
    [accountId, machineId, technicianId, technicians]
  );
  const totalPaidShifts = visibleTechnicians.reduce((sum, technician) => sum + technician.paidShifts, 0);
  const totalCommissionableSales = visibleTechnicians.reduce((sum, technician) => sum + technician.commissionableSalesCents, 0);
  const currentTotal = visibleTechnicians.reduce((sum, technician) => sum + technician.currentTotalCents, 0);
  const blockerCount = visibleTechnicians.reduce((sum, technician) => sum + technician.blockers.length, 0);

  return (
    <AppLayout>
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-sm font-medium text-primary"><Banknote className="h-4 w-4" /> Manager report</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Technician Pay Report</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Check paid shifts, rate changes, machine sales, commission, and other earnings. This report does not approve or send payment.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="min-h-8 gap-1.5 px-3"><CalendarDays className="h-3.5 w-3.5" /> {formatMonth(month)}</Badge>
            <Button type="button" variant="outline" className="min-h-11" disabled={isFetching} onClick={() => void refetch()}>
              <RefreshCw className={cn('mr-2 h-4 w-4', isFetching && 'animate-spin motion-reduce:animate-none')} /> Refresh
            </Button>
          </div>
        </header>

        {isLoading ? (
          <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin motion-reduce:animate-none" />Loading the Technician Pay Report…</div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6" role="alert">
            <h2 className="font-semibold text-foreground">Pay Report unavailable</h2>
            <p className="mt-2 text-sm text-muted-foreground">Account-level pay access is required. If you should have access, ask a Bloomjoy owner to confirm your account role.</p>
            <Button type="button" className="mt-5 min-h-11" onClick={() => void refetch()}>Try again</Button>
          </div>
        ) : !context?.hasAccess ? (
          <div className="rounded-xl border border-border bg-card p-6">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            <h2 className="mt-3 font-semibold text-foreground">Account pay authority required</h2>
            <p className="mt-2 text-sm text-muted-foreground">Machine Managers can correct time in the Time Report, but pay details are limited to account-level pay managers.</p>
          </div>
        ) : (
          <>
            <section className="grid gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4" aria-label="Pay Report filters">
              <div><label htmlFor="pay-report-month" className="text-sm font-medium text-foreground">Month</label><Input id="pay-report-month" type="month" value={month} max={currentMonthValue()} className="mt-2 min-h-11" onChange={(event) => setMonth(event.target.value)} /></div>
              <div><label htmlFor="pay-report-account" className="text-sm font-medium text-foreground">Account</label><Select value={accountId} onValueChange={setAccountId}><SelectTrigger id="pay-report-account" className="mt-2 min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All accounts</SelectItem>{context.accounts.map((account) => <SelectItem key={account.accountId} value={account.accountId}>{account.accountName}</SelectItem>)}</SelectContent></Select></div>
              <div><label htmlFor="pay-report-technician" className="text-sm font-medium text-foreground">Technician</label><Select value={technicianId} onValueChange={setTechnicianId}><SelectTrigger id="pay-report-technician" className="mt-2 min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Technicians</SelectItem>{technicians.map((technician) => <SelectItem key={technician.operatorProfileId} value={technician.operatorProfileId}>{technician.displayName}</SelectItem>)}</SelectContent></Select></div>
              <div><label htmlFor="pay-report-machine" className="text-sm font-medium text-foreground">Machine</label><Select value={machineId} onValueChange={setMachineId}><SelectTrigger id="pay-report-machine" className="mt-2 min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All machines</SelectItem>{machines.map((machine) => <SelectItem key={machine.id} value={machine.id}>{machine.label}</SelectItem>)}</SelectContent></Select></div>
            </section>

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-live="polite">
              <Metric label="Paid shifts" value={`${totalPaidShifts}`} helper="Each started hour" icon={Clock3} />
              <Metric label="Commissionable sales" value={formatCurrency(totalCommissionableSales)} helper="After one refund adjustment" icon={ShoppingBag} />
              <Metric label="Current total" value={formatCurrency(currentTotal)} helper="Before payment or tax" icon={Banknote} />
              <Metric label="Technicians" value={`${visibleTechnicians.length}`} helper={blockerCount ? `${blockerCount} publishing blocker${blockerCount === 1 ? '' : 's'}` : 'No publishing blockers'} icon={UserRound} />
            </section>

            {blockerCount > 0 && (
              <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:p-5" role="alert">
                <h2 className="flex items-center gap-2 font-semibold text-foreground"><AlertTriangle className="h-5 w-5 text-destructive" />Resolve {blockerCount} publishing blocker{blockerCount === 1 ? '' : 's'}</h2>
                <p className="mt-2 text-sm text-muted-foreground">The report stays visible for checking, but affected pay stubs should not publish until these data issues are resolved.</p>
              </section>
            )}

            <section className="space-y-5" aria-label="Technician pay details">
              {visibleTechnicians.length ? visibleTechnicians.map((technician) => <TechnicianReport key={technician.operatorProfileId} technician={technician} />) : (
                <div className="rounded-xl border border-dashed border-border bg-card p-6"><h2 className="font-semibold text-foreground">No matching pay details</h2><p className="mt-2 text-sm text-muted-foreground">Change the filters or choose another month.</p></div>
              )}
            </section>

            <p className="text-xs leading-5 text-muted-foreground">
              Report totals are calculation records for contractor pay stubs. They do not record proof of payment, calculate taxes, or change contractor classification.
            </p>
          </>
        )}
      </div>
    </AppLayout>
  );
}
