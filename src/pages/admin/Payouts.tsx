import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Loader2,
  Plus,
  SlidersHorizontal,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  upsertEffectiveOperatorMachineAssignmentAdmin,
  upsertOperatorRecurringItemAdmin,
  type OperatorWorkerType,
  type OperatorRecurringCompensationItemType,
  type TechnicianPayReportAssignment,
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

type AssignmentInputDraft = {
  technician: TechnicianPayReportTechnician;
  assignmentId: string;
  effectiveStartDate: string;
  effectiveEndDate: string;
};

type TechnicianSetupDraft = {
  userEmail: string;
  displayName: string;
  workerType: OperatorWorkerType;
  workerIdentifier: string;
  machineIds: string[];
  effectiveStartDate: string;
  machinePay: Record<string, MachinePayDraft>;
};

type CommissionTiming = 'immediate' | 'three_months' | 'date';
type CommissionChoice = 'none' | 'three_percent_three_months' | 'custom';

type MachinePayDraft = {
  shiftRate: string;
  commissionChoice: CommissionChoice;
  commissionEnabled: boolean;
  commissionRate: string;
  commissionTiming: CommissionTiming;
  commissionStartDate: string;
};

const newMachinePayDraft = (): MachinePayDraft => ({
  shiftRate: '',
  commissionChoice: 'none',
  commissionEnabled: false,
  commissionRate: '3',
  commissionTiming: 'three_months',
  commissionStartDate: '',
});

const copyMachinePayDraft = (machinePay: MachinePayDraft): MachinePayDraft => ({ ...machinePay });

const newTechnicianSetupDraft = (): TechnicianSetupDraft => ({
  userEmail: '',
  displayName: '',
  workerType: 'contractor_1099',
  workerIdentifier: '',
  machineIds: [],
  effectiveStartDate: getTodayInTimekeepingZone(),
  machinePay: {},
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

const formatAssignmentRange = (
  effectiveStartDate: string,
  effectiveEndDate: string | null | undefined
) => `${formatDate(effectiveStartDate)} to ${effectiveEndDate ? formatDate(effectiveEndDate) : 'Present'}`;

const getAssignmentById = (
  technician: TechnicianPayReportTechnician,
  assignmentId: string
): TechnicianPayReportAssignment | null =>
  (technician.assignments ?? []).find((assignment) => assignment.assignmentId === assignmentId) ?? null;

const addUtcMonths = (dateValue: string, months: number) => {
  const [year, month, day] = dateValue.split('-').map(Number);
  if (!year || !month || !day) return '';
  const result = new Date(Date.UTC(year, month - 1 + months, day));
  return result.toISOString().slice(0, 10);
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

const refreshableCommissionCodes = new Set([
  'missing_revenue_snapshot',
  'revenue_snapshot_fact_mismatch',
]);

const hasUnresolvedCommission = (technician: TechnicianPayReportTechnician) =>
  technician.blockers.some((issue) => unresolvedCommissionCodes.has(issue.code));

const hasMissingShiftRate = (technician: TechnicianPayReportTechnician) =>
  technician.shiftRateLines.some((line) => line.shiftRateCents == null) ||
  technician.blockers.some((issue) => issue.code === 'missing_shift_rate');

const buildShiftRateLines = (
  entries: TechnicianPayReportEntry[]
): TechnicianPayReportShiftRateLine[] => {
  const distinctRates = new Set(entries.map((entry) => entry.shiftRateCents ?? 'missing'));
  const showMachine = distinctRates.size > 1;
  const groups = new Map<string, TechnicianPayReportShiftRateLine>();
  for (const entry of entries) {
    const rateKey = entry.shiftRateCents == null ? 'missing' : String(entry.shiftRateCents);
    const key = showMachine ? `${entry.machineId}:${rateKey}` : rateKey;
    const current = groups.get(key);
    if (current) {
      current.paidShifts += entry.paidShifts;
      current.actualDurationMinutes += entry.actualDurationMinutes;
      current.shiftEarningsCents += entry.shiftEarningsCents;
      if (entry.workDate < current.firstWorkDate) current.firstWorkDate = entry.workDate;
      if (entry.workDate > current.lastWorkDate) current.lastWorkDate = entry.workDate;
    } else {
      groups.set(key, {
        machineId: showMachine ? entry.machineId : null,
        machineLabel: showMachine ? entry.machineLabel : null,
        locationName: showMachine ? entry.locationName : null,
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
  const assignments = (technician.assignments ?? []).filter((assignment) => assignment.machineId === machineId);
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
    assignments,
    otherEarnings: [],
    blockers,
    warnings,
  };
};

function TechnicianReport({
  technician,
  selectedMonth,
  onManageAssignments,
  onAddShiftRate,
  onAddCommissionRate,
  onAddOtherEarning,
  onEditOtherEarning,
  onGeneratePayStub,
  isGeneratingPayStub,
}: {
  technician: TechnicianPayReportTechnician;
  selectedMonth: string;
  onManageAssignments: () => void;
  onAddShiftRate: () => void;
  onAddCommissionRate: () => void;
  onAddOtherEarning: () => void;
  onEditOtherEarning: (earning: TechnicianPayReportOtherEarning) => void;
  onGeneratePayStub: () => void;
  isGeneratingPayStub: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const assignments = technician.assignments ?? [];
  const editableAssignments = assignments.filter((assignment) => assignment.editable);
  const issues = [...technician.blockers, ...technician.warnings].filter(
    (issue) => issue.code !== 'current_period_sales_through'
  );
  const commissionUnavailable = hasUnresolvedCommission(technician);
  const shiftPayUnavailable = hasMissingShiftRate(technician);
  const totalUnavailable = technician.blockers.length > 0;
  const periodInProgress = technician.calculationMeta.periodInProgress === true;
  const hasAssignmentInPeriod = technician.calculationMeta.hasAssignmentInPeriod
    ?? technician.machines.length > 0;
  const assignmentGap = !hasAssignmentInPeriod && assignments.length > 0;
  const salesOutsideAssignmentCents = assignments
    .filter((assignment) => !assignment.overlapsSelectedPeriod)
    .reduce((sum, assignment) => sum + assignment.selectedPeriodGrossSalesCents, 0);
  const shiftRateLines = buildShiftRateLines(technician.entries);
  const otherEarningsCents = technician.bonusCents + technician.supplyCreditCents + technician.expenseReimbursementCents;
  const detailsId = `technician-pay-details-${technician.operatorProfileId}`;

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <header className={cn('bg-muted/25 p-4 sm:p-5', expanded && 'border-b border-border')}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">{technician.displayName}</h2>
              <Badge variant="outline">{formatWorkerType(technician.workerType)}</Badge>
              {technician.blockers.length > 0 ? (
                <Badge variant="destructive">Needs attention</Badge>
              ) : technician.publishable ? (
                <Badge className="border-sage/30 bg-sage-light text-foreground">Ready</Badge>
              ) : periodInProgress ? (
                <Badge variant="outline">Month in progress</Badge>
              ) : assignmentGap ? (
                <Badge variant="outline">No assignment this month</Badge>
              ) : (
                <Badge variant="destructive">Needs attention</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {technician.workerIdentifier || technician.positionTitle || 'Technician'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 bg-background"
              disabled={!editableAssignments.length}
              onClick={onManageAssignments}
            >
              <CalendarDays className="mr-2 h-4 w-4" /> Assignment dates
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="min-h-11 bg-background">
                  Adjust pay <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onAddShiftRate}>Change started-hour rate</DropdownMenuItem>
                <DropdownMenuItem onSelect={onAddCommissionRate} disabled={!technician.machines.length}>Change commission</DropdownMenuItem>
                <DropdownMenuItem onSelect={onAddOtherEarning}>Add another earning</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              size="sm"
              className="min-h-11"
              disabled={!technician.publishable || isGeneratingPayStub}
              onClick={onGeneratePayStub}
            >
              {isGeneratingPayStub ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Banknote className="mr-2 h-4 w-4" />}
              {isGeneratingPayStub
                ? technician.payStubRegenerationRequired ? 'Regenerating…' : 'Publishing…'
                : technician.payStubRegenerationRequired ? 'Regenerate Pay Stub' : 'Publish Pay Stub'}
            </Button>
          </div>
        </div>
        {assignments.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {assignments.length} machine assignment{assignments.length === 1 ? '' : 's'} on record. Assignment dates control which time and machine sales belong to this Technician; pay-rate dates are separate.
          </p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/70 pt-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div><span className="text-muted-foreground">Paid shifts</span><strong className="mt-1 block text-foreground">{technician.paidShifts}</strong></div>
          <div><span className="text-muted-foreground">Time worked</span><strong className="mt-1 block text-foreground">{formatDuration(technician.actualDurationMinutes)}</strong></div>
          <div><span className="text-muted-foreground">Shift pay</span><strong className="mt-1 block text-foreground">{shiftPayUnavailable ? 'Unavailable' : formatCurrency(technician.shiftEarningsCents)}</strong></div>
          <div><span className="text-muted-foreground">Commission</span><strong className="mt-1 block text-foreground">{commissionUnavailable ? 'Unavailable' : formatCurrency(technician.commissionEarningsCents)}</strong></div>
          <div><span className="text-muted-foreground">Other earnings</span><strong className="mt-1 block text-foreground">{formatCurrency(otherEarningsCents)}</strong></div>
          <div><span className="text-muted-foreground">Total</span><strong className="mt-1 block text-lg text-foreground">{totalUnavailable ? 'Unavailable' : formatCurrency(technician.currentTotalCents)}</strong></div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3 min-h-11 px-2"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Hide breakdown' : 'View machine breakdown'}
          <ChevronDown className={cn('ml-2 h-4 w-4 transition-transform', expanded && 'rotate-180')} />
        </Button>
      </header>

      {assignmentGap && (
        <section className="border-t border-border bg-muted/20 p-4 sm:p-5" aria-label={`No assignment in ${formatMonth(selectedMonth)}`}>
          <h3 className="font-semibold text-foreground">No machine assignment in {formatMonth(selectedMonth)}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {salesOutsideAssignmentCents > 0
              ? `${formatCurrency(salesOutsideAssignmentCents)} in machine sales exists for this month, but it is not attributed to ${technician.displayName} because their assignment dates do not overlap.`
              : `The machine assignments on record do not overlap ${formatMonth(selectedMonth)}, so this month is not ready to publish.`}
          </p>
          {editableAssignments.length > 0 && (
            <Button type="button" variant="outline" size="sm" className="mt-3 min-h-11 bg-background" onClick={onManageAssignments}>
              Backdate assignment
            </Button>
          )}
        </section>
      )}

      {expanded && <div id={detailsId}>
      {assignments.length > 0 && (
        <section className="border-b border-border p-4 sm:p-5" aria-labelledby={`assignments-${technician.operatorProfileId}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id={`assignments-${technician.operatorProfileId}`} className="font-semibold text-foreground">Machine assignments</h3>
              <p className="mt-1 text-sm text-muted-foreground">These dates determine which time and sales are attributed. They do not change the pay rate.</p>
            </div>
            {editableAssignments.length > 0 && <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onManageAssignments}>Edit dates</Button>}
          </div>
          <div className="mt-3 divide-y divide-border rounded-lg border border-border px-3">
            {assignments.map((assignment) => (
              <div key={assignment.assignmentId} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{assignment.machineLabel}</p>
                  <p className="text-sm text-muted-foreground">{assignment.locationName}</p>
                </div>
                <div className="text-sm sm:text-right">
                  <p className="font-medium text-foreground">{formatAssignmentRange(assignment.effectiveStartDate, assignment.effectiveEndDate)}</p>
                  <p className="text-muted-foreground">{assignment.overlapsSelectedPeriod ? `Included in ${formatMonth(selectedMonth)}` : `Not assigned in ${formatMonth(selectedMonth)}`}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
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
                <span className="font-semibold">{issue.severity === 'blocker' ? 'Blocks publishing: ' : issue.severity === 'info' ? 'Info: ' : 'Check: '}</span>
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
          {shiftRateLines.length ? shiftRateLines.map((line, index) => (
            <BreakdownRow
              key={`${line.shiftRateCents}-${line.firstWorkDate}-${index}`}
              label={`${line.paidShifts} shift${line.paidShifts === 1 ? '' : 's'} × ${line.shiftRateCents == null ? 'Rate missing' : formatCurrency(line.shiftRateCents)}`}
              detail={<>{line.machineLabel && <span className="font-medium text-foreground">{line.machineLabel} · </span>}{formatDuration(line.actualDurationMinutes)} worked · {formatDate(line.firstWorkDate)}–{formatDate(line.lastWorkDate)}</>}
              amount={line.shiftRateCents == null ? 'Unavailable' : formatCurrency(line.shiftEarningsCents)}
            />
          )) : <p className="py-4 text-sm text-muted-foreground">No paid shifts in this month.</p>}
        </div>
      </section>

      <section className="border-t border-border p-4 sm:p-5" aria-labelledby={`commission-${technician.operatorProfileId}`}>
        <h3 id={`commission-${technician.operatorProfileId}`} className="font-semibold text-foreground">Machine sales and commission</h3>
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
                    <span>{machine.locationName} · {formatDuration(machineActualMinutes)} worked · {machinePaidShifts} paid {machinePaidShifts === 1 ? 'shift' : 'shifts'}</span>
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
                    <span className="mt-1 block">
                      Included window {formatAssignmentRange(machine.assignedStartDate, machine.assignedEndDate)}{machine.sourceLatestSaleDate ? ` · Sales through ${formatDate(machine.sourceLatestSaleDate)}` : ''}
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
        <h3 id={`other-pay-${technician.operatorProfileId}`} className="font-semibold text-foreground">Other earnings</h3>
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
      </div>}
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
  const [assignmentInputDraft, setAssignmentInputDraft] = useState<AssignmentInputDraft | null>(null);
  const [assignmentInputError, setAssignmentInputError] = useState<string | null>(null);
  const [setupDraft, setSetupDraft] = useState<TechnicianSetupDraft | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupSubmitting, setSetupSubmitting] = useState(false);
  const [generatingProfileId, setGeneratingProfileId] = useState<string | null>(null);
  const [showMoreFilters, setShowMoreFilters] = useState(false);

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
  const canRefreshSales = visibleTechnicians.some((technician) =>
    technician.blockers.some((issue) => refreshableCommissionCodes.has(issue.code))
  );
  const periodInProgress = visibleTechnicians.some(
    (technician) => technician.calculationMeta.periodInProgress === true
  );
  const visibleSalesThroughDate = visibleTechnicians
    .flatMap((technician) => technician.calculationMeta.salesThroughDate
      ? [technician.calculationMeta.salesThroughDate]
      : technician.machines.map((machine) => machine.sourceLatestSaleDate))
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;
  const setupAccounts = setupContextQuery.data?.accounts ?? [];
  const setupMachineById = new Map(
    setupAccounts.flatMap((account) => account.machines.map((machine) => [machine.machineId, { ...machine, accountId: account.accountId, accountName: account.accountName }] as const))
  );
  const selectedPayerCount = setupDraft
    ? setupAccounts.filter((account) => account.machines.some((machine) => setupDraft.machineIds.includes(machine.machineId))).length
    : 0;
  const advancedFilterCount = Number(accountId !== 'all') + Number(machineId !== 'all');

  const openTechnicianSetup = () => {
    setSetupError(null);
    setSetupDraft(newTechnicianSetupDraft());
  };

  const openAssignmentInput = (technician: TechnicianPayReportTechnician) => {
    const assignment = (technician.assignments ?? []).find((candidate) => candidate.editable);
    if (!assignment) {
      toast.error('No editable machine assignment is available for this Technician.');
      return;
    }
    setAssignmentInputError(null);
    setAssignmentInputDraft({
      technician,
      assignmentId: assignment.assignmentId,
      effectiveStartDate: assignment.effectiveStartDate,
      effectiveEndDate: assignment.effectiveEndDate ?? '',
    });
  };

  const saveTechnicianSetup = useMutation({
    mutationFn: async (draft: TechnicianSetupDraft) => {
      if (!draft.userEmail.trim() || !draft.userEmail.includes('@')) {
        throw new Error('Enter the email used for the Technician invitation.');
      }
      if (!draft.displayName.trim()) throw new Error('Enter the Technician’s name.');
      if (!draft.machineIds.length) throw new Error('Choose at least one machine.');
      if (!draft.effectiveStartDate) throw new Error('Choose the Timekeeping start date.');

      const machineCompensation = draft.machineIds.map((machineId) => {
        const machinePay = draft.machinePay[machineId];
        if (!machinePay) throw new Error('Add pay details for every selected machine.');
        const shiftRate = Number(machinePay.shiftRate);
        const commissionRate = machinePay.commissionEnabled ? Number(machinePay.commissionRate) : 0;
        if (!Number.isFinite(shiftRate) || shiftRate <= 0) {
          throw new Error('Enter pay per started hour greater than zero for every selected machine.');
        }
        if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) {
          throw new Error('Enter a commission percent from 0 to 100.');
        }
        const commissionStartDate = machinePay.commissionTiming === 'three_months'
          ? addUtcMonths(draft.effectiveStartDate, 3)
          : machinePay.commissionTiming === 'date'
            ? machinePay.commissionStartDate
            : draft.effectiveStartDate;
        if (!commissionStartDate) throw new Error('Choose when commission begins.');
        if (commissionStartDate < draft.effectiveStartDate) {
          throw new Error('Commission cannot begin before Timekeeping starts.');
        }
        return {
          machineId,
          shiftRateCents: Math.round(shiftRate * 100),
          commissionBasisPoints: Math.round(commissionRate * 100),
          commissionEffectiveStartDate: commissionStartDate,
        };
      });

      return setupTimekeepingTechnicianAdmin({
        userEmail: draft.userEmail.trim(),
        displayName: draft.displayName.trim(),
        workerType: draft.workerType,
        workerIdentifier: draft.workerIdentifier.trim() || null,
        effectiveStartDate: draft.effectiveStartDate,
        machineCompensation,
      });
    },
    onSuccess: async (result) => {
      setSetupSubmitting(false);
      await queryClient.invalidateQueries({ queryKey: ['technician-pay-report'] });
      setSetupDraft(null);
      setSetupError(null);
      toast.success(`${result.displayName} can now use Timekeeping across ${result.machineCount} machine${result.machineCount === 1 ? '' : 's'}.`);
    },
    onError: (setupSaveError) => {
      setSetupSubmitting(false);
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
    const shiftRate = selectedMachine
      ? technician.entries.find((entry) => entry.machineId === selectedMachine.machineId && entry.shiftRateCents != null)?.shiftRateCents
      : technician.shiftRateLines.find((line) => line.shiftRateCents != null)?.shiftRateCents;
    const isOtherEarning = kind === 'bonus' || kind === 'supply_credit' || kind === 'expense_reimbursement';
    setPayInputError(null);
    setPayInputDraft({
      technician,
      kind,
      itemId: earning?.id ?? null,
      machineId: kind === 'shift' || kind === 'commission'
        ? selectedMachine?.machineId ?? TECHNICIAN_DEFAULT_MACHINE
        : '',
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
      if (!Number.isFinite(numericValue) || numericValue < 0 || (draft.kind !== 'commission' && numericValue === 0)) {
        throw new Error(draft.kind === 'commission' ? 'Enter a commission from 0 to 100%.' : 'Enter an amount greater than zero.');
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
          machineId: draft.machineId !== TECHNICIAN_DEFAULT_MACHINE ? draft.machineId : null,
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
    onSuccess: async (_result, draft) => {
      await queryClient.invalidateQueries({ queryKey: ['technician-pay-report'] });
      setPayInputDraft(null);
      setPayInputError(null);
      const machine = draft.machineId === TECHNICIAN_DEFAULT_MACHINE
        ? null
        : draft.technician.machines.find((candidate) => candidate.machineId === draft.machineId);
      const payLabel = draft.kind === 'shift'
        ? `${formatCurrency(Math.round(Number(draft.value) * 100))} per started hour`
        : draft.kind === 'commission'
          ? `${Number(draft.value).toLocaleString()}% commission`
          : `${formatCurrency(Math.round(Number(draft.value) * 100))} ${draft.kind.replaceAll('_', ' ')}`;
      toast.success(`${payLabel} saved for ${machine?.machineLabel ?? draft.technician.displayName}, effective ${formatDate(draft.effectiveStartDate)}. Assignment dates were not changed.`);
    },
    onError: (saveError) => {
      setPayInputError(saveError instanceof Error ? saveError.message : 'Unable to save this pay input.');
    },
  });

  const saveAssignmentInput = useMutation({
    mutationFn: async (draft: AssignmentInputDraft) => {
      const assignment = getAssignmentById(draft.technician, draft.assignmentId);
      if (!assignment?.editable) throw new Error('Choose an active machine assignment.');
      if (!draft.effectiveStartDate) throw new Error('Choose the assignment start date.');
      if (draft.effectiveEndDate && draft.effectiveEndDate < draft.effectiveStartDate) {
        throw new Error('The assignment end date cannot be before the start date.');
      }
      return upsertEffectiveOperatorMachineAssignmentAdmin({
        assignmentId: assignment.assignmentId,
        operatorProfileId: draft.technician.operatorProfileId,
        machineId: assignment.machineId,
        effectiveStartDate: draft.effectiveStartDate,
        effectiveEndDate: draft.effectiveEndDate || null,
      });
    },
    onSuccess: async (_result, draft) => {
      const assignment = getAssignmentById(draft.technician, draft.assignmentId);
      let salesRefreshFailed = false;
      try {
        const refreshedSales = await refreshTechnicianPayReportSalesAdmin(
          `${month}-01`,
          draft.technician.accountId
        );
        salesRefreshFailed = refreshedSales.periodCount === 0;
      } catch {
        salesRefreshFailed = true;
      }
      await queryClient.invalidateQueries({ queryKey: ['technician-pay-report'] });
      setAssignmentInputDraft(null);
      setAssignmentInputError(null);
      toast.success(`${assignment?.machineLabel ?? 'Machine'} assignment saved: ${formatAssignmentRange(draft.effectiveStartDate, draft.effectiveEndDate || null)}. Pay and commission rates were not changed.${salesRefreshFailed ? '' : ` ${formatMonth(month)} sales were recalculated.`}`);
      if (salesRefreshFailed) {
        toast.error(`Assignment dates were saved, but ${formatMonth(month)} sales could not be recalculated. Use Refresh sales and try again.`);
      }
    },
    onError: (saveError) => {
      setAssignmentInputError(saveError instanceof Error ? saveError.message : 'Unable to save assignment dates.');
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
            {canRefreshSales && (
              <Button type="button" variant="outline" className="min-h-11" disabled={refreshSales.isPending || isFetching} onClick={() => refreshSales.mutate()}>
                <ShoppingBag className={cn('mr-2 h-4 w-4', refreshSales.isPending && 'animate-pulse motion-reduce:animate-none')} /> Refresh sales
              </Button>
            )}
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
            <section className="grid gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3" aria-label="Pay Report filters">
              <div><label htmlFor="pay-report-month" className="text-sm font-medium text-foreground">Month</label><Input id="pay-report-month" type="month" value={month} max={currentMonthValue()} className="mt-2 min-h-11" onChange={(event) => { if (isMonthValue(event.target.value)) setMonth(event.target.value); }} /></div>
              <div><label htmlFor="pay-report-technician" className="text-sm font-medium text-foreground">Technician</label><Select value={technicianId} onValueChange={setTechnicianId}><SelectTrigger id="pay-report-technician" className="mt-2 min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Technicians</SelectItem>{technicians.map((technician) => <SelectItem key={technician.operatorProfileId} value={technician.operatorProfileId}>{technician.displayName}</SelectItem>)}</SelectContent></Select></div>
              <div className="flex items-end">
                <Button type="button" variant="outline" className="min-h-11 w-full" aria-expanded={showMoreFilters} onClick={() => setShowMoreFilters((current) => !current)}>
                  <SlidersHorizontal className="mr-2 h-4 w-4" />
                  {showMoreFilters ? 'Hide account and machine filters' : `More filters${advancedFilterCount ? ` (${advancedFilterCount} active)` : ''}`}
                </Button>
              </div>
              {showMoreFilters && <>
                <div><label htmlFor="pay-report-account" className="text-sm font-medium text-foreground">Account</label><Select value={accountId} onValueChange={setAccountId}><SelectTrigger id="pay-report-account" className="mt-2 min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All accounts</SelectItem>{context.accounts.map((account) => <SelectItem key={account.accountId} value={account.accountId}>{account.accountName}</SelectItem>)}</SelectContent></Select></div>
                <div><label htmlFor="pay-report-machine" className="text-sm font-medium text-foreground">Machine</label><Select value={machineId} onValueChange={setMachineId}><SelectTrigger id="pay-report-machine" className="mt-2 min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All machines</SelectItem>{machines.map((machine) => <SelectItem key={machine.id} value={machine.id}>{machine.label}</SelectItem>)}</SelectContent></Select></div>
              </>}
            </section>
            {machineId !== 'all' && <p className="-mt-3 text-xs text-muted-foreground">Machine filtering shows only that machine’s time, shift earnings, sales, and commission. Technician-level other earnings are excluded from these filtered totals; publishing status remains month-wide.</p>}

            {periodInProgress && visibleSalesThroughDate && (
              <section className="rounded-xl border border-border bg-muted/25 px-4 py-3" aria-label="Current month sales status">
                <p className="text-sm font-semibold text-foreground">Month in progress · Sales through {formatDate(visibleSalesThroughDate)}</p>
                <p className="mt-1 text-sm text-muted-foreground">Totals are a current estimate. This month cannot be published until the Technician edit window closes.</p>
              </section>
            )}

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-live="polite">
              <Metric label="Paid shifts" value={`${totalPaidShifts}`} helper="Each started hour" icon={Clock3} />
              <Metric label="Commissionable sales" value={commissionableSalesUnavailable ? 'Unavailable' : formatCurrency(totalCommissionableSales)} helper={commissionableSalesUnavailable ? (canRefreshSales ? 'Refresh required' : 'Sales facts required') : `After refunds and ${formatCurrency(totalEstimatedTax)} tax`} icon={ShoppingBag} />
              <Metric label="Current total" value={totalsUnavailable ? 'Unavailable' : formatCurrency(currentTotal)} helper={totalsUnavailable ? 'Resolve calculation blockers' : periodInProgress ? 'Current estimate, before payment or tax' : 'Before payment or tax'} icon={Banknote} />
              <Metric label="Technicians" value={`${visibleTechnicians.length}`} helper={blockerCount ? `${blockerCount} publishing blocker${blockerCount === 1 ? '' : 's'}` : 'No publishing blockers'} icon={UserRound} />
            </section>

            {blockerCount > 0 && (
              <section className="flex flex-col gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5" role="alert">
                <div>
                  <h2 className="flex items-center gap-2 font-semibold text-foreground"><AlertTriangle className="h-5 w-5 text-destructive" />Resolve {blockerCount} publishing blocker{blockerCount === 1 ? '' : 's'}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Open the affected Technician below for details. Pay Stubs remain unpublished until the missing information is fixed.</p>
                </div>
                {canRefreshSales && (
                  <Button type="button" variant="outline" className="min-h-11 shrink-0 bg-background" disabled={refreshSales.isPending || isFetching} onClick={() => refreshSales.mutate()}>
                    <ShoppingBag className={cn('mr-2 h-4 w-4', refreshSales.isPending && 'animate-pulse motion-reduce:animate-none')} /> Refresh sales now
                  </Button>
                )}
              </section>
            )}

            <section className="space-y-5" aria-label="Technician pay details">
              {visibleTechnicians.length ? visibleTechnicians.map((technician) => (
                <TechnicianReport
                  key={technician.operatorProfileId}
                  technician={technician}
                  selectedMonth={month}
                  onManageAssignments={() => openAssignmentInput(technician)}
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

                  {(payInputDraft.kind === 'shift' || payInputDraft.kind === 'commission') && (
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
                      {payInputDraft.kind === 'commission' ? 'Commission percent' : payInputDraft.kind === 'shift' ? 'Pay per started hour' : 'Amount'}
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

        <Dialog open={Boolean(assignmentInputDraft)} onOpenChange={(open) => {
          if (!open && !saveAssignmentInput.isPending) {
            setAssignmentInputDraft(null);
            setAssignmentInputError(null);
          }
        }}>
          <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
            {assignmentInputDraft && (() => {
              const editableAssignments = (assignmentInputDraft.technician.assignments ?? []).filter(
                (assignment) => assignment.editable
              );
              const selectedAssignment = getAssignmentById(
                assignmentInputDraft.technician,
                assignmentInputDraft.assignmentId
              );
              return (
                <form onSubmit={(event) => {
                  event.preventDefault();
                  setAssignmentInputError(null);
                  saveAssignmentInput.mutate(assignmentInputDraft);
                }}>
                  <DialogHeader>
                    <DialogTitle>Edit machine assignment dates</DialogTitle>
                    <DialogDescription>
                      {assignmentInputDraft.technician.displayName} · These dates control which time and machine sales belong to this Technician. Pay and commission rates have their own effective dates and will not change here.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="mt-5 space-y-4">
                    <div>
                      <label htmlFor="assignment-machine" className="text-sm font-medium text-foreground">Machine assignment</label>
                      <Select value={assignmentInputDraft.assignmentId} onValueChange={(assignmentId) => {
                        const assignment = getAssignmentById(assignmentInputDraft.technician, assignmentId);
                        if (!assignment) return;
                        setAssignmentInputDraft((current) => current ? {
                          ...current,
                          assignmentId,
                          effectiveStartDate: assignment.effectiveStartDate,
                          effectiveEndDate: assignment.effectiveEndDate ?? '',
                        } : current);
                      }}>
                        <SelectTrigger id="assignment-machine" className="mt-2 min-h-11"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {editableAssignments.map((assignment) => (
                            <SelectItem key={assignment.assignmentId} value={assignment.assignmentId}>
                              {assignment.machineLabel} · {formatAssignmentRange(assignment.effectiveStartDate, assignment.effectiveEndDate)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {selectedAssignment && (
                      <p className="rounded-lg border border-border bg-muted/25 px-3 py-2 text-sm text-muted-foreground">
                        {selectedAssignment.overlapsSelectedPeriod
                          ? `This assignment currently applies to ${formatMonth(month)}.`
                          : `${formatMonth(month)} is outside this assignment. ${selectedAssignment.selectedPeriodGrossSalesCents > 0 ? `${formatCurrency(selectedAssignment.selectedPeriodGrossSalesCents)} in machine sales for that month is not currently attributed to this Technician.` : 'Backdate the start only if this Technician was responsible for the machine during that month.'}`}
                      </p>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="assignment-start" className="text-sm font-medium text-foreground">Assigned from</label>
                        <Input id="assignment-start" type="date" value={assignmentInputDraft.effectiveStartDate} className="mt-2 min-h-11" onChange={(event) => setAssignmentInputDraft((current) => current ? { ...current, effectiveStartDate: event.target.value } : current)} required />
                      </div>
                      <div>
                        <label htmlFor="assignment-end" className="text-sm font-medium text-foreground">Assigned through <span className="font-normal text-muted-foreground">(optional)</span></label>
                        <Input id="assignment-end" type="date" value={assignmentInputDraft.effectiveEndDate} className="mt-2 min-h-11" onChange={(event) => setAssignmentInputDraft((current) => current ? { ...current, effectiveEndDate: event.target.value } : current)} />
                      </div>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">Leave the end date blank while the Technician remains assigned. Backdating changes pay attribution for the affected dates and is retained in the admin audit history.</p>
                    {assignmentInputError && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{assignmentInputError}</p>}
                  </div>

                  <DialogFooter className="mt-6 gap-2 sm:gap-0">
                    <Button type="button" variant="outline" className="min-h-11" disabled={saveAssignmentInput.isPending} onClick={() => setAssignmentInputDraft(null)}>Cancel</Button>
                    <Button type="submit" className="min-h-11" disabled={saveAssignmentInput.isPending}>
                      {saveAssignmentInput.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}
                      Save assignment dates
                    </Button>
                  </DialogFooter>
                </form>
              );
            })()}
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(setupDraft)} onOpenChange={(open) => {
          if (!open && !setupSubmitting) {
            setSetupDraft(null);
            setSetupError(null);
          }
        }}>
          <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-4xl gap-0 overflow-hidden p-0 sm:max-h-[92vh]">
            {setupDraft && (
              <form
                className="flex max-h-[calc(100dvh-1rem)] min-h-0 flex-col sm:max-h-[92vh]"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSetupError(null);
                  setSetupSubmitting(true);
                  saveTechnicianSetup.mutate(setupDraft);
                }}
              >
                <DialogHeader className="shrink-0 border-b border-border px-5 py-5 pr-16 sm:px-6">
                  <DialogTitle>Set up Technician Timekeeping</DialogTitle>
                  <DialogDescription>
                    Choose their machines, then enter what they earn for each one.
                  </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
                  <div className="flex flex-col gap-3 rounded-xl border border-sage/30 bg-sage-light/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">Already invited this Technician?</p>
                        <p className="mt-0.5 text-sm leading-5 text-muted-foreground">They must accept the invitation and sign in once before activation.</p>
                      </div>
                    </div>
                    <Button asChild type="button" variant="outline" size="sm" className="min-h-11 shrink-0 bg-background">
                      <Link to="/admin/access?action=add-access&preset=technician">Invite Technician</Link>
                    </Button>
                  </div>

                  {setupContextQuery.isLoading ? (
                    <div className="rounded-xl border border-border p-5 text-sm text-muted-foreground">
                      <Loader2 className="mr-2 inline h-4 w-4 animate-spin motion-reduce:animate-none" />Loading accounts and machines…
                    </div>
                  ) : setupContextQuery.error ? (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
                      Timekeeping setup choices could not be loaded. Confirm account-level pay access and try again.
                    </div>
                  ) : (
                    <>
                      <section aria-labelledby="setup-person-heading">
                        <div className="flex flex-wrap items-end justify-between gap-2">
                          <div>
                            <h3 id="setup-person-heading" className="font-semibold text-foreground">1. Who is the Technician?</h3>
                            <p className="mt-1 text-sm text-muted-foreground">Use the same email address as their invitation.</p>
                          </div>
                          <div className="w-full sm:w-48">
                            <label htmlFor="setup-start-date" className="text-sm font-medium text-foreground">Timekeeping starts</label>
                            <Input id="setup-start-date" type="date" className="mt-2 min-h-11" value={setupDraft.effectiveStartDate} onChange={(event) => setSetupDraft((current) => current ? { ...current, effectiveStartDate: event.target.value } : current)} required />
                          </div>
                        </div>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <div>
                            <label htmlFor="setup-technician-email" className="text-sm font-medium text-foreground">Invitation email</label>
                            <Input id="setup-technician-email" type="email" autoComplete="email" className="mt-2 min-h-11" placeholder="technician@example.com" value={setupDraft.userEmail} onChange={(event) => setSetupDraft((current) => current ? { ...current, userEmail: event.target.value } : current)} required />
                          </div>
                          <div>
                            <label htmlFor="setup-technician-name" className="text-sm font-medium text-foreground">Technician name</label>
                            <Input id="setup-technician-name" autoComplete="name" className="mt-2 min-h-11" placeholder="Full name" value={setupDraft.displayName} onChange={(event) => setSetupDraft((current) => current ? { ...current, displayName: event.target.value } : current)} required />
                          </div>
                        </div>
                        <details className="mt-4 rounded-lg border border-border bg-muted/20 px-4 py-3">
                          <summary className="cursor-pointer text-sm font-medium text-foreground">Optional worker details</summary>
                          <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <div>
                              <label htmlFor="setup-worker-type" className="text-sm font-medium text-foreground">Worker type</label>
                              <Select value={setupDraft.workerType} onValueChange={(value: OperatorWorkerType) => setSetupDraft((current) => current ? { ...current, workerType: value } : current)}>
                                <SelectTrigger id="setup-worker-type" className="mt-2 min-h-11"><SelectValue /></SelectTrigger>
                                <SelectContent>{workerTypeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                              </Select>
                            </div>
                            <div>
                              <label htmlFor="setup-worker-id" className="text-sm font-medium text-foreground">Worker ID <span className="font-normal text-muted-foreground">(optional)</span></label>
                              <Input id="setup-worker-id" className="mt-2 min-h-11" value={setupDraft.workerIdentifier} onChange={(event) => setSetupDraft((current) => current ? { ...current, workerIdentifier: event.target.value } : current)} />
                            </div>
                          </div>
                        </details>
                      </section>

                      <fieldset>
                        <legend className="font-semibold text-foreground">2. What machines can they work on?</legend>
                        <p className="mt-1 text-sm text-muted-foreground">Choose every machine where this Technician may record time.</p>
                        <div className="mt-4 space-y-3">
                          {setupAccounts.map((account) => (
                            <div key={account.accountId} className="rounded-xl border border-border p-3">
                              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{account.accountName}</p>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {account.machines.map((machine) => {
                                  const checked = setupDraft.machineIds.includes(machine.machineId);
                                  return (
                                    <label key={machine.machineId} className={cn('flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors', checked ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-muted/40')}>
                                      <Checkbox checked={checked} onCheckedChange={(nextChecked) => setSetupDraft((current) => {
                                        if (!current) return current;
                                        if (nextChecked) {
                                          const firstPay = current.machineIds.length ? current.machinePay[current.machineIds[0]] : null;
                                          return {
                                            ...current,
                                            machineIds: [...current.machineIds, machine.machineId],
                                            machinePay: {
                                              ...current.machinePay,
                                              [machine.machineId]: firstPay ? copyMachinePayDraft(firstPay) : newMachinePayDraft(),
                                            },
                                          };
                                        }
                                        const machinePay = { ...current.machinePay };
                                        delete machinePay[machine.machineId];
                                        return {
                                          ...current,
                                          machineIds: current.machineIds.filter((id) => id !== machine.machineId),
                                          machinePay,
                                        };
                                      })} />
                                      <span className="min-w-0 text-sm"><span className="block font-medium text-foreground">{machine.machineLabel}</span>{machine.locationName && <span className="block truncate text-muted-foreground">{machine.locationName}</span>}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </fieldset>

                      {selectedPayerCount > 1 && (
                        <p className="rounded-lg border border-sage/30 bg-sage-light/50 px-3 py-2 text-sm text-foreground">
                          This setup spans {selectedPayerCount} businesses, so {setupDraft.displayName || 'this Technician'} will receive {selectedPayerCount} separate Pay Stubs.
                        </p>
                      )}

                      {setupDraft.machineIds.length > 0 && (
                        <section aria-labelledby="setup-pay-heading">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                              <h3 id="setup-pay-heading" className="font-semibold text-foreground">3. How is {setupDraft.displayName || 'this Technician'} paid for each machine?</h3>
                              <p className="mt-1 text-sm text-muted-foreground">Enter the rate and commission for each machine. Start with the first one and copy it when the others match.</p>
                            </div>
                            {setupDraft.machineIds.length > 1 && (
                              <Button
                                type="button"
                                variant="outline"
                                className="min-h-11 shrink-0"
                                onClick={() => setSetupDraft((current) => {
                                  if (!current?.machineIds.length) return current;
                                  const firstPay = current.machinePay[current.machineIds[0]];
                                  if (!firstPay) return current;
                                  return {
                                    ...current,
                                    machinePay: Object.fromEntries(current.machineIds.map((id) => [id, copyMachinePayDraft(firstPay)])),
                                  };
                                })}
                              >
                                Apply first machine to all
                              </Button>
                            )}
                          </div>

                          <div className="mt-4 space-y-3">
                            {setupDraft.machineIds.map((selectedMachineId) => {
                              const machine = setupMachineById.get(selectedMachineId);
                              const machinePay = setupDraft.machinePay[selectedMachineId] ?? newMachinePayDraft();
                              const updateMachinePay = (updates: Partial<MachinePayDraft>) => setSetupDraft((current) => current ? {
                                ...current,
                                machinePay: {
                                  ...current.machinePay,
                                  [selectedMachineId]: { ...(current.machinePay[selectedMachineId] ?? newMachinePayDraft()), ...updates },
                                },
                              } : current);
                              return (
                                <div key={selectedMachineId} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                      <p className="font-semibold text-foreground">{machine?.machineLabel ?? 'Selected machine'}</p>
                                      <p className="mt-0.5 text-sm text-muted-foreground">{[machine?.locationName, machine?.accountName].filter(Boolean).join(' · ')}</p>
                                    </div>
                                    {machinePay.shiftRate && (
                                      <Badge variant="outline" className="bg-muted/30">{formatCurrency(Math.round(Number(machinePay.shiftRate) * 100))} per started hour</Badge>
                                    )}
                                  </div>
                                  <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
                                    <div>
                                      <label htmlFor={`setup-shift-rate-${selectedMachineId}`} className="text-sm font-medium text-foreground">Pay per started hour</label>
                                      <div className="relative mt-2"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">$</span><Input id={`setup-shift-rate-${selectedMachineId}`} type="number" min="0.01" step="0.01" className="min-h-11 pl-7" value={machinePay.shiftRate} onChange={(event) => updateMachinePay({ shiftRate: event.target.value })} required /></div>
                                    </div>
                                    <div>
                                      <label htmlFor={`setup-commission-choice-${selectedMachineId}`} className="text-sm font-medium text-foreground">Commission</label>
                                      <Select value={machinePay.commissionChoice} onValueChange={(value: CommissionChoice) => {
                                        if (value === 'none') updateMachinePay({ commissionChoice: value, commissionEnabled: false });
                                        else if (value === 'three_percent_three_months') updateMachinePay({ commissionChoice: value, commissionEnabled: true, commissionRate: '3', commissionTiming: 'three_months', commissionStartDate: '' });
                                        else updateMachinePay({ commissionChoice: value, commissionEnabled: true });
                                      }}>
                                        <SelectTrigger id={`setup-commission-choice-${selectedMachineId}`} className="mt-2 min-h-11"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="none">No commission</SelectItem>
                                          <SelectItem value="three_percent_three_months">3% after 3 months</SelectItem>
                                          <SelectItem value="custom">Custom commission</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  </div>
                                  {machinePay.commissionChoice === 'three_percent_three_months' && (
                                    <p className="mt-3 text-sm text-muted-foreground">3% commission begins {formatDate(addUtcMonths(setupDraft.effectiveStartDate, 3))}.</p>
                                  )}
                                  {machinePay.commissionChoice === 'custom' && (
                                    <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                                      <div>
                                        <label htmlFor={`setup-commission-rate-${selectedMachineId}`} className="text-sm font-medium text-foreground">Commission rate</label>
                                        <div className="relative mt-2"><Input id={`setup-commission-rate-${selectedMachineId}`} type="number" min="0" max="100" step="0.01" className="min-h-11 pr-8" value={machinePay.commissionRate} onChange={(event) => updateMachinePay({ commissionRate: event.target.value })} required /><span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">%</span></div>
                                      </div>
                                      <div>
                                        <label htmlFor={`setup-commission-timing-${selectedMachineId}`} className="text-sm font-medium text-foreground">Commission begins</label>
                                        <Select value={machinePay.commissionTiming} onValueChange={(value: CommissionTiming) => updateMachinePay({ commissionTiming: value })}>
                                          <SelectTrigger id={`setup-commission-timing-${selectedMachineId}`} className="mt-2 min-h-11"><SelectValue /></SelectTrigger>
                                          <SelectContent><SelectItem value="immediate">Immediately</SelectItem><SelectItem value="three_months">After 3 months</SelectItem><SelectItem value="date">Choose a date</SelectItem></SelectContent>
                                        </Select>
                                        {machinePay.commissionTiming === 'date' && <Input aria-label={`Commission start date for ${machine?.machineLabel ?? 'machine'}`} type="date" min={setupDraft.effectiveStartDate} className="mt-2 min-h-11" value={machinePay.commissionStartDate} onChange={(event) => updateMachinePay({ commissionStartDate: event.target.value })} required />}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <p className="mt-3 text-xs leading-5 text-muted-foreground">Each saved entry rounds up independently: 61 minutes worked counts as two paid shifts. Future rate changes retain their effective-date history.</p>
                        </section>
                      )}

                      {setupError && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{setupError}</p>}
                    </>
                  )}
                </div>

                <DialogFooter className="shrink-0 gap-2 border-t border-border bg-background px-5 py-4 sm:px-6">
                  <Button type="button" variant="outline" className="min-h-11" disabled={setupSubmitting} onClick={() => setSetupDraft(null)}>Cancel</Button>
                  <Button type="submit" className="min-h-11" disabled={setupSubmitting || setupContextQuery.isLoading || Boolean(setupContextQuery.error) || !setupDraft.userEmail.trim() || !setupDraft.displayName.trim() || !setupDraft.effectiveStartDate || !setupDraft.machineIds.length}>
                    {setupSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}
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
