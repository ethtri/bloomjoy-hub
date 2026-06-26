import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock3,
  Copy,
  FileText,
  Loader2,
  Mail,
  Power,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  UserPlus,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getAccessInviteLoginUrl, sendAccessInvite } from '@/lib/accessInvites';
import {
  addPayoutAdjustmentAdmin,
  calculatePayoutRunAdmin,
  deactivateOperatorPayoutProfileAdmin,
  fetchOperatorPayoutSetupContext,
  fetchPayoutReviewContext,
  finalizePayoutRunAdmin,
  issuePayStatementsAdmin,
  markPayoutRunReviewedAdmin,
  previewPayStatementsAdmin,
  provisionOperatorPayoutAccessAdmin,
  reopenPayoutRunAdmin,
  voidPayoutRunAdmin,
  type OperatorPayoutSetupOperator,
  type OperatorWorkerType,
  type PayStatementPreviewResult,
  type PayoutCalculationWarning,
  type PayoutReviewPeriod,
  type PayoutRun,
  type PayoutRunItem,
} from '@/lib/operatorPayouts';
import { cn } from '@/lib/utils';

type ReviewAction = 'mark_reviewed' | 'finalize' | 'reopen' | 'void';

type OperatorProvisionStatus = {
  profileId: string;
  email: string;
  displayName: string;
  authUserCreated: boolean;
  inviteStatus: 'sent' | 'failed';
  inviteError?: string;
};

type OperatorSetupForm = {
  accountId: string;
  email: string;
  displayName: string;
  workerType: OperatorWorkerType;
  payoutPolicyId: string;
  machineIds: string[];
  reason: string;
};

const defaultOperatorSetupForm: OperatorSetupForm = {
  accountId: '',
  email: '',
  displayName: '',
  workerType: 'employee_w2',
  payoutPolicyId: '',
  machineIds: [],
  reason: '',
};

const workerTypeOptions: Array<{ value: OperatorWorkerType; label: string }> = [
  { value: 'employee_w2', label: 'Employee W-2' },
  { value: 'part_time_employee', label: 'Part-time employee' },
  { value: 'contractor_1099', label: 'Contractor 1099' },
  { value: 'owner_operator', label: 'Owner/operator' },
  { value: 'partner', label: 'Partner' },
  { value: 'other', label: 'Other' },
  { value: 'unspecified', label: 'Unspecified' },
];

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

const formatDateTime = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'n/a';

const formatCurrency = (cents: number | null | undefined) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format((cents ?? 0) / 100);

const formatHours = (minutes: number) => `${(minutes / 60).toFixed(2)}h`;

const formatMachineLabel = (machine: { machineLabel?: string; label?: string; locationName?: string | null }) => {
  const label = machine.machineLabel ?? machine.label ?? 'Bloomjoy machine';
  return machine.locationName ? `${label} at ${machine.locationName}` : label;
};

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
  const [isCalculating, setIsCalculating] = useState(false);
  const [action, setAction] = useState<ReviewAction | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [overrideBlockers, setOverrideBlockers] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
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
  const [operatorSetupForm, setOperatorSetupForm] =
    useState<OperatorSetupForm>(defaultOperatorSetupForm);
  const [isProvisioningOperator, setIsProvisioningOperator] = useState(false);
  const [operatorProvisionStatus, setOperatorProvisionStatus] =
    useState<OperatorProvisionStatus | null>(null);
  const [resendingOperatorId, setResendingOperatorId] = useState<string | null>(null);
  const [deactivationForm, setDeactivationForm] = useState({
    operatorProfileId: '',
    reason: '',
  });
  const [isDeactivatingOperator, setIsDeactivatingOperator] = useState(false);

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

  const {
    data: setupContext,
    isLoading: isLoadingSetup,
    isFetching: isFetchingSetup,
    error: setupError,
  } = useQuery({
    queryKey: ['admin-operator-payout-setup-context'],
    queryFn: fetchOperatorPayoutSetupContext,
    staleTime: 1000 * 20,
  });

  const periods = useMemo(() => reviewContext?.periods ?? [], [reviewContext?.periods]);
  const setupAccounts = useMemo(() => setupContext?.accounts ?? [], [setupContext?.accounts]);
  const setupOperators = useMemo(() => setupContext?.operators ?? [], [setupContext?.operators]);
  const selectedSetupAccount = useMemo(
    () =>
      setupAccounts.find((account) => account.id === operatorSetupForm.accountId) ??
      setupAccounts[0] ??
      null,
    [operatorSetupForm.accountId, setupAccounts]
  );
  const selectedAccountOperators = useMemo(
    () =>
      selectedSetupAccount
        ? setupOperators.filter((operator) => operator.accountId === selectedSetupAccount.id)
        : setupOperators,
    [selectedSetupAccount, setupOperators]
  );
  const activeSetupOperators = useMemo(
    () => selectedAccountOperators.filter((operator) => operator.status === 'active'),
    [selectedAccountOperators]
  );
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

  useEffect(() => {
    if (!selectedPeriodId && periods[0]) {
      setSelectedPeriodId(periods[0].id);
    }
  }, [periods, selectedPeriodId]);

  useEffect(() => {
    if (!selectedSetupAccount) return;

    setOperatorSetupForm((current) => {
      if (current.accountId === selectedSetupAccount.id) return current;

      return {
        ...current,
        accountId: selectedSetupAccount.id,
        payoutPolicyId: selectedSetupAccount.policies[0]?.id ?? '',
        machineIds: [],
      };
    });
  }, [selectedSetupAccount]);

  useEffect(() => {
    if (deactivationForm.operatorProfileId || !activeSetupOperators[0]) return;

    setDeactivationForm((current) => ({
      ...current,
      operatorProfileId: activeSetupOperators[0].id,
    }));
  }, [activeSetupOperators, deactivationForm.operatorProfileId]);

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

  const refreshSetup = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-operator-payout-setup-context'] });

  const refreshPayoutSurfaces = async () => {
    await Promise.all([refresh(), refreshSetup()]);
  };

  const updateOperatorSetupForm = (updates: Partial<OperatorSetupForm>) => {
    setOperatorSetupForm((current) => ({ ...current, ...updates }));
  };

  const setOperatorSetupAccount = (accountId: string) => {
    const account = setupAccounts.find((item) => item.id === accountId);
    setOperatorSetupForm((current) => ({
      ...current,
      accountId,
      payoutPolicyId: account?.policies[0]?.id ?? '',
      machineIds: [],
    }));
  };

  const toggleOperatorMachine = (machineId: string) => {
    setOperatorSetupForm((current) => ({
      ...current,
      machineIds: current.machineIds.includes(machineId)
        ? current.machineIds.filter((id) => id !== machineId)
        : [...current.machineIds, machineId],
    }));
  };

  const requireOperatorLoginUrl = (email: string) => {
    const loginUrlResult = getAccessInviteLoginUrl('operator_payout', email);

    if (!loginUrlResult.ok) {
      throw new Error(loginUrlResult.message);
    }

    return loginUrlResult.loginUrl;
  };

  const provisionOperator = async () => {
    const email = operatorSetupForm.email.trim().toLowerCase();
    const reason = operatorSetupForm.reason.trim();

    if (!email) {
      toast.error('Enter the operator email before saving access.');
      return;
    }

    if (!operatorSetupForm.accountId) {
      toast.error('Choose the account for this operator.');
      return;
    }

    if (operatorSetupForm.machineIds.length === 0) {
      toast.error('Assign at least one machine before saving operator access.');
      return;
    }

    if (!reason) {
      toast.error('Enter an audit reason before saving operator access.');
      return;
    }

    setIsProvisioningOperator(true);
    setOperatorProvisionStatus(null);

    try {
      const result = await provisionOperatorPayoutAccessAdmin({
        userEmail: email,
        accountId: operatorSetupForm.accountId,
        displayName: operatorSetupForm.displayName.trim() || email,
        workerType: operatorSetupForm.workerType,
        payoutPolicyId: operatorSetupForm.payoutPolicyId || null,
        machineIds: operatorSetupForm.machineIds,
        reason,
      });

      try {
        const loginUrl = requireOperatorLoginUrl(result.operatorProfile.email);
        await sendAccessInvite({
          inviteType: 'operator_payout',
          sourceId: result.operatorProfile.id,
          targetEmail: result.operatorProfile.email,
          loginUrl,
        });

        setOperatorProvisionStatus({
          profileId: result.operatorProfile.id,
          email: result.operatorProfile.email,
          displayName: result.operatorProfile.displayName,
          authUserCreated: result.authUserCreated,
          inviteStatus: 'sent',
        });
        toast.success(
          result.authUserCreated
            ? 'Operator Auth user, payout profile, assignments, and invite are saved.'
            : 'Operator payout profile, assignments, and invite are saved.'
        );
      } catch (inviteError) {
        const message =
          inviteError instanceof Error ? inviteError.message : 'Unable to send operator invite.';
        setOperatorProvisionStatus({
          profileId: result.operatorProfile.id,
          email: result.operatorProfile.email,
          displayName: result.operatorProfile.displayName,
          authUserCreated: result.authUserCreated,
          inviteStatus: 'failed',
          inviteError: message,
        });
        toast.error('Operator access was saved, but the invite email failed.');
      }

      setOperatorSetupForm((current) => ({
        ...current,
        email: '',
        displayName: '',
        reason: '',
      }));
      await refreshPayoutSurfaces();
    } catch (provisionError) {
      toast.error(
        provisionError instanceof Error
          ? provisionError.message
          : 'Unable to save operator payout access.'
      );
    } finally {
      setIsProvisioningOperator(false);
    }
  };

  const resendOperatorInvite = async (operator: OperatorPayoutSetupOperator) => {
    const email = operator.email?.trim().toLowerCase();

    if (!email) {
      toast.error('This operator profile does not have an email to invite.');
      return;
    }

    setResendingOperatorId(operator.id);
    try {
      const loginUrl = requireOperatorLoginUrl(email);
      await sendAccessInvite({
        inviteType: 'operator_payout',
        sourceId: operator.id,
        targetEmail: email,
        loginUrl,
      });
      setOperatorProvisionStatus((current) =>
        current?.profileId === operator.id
          ? {
              ...current,
              email,
              inviteStatus: 'sent',
              inviteError: undefined,
            }
          : current
      );
      toast.success('Operator invite resent.');
      await refreshSetup();
    } catch (inviteError) {
      toast.error(inviteError instanceof Error ? inviteError.message : 'Unable to resend invite.');
    } finally {
      setResendingOperatorId(null);
    }
  };

  const copyOperatorLoginUrl = async (email: string | null) => {
    if (!email) {
      toast.error('This operator profile does not have an email to copy.');
      return;
    }

    try {
      const loginUrl = requireOperatorLoginUrl(email);
      await navigator.clipboard.writeText(loginUrl);
      toast.success('Operator login link copied.');
    } catch (copyError) {
      toast.error(copyError instanceof Error ? copyError.message : 'Unable to copy login link.');
    }
  };

  const deactivateOperator = async () => {
    const reason = deactivationForm.reason.trim();

    if (!deactivationForm.operatorProfileId) {
      toast.error('Choose an operator to deactivate.');
      return;
    }

    if (!reason) {
      toast.error('Enter an audit reason before deactivating operator access.');
      return;
    }

    setIsDeactivatingOperator(true);
    try {
      await deactivateOperatorPayoutProfileAdmin({
        operatorProfileId: deactivationForm.operatorProfileId,
        reason,
      });
      toast.success('Operator access deactivated.');
      setOperatorProvisionStatus(null);
      setDeactivationForm({ operatorProfileId: '', reason: '' });
      await refreshPayoutSurfaces();
    } catch (deactivateError) {
      toast.error(
        deactivateError instanceof Error
          ? deactivateError.message
          : 'Unable to deactivate operator access.'
      );
    } finally {
      setIsDeactivatingOperator(false);
    }
  };

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
            <Button
              variant="outline"
              onClick={() => void refreshPayoutSurfaces()}
              disabled={isFetching || isFetchingSetup}
            >
              {isFetching || isFetchingSetup ? (
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
        <div className="container-page space-y-6">
          <div className="rounded-lg border border-border bg-background p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <UserPlus className="h-5 w-5 text-primary" />
                  <h2 className="font-display text-2xl font-semibold text-foreground">
                    Operator Setup
                  </h2>
                  <Badge variant="outline">{activeSetupOperators.length} active</Badge>
                </div>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                  Create employee operator access, assign machines, send the invite, and preserve
                  setup evidence before the first time entry.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => void refreshSetup()}
                disabled={isFetchingSetup}
              >
                {isFetchingSetup ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Refresh Setup
              </Button>
            </div>

            <div className="mt-5">
              {isLoadingSetup ? (
                <EmptyState title="Loading operator setup">
                  Pulling manageable accounts, machines, payout policies, and invite evidence.
                </EmptyState>
              ) : setupError ? (
                <EmptyState title="Unable to load operator setup">
                  {setupError instanceof Error
                    ? setupError.message
                    : 'The operator setup context could not load.'}
                </EmptyState>
              ) : setupAccounts.length === 0 ? (
                <EmptyState title="No operator setup access">
                  Your account does not currently have payout setup access for any active machine.
                </EmptyState>
              ) : (
                <>
                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                    <div className="space-y-5">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <Label htmlFor="operator-setup-account">Account</Label>
                          <select
                            id="operator-setup-account"
                            value={operatorSetupForm.accountId}
                            onChange={(event) => setOperatorSetupAccount(event.target.value)}
                            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          >
                            {setupAccounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <Label htmlFor="operator-setup-policy">Payout policy</Label>
                          <select
                            id="operator-setup-policy"
                            value={operatorSetupForm.payoutPolicyId}
                            onChange={(event) =>
                              updateOperatorSetupForm({ payoutPolicyId: event.target.value })
                            }
                            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          >
                            <option value="">Use account default</option>
                            {(selectedSetupAccount?.policies ?? []).map((policy) => (
                              <option key={policy.id} value={policy.id}>
                                {policy.name} / {formatStatus(policy.frequency)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <Label htmlFor="operator-setup-email">Operator email</Label>
                          <Input
                            id="operator-setup-email"
                            type="email"
                            value={operatorSetupForm.email}
                            onChange={(event) =>
                              updateOperatorSetupForm({ email: event.target.value })
                            }
                            placeholder="operator@example.com"
                            className="mt-2"
                          />
                        </div>
                        <div>
                          <Label htmlFor="operator-setup-name">Display name</Label>
                          <Input
                            id="operator-setup-name"
                            value={operatorSetupForm.displayName}
                            onChange={(event) =>
                              updateOperatorSetupForm({ displayName: event.target.value })
                            }
                            placeholder="Alex Operator"
                            className="mt-2"
                          />
                        </div>
                        <div>
                          <Label htmlFor="operator-setup-worker-type">Worker type</Label>
                          <select
                            id="operator-setup-worker-type"
                            value={operatorSetupForm.workerType}
                            onChange={(event) =>
                              updateOperatorSetupForm({
                                workerType: event.target.value as OperatorWorkerType,
                              })
                            }
                            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          >
                            {workerTypeOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between gap-3">
                          <Label>Assigned machines</Label>
                          <Badge variant="outline">{operatorSetupForm.machineIds.length} selected</Badge>
                        </div>
                        {(selectedSetupAccount?.machines ?? []).length === 0 ? (
                          <p className="mt-3 rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                            No active manageable machines are available for this account.
                          </p>
                        ) : (
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {(selectedSetupAccount?.machines ?? []).map((machine) => (
                              <label
                                key={machine.id}
                                className={cn(
                                  'flex min-h-12 items-start gap-3 rounded-md border border-border bg-muted/10 p-3 text-sm',
                                  !machine.canManage && 'opacity-60'
                                )}
                              >
                                <input
                                  type="checkbox"
                                  className="mt-1"
                                  checked={operatorSetupForm.machineIds.includes(machine.id)}
                                  disabled={!machine.canManage}
                                  onChange={() => toggleOperatorMachine(machine.id)}
                                />
                                <span>
                                  <span className="block font-medium text-foreground">
                                    {formatMachineLabel(machine)}
                                  </span>
                                  <span className="block text-xs text-muted-foreground">
                                    {formatStatus(machine.machineType ?? 'machine')}
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <Label htmlFor="operator-setup-reason">Audit reason</Label>
                        <Textarea
                          id="operator-setup-reason"
                          value={operatorSetupForm.reason}
                          onChange={(event) =>
                            updateOperatorSetupForm({ reason: event.target.value })
                          }
                          placeholder="Hired for the June machine service schedule."
                          className="mt-2"
                        />
                      </div>

                      {operatorProvisionStatus && (
                        <div
                          className={cn(
                            'rounded-md border p-4 text-sm',
                            operatorProvisionStatus.inviteStatus === 'sent'
                              ? 'border-sage/30 bg-sage-light'
                              : 'border-amber/30 bg-amber/10'
                          )}
                        >
                          <div className="flex items-start gap-3">
                            {operatorProvisionStatus.inviteStatus === 'sent' ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 text-sage" />
                            ) : (
                              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber" />
                            )}
                            <div>
                              <p className="font-medium text-foreground">
                                {operatorProvisionStatus.displayName} saved
                              </p>
                              <p className="mt-1 text-muted-foreground">
                                {operatorProvisionStatus.inviteStatus === 'sent'
                                  ? `Invite sent to ${operatorProvisionStatus.email}.`
                                  : `Invite failed for ${operatorProvisionStatus.email}: ${
                                      operatorProvisionStatus.inviteError ??
                                      'retry from the operator list.'
                                    }`}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      <Button
                        onClick={() => void provisionOperator()}
                        disabled={isProvisioningOperator}
                      >
                        {isProvisioningOperator ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <UserPlus className="mr-2 h-4 w-4" />
                        )}
                        Save Operator and Send Invite
                      </Button>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="font-semibold text-foreground">Operator Access</h3>
                          <Badge variant="outline">{selectedAccountOperators.length}</Badge>
                        </div>
                        {selectedAccountOperators.length === 0 ? (
                          <p className="mt-3 rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                            No operators are set up for this account yet.
                          </p>
                        ) : (
                          <div className="mt-3 divide-y divide-border rounded-md border border-border">
                            {selectedAccountOperators.map((operator) => (
                              <div key={operator.id} className="p-4">
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="font-medium text-foreground">
                                        {operator.displayName}
                                      </p>
                                      <Badge variant={statusVariant(operator.status)}>
                                        {formatStatus(operator.status)}
                                      </Badge>
                                    </div>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                      {operator.email ?? 'No email on Auth user'}
                                    </p>
                                    <p className="mt-2 text-xs text-muted-foreground">
                                      {operator.activeAssignments.length} active machines
                                      {operator.latestInvite
                                        ? ` / last invite ${formatStatus(
                                            operator.latestInvite.deliveryStatus
                                          )} ${formatDateTime(operator.latestInvite.sentAt)}`
                                        : ' / no invite evidence yet'}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <Button
                                      variant="outline"
                                      className="h-9 px-3"
                                      onClick={() => void copyOperatorLoginUrl(operator.email)}
                                    >
                                      <Copy className="mr-2 h-4 w-4" />
                                      Copy Link
                                    </Button>
                                    <Button
                                      variant="outline"
                                      className="h-9 px-3"
                                      onClick={() => void resendOperatorInvite(operator)}
                                      disabled={
                                        !operator.canSendInvite ||
                                        resendingOperatorId === operator.id ||
                                        operator.status !== 'active'
                                      }
                                    >
                                      {resendingOperatorId === operator.id ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      ) : (
                                        <Mail className="mr-2 h-4 w-4" />
                                      )}
                                      Resend
                                    </Button>
                                  </div>
                                </div>
                                {operator.activeAssignments.length > 0 && (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {operator.activeAssignments.map((assignment) => (
                                      <Badge key={assignment.assignmentId} variant="outline">
                                        {formatMachineLabel(assignment)}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="rounded-md border border-border bg-muted/10 p-4">
                        <div className="flex items-center gap-2">
                          <Power className="h-4 w-4 text-destructive" />
                          <h3 className="font-semibold text-foreground">Deactivate Access</h3>
                        </div>
                        <div className="mt-4 space-y-3">
                          <div>
                            <Label htmlFor="operator-deactivate-profile">Operator</Label>
                            <select
                              id="operator-deactivate-profile"
                              value={deactivationForm.operatorProfileId}
                              onChange={(event) =>
                                setDeactivationForm((current) => ({
                                  ...current,
                                  operatorProfileId: event.target.value,
                                }))
                              }
                              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            >
                              <option value="">Choose an active operator</option>
                              {activeSetupOperators.map((operator) => (
                                <option key={operator.id} value={operator.id}>
                                  {operator.displayName}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <Label htmlFor="operator-deactivate-reason">Audit reason</Label>
                            <Textarea
                              id="operator-deactivate-reason"
                              value={deactivationForm.reason}
                              onChange={(event) =>
                                setDeactivationForm((current) => ({
                                  ...current,
                                  reason: event.target.value,
                                }))
                              }
                              placeholder="Employment ended; revoke future time entry access."
                              className="mt-2"
                            />
                          </div>
                          <Button
                            variant="outline"
                            className="border-destructive/30 text-destructive hover:bg-destructive/10"
                            onClick={() => void deactivateOperator()}
                            disabled={isDeactivatingOperator || activeSetupOperators.length === 0}
                          >
                            {isDeactivatingOperator ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Power className="mr-2 h-4 w-4" />
                            )}
                            Deactivate Operator
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

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

              <div className="space-y-6">
                <div className="rounded-lg border border-border bg-background p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display text-2xl font-semibold text-foreground">
                          {selectedPeriod?.accountName}
                        </h2>
                        <Badge variant={statusVariant(selectedRun?.status ?? selectedPeriod?.status ?? '')}>
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
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setAction('mark_reviewed')}
                        disabled={!canMutateRun}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Mark Reviewed
                      </Button>
                      <Button
                        onClick={() => setAction('finalize')}
                        disabled={!canMutateRun || Boolean(selectedPeriod?.issuedStatementCount)}
                      >
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        Finalize
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setAction('reopen')}
                        disabled={!selectedRun || !selectedPeriod?.canFinalize}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Reopen
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setAction('void')}
                        disabled={!selectedRun || !selectedPeriod?.canFinalize}
                      >
                        <Ban className="mr-2 h-4 w-4" />
                        Void
                      </Button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Metric label="Total payout" value={formatCurrency(selectedRun?.totalPayoutCents)} tone="good" />
                    <Metric label="Operators" value={`${selectedRun?.items.length ?? 0}`} />
                    <Metric label="Paid hours" value={formatHours(selectedRun?.totalRoundedPaidMinutes ?? 0)} />
                    <Metric
                      label="Warnings"
                      value={`${warnings.length}`}
                      tone={blockerCount > 0 ? 'warning' : 'default'}
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-background p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div>
                      <h2 className="font-semibold text-foreground">Calculation</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Generate the first payout run or regenerate after corrections. Existing
                        runs require an audit reason.
                      </p>
                    </div>
                    <Button onClick={() => void runCalculation()} disabled={isCalculating || !selectedPeriod}>
                      {isCalculating ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Clock3 className="mr-2 h-4 w-4" />
                      )}
                      {selectedRun ? 'Recalculate' : 'Generate'}
                    </Button>
                  </div>
                  <div className="mt-4">
                    <Label htmlFor="payout-calculate-reason">Audit reason</Label>
                    <Textarea
                      id="payout-calculate-reason"
                      value={calculateReason}
                      onChange={(event) => setCalculateReason(event.target.value)}
                      placeholder="Explain the correction, override, or source-data refresh."
                      className="mt-2"
                    />
                  </div>
                </div>

                {warnings.length > 0 && (
                  <div className="rounded-lg border border-amber/30 bg-amber/10 p-5">
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
                  <div className="rounded-lg border border-border bg-background p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h2 className="font-semibold text-foreground">Pay Statements</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Preview operator statements, then publish the finalized payout run to the
                          operator portal with versioned revision history.
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

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <Metric
                        label="Statement records"
                        value={`${selectedPeriod?.issuedStatementCount ?? 0}`}
                      />
                      <Metric label="Portal status" value={hasIssuedStatements ? 'Published' : 'Not issued'} />
                      <Metric label="Eligible now" value={canIssueStatements ? 'Yes' : 'Finalize first'} />
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

                {selectedRun && (
                  <div className="rounded-lg border border-border bg-background p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h2 className="font-semibold text-foreground">Manual Adjustment</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Add bonuses, reimbursements, corrections, or deductions with both an
                          operator-visible description and manager audit reason.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => void addAdjustment()}
                        disabled={!canMutateRun || isAddingAdjustment}
                      >
                        {isAddingAdjustment && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Add Adjustment
                      </Button>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <Label htmlFor="adjustment-operator">Operator</Label>
                        <select
                          id="adjustment-operator"
                          value={adjustmentForm.operatorProfileId}
                          onChange={(event) =>
                            setAdjustmentForm((current) => ({
                              ...current,
                              operatorProfileId: event.target.value,
                            }))
                          }
                          className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          {selectedRun.items.map((item) => (
                            <option key={item.id} value={item.operatorProfileId}>
                              {item.operatorDisplayName}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label htmlFor="adjustment-amount">Amount</Label>
                        <Input
                          id="adjustment-amount"
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
                        <Label htmlFor="adjustment-type">Type</Label>
                        <select
                          id="adjustment-type"
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
                        <Label htmlFor="adjustment-description">Operator-visible description</Label>
                        <Input
                          id="adjustment-description"
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
                        <Label htmlFor="adjustment-reason">Manager audit reason</Label>
                        <Textarea
                          id="adjustment-reason"
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
                  </div>
                )}

                {selectedRun ? (
                  <div className="space-y-4">
                    {selectedRun.items.map((item) => (
                      <OperatorItemCard key={item.id} item={item} />
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No payout run yet">
                    Generate a payout run after operators have submitted time for this period.
                  </EmptyState>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

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
