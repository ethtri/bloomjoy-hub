import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  fetchTimekeepingSetupContext,
  refreshTechnicianPayReportSalesAdmin,
  requestPayStubGenerationAdmin,
  setupTimekeepingTechnicianAdmin,
  supersedeOperatorCompensationRateAdmin,
  upsertOperatorRecurringItemAdmin,
  type OperatorWorkerType,
  type OperatorRecurringCompensationItemType,
  type TechnicianPayReportEntry,
  type TechnicianPayReportOtherEarning,
  type TechnicianPayReportShiftRateLine,
  type TechnicianPayReportTechnician,
} from '@/lib/operatorPayouts';
import { getTodayInTimekeepingZone } from '@/lib/timekeepingUi';
import { cn } from '@/lib/utils';

const currentMonthValue = () => getTodayInTimekeepingZone().slice(0, 7);
const TECHNICIAN_DEFAULT_MACHINE = 'technician-default';
const isMonthValue = (value: string) => /^\d{4}-\d{2}$/.test(value);

type PayInputKind = 'shift' | 'commission' | OperatorRecurringCompensationItemType;

type PayInputDraft = {
  technician: TechnicianPayReportTechnician;
  kind: PayInputKind;
  itemId: string | null;
  machineId: string;
  value: string;
  description: string;
  effectiveStartDate: string;
  effectiveEndDate: string;
};

type TechnicianSetupDraft = {
  userEmail: string;
  displayName: string;
  workerType: OperatorWorkerType;
  workerIdentifier: string;
  accountId: string;
  machineIds: string[];
  shiftRate: string;
  commissionRate: string;
  effectiveStartDate: string;
};

const newTechnicianSetupDraft = (): TechnicianSetupDraft => ({
  userEmail: '',
  displayName: '',
  workerType: 'contractor_1099',
  workerIdentifier: '',
  accountId: '',
  machineIds: [],
  shiftRate: '',
  commissionRate: '',
  effectiveStartDate: getTodayInTimekeepingZone(),
});

const workerTypeOptions: Array<{ value: OperatorWorkerType; label: string }> = [
  { value: 'contractor_1099', label: 'Independent contractor' },
  { value: 'employee_w2', label: 'Employee' },
  { value: 'part_time_employee', label: 'Part-time employee' },
  { value: 'owner_operator', label: 'Owner / operator' },
  { value: 'partner', label: 'Partner' },
  { value: 'other', label: 'Other' },
];

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
  isMonthValue(month)
    ? new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${month}-01T12:00:00.000Z`)
      )
    : 'Selected month';

const formatRate = (basisPoints: number | null | undefined) =>
  `${((basisPoints ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;

const formatWorkerType = (value: string | null | undefined) => {
  if (value === 'contractor_1099') return 'Independent contractor';
  if (value === 'employee_w2') return 'Employee';
  return value?.replaceAll('_', ' ') || 'Technician';
};

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

const BreakdownRow = ({ label, detail, amount }: { label: string; detail: ReactNode; amount: ReactNode }) => (
  <div className="grid gap-1 border-t border-border py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_auto] sm:items-center sm:gap-4">
    <p className="font-medium text-foreground">{label}</p>
    <div className="text-sm text-muted-foreground">{detail}</div>
    <div className="text-base font-semibold text-foreground sm:text-right">{amount}</div>
  </div>
);

const issueKey = (issue: { code: string; message: string }, index: number) =>
  `${issue.code}-${issue.message}-${index}`;

const unresolvedCommissionCodes = new Set([
  'commission_rate_changed_within_snapshot',
  'partial_period_assignment_scope',
  'shared_machine_compensation_scope',
  'missing_revenue_snapshot',
  'missing_commission_sales_facts',
  'stale_commission_sales_facts',
  'revenue_snapshot_fact_mismatch',
  'cross_rate_refund_allocation_ambiguous',
  'missing_commission_rate',
  'missing_machine_tax_rate',
]);

const hasUnresolvedCommission = (technician: TechnicianPayReportTechnician) =>
  technician.blockers.some((issue) => unresolvedCommissionCodes.has(issue.code));

const hasMissingShiftRate = (technician: TechnicianPayReportTechnician) =>
  technician.shiftRateLines.some((line) => line.shiftRateCents == null) ||
  technician.blockers.some((issue) => issue.code === 'missing_shift_rate');

const buildShiftRateLines = (
  entries: TechnicianPayReportEntry[]
): TechnicianPayReportShiftRateLine[] => {
  const groups = new Map<string, TechnicianPayReportShiftRateLine>();
  for (const entry of entries) {
    const key = entry.shiftRateCents == null ? 'missing' : String(entry.shiftRateCents);
    const current = groups.get(key);
    if (current) {
      current.paidShifts += entry.paidShifts;
      current.actualDurationMinutes += entry.actualDurationMinutes;
      current.shiftEarningsCents += entry.shiftEarningsCents;
      if (entry.workDate < current.firstWorkDate) current.firstWorkDate = entry.workDate;
      if (entry.workDate > current.lastWorkDate) current.lastWorkDate = entry.workDate;
    } else {
      groups.set(key, {
        shiftRateCents: entry.shiftRateCents,
        paidShifts: entry.paidShifts,
        actualDurationMinutes: entry.actualDurationMinutes,
        shiftEarningsCents: entry.shiftEarningsCents,
        firstWorkDate: entry.workDate,
        lastWorkDate: entry.workDate,
      });
    }
  }
  return [...groups.values()].sort((left, right) =>
    left.firstWorkDate.localeCompare(right.firstWorkDate)
  );
};

const scopeTechnicianToMachine = (
  technician: TechnicianPayReportTechnician,
  machineId: string
): TechnicianPayReportTechnician => {
  const entries = technician.entries.filter((entry) => entry.machineId === machineId);
  const machines = technician.machines.filter((machine) => machine.machineId === machineId);
  const blockers = technician.blockers;
  const warnings = technician.warnings.filter((issue) => !issue.machineId || issue.machineId === machineId);
  const shiftEarningsCents = entries.reduce((sum, entry) => sum + entry.shiftEarningsCents, 0);
  const commissionEarningsCents = machines.reduce((sum, machine) => sum + machine.commissionEarningsCents, 0);
  return {
    ...technician,
    actualDurationMinutes: entries.reduce((sum, entry) => sum + entry.actualDurationMinutes, 0),
    paidShifts: entries.reduce((sum, entry) => sum + entry.paidShifts, 0),
    shiftEarningsCents,
    taxCents: machines.reduce((sum, machine) => sum + (machine.taxCents ?? 0), 0),
    commissionableSalesCents: machines.reduce((sum, machine) => sum + machine.commissionableSalesCents, 0),
    commissionEarningsCents,
    bonusCents: 0,
    supplyCreditCents: 0,
    expenseReimbursementCents: 0,
    currentTotalCents: shiftEarningsCents + commissionEarningsCents,
    publishable: technician.publishable,
    entries,
    shiftRateLines: buildShiftRateLines(entries),
    machines,
    otherEarnings: [],
    blockers,
    warnings,
  };
};

function TechnicianReport({
  technician,
  onAddShiftRate,
  onAddCommissionRate,
  onAddOtherEarning,
  onEditOtherEarning,
  onGeneratePayStub,
  isGeneratingPayStub,
}: {
  technician: TechnicianPayReportTechnician;
  onAddShiftRate: () => void;
  onAddCommissionRate: () => void;
  onAddOtherEarning: () => void;
  onEditOtherEarning: (earning: TechnicianPayReportOtherEarning) => void;
  onGeneratePayStub: () => void;
  isGeneratingPayStub: boolean;
}) {
  const issues = [...technician.blockers, ...technician.warnings];
  const commissionUnavailable = hasUnresolvedCommission(technician);
  const shiftPayUnavailable = hasMissingShiftRate(technician);
  const totalUnavailable = technician.blockers.length > 0;

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <header className="border-b border-border bg-muted/25 p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">{technician.displayName}</h2>
              <Badge variant="outline">{formatWorkerType(technician.workerType)}</Badge>
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
            <p className="mt-1 text-2xl font-semibold text-foreground">
              {totalUnavailable ? 'Unavailable' : formatCurrency(technician.currentTotalCents)}
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-3 min-h-11"
              disabled={!technician.publishable || isGeneratingPayStub}
              onClick={onGeneratePayStub}
            >
              {isGeneratingPayStub ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Banknote className="mr-2 h-4 w-4" />}
              {isGeneratingPayStub ? 'Publishing…' : 'Publish Pay Stub'}
            </Button>
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id={`shift-pay-${technician.operatorProfileId}`} className="font-semibold text-foreground">Shift pay</h3>
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onAddShiftRate}>
            <Plus className="mr-2 h-4 w-4" /> Add rate change
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Every started hour is one paid shift. A 61-minute entry is two shifts.
        </p>
        <div className="mt-3 rounded-lg border border-border px-3">
          {technician.shiftRateLines.length ? technician.shiftRateLines.map((line, index) => (
            <BreakdownRow
              key={`${line.shiftRateCents}-${line.firstWorkDate}-${index}`}
              label={`${line.paidShifts} shift${line.paidShifts === 1 ? '' : 's'} × ${line.shiftRateCents == null ? 'Rate missing' : formatCurrency(line.shiftRateCents)}`}
              detail={<>{formatDuration(line.actualDurationMinutes)} actual · {formatDate(line.firstWorkDate)}–{formatDate(line.lastWorkDate)}</>}
              amount={line.shiftRateCents == null ? 'Unavailable' : formatCurrency(line.shiftEarningsCents)}
            />
          )) : <p className="py-4 text-sm text-muted-foreground">No paid shifts in this month.</p>}
        </div>
      </section>

      <section className="border-t border-border p-4 sm:p-5" aria-labelledby={`commission-${technician.operatorProfileId}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id={`commission-${technician.operatorProfileId}`} className="font-semibold text-foreground">Machine sales and commission</h3>
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onAddCommissionRate} disabled={!technician.machines.length}>
            <Plus className="mr-2 h-4 w-4" /> Add commission rate
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Commission is calculated as (sales − refunds − estimated sales tax) × the contractor’s commission rate.
        </p>
        <div className="mt-3 rounded-lg border border-border px-3">
          {technician.machines.length ? technician.machines.map((machine) => {
            const machineEntries = technician.entries.filter((entry) => entry.machineId === machine.machineId);
            const machineActualMinutes = machineEntries.reduce((sum, entry) => sum + entry.actualDurationMinutes, 0);
            const machinePaidShifts = machineEntries.reduce((sum, entry) => sum + entry.paidShifts, 0);
            const hasIncompleteCommissionSegment = machine.commissionSegments.some(
              (segment) => segment.commissionBasisPoints == null
            );
            const machineCommissionUnavailable = hasIncompleteCommissionSegment || technician.blockers.some(
              (issue) => unresolvedCommissionCodes.has(issue.code) && (!issue.machineId || issue.machineId === machine.machineId)
            );
            const machineSalesUnavailable = machine.revenueSnapshotId == null;
            return (
              <BreakdownRow
                key={machine.machineId}
                label={machine.machineLabel}
                detail={
                  <>
                    <span>{machine.locationName} · {formatDuration(machineActualMinutes)} actual · {machinePaidShifts} paid {machinePaidShifts === 1 ? 'shift' : 'shifts'}</span>
                    {machineSalesUnavailable ? (
                      <span className="mt-1 block">
                        Commissionable Sales unavailable{machine.commissionBasisPoints == null ? '' : ` × ${formatRate(machine.commissionBasisPoints)}`}
                      </span>
                    ) : machine.commissionSegments.length ? (
                      <span className="mt-2 block space-y-1.5">
                        {machine.commissionSegments.map((segment) => (
                          <span
                            key={`${segment.segmentStartDate}-${segment.segmentEndDate}-${segment.commissionBasisPoints ?? 'missing'}`}
                            className="block rounded-md bg-muted/50 px-2 py-1.5"
                          >
                            <span className="font-medium text-foreground">
                              {formatDate(segment.segmentStartDate)}–{formatDate(segment.segmentEndDate)}
                            </span>
                            <span className="mt-0.5 block">
                              {formatCurrency(segment.grossSalesCents)} sales − {formatCurrency(Math.abs(segment.refundAdjustmentCents ?? 0))} refunds − {formatCurrency(Math.abs(segment.taxCents ?? 0))} tax ({segment.taxRatePercent == null ? 'rate missing' : `${segment.taxRatePercent}%`})
                            </span>
                            <span className="mt-0.5 block font-medium text-foreground">
                              {formatCurrency(segment.commissionableSalesCents)} × {segment.commissionBasisPoints == null ? 'commission rate missing' : formatRate(segment.commissionBasisPoints)} = {machineCommissionUnavailable ? 'Allocation unavailable' : formatCurrency(segment.commissionEarningsCents)}
                            </span>
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="mt-1 block">
                        {formatCurrency(machine.commissionableSalesCents)} commissionable sales · No dated commission segment
                      </span>
                    )}
                    <span className="mt-1 block">
                      Machine totals: {formatCurrency(machine.grossSalesCents)} sales − {formatCurrency(Math.abs(machine.refundAdjustmentCents ?? 0))} refunds − {formatCurrency(Math.abs(machine.taxCents ?? 0))} estimated sales tax
                    </span>
                  </>
                }
                amount={machineCommissionUnavailable ? 'Unavailable' : formatCurrency(machine.commissionEarningsCents)}
              />
            );
          }) : <p className="py-4 text-sm text-muted-foreground">No commissionable machine sales in this month.</p>}
        </div>
      </section>

      <section className="border-t border-border p-4 sm:p-5" aria-labelledby={`other-pay-${technician.operatorProfileId}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id={`other-pay-${technician.operatorProfileId}`} className="font-semibold text-foreground">Other earnings</h3>
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onAddOtherEarning}>
            <Plus className="mr-2 h-4 w-4" /> Add other earning
          </Button>
        </div>
        <div className="mt-3 rounded-lg border border-border px-3">
          {technician.otherEarnings.length ? technician.otherEarnings.map((earning) => (
            <BreakdownRow
              key={earning.id}
              label={earning.type === 'bonus' ? 'Bonus' : earning.type === 'supply_credit' ? 'Supply Credit' : 'Expense Reimbursement'}
              detail={<>{earning.description || 'No description'} · {formatDate(earning.effectiveStartDate)}</>}
              amount={
                <div className="flex items-center gap-2 sm:justify-end">
                  <span>{formatCurrency(earning.amountCents)}</span>
                  <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => onEditOtherEarning(earning)}>Edit</Button>
                </div>
              }
            />
          )) : <p className="py-4 text-sm text-muted-foreground">No bonuses, supply credits, or expense reimbursements.</p>}
        </div>
      </section>

      <footer className="grid gap-2 border-t border-border bg-muted/20 p-4 text-sm sm:grid-cols-4 sm:p-5">
        <div><span className="text-muted-foreground">Shift earnings</span><strong className="mt-1 block text-foreground">{shiftPayUnavailable ? 'Unavailable' : formatCurrency(technician.shiftEarningsCents)}</strong></div>
        <div><span className="text-muted-foreground">Commission</span><strong className="mt-1 block text-foreground">{commissionUnavailable ? 'Unavailable' : formatCurrency(technician.commissionEarningsCents)}</strong></div>
        <div><span className="text-muted-foreground">Other earnings</span><strong className="mt-1 block text-foreground">{formatCurrency(technician.bonusCents + technician.supplyCreditCents + technician.expenseReimbursementCents)}</strong></div>
        <div><span className="text-muted-foreground">Current total</span><strong className="mt-1 block text-lg text-foreground">{totalUnavailable ? 'Unavailable' : formatCurrency(technician.currentTotalCents)}</strong></div>
      </footer>
    </article>
  );
}

export default function AdminPayoutsPage() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonthValue);
  const [accountId, setAccountId] = useState('all');
  const [technicianId, setTechnicianId] = useState('all');
  const [machineId, setMachineId] = useState('all');
  const [payInputDraft, setPayInputDraft] = useState<PayInputDraft | null>(null);
  const [payInputError, setPayInputError] = useState<string | null>(null);
  const [setupDraft, setSetupDraft] = useState<TechnicianSetupDraft | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [generatingProfileId, setGeneratingProfileId] = useState<string | null>(null);

  const { data: context, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['technician-pay-report', month],
    queryFn: () => fetchTechnicianPayReportContext(month),
    staleTime: 20_000,
    retry: false,
  });

  const setupContextQuery = useQuery({
    queryKey: ['timekeeping-setup-context'],
    queryFn: fetchTimekeepingSetupContext,
    staleTime: 60_000,
    retry: false,
    enabled: Boolean(setupDraft),
  });

  const technicians = useMemo(() => context?.technicians ?? [], [context?.technicians]);
  const machines = useMemo(
    () => [...new Map(technicians.flatMap((technician) => technician.machines.map((machine) => [machine.machineId, machine.machineLabel] as const))).entries()].map(([id, label]) => ({ id, label })).sort((left, right) => left.label.localeCompare(right.label)),
    [technicians]
  );
  const visibleTechnicians = useMemo(
    () => technicians
      .filter((technician) =>
        (accountId === 'all' || technician.accountId === accountId) &&
        (technicianId === 'all' || technician.operatorProfileId === technicianId) &&
        (machineId === 'all' || technician.machines.some((machine) => machine.machineId === machineId))
      )
      .map((technician) =>
        machineId === 'all' ? technician : scopeTechnicianToMachine(technician, machineId)
      ),
    [accountId, machineId, technicianId, technicians]
  );
  const totalPaidShifts = visibleTechnicians.reduce((sum, technician) => sum + technician.paidShifts, 0);
  const totalEstimatedTax = visibleTechnicians.reduce((sum, technician) => sum + (technician.taxCents ?? 0), 0);
  const totalCommissionableSales = visibleTechnicians.reduce((sum, technician) => sum + technician.commissionableSalesCents, 0);
  const currentTotal = visibleTechnicians.reduce((sum, technician) => sum + technician.currentTotalCents, 0);
  const blockerCount = visibleTechnicians.reduce((sum, technician) => sum + technician.blockers.length, 0);
  const totalsUnavailable = visibleTechnicians.some((technician) => technician.blockers.length > 0);
  const commissionableSalesUnavailable = visibleTechnicians.some((technician) =>
    technician.machines.some((machine) => machine.revenueSnapshotId == null)
  );
  const setupMachines = setupContextQuery.data?.accounts.find(
    (account) => account.accountId === setupDraft?.accountId
  )?.machines ?? [];

  const openTechnicianSetup = () => {
    setSetupError(null);
    setSetupDraft(newTechnicianSetupDraft());
  };

  const saveTechnicianSetup = useMutation({
    mutationFn: async (draft: TechnicianSetupDraft) => {
      const shiftRate = Number(draft.shiftRate);
      const commissionRate = Number(draft.commissionRate);
      if (!draft.userEmail.trim() || !draft.userEmail.includes('@')) {
        throw new Error('Enter the email used for the Technician invitation.');
      }
      if (!draft.displayName.trim()) throw new Error('Enter the Technician’s name.');
      if (!draft.accountId) throw new Error('Choose an account.');
      if (!draft.machineIds.length) throw new Error('Choose at least one machine.');
      if (!Number.isFinite(shiftRate) || shiftRate <= 0) {
        throw new Error('Enter pay per shift greater than zero.');
      }
      if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) {
        throw new Error('Enter a commission percent from 0 to 100.');
      }
      if (!draft.effectiveStartDate) throw new Error('Choose the Timekeeping start date.');

      return setupTimekeepingTechnicianAdmin({
        userEmail: draft.userEmail.trim(),
        accountId: draft.accountId,
        displayName: draft.displayName.trim(),
        workerType: draft.workerType,
        workerIdentifier: draft.workerIdentifier.trim() || null,
        machineIds: draft.machineIds,
        shiftRateCents: Math.round(shiftRate * 100),
        commissionBasisPoints: Math.round(commissionRate * 100),
        effectiveStartDate: draft.effectiveStartDate,
      });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['technician-pay-report'] });
      setSetupDraft(null);
      setSetupError(null);
      toast.success(`${result.displayName} can now use Timekeeping.`);
    },
    onError: (setupSaveError) => {
      setSetupError(
        setupSaveError instanceof Error
          ? setupSaveError.message
          : 'Unable to activate Timekeeping for this Technician.'
      );
    },
  });

  const openPayInput = (
    technician: TechnicianPayReportTechnician,
    kind: PayInputKind,
    earning?: TechnicianPayReportOtherEarning
  ) => {
    const selectedMachine = machineId === 'all'
      ? null
      : technician.machines.find((machine) => machine.machineId === machineId) ?? null;
    const defaultCommissionRate = technician.machines.find((machine) => machine.commissionRate?.source === 'technician_default')?.commissionBasisPoints;
    const shiftRate = technician.shiftRateLines.find((line) => line.shiftRateCents != null)?.shiftRateCents;
    const isOtherEarning = kind === 'bonus' || kind === 'supply_credit' || kind === 'expense_reimbursement';
    setPayInputError(null);
    setPayInputDraft({
      technician,
      kind,
      itemId: earning?.id ?? null,
      machineId: kind === 'commission' ? selectedMachine?.machineId ?? TECHNICIAN_DEFAULT_MACHINE : '',
      value: earning
        ? (earning.amountCents / 100).toFixed(2)
        : kind === 'shift' && shiftRate != null
          ? (shiftRate / 100).toFixed(2)
          : kind === 'commission' && (selectedMachine?.commissionBasisPoints ?? defaultCommissionRate) != null
            ? ((selectedMachine?.commissionBasisPoints ?? defaultCommissionRate ?? 0) / 100).toFixed(2)
            : '',
      description: earning?.description ?? (isOtherEarning ? '' : ''),
      effectiveStartDate: earning?.effectiveStartDate ?? `${month}-01`,
      effectiveEndDate: earning?.effectiveEndDate
        ?? (kind === 'bonus' || kind === 'expense_reimbursement' ? technician.periodEndDate : ''),
    });
  };

  const savePayInput = useMutation({
    mutationFn: async (draft: PayInputDraft) => {
      const numericValue = Number(draft.value);
      if (!Number.isFinite(numericValue) || numericValue <= 0) {
        throw new Error('Enter an amount greater than zero.');
      }
      if (!draft.effectiveStartDate) throw new Error('Choose an effective start date.');
      if (draft.effectiveEndDate && draft.effectiveEndDate < draft.effectiveStartDate) {
        throw new Error('The end date cannot be before the start date.');
      }

      if (draft.kind === 'shift' || draft.kind === 'commission') {
        if (draft.kind === 'commission' && numericValue > 100) {
          throw new Error('Commission cannot be more than 100%.');
        }
        return supersedeOperatorCompensationRateAdmin({
          accountId: draft.technician.accountId,
          operatorProfileId: draft.technician.operatorProfileId,
          machineId: draft.kind === 'commission' && draft.machineId !== TECHNICIAN_DEFAULT_MACHINE ? draft.machineId : null,
          rateType: draft.kind,
          rateValue: Math.round(numericValue * 100),
          effectiveStartDate: draft.effectiveStartDate,
          effectiveEndDate: draft.effectiveEndDate || null,
        });
      }

      if (!draft.description.trim()) throw new Error('Add a short description.');
      return upsertOperatorRecurringItemAdmin({
        itemId: draft.itemId,
        accountId: draft.technician.accountId,
        operatorProfileId: draft.technician.operatorProfileId,
        itemType: draft.kind,
        description: draft.description.trim(),
        amountCents: Math.round(numericValue * 100),
        effectiveStartDate: draft.effectiveStartDate,
        effectiveEndDate: draft.effectiveEndDate || null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['technician-pay-report'] });
      setPayInputDraft(null);
      setPayInputError(null);
      toast.success('Pay input saved. The report has been refreshed.');
    },
    onError: (saveError) => {
      setPayInputError(saveError instanceof Error ? saveError.message : 'Unable to save this pay input.');
    },
  });

  const refreshSales = useMutation({
    mutationFn: () => refreshTechnicianPayReportSalesAdmin(
      `${month}-01`,
      accountId === 'all' ? null : accountId
    ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['technician-pay-report'] });
      if (result.periodCount === 0) {
        toast.error('No monthly pay period was found for this selection.');
      } else {
        toast.success(`Commissionable Sales refreshed for ${result.snapshotCount} machine${result.snapshotCount === 1 ? '' : 's'}.`);
      }
    },
    onError: (refreshError) => {
      toast.error(refreshError instanceof Error ? refreshError.message : 'Unable to refresh Commissionable Sales.');
    },
  });

  const generatePayStub = useMutation({
    mutationFn: (operatorProfileId: string) => requestPayStubGenerationAdmin(operatorProfileId, month),
    onMutate: (operatorProfileId) => setGeneratingProfileId(operatorProfileId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['technician-pay-report'] });
      toast.success('Pay Stub published. The Technician can download the PDF now.');
    },
    onError: (generationError) => {
      toast.error(generationError instanceof Error ? generationError.message : 'Unable to publish the Pay Stub.');
    },
    onSettled: () => setGeneratingProfileId(null),
  });

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
            <Button type="button" className="min-h-11" onClick={openTechnicianSetup}>
              <Plus className="mr-2 h-4 w-4" /> Set up Technician
            </Button>
            <Button type="button" variant="outline" className="min-h-11" disabled={refreshSales.isPending || isFetching} onClick={() => refreshSales.mutate()}>
              <ShoppingBag className={cn('mr-2 h-4 w-4', refreshSales.isPending && 'animate-pulse motion-reduce:animate-none')} /> Refresh sales
            </Button>
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
              <div><label htmlFor="pay-report-month" className="text-sm font-medium text-foreground">Month</label><Input id="pay-report-month" type="month" value={month} max={currentMonthValue()} className="mt-2 min-h-11" onChange={(event) => { if (isMonthValue(event.target.value)) setMonth(event.target.value); }} /></div>
              <div><label htmlFor="pay-report-account" className="text-sm font-medium text-foreground">Account</label><Select value={accountId} onValueChange={setAccountId}><SelectTrigger id="pay-report-account" className="mt-2 min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All accounts</SelectItem>{context.accounts.map((account) => <SelectItem key={account.accountId} value={account.accountId}>{account.accountName}</SelectItem>)}</SelectContent></Select></div>
              <div><label htmlFor="pay-report-technician" className="text-sm font-medium text-foreground">Technician</label><Select value={technicianId} onValueChange={setTechnicianId}><SelectTrigger id="pay-report-technician" className="mt-2 min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Technicians</SelectItem>{technicians.map((technician) => <SelectItem key={technician.operatorProfileId} value={technician.operatorProfileId}>{technician.displayName}</SelectItem>)}</SelectContent></Select></div>
              <div><label htmlFor="pay-report-machine" className="text-sm font-medium text-foreground">Machine</label><Select value={machineId} onValueChange={setMachineId}><SelectTrigger id="pay-report-machine" className="mt-2 min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All machines</SelectItem>{machines.map((machine) => <SelectItem key={machine.id} value={machine.id}>{machine.label}</SelectItem>)}</SelectContent></Select></div>
            </section>
            {machineId !== 'all' && <p className="-mt-3 text-xs text-muted-foreground">Machine filtering shows only that machine’s time, shift earnings, sales, and commission. Technician-level other earnings are excluded from these filtered totals; publishing status remains month-wide.</p>}

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-live="polite">
              <Metric label="Paid shifts" value={`${totalPaidShifts}`} helper="Each started hour" icon={Clock3} />
              <Metric label="Commissionable sales" value={commissionableSalesUnavailable ? 'Unavailable' : formatCurrency(totalCommissionableSales)} helper={commissionableSalesUnavailable ? 'Refresh required' : `After refunds and ${formatCurrency(totalEstimatedTax)} tax`} icon={ShoppingBag} />
              <Metric label="Current total" value={totalsUnavailable ? 'Unavailable' : formatCurrency(currentTotal)} helper={totalsUnavailable ? 'Resolve calculation blockers' : 'Before payment or tax'} icon={Banknote} />
              <Metric label="Technicians" value={`${visibleTechnicians.length}`} helper={blockerCount ? `${blockerCount} publishing blocker${blockerCount === 1 ? '' : 's'}` : 'No publishing blockers'} icon={UserRound} />
            </section>

            {blockerCount > 0 && (
              <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:p-5" role="alert">
                <h2 className="flex items-center gap-2 font-semibold text-foreground"><AlertTriangle className="h-5 w-5 text-destructive" />Resolve {blockerCount} publishing blocker{blockerCount === 1 ? '' : 's'}</h2>
                <p className="mt-2 text-sm text-muted-foreground">The report stays visible for checking, but affected pay stubs should not publish until these data issues are resolved.</p>
              </section>
            )}

            <section className="space-y-5" aria-label="Technician pay details">
              {visibleTechnicians.length ? visibleTechnicians.map((technician) => (
                <TechnicianReport
                  key={technician.operatorProfileId}
                  technician={technician}
                  onAddShiftRate={() => openPayInput(technician, 'shift')}
                  onAddCommissionRate={() => openPayInput(technician, 'commission')}
                  onAddOtherEarning={() => openPayInput(technician, 'bonus')}
                  onEditOtherEarning={(earning) => openPayInput(technician, earning.type, earning)}
                  onGeneratePayStub={() => generatePayStub.mutate(technician.operatorProfileId)}
                  isGeneratingPayStub={generatingProfileId === technician.operatorProfileId}
                />
              )) : (
                <div className="rounded-xl border border-dashed border-border bg-card p-6">
                  <h2 className="font-semibold text-foreground">{technicians.length ? 'No matching pay details' : 'No Technicians set up yet'}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {technicians.length
                      ? 'Change the filters or choose another month.'
                      : 'After a Technician accepts their portal invitation, add their machines and starting rates here.'}
                  </p>
                  {!technicians.length && <Button type="button" className="mt-5 min-h-11" onClick={openTechnicianSetup}><Plus className="mr-2 h-4 w-4" />Set up first Technician</Button>}
                </div>
              )}
            </section>

            <p className="text-xs leading-5 text-muted-foreground">
              Report totals are calculation records for contractor Pay Stubs. Estimated sales tax is deducted only for commission; this does not record proof of payment, calculate payroll withholding, or change contractor classification.
            </p>
          </>
        )}

        <Dialog open={Boolean(payInputDraft)} onOpenChange={(open) => {
          if (!open && !savePayInput.isPending) {
            setPayInputDraft(null);
            setPayInputError(null);
          }
        }}>
          <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
            {payInputDraft && (
              <form onSubmit={(event) => {
                event.preventDefault();
                setPayInputError(null);
                savePayInput.mutate(payInputDraft);
              }}>
                <DialogHeader>
                  <DialogTitle>
                    {payInputDraft.itemId ? 'Edit' : 'Add'} {payInputDraft.kind === 'shift'
                      ? 'shift rate'
                      : payInputDraft.kind === 'commission'
                        ? 'commission rate'
                        : 'other earning'}
                  </DialogTitle>
                  <DialogDescription>
                    {payInputDraft.technician.displayName} · Changes take effect on the date you choose and refresh this report. No approval or edit reason is required.
                  </DialogDescription>
                </DialogHeader>

                <div className="mt-5 space-y-4">
                  {(payInputDraft.kind === 'bonus' || payInputDraft.kind === 'supply_credit' || payInputDraft.kind === 'expense_reimbursement') && (
                    <div>
                      <label htmlFor="pay-input-type" className="text-sm font-medium text-foreground">Earning type</label>
                      <Select value={payInputDraft.kind} onValueChange={(value: OperatorRecurringCompensationItemType) => setPayInputDraft((current) => current ? {
                        ...current,
                        kind: value,
                        effectiveEndDate: value === 'supply_credit' ? '' : current.technician.periodEndDate,
                      } : current)}>
                        <SelectTrigger id="pay-input-type" className="mt-2 min-h-11"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bonus">Bonus</SelectItem>
                          <SelectItem value="supply_credit">Supply Credit</SelectItem>
                          <SelectItem value="expense_reimbursement">Expense Reimbursement</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {payInputDraft.kind === 'commission' && (
                    <div>
                      <label htmlFor="pay-input-machine" className="text-sm font-medium text-foreground">Machine</label>
                      <Select value={payInputDraft.machineId} onValueChange={(value) => setPayInputDraft((current) => current ? { ...current, machineId: value } : current)}>
                        <SelectTrigger id="pay-input-machine" className="mt-2 min-h-11"><SelectValue placeholder="Choose a machine" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={TECHNICIAN_DEFAULT_MACHINE}>All assigned machines — Technician default</SelectItem>
                          {payInputDraft.technician.machines.map((machine) => <SelectItem key={machine.machineId} value={machine.machineId}>{machine.machineLabel}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div>
                    <label htmlFor="pay-input-value" className="text-sm font-medium text-foreground">
                      {payInputDraft.kind === 'commission' ? 'Commission percent' : payInputDraft.kind === 'shift' ? 'Pay per shift' : 'Amount'}
                    </label>
                    <div className="relative mt-2">
                      {payInputDraft.kind !== 'commission' && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">$</span>}
                      <Input
                        id="pay-input-value"
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        max={payInputDraft.kind === 'commission' ? '100' : undefined}
                        step="0.01"
                        value={payInputDraft.value}
                        className={cn('min-h-11', payInputDraft.kind !== 'commission' && 'pl-7', payInputDraft.kind === 'commission' && 'pr-8')}
                        onChange={(event) => setPayInputDraft((current) => current ? { ...current, value: event.target.value } : current)}
                        required
                      />
                      {payInputDraft.kind === 'commission' && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">%</span>}
                    </div>
                  </div>

                  {(payInputDraft.kind === 'bonus' || payInputDraft.kind === 'supply_credit' || payInputDraft.kind === 'expense_reimbursement') && (
                    <div>
                      <label htmlFor="pay-input-description" className="text-sm font-medium text-foreground">Description</label>
                      <Input id="pay-input-description" value={payInputDraft.description} className="mt-2 min-h-11" onChange={(event) => setPayInputDraft((current) => current ? { ...current, description: event.target.value } : current)} required />
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="pay-input-start" className="text-sm font-medium text-foreground">Effective start</label>
                      <Input id="pay-input-start" type="date" value={payInputDraft.effectiveStartDate} className="mt-2 min-h-11" onChange={(event) => setPayInputDraft((current) => current ? { ...current, effectiveStartDate: event.target.value } : current)} required />
                    </div>
                    <div>
                      <label htmlFor="pay-input-end" className="text-sm font-medium text-foreground">Effective end <span className="font-normal text-muted-foreground">(optional)</span></label>
                      <Input id="pay-input-end" type="date" value={payInputDraft.effectiveEndDate} className="mt-2 min-h-11" onChange={(event) => setPayInputDraft((current) => current ? { ...current, effectiveEndDate: event.target.value } : current)} />
                    </div>
                  </div>

                  {(payInputDraft.kind === 'bonus' || payInputDraft.kind === 'expense_reimbursement') && (
                    <p className="text-xs leading-5 text-muted-foreground">This one-time earning defaults to the selected month. Change the end date only if it should span more than one month.</p>
                  )}
                  {payInputDraft.kind === 'supply_credit' && (
                    <p className="text-xs leading-5 text-muted-foreground">Leave the end date blank for a recurring Supply Credit, or choose an end date to limit it.</p>
                  )}

                  {payInputError && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{payInputError}</p>}
                </div>

                <DialogFooter className="mt-6 gap-2 sm:gap-0">
                  <Button type="button" variant="outline" className="min-h-11" disabled={savePayInput.isPending} onClick={() => setPayInputDraft(null)}>Cancel</Button>
                  <Button type="submit" className="min-h-11" disabled={savePayInput.isPending}>
                    {savePayInput.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}
                    Save pay input
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(setupDraft)} onOpenChange={(open) => {
          if (!open && !saveTechnicianSetup.isPending) {
            setSetupDraft(null);
            setSetupError(null);
          }
        }}>
          <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
            {setupDraft && (
              <form onSubmit={(event) => {
                event.preventDefault();
                setSetupError(null);
                saveTechnicianSetup.mutate(setupDraft);
              }}>
                <DialogHeader>
                  <DialogTitle>Set up Technician Timekeeping</DialogTitle>
                  <DialogDescription>
                    One setup adds the Technician’s machines, pay per shift, and default commission rate. No approval workflow is added.
                  </DialogDescription>
                </DialogHeader>

                <div className="mt-5 rounded-xl border border-sage/30 bg-sage-light/50 p-4">
                  <div className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Invite first, then complete this setup</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        The Technician must accept their invitation and sign in once so Bloomjoy can match this setup to the right account.
                      </p>
                      <Button asChild type="button" variant="link" className="mt-1 h-auto min-h-11 px-0">
                        <Link to="/admin/access?action=add-access&preset=technician">Open People &amp; Permissions</Link>
                      </Button>
                    </div>
                  </div>
                </div>

                {setupContextQuery.isLoading ? (
                  <div className="mt-5 rounded-xl border border-border p-5 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin motion-reduce:animate-none" />Loading accounts and machines…
                  </div>
                ) : setupContextQuery.error ? (
                  <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
                    Timekeeping setup choices could not be loaded. Confirm account-level pay access and try again.
                  </div>
                ) : (
                  <div className="mt-5 space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="setup-technician-email" className="text-sm font-medium text-foreground">Invitation email</label>
                        <Input id="setup-technician-email" type="email" autoComplete="email" className="mt-2 min-h-11" placeholder="technician@example.com" value={setupDraft.userEmail} onChange={(event) => setSetupDraft((current) => current ? { ...current, userEmail: event.target.value } : current)} required />
                      </div>
                      <div>
                        <label htmlFor="setup-technician-name" className="text-sm font-medium text-foreground">Technician name</label>
                        <Input id="setup-technician-name" autoComplete="name" className="mt-2 min-h-11" placeholder="Full name" value={setupDraft.displayName} onChange={(event) => setSetupDraft((current) => current ? { ...current, displayName: event.target.value } : current)} required />
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="setup-worker-type" className="text-sm font-medium text-foreground">Worker type</label>
                        <Select value={setupDraft.workerType} onValueChange={(value: OperatorWorkerType) => setSetupDraft((current) => current ? { ...current, workerType: value } : current)}>
                          <SelectTrigger id="setup-worker-type" className="mt-2 min-h-11"><SelectValue /></SelectTrigger>
                          <SelectContent>{workerTypeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label htmlFor="setup-worker-id" className="text-sm font-medium text-foreground">Contractor or employee ID <span className="font-normal text-muted-foreground">(optional)</span></label>
                        <Input id="setup-worker-id" className="mt-2 min-h-11" value={setupDraft.workerIdentifier} onChange={(event) => setSetupDraft((current) => current ? { ...current, workerIdentifier: event.target.value } : current)} />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="setup-account" className="text-sm font-medium text-foreground">Account</label>
                      <Select value={setupDraft.accountId} onValueChange={(value) => setSetupDraft((current) => current ? { ...current, accountId: value, machineIds: [] } : current)}>
                        <SelectTrigger id="setup-account" className="mt-2 min-h-11"><SelectValue placeholder="Choose an account" /></SelectTrigger>
                        <SelectContent>{setupContextQuery.data?.accounts.map((account) => <SelectItem key={account.accountId} value={account.accountId}>{account.accountName}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>

                    <fieldset>
                      <legend className="text-sm font-medium text-foreground">Machines</legend>
                      {!setupDraft.accountId ? (
                        <p className="mt-2 rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">Choose an account to see its active machines.</p>
                      ) : setupMachines.length ? (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {setupMachines.map((machine) => {
                            const checked = setupDraft.machineIds.includes(machine.machineId);
                            return (
                              <label key={machine.machineId} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2.5 transition-colors hover:bg-muted/40">
                                <Checkbox checked={checked} onCheckedChange={(nextChecked) => setSetupDraft((current) => current ? {
                                  ...current,
                                  machineIds: nextChecked
                                    ? [...current.machineIds, machine.machineId]
                                    : current.machineIds.filter((id) => id !== machine.machineId),
                                } : current)} />
                                <span className="min-w-0 text-sm">
                                  <span className="block font-medium text-foreground">{machine.machineLabel}</span>
                                  {machine.locationName && <span className="block truncate text-muted-foreground">{machine.locationName}</span>}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="mt-2 rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">This account has no active machines available for Timekeeping.</p>
                      )}
                    </fieldset>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <div>
                        <label htmlFor="setup-shift-rate" className="text-sm font-medium text-foreground">Pay per shift</label>
                        <div className="relative mt-2"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">$</span><Input id="setup-shift-rate" type="number" inputMode="decimal" min="0.01" step="0.01" className="min-h-11 pl-7" value={setupDraft.shiftRate} onChange={(event) => setSetupDraft((current) => current ? { ...current, shiftRate: event.target.value } : current)} required /></div>
                      </div>
                      <div>
                        <label htmlFor="setup-commission-rate" className="text-sm font-medium text-foreground">Commission</label>
                        <div className="relative mt-2"><Input id="setup-commission-rate" type="number" inputMode="decimal" min="0" max="100" step="0.01" className="min-h-11 pr-8" value={setupDraft.commissionRate} onChange={(event) => setSetupDraft((current) => current ? { ...current, commissionRate: event.target.value } : current)} required /><span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">%</span></div>
                      </div>
                      <div>
                        <label htmlFor="setup-start-date" className="text-sm font-medium text-foreground">Starts</label>
                        <Input id="setup-start-date" type="date" className="mt-2 min-h-11" value={setupDraft.effectiveStartDate} onChange={(event) => setSetupDraft((current) => current ? { ...current, effectiveStartDate: event.target.value } : current)} required />
                      </div>
                    </div>

                    <p className="text-xs leading-5 text-muted-foreground">Each started hour counts as one paid shift. The commission rate applies to all selected machines unless a manager adds a machine-specific rate later.</p>

                    {setupError && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{setupError}</p>}
                  </div>
                )}

                <DialogFooter className="mt-6 gap-2 sm:gap-0">
                  <Button type="button" variant="outline" className="min-h-11" disabled={saveTechnicianSetup.isPending} onClick={() => setSetupDraft(null)}>Cancel</Button>
                  <Button type="submit" className="min-h-11" disabled={saveTechnicianSetup.isPending || setupContextQuery.isLoading || Boolean(setupContextQuery.error)}>
                    {saveTechnicianSetup.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}
                    Activate Timekeeping
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
