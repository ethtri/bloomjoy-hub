import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock3,
  FileText,
  ListChecks,
  Loader2,
  MoreHorizontal,
  PlusCircle,
  RefreshCw,
  ReceiptText,
  RotateCcw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  addPayoutAdjustmentAdmin,
  calculatePayoutRunAdmin,
  fetchPayoutReviewContext,
  finalizePayoutRunAdmin,
  issuePayStatementsAdmin,
  markPayoutRunReviewedAdmin,
  previewPayStatementsAdmin,
  reopenPayoutRunAdmin,
  voidPayoutRunAdmin,
  type PayStatementPreviewResult,
  type PayoutCalculationWarning,
  type PayoutReviewPeriod,
  type PayoutRun,
  type PayoutRunItem,
} from '@/lib/operatorPayouts';
import { cn } from '@/lib/utils';

type ReviewAction = 'mark_reviewed' | 'finalize' | 'reopen' | 'void';
type PrimaryAction = 'generate' | 'warnings' | 'operators' | 'finalize' | 'statements' | 'none';
type StepState = 'done' | 'current' | 'blocked' | 'pending';

type ReadinessState = {
  tone: 'ready' | 'blocked' | 'attention' | 'neutral';
  label: string;
  title: string;
  description: string;
  primaryLabel: string;
  primaryAction: PrimaryAction;
  primaryDisabled?: boolean;
};

const statusVariant = (status: string): 'default' | 'destructive' | 'outline' => {
  if (['finalized', 'issued', 'closed', 'reviewed'].includes(status)) return 'default';
  if (status === 'voided') return 'destructive';
  return 'outline';
};

const warningVariant = (severity: string): 'default' | 'destructive' | 'outline' =>
  severity === 'blocker' ? 'destructive' : severity === 'warning' ? 'outline' : 'default';

const formatStatus = (value: string) =>
  value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatDate = (value: string | null | undefined) =>
  value
    ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'n/a';

const formatCurrency = (cents: number | null | undefined) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format((cents ?? 0) / 100);

const formatHours = (minutes: number) => `${(minutes / 60).toFixed(2)}h`;

const centsFromCurrency = (value: string) => {
  const normalized = value.replace(/[$,\s]/g, '');
  if (!normalized) return null;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric === 0) return null;
  return Math.round(numeric * 100);
};

const collectWarnings = (run: PayoutRun | null): PayoutCalculationWarning[] => [
  ...(run?.warnings ?? []),
  ...(run?.items.flatMap((item) => item.warnings) ?? []),
];

const getReadinessState = ({
  period,
  run,
  warningCount,
  blockerCount,
  canMutateRun,
  canIssueStatements,
  hasIssuedStatements,
}: {
  period: PayoutReviewPeriod | null;
  run: PayoutRun | null;
  warningCount: number;
  blockerCount: number;
  canMutateRun: boolean;
  canIssueStatements: boolean;
  hasIssuedStatements: boolean;
}): ReadinessState => {
  if (!period) {
    return {
      tone: 'neutral',
      label: 'No period selected',
      title: 'Choose a payout period',
      description: 'Select a period from the review queue to see status and next actions.',
      primaryLabel: 'Select period',
      primaryAction: 'none',
      primaryDisabled: true,
    };
  }

  if (!run) {
    return {
      tone: 'attention',
      label: 'Needs payout run',
      title: 'Generate the payout run before review',
      description:
        'The review starts after submitted time, revenue snapshots, rules, and adjustments are calculated into a draft run.',
      primaryLabel: 'Generate payout run',
      primaryAction: 'generate',
      primaryDisabled: !period.canFinalize,
    };
  }

  if (hasIssuedStatements) {
    return {
      tone: 'ready',
      label: 'Pay stubs issued',
      title: 'Operators can now see their pay stubs',
      description:
        'Use the statement panel only when a corrected revision is needed. Issued runs cannot be casually reopened.',
      primaryLabel: 'Review pay stubs',
      primaryAction: 'statements',
    };
  }

  if (canIssueStatements) {
    return {
      tone: 'ready',
      label: 'Ready to issue',
      title: 'Final review is complete',
      description:
        'Operators cannot see pay stubs yet. Preview the rows, then issue them with an audit reason.',
      primaryLabel: 'Issue pay stubs',
      primaryAction: 'statements',
    };
  }

  if (blockerCount > 0) {
    return {
      tone: 'blocked',
      label: 'Blocked',
      title: 'Resolve critical warnings before finalizing',
      description:
        'Critical warnings block finalization unless a manager records an explicit override reason.',
      primaryLabel: 'Review blockers',
      primaryAction: 'warnings',
    };
  }

  if (!period.canFinalize) {
    return {
      tone: 'neutral',
      label: 'Review only',
      title: 'This period is outside your payout approval scope',
      description:
        'Payout approval stays with admins who have payout access. Plus and partner reporting remain separate.',
      primaryLabel: 'Review operator totals',
      primaryAction: 'operators',
    };
  }

  return {
    tone: warningCount > 0 ? 'attention' : 'ready',
    label: warningCount > 0 ? 'Needs review' : 'Ready',
    title: warningCount > 0 ? 'Review warnings, then finalize' : 'Ready for final review',
    description:
      warningCount > 0
        ? 'Non-critical warnings are present. Check operator totals before recording the final decision.'
        : 'No blockers found. Review operator totals once more, then finalize this payout run.',
    primaryLabel: 'Finalize payout',
    primaryAction: 'finalize',
    primaryDisabled: !canMutateRun,
  };
};

const getStepState = ({
  step,
  run,
  blockerCount,
  hasIssuedStatements,
}: {
  step: 'inputs' | 'warnings' | 'adjustments' | 'finalize' | 'statements';
  run: PayoutRun | null;
  blockerCount: number;
  hasIssuedStatements: boolean;
}): StepState => {
  if (!run) return step === 'inputs' ? 'current' : 'pending';
  if (step === 'inputs') return 'done';
  if (step === 'warnings') return blockerCount > 0 ? 'blocked' : 'done';
  if (step === 'adjustments') {
    return ['draft', 'review', 'reopened'].includes(run.status) ? 'current' : 'done';
  }
  if (step === 'finalize') {
    return ['finalized', 'issued', 'closed'].includes(run.status) ? 'done' : 'current';
  }
  if (step === 'statements') {
    if (hasIssuedStatements) return 'done';
    return ['finalized', 'issued'].includes(run.status) ? 'current' : 'pending';
  }
  return 'pending';
};

const Metric = ({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'warning';
}) => (
  <div
    className={cn(
      'rounded-lg border bg-background p-4',
      tone === 'good' && 'border-sage/30 bg-sage-light',
      tone === 'warning' && 'border-amber/30 bg-amber/10'
    )}
  >
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {label}
    </p>
    <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
  </div>
);

const EmptyState = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-sm">
    <h2 className="font-semibold text-foreground">{title}</h2>
    <p className="mt-2 text-muted-foreground">{children}</p>
  </div>
);

const ReviewStep = ({
  index,
  title,
  description,
  state,
}: {
  index: number;
  title: string;
  description: string;
  state: StepState;
}) => {
  const isDone = state === 'done';
  const isBlocked = state === 'blocked';
  const isCurrent = state === 'current';

  return (
    <div className="flex gap-3 rounded-lg border border-border bg-background p-3">
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
          isDone && 'border-sage/30 bg-sage-light text-foreground',
          isBlocked && 'border-destructive/30 bg-destructive/10 text-destructive',
          isCurrent && 'border-primary/30 bg-primary/10 text-primary',
          state === 'pending' && 'border-border bg-muted/30 text-muted-foreground'
        )}
      >
        {isDone ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : isBlocked ? (
          <AlertTriangle className="h-4 w-4" />
        ) : (
          index
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
};

const PeriodCard = ({
  period,
  selected,
  onSelect,
}: {
  period: PayoutReviewPeriod;
  selected: boolean;
  onSelect: () => void;
}) => {
  const run = period.payoutRun;
  const warningCount = collectWarnings(run).length;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-lg border p-4 text-left transition-colors',
        selected
          ? 'border-primary/40 bg-primary/10'
          : 'border-border bg-background hover:bg-muted/40'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{period.accountName}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDate(period.periodStartDate)} - {formatDate(period.periodEndDate)}
          </p>
        </div>
        <Badge variant={statusVariant(run?.status ?? period.status)}>
          {formatStatus(run?.status ?? period.status)}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>{formatCurrency(run?.totalPayoutCents ?? 0)}</span>
        <span>{run?.items.length ?? 0} operators</span>
        {warningCount > 0 && <span>{warningCount} warnings</span>}
        {period.revisionCount > 0 && <span>{period.revisionCount} revisions</span>}
      </div>
    </button>
  );
};

const OperatorItemCard = ({ item }: { item: PayoutRunItem }) => (
  <div className="rounded-lg border border-border bg-background p-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 className="font-semibold text-foreground">{item.operatorDisplayName}</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant={statusVariant(item.status)}>{formatStatus(item.status)}</Badge>
          <Badge variant="outline">{formatHours(item.roundedPaidMinutes)}</Badge>
          <Badge variant="outline">{item.shiftCount} shifts</Badge>
        </div>
      </div>
      <div className="text-left sm:text-right">
        <p className="text-lg font-semibold text-foreground">
          {formatCurrency(item.totalPayoutCents)}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatCurrency(item.hourlyPayCents)} hourly / {formatCurrency(item.commissionPayCents)} commission
        </p>
      </div>
    </div>

    {item.warnings.length > 0 && (
      <div className="mt-4 space-y-2">
        {item.warnings.map((warning, index) => (
          <div
            key={`${warning.code}-${index}`}
            className="rounded-md border border-amber/30 bg-amber/10 p-3 text-xs text-amber-900"
          >
            <span className="font-semibold">{formatStatus(warning.severity)}:</span>{' '}
            {warning.message}
          </div>
        ))}
      </div>
    )}

    <div className="mt-4 overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-2 pr-4 font-semibold">Machine</th>
            <th className="py-2 pr-4 font-semibold">Time</th>
            <th className="py-2 pr-4 font-semibold">Revenue</th>
            <th className="py-2 pr-4 font-semibold">Commission</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {item.machines.map((machine) => (
            <tr key={machine.id}>
              <td className="py-2 pr-4">
                <span className="block font-medium text-foreground">{machine.machineLabel}</span>
                <span className="text-xs text-muted-foreground">{machine.locationName}</span>
              </td>
              <td className="py-2 pr-4">{formatHours(machine.roundedPaidMinutes)}</td>
              <td className="py-2 pr-4">{formatCurrency(machine.eligibleNetRevenueCents)}</td>
              <td className="py-2 pr-4">{formatCurrency(machine.commissionPayCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {item.adjustments.length > 0 && (
      <div className="mt-4 rounded-md border border-border bg-muted/20 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Adjustments
        </p>
        <div className="mt-2 space-y-2 text-sm">
          {item.adjustments.map((adjustment) => (
            <div key={adjustment.id} className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">{adjustment.description}</span>
              <span className="font-medium text-foreground">
                {formatCurrency(adjustment.amountCents)}
              </span>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
);

export default function AdminPayoutsPage() {
  const queryClient = useQueryClient();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [calculateReason, setCalculateReason] = useState('');
  const [isCalculationDialogOpen, setIsCalculationDialogOpen] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [action, setAction] = useState<ReviewAction | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [overrideBlockers, setOverrideBlockers] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [isAdjustmentDialogOpen, setIsAdjustmentDialogOpen] = useState(false);
  const [adjustmentForm, setAdjustmentForm] = useState({
    operatorProfileId: '',
    amount: '',
    adjustmentType: 'manual_adjustment',
    description: '',
    reason: '',
    visibleToOperator: true,
  });
  const [isAddingAdjustment, setIsAddingAdjustment] = useState(false);
  const [isRunningAction, setIsRunningAction] = useState(false);
  const [statementPreview, setStatementPreview] = useState<PayStatementPreviewResult | null>(null);
  const [isPreviewingStatements, setIsPreviewingStatements] = useState(false);
  const [isIssuingStatements, setIsIssuingStatements] = useState(false);
  const [issueReason, setIssueReason] = useState('');
  const [issueRevisionReason, setIssueRevisionReason] = useState('');

  const {
    data: reviewContext,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-payout-review-context'],
    queryFn: fetchPayoutReviewContext,
    staleTime: 1000 * 20,
  });

  const periods = useMemo(() => reviewContext?.periods ?? [], [reviewContext?.periods]);
  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === selectedPeriodId) ?? periods[0] ?? null,
    [periods, selectedPeriodId]
  );
  const selectedRun = selectedPeriod?.payoutRun ?? null;
  const warnings = useMemo(() => collectWarnings(selectedRun), [selectedRun]);
  const blockerCount = warnings.filter((warning) => warning.severity === 'blocker').length;
  const canMutateRun =
    Boolean(selectedPeriod?.canFinalize) &&
    Boolean(selectedRun) &&
    ['draft', 'review', 'reopened'].includes(selectedRun?.status ?? '');
  const canIssueStatements =
    Boolean(selectedPeriod?.canFinalize) &&
    Boolean(selectedRun) &&
    ['finalized', 'issued'].includes(selectedRun?.status ?? '');
  const hasIssuedStatements = Boolean(selectedPeriod?.issuedStatementCount);
  const readiness = getReadinessState({
    period: selectedPeriod,
    run: selectedRun,
    warningCount: warnings.length,
    blockerCount,
    canMutateRun,
    canIssueStatements,
    hasIssuedStatements,
  });
  const reviewSteps = [
    {
      title: 'Review inputs',
      description: selectedRun
        ? 'Time, revenue snapshots, and compensation rules are calculated.'
        : 'Generate the run from submitted time and current payout rules.',
      state: getStepState({
        step: 'inputs',
        run: selectedRun,
        blockerCount,
        hasIssuedStatements,
      }),
    },
    {
      title: 'Resolve issues',
      description:
        blockerCount > 0
          ? 'Critical warnings need a fix or explicit override.'
          : 'No critical blockers are stopping final review.',
      state: getStepState({
        step: 'warnings',
        run: selectedRun,
        blockerCount,
        hasIssuedStatements,
      }),
    },
    {
      title: 'Adjust if needed',
      description: 'Manual corrections stay available without crowding normal review.',
      state: getStepState({
        step: 'adjustments',
        run: selectedRun,
        blockerCount,
        hasIssuedStatements,
      }),
    },
    {
      title: 'Finalize',
      description: 'Record the manager decision and preserve a review snapshot.',
      state: getStepState({
        step: 'finalize',
        run: selectedRun,
        blockerCount,
        hasIssuedStatements,
      }),
    },
    {
      title: 'Issue pay stubs',
      description: hasIssuedStatements
        ? 'Operators can download the latest issued statements.'
        : 'Pay stubs become operator-visible only after issuance.',
      state: getStepState({
        step: 'statements',
        run: selectedRun,
        blockerCount,
        hasIssuedStatements,
      }),
    },
  ];

  useEffect(() => {
    if (!selectedPeriodId && periods[0]) {
      setSelectedPeriodId(periods[0].id);
    }
  }, [periods, selectedPeriodId]);

  useEffect(() => {
    const firstOperator = selectedRun?.items[0]?.operatorProfileId ?? '';
    setAdjustmentForm((current) => ({
      ...current,
      operatorProfileId: firstOperator,
    }));
  }, [selectedRun?.id, selectedRun?.items]);

  useEffect(() => {
    setStatementPreview(null);
    setIssueReason('');
    setIssueRevisionReason('');
  }, [selectedRun?.id]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-payout-review-context'] });

  const runCalculation = async () => {
    if (!selectedPeriod) return;
    const existingRun = Boolean(selectedPeriod.payoutRun);

    if (existingRun && !calculateReason.trim()) {
      toast.error('Enter a recalculation reason before regenerating this payout run.');
      return;
    }

    setIsCalculating(true);
    try {
      await calculatePayoutRunAdmin({
        payoutPeriodId: selectedPeriod.id,
        regenerate: existingRun,
        reason: calculateReason.trim() || null,
      });
      toast.success(existingRun ? 'Payout run recalculated.' : 'Payout run generated.');
      setCalculateReason('');
      setIsCalculationDialogOpen(false);
      await refresh();
    } catch (calculationError) {
      toast.error(
        calculationError instanceof Error
          ? calculationError.message
          : 'Unable to calculate payout run.'
      );
    } finally {
      setIsCalculating(false);
    }
  };

  const resetActionDialog = () => {
    setAction(null);
    setActionReason('');
    setOverrideBlockers(false);
    setOverrideReason('');
  };

  const runReviewAction = async () => {
    if (!selectedRun || !action) return;

    if (!actionReason.trim()) {
      toast.error('Enter an audit reason before saving this payout action.');
      return;
    }

    if (action === 'finalize' && overrideBlockers && !overrideReason.trim()) {
      toast.error('Enter an override reason for critical payout warnings.');
      return;
    }

    setIsRunningAction(true);
    try {
      if (action === 'mark_reviewed') {
        await markPayoutRunReviewedAdmin({
          payoutRunId: selectedRun.id,
          reason: actionReason.trim(),
        });
        toast.success('Payout run marked reviewed.');
      }

      if (action === 'finalize') {
        await finalizePayoutRunAdmin({
          payoutRunId: selectedRun.id,
          reason: actionReason.trim(),
          overrideBlockers,
          overrideReason: overrideBlockers ? overrideReason.trim() : null,
        });
        toast.success('Payout run finalized.');
      }

      if (action === 'reopen') {
        await reopenPayoutRunAdmin({
          payoutRunId: selectedRun.id,
          reason: actionReason.trim(),
        });
        toast.success('Payout run reopened.');
      }

      if (action === 'void') {
        await voidPayoutRunAdmin({
          payoutRunId: selectedRun.id,
          reason: actionReason.trim(),
        });
        toast.success('Payout run voided.');
      }

      resetActionDialog();
      await refresh();
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : 'Unable to update payout run.');
    } finally {
      setIsRunningAction(false);
    }
  };

  const addAdjustment = async () => {
    if (!selectedRun) return;
    const amountCents = centsFromCurrency(adjustmentForm.amount);

    if (!adjustmentForm.operatorProfileId) {
      toast.error('Choose an operator for the adjustment.');
      return;
    }

    if (amountCents === null) {
      toast.error('Enter a non-zero adjustment amount.');
      return;
    }

    if (!adjustmentForm.description.trim() || !adjustmentForm.reason.trim()) {
      toast.error('Adjustment description and audit reason are required.');
      return;
    }

    setIsAddingAdjustment(true);
    try {
      await addPayoutAdjustmentAdmin({
        payoutRunId: selectedRun.id,
        operatorProfileId: adjustmentForm.operatorProfileId,
        amountCents,
        adjustmentType: adjustmentForm.adjustmentType,
        description: adjustmentForm.description.trim(),
        visibleToOperator: adjustmentForm.visibleToOperator,
        reason: adjustmentForm.reason.trim(),
      });
      toast.success('Adjustment added and payout run recalculated.');
      setAdjustmentForm((current) => ({
        ...current,
        amount: '',
        description: '',
        reason: '',
      }));
      setIsAdjustmentDialogOpen(false);
      await refresh();
    } catch (adjustmentError) {
      toast.error(
        adjustmentError instanceof Error ? adjustmentError.message : 'Unable to add adjustment.'
      );
    } finally {
      setIsAddingAdjustment(false);
    }
  };

  const previewStatements = async () => {
    if (!selectedRun) return;

    setIsPreviewingStatements(true);
    try {
      const preview = await previewPayStatementsAdmin(selectedRun.id);
      setStatementPreview(preview);
      toast.success(`Previewed ${preview.statementCount} pay statement${preview.statementCount === 1 ? '' : 's'}.`);
    } catch (previewError) {
      toast.error(
        previewError instanceof Error ? previewError.message : 'Unable to preview pay statements.'
      );
    } finally {
      setIsPreviewingStatements(false);
    }
  };

  const issueStatements = async () => {
    if (!selectedRun) return;

    if (!issueReason.trim()) {
      toast.error('Enter an audit reason before issuing pay statements.');
      return;
    }

    if (hasIssuedStatements && !issueRevisionReason.trim()) {
      toast.error('Enter a revision reason before reissuing statements.');
      return;
    }

    setIsIssuingStatements(true);
    try {
      const result = await issuePayStatementsAdmin({
        payoutRunId: selectedRun.id,
        reason: issueReason.trim(),
        revisionReason: hasIssuedStatements ? issueRevisionReason.trim() : null,
      });
      toast.success(`Issued ${result.issuedStatementCount} pay statement${result.issuedStatementCount === 1 ? '' : 's'}.`);
      setStatementPreview(null);
      setIssueReason('');
      setIssueRevisionReason('');
      await refresh();
    } catch (issueError) {
      toast.error(issueError instanceof Error ? issueError.message : 'Unable to issue pay statements.');
    } finally {
      setIsIssuingStatements(false);
    }
  };

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const startCalculation = () => {
    if (selectedRun) {
      setIsCalculationDialogOpen(true);
      return;
    }

    void runCalculation();
  };

  const runPrimaryAction = () => {
    if (readiness.primaryAction === 'generate') {
      startCalculation();
      return;
    }

    if (readiness.primaryAction === 'warnings') {
      scrollToSection('payout-warnings');
      return;
    }

    if (readiness.primaryAction === 'operators') {
      scrollToSection('payout-operators');
      return;
    }

    if (readiness.primaryAction === 'finalize') {
      setAction('finalize');
      return;
    }

    if (readiness.primaryAction === 'statements') {
      scrollToSection('payout-pay-stubs');
    }
  };

  const actionTitle =
    action === 'mark_reviewed'
      ? 'Mark Reviewed'
      : action === 'finalize'
        ? 'Finalize Payout'
        : action === 'reopen'
          ? 'Reopen Payout'
          : 'Void Payout';

  return (
    <AppLayout>
      <section className="border-b border-border bg-muted/20">
        <div className="container-page py-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Operator Payouts
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground">
                Payout Review
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                Review assigned-machine time, revenue snapshots, compensation rules, warnings,
                adjustments, and finalization history before pay statements are issued.
              </p>
            </div>
            <Button variant="outline" onClick={() => void refresh()} disabled={isFetching}>
              {isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>
        </div>
      </section>

      <section className="section-padding">
        <div className="container-page">
          {isLoading ? (
            <EmptyState title="Loading payout review">
              Pulling the latest payout periods, review states, and scoped manager permissions.
            </EmptyState>
          ) : error ? (
            <EmptyState title="Unable to load payouts">
              {error instanceof Error ? error.message : 'The payout review queue could not load.'}
            </EmptyState>
          ) : periods.length === 0 ? (
            <EmptyState title="No payout periods ready">
              Create an operator payout profile and payout period first. Payout review appears here
              after a period has assigned time or a generated payout run.
            </EmptyState>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(260px,360px)_1fr]">
              <aside className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-foreground">Periods</h2>
                  <Badge variant="outline">{periods.length}</Badge>
                </div>
                {periods.map((period) => (
                  <PeriodCard
                    key={period.id}
                    period={period}
                    selected={selectedPeriod?.id === period.id}
                    onSelect={() => setSelectedPeriodId(period.id)}
                  />
                ))}
              </aside>

              <div className="flex flex-col gap-6">
                <div className="rounded-lg border border-border bg-background p-5">
                  <div className="flex flex-col gap-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-display text-2xl font-semibold text-foreground">
                            {selectedPeriod?.accountName}
                          </h2>
                          <Badge
                            variant={statusVariant(
                              selectedRun?.status ?? selectedPeriod?.status ?? ''
                            )}
                          >
                            {formatStatus(selectedRun?.status ?? selectedPeriod?.status ?? '')}
                          </Badge>
                          {selectedPeriod?.canFinalize && (
                            <Badge variant="outline" className="gap-1">
                              <ShieldCheck className="h-3.5 w-3.5" />
                              Review access
                            </Badge>
                          )}
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {formatDate(selectedPeriod?.periodStartDate)} -{' '}
                          {formatDate(selectedPeriod?.periodEndDate)} / target payout{' '}
                          {formatDate(selectedPeriod?.targetPayoutDate)}
                        </p>
                        {selectedPeriod?.issuedStatementCount ? (
                          <p className="mt-2 text-sm text-destructive">
                            {selectedPeriod.issuedStatementCount} issued statements already exist;
                            finalization is blocked to prevent duplicates.
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2 md:justify-end">
                        <Button
                          onClick={runPrimaryAction}
                          disabled={
                            readiness.primaryDisabled || isCalculating || isIssuingStatements
                          }
                        >
                          {isCalculating || isIssuingStatements ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : readiness.primaryAction === 'statements' ? (
                            <ReceiptText className="mr-2 h-4 w-4" />
                          ) : readiness.primaryAction === 'generate' ? (
                            <Clock3 className="mr-2 h-4 w-4" />
                          ) : readiness.primaryAction === 'warnings' ? (
                            <AlertTriangle className="mr-2 h-4 w-4" />
                          ) : (
                            <ShieldCheck className="mr-2 h-4 w-4" />
                          )}
                          {readiness.primaryLabel}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline">
                              <MoreHorizontal className="mr-2 h-4 w-4" />
                              More
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel>Review actions</DropdownMenuLabel>
                            <DropdownMenuItem
                              onSelect={() => setAction('mark_reviewed')}
                              disabled={!canMutateRun}
                            >
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                              Mark Reviewed
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={startCalculation}
                              disabled={!selectedPeriod || isCalculating}
                            >
                              <RefreshCw className="mr-2 h-4 w-4" />
                              {selectedRun ? 'Recalculate run' : 'Generate run'}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => setIsAdjustmentDialogOpen(true)}
                              disabled={!canMutateRun}
                            >
                              <PlusCircle className="mr-2 h-4 w-4" />
                              Add adjustment
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>Exception actions</DropdownMenuLabel>
                            <DropdownMenuItem
                              onSelect={() => setAction('reopen')}
                              disabled={!selectedRun || !selectedPeriod?.canFinalize}
                            >
                              <RotateCcw className="mr-2 h-4 w-4" />
                              Reopen payout
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => setAction('void')}
                              disabled={!selectedRun || !selectedPeriod?.canFinalize}
                            >
                              <Ban className="mr-2 h-4 w-4" />
                              Void payout
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    <div
                      className={cn(
                        'rounded-lg border p-4',
                        readiness.tone === 'ready' && 'border-sage/30 bg-sage-light',
                        readiness.tone === 'blocked' && 'border-destructive/30 bg-destructive/10',
                        readiness.tone === 'attention' && 'border-amber/30 bg-amber/10',
                        readiness.tone === 'neutral' && 'border-border bg-muted/20'
                      )}
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <Badge variant={readiness.tone === 'blocked' ? 'destructive' : 'outline'}>
                            {readiness.label}
                          </Badge>
                          <h3 className="mt-3 text-lg font-semibold text-foreground">
                            {readiness.title}
                          </h3>
                          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                            {readiness.description}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <ListChecks className="h-4 w-4" />
                          Guided review
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                      <Metric
                        label="Total payout"
                        value={formatCurrency(selectedRun?.totalPayoutCents)}
                        tone="good"
                      />
                      <Metric label="Operators" value={`${selectedRun?.items.length ?? 0}`} />
                      <Metric label="Paid hours" value={formatHours(selectedRun?.totalRoundedPaidMinutes ?? 0)} />
                      <Metric
                        label="Warnings"
                        value={`${warnings.length}`}
                        tone={blockerCount > 0 ? 'warning' : 'default'}
                      />
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                      {reviewSteps.map((step, index) => (
                        <ReviewStep
                          key={step.title}
                          index={index + 1}
                          title={step.title}
                          description={step.description}
                          state={step.state}
                        />
                      ))}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Admin-only payout approval. Plus and partner users keep separate reporting
                      surfaces and cannot approve operator payouts from this workspace.
                    </p>
                  </div>
                </div>

                {warnings.length > 0 && (
                  <div
                    id="payout-warnings"
                    className="order-2 rounded-lg border border-amber/30 bg-amber/10 p-5"
                  >
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700" />
                      <div>
                        <h2 className="font-semibold text-foreground">Warnings</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Critical warnings block finalization unless a manager records an
                          explicit override reason.
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      {warnings.map((warning, index) => (
                        <div
                          key={`${warning.code}-${index}`}
                          className="rounded-md border border-border bg-background p-3 text-sm"
                        >
                          <Badge variant={warningVariant(warning.severity)}>
                            {formatStatus(warning.severity)}
                          </Badge>
                          <p className="mt-2 font-medium text-foreground">{warning.message}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{warning.code}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedRun && (
                  <div
                    id="payout-pay-stubs"
                    className="order-4 rounded-lg border border-border bg-background p-5"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h2 className="font-semibold text-foreground">Pay Statements</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {hasIssuedStatements
                            ? 'Operators can download the latest issued pay stubs from their portal.'
                            : canIssueStatements
                              ? 'Operators cannot see pay stubs yet. Preview the rows, then issue with an audit reason.'
                              : 'Operators cannot see pay stubs until this payout run is finalized.'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          onClick={() => void previewStatements()}
                          disabled={!selectedPeriod?.canFinalize || isPreviewingStatements}
                        >
                          {isPreviewingStatements ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <FileText className="mr-2 h-4 w-4" />
                          )}
                          Preview
                        </Button>
                        <Button
                          onClick={() => void issueStatements()}
                          disabled={!canIssueStatements || isIssuingStatements}
                        >
                          {isIssuingStatements ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="mr-2 h-4 w-4" />
                          )}
                          Issue
                        </Button>
                      </div>
                    </div>

                    {canIssueStatements && (
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div>
                          <Label htmlFor="statement-issue-reason">Audit reason</Label>
                          <Textarea
                            id="statement-issue-reason"
                            value={issueReason}
                            onChange={(event) => setIssueReason(event.target.value)}
                            placeholder="Approved after final payout review."
                            className="mt-2"
                          />
                        </div>
                        <div>
                          <Label htmlFor="statement-revision-reason">Revision reason</Label>
                          <Textarea
                            id="statement-revision-reason"
                            value={issueRevisionReason}
                            onChange={(event) => setIssueRevisionReason(event.target.value)}
                            placeholder={
                              hasIssuedStatements
                                ? 'Required because statements already exist.'
                                : 'Only needed when reissuing a statement.'
                            }
                            className="mt-2"
                            disabled={!hasIssuedStatements}
                          />
                        </div>
                      </div>
                    )}

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <Metric
                        label="Statement records"
                        value={`${selectedPeriod?.issuedStatementCount ?? 0}`}
                      />
                      <Metric
                        label="Operator visibility"
                        value={hasIssuedStatements ? 'Visible' : 'Hidden'}
                      />
                      <Metric
                        label="Next requirement"
                        value={canIssueStatements ? 'Audit reason' : 'Finalize first'}
                      />
                    </div>

                    {statementPreview && (
                      <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-semibold text-foreground">
                              Draft Preview ({statementPreview.statementCount})
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              Preview rows are not operator-visible until issued.
                            </p>
                          </div>
                          <Badge variant="outline">{formatStatus(statementPreview.status)}</Badge>
                        </div>
                        <div className="mt-3 divide-y divide-border">
                          {statementPreview.statements.slice(0, 5).map((statement) => (
                            <div
                              key={`${statement.statementNumber}-${statement.operator.operatorProfileId}`}
                              className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div>
                                <p className="font-medium text-foreground">
                                  {statement.operator.displayName}
                                </p>
                                <p className="text-muted-foreground">
                                  {formatDate(statement.period.periodStartDate)} -{' '}
                                  {formatDate(statement.period.periodEndDate)}
                                </p>
                              </div>
                              <p className="font-semibold text-foreground">
                                {formatCurrency(statement.totals.totalPayoutCents)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {selectedRun ? (
                  <div id="payout-operators" className="order-3 space-y-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <h2 className="font-semibold text-foreground">Operator review</h2>
                        <p className="text-sm text-muted-foreground">
                          Check each operator's paid hours, machine revenue basis, commission, and
                          warnings.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => setIsAdjustmentDialogOpen(true)}
                        disabled={!canMutateRun}
                      >
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Add adjustment
                      </Button>
                    </div>
                    {selectedRun.items.map((item) => (
                      <OperatorItemCard key={item.id} item={item} />
                    ))}
                  </div>
                ) : (
                  <div id="payout-operators" className="order-3">
                    <EmptyState title="No payout run yet">
                      Generate a payout run after operators have submitted time for this period.
                    </EmptyState>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <Dialog open={isCalculationDialogOpen} onOpenChange={setIsCalculationDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recalculate Payout Run</DialogTitle>
            <DialogDescription>
              Recalculation refreshes the review numbers from current source data and writes an
              audit trail.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="payout-calculate-reason-dialog">Audit reason</Label>
            <Textarea
              id="payout-calculate-reason-dialog"
              value={calculateReason}
              onChange={(event) => setCalculateReason(event.target.value)}
              placeholder="Explain the correction, override, or source-data refresh."
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCalculationDialogOpen(false)}
              disabled={isCalculating}
            >
              Cancel
            </Button>
            <Button onClick={() => void runCalculation()} disabled={isCalculating}>
              {isCalculating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Recalculate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAdjustmentDialogOpen} onOpenChange={setIsAdjustmentDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manual Adjustment</DialogTitle>
            <DialogDescription>
              Add a bonus, reimbursement, correction, or deduction. The operator description and
              manager audit reason are both required.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="adjustment-operator-dialog">Operator</Label>
              <select
                id="adjustment-operator-dialog"
                value={adjustmentForm.operatorProfileId}
                onChange={(event) =>
                  setAdjustmentForm((current) => ({
                    ...current,
                    operatorProfileId: event.target.value,
                  }))
                }
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {selectedRun?.items.map((item) => (
                  <option key={item.id} value={item.operatorProfileId}>
                    {item.operatorDisplayName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="adjustment-amount-dialog">Amount</Label>
              <Input
                id="adjustment-amount-dialog"
                value={adjustmentForm.amount}
                onChange={(event) =>
                  setAdjustmentForm((current) => ({
                    ...current,
                    amount: event.target.value,
                  }))
                }
                placeholder="75.00 or -25.00"
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="adjustment-type-dialog">Type</Label>
              <select
                id="adjustment-type-dialog"
                value={adjustmentForm.adjustmentType}
                onChange={(event) =>
                  setAdjustmentForm((current) => ({
                    ...current,
                    adjustmentType: event.target.value,
                  }))
                }
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="manual_adjustment">Manual adjustment</option>
                <option value="bonus">Bonus</option>
                <option value="reimbursement">Reimbursement</option>
                <option value="prior_period_correction">Prior period correction</option>
                <option value="deduction">Deduction</option>
              </select>
            </div>
            <label className="flex items-center gap-2 pt-7 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={adjustmentForm.visibleToOperator}
                onChange={(event) =>
                  setAdjustmentForm((current) => ({
                    ...current,
                    visibleToOperator: event.target.checked,
                  }))
                }
              />
              Show on operator statement
            </label>
            <div className="md:col-span-2">
              <Label htmlFor="adjustment-description-dialog">Operator-visible description</Label>
              <Input
                id="adjustment-description-dialog"
                value={adjustmentForm.description}
                onChange={(event) =>
                  setAdjustmentForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Weekend event bonus"
                className="mt-2"
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="adjustment-reason-dialog">Manager audit reason</Label>
              <Textarea
                id="adjustment-reason-dialog"
                value={adjustmentForm.reason}
                onChange={(event) =>
                  setAdjustmentForm((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
                placeholder="Approved by operations after event review."
                className="mt-2"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsAdjustmentDialogOpen(false)}
              disabled={isAddingAdjustment}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void addAdjustment()}
              disabled={!canMutateRun || isAddingAdjustment}
            >
              {isAddingAdjustment && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(action)} onOpenChange={(open) => !open && resetActionDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionTitle}</DialogTitle>
            <DialogDescription>
              This action writes an audit record and preserves a review snapshot before the payout
              status changes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="payout-action-reason">Audit reason</Label>
              <Textarea
                id="payout-action-reason"
                value={actionReason}
                onChange={(event) => setActionReason(event.target.value)}
                placeholder="Explain the review decision or correction."
                className="mt-2"
              />
            </div>
            {action === 'finalize' && blockerCount > 0 && (
              <div className="rounded-lg border border-amber/30 bg-amber/10 p-3">
                <label className="flex items-start gap-2 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={overrideBlockers}
                    onChange={(event) => setOverrideBlockers(event.target.checked)}
                    className="mt-1"
                  />
                  Finalize with critical warnings
                </label>
                {overrideBlockers && (
                  <div className="mt-3">
                    <Label htmlFor="payout-override-reason">Override reason</Label>
                    <Textarea
                      id="payout-override-reason"
                      value={overrideReason}
                      onChange={(event) => setOverrideReason(event.target.value)}
                      placeholder="Document why the payout can proceed despite critical warnings."
                      className="mt-2"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetActionDialog} disabled={isRunningAction}>
              Cancel
            </Button>
            <Button onClick={() => void runReviewAction()} disabled={isRunningAction}>
              {isRunningAction && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
