import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
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
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  fetchPartnershipReportingSetup,
  previewPartnerWeeklyReportAdmin,
  removeReportingPartnershipPartyAdmin,
  upsertReportingFinancialRuleAdmin,
  upsertReportingMachineAssignmentAdmin,
  upsertReportingPartnerAdmin,
  upsertReportingPartnershipAdmin,
  upsertReportingPartnershipPartyAdmin,
  type PartnerWeeklyReportPreview,
  type PartnershipReportingSetup,
  type ReportingPartner,
  type ReportingPartnership,
  type ReportingPartnershipFinancialRule,
  type ReportingPartnershipParty,
} from '@/lib/partnershipReporting';
import {
  basisPointsFromPercent,
  centsFromDollars,
  dayNames,
  dollarsFromCents,
  formatDate,
  formatLabel,
  formatMoney,
  getActiveMachineAssignments,
  getLastCompletedWeekEndingDate,
  participantRoles,
  partnerTypes,
  partnershipTypes,
  percentFromBasisPoints,
  today,
  toDateInputValue,
} from '@/pages/admin/reportingSetupUi';

type PartnershipStep = 'details' | 'participants' | 'machines' | 'terms' | 'preview';

const setupQueryKey = ['admin-partnership-reporting-setup'];

const emptySetup: PartnershipReportingSetup = {
  partners: [],
  partnerships: [],
  machines: [],
  assignments: [],
  parties: [],
  taxRates: [],
  financialRules: [],
  warnings: [],
};

const steps: Array<{ key: PartnershipStep; label: string; description: string }> = [
  { key: 'details', label: 'Details', description: 'Name and reporting cadence' },
  { key: 'participants', label: 'Participants', description: 'Organizations in the agreement' },
  { key: 'machines', label: 'Machines', description: 'Assign reporting machines' },
  { key: 'terms', label: 'Payout Rules', description: 'Fees, model, payout split' },
  { key: 'preview', label: 'Weekly Preview', description: 'Check report output' },
];

const validSteps = new Set<PartnershipStep>(steps.map((step) => step.key));
const stepIndexByKey = new Map<PartnershipStep, number>(
  steps.map((step, index) => [step.key, index])
);

const getStepIndex = (step: PartnershipStep) => stepIndexByKey.get(step) ?? 0;
const getAdjacentStep = (step: PartnershipStep, direction: -1 | 1) => {
  const nextIndex = Math.min(Math.max(getStepIndex(step) + direction, 0), steps.length - 1);
  return steps[nextIndex].key;
};

const getSafeArchiveEndDate = (effectiveStartDate: string) => {
  const currentDate = today();
  return effectiveStartDate > currentDate ? effectiveStartDate : currentDate;
};

const emptyPartnerForm = {
  partnerId: null as string | null,
  name: '',
  partnerType: 'revenue_share_partner',
  primaryContactName: '',
  primaryContactEmail: '',
  status: 'active',
  notes: '',
};

const emptyPartnershipForm = {
  partnershipId: null as string | null,
  name: '',
  partnershipType: 'revenue_share',
  reportingWeekEndDay: '0',
  timezone: 'America/Los_Angeles',
  effectiveStartDate: today(),
  effectiveEndDate: '',
  status: 'active',
  notes: '',
};

const emptyParticipantForm = {
  partyId: null as string | null,
  partnershipId: '',
  partnerId: '',
  partyRole: 'revenue_share_recipient',
  sharePercent: '',
  isReportRecipient: false,
};

const emptyRuleForm = {
  ruleId: null as string | null,
  partnershipId: '',
  calculationModel: 'net_split',
  splitBase: 'net_sales',
  feeAmountDollars: '0.40',
  feeBasis: 'per_stick',
  costAmountDollars: '0.00',
  costBasis: 'none',
  deductionTiming: 'before_split',
  grossToNetMethod: 'machine_tax_plus_configured_fees',
  primarySharePercent: '60',
  partnerSharePercent: '40',
  bloomjoySharePercent: '0',
  effectiveStartDate: today(),
  effectiveEndDate: '',
  status: 'active',
  notes: '',
};

const payoutModelPresets = [
  {
    value: 'net_after_tax_fee',
    label: 'Net sales split',
    description: 'Machine tax and the per-stick fee are deducted before splitting payout.',
  },
  {
    value: 'gross_sales_split',
    label: 'Gross sales split',
    description: 'Payout share is calculated from gross sales before deductions.',
  },
  {
    value: 'internal_only',
    label: 'Bloomjoy internal',
    description: 'Use when there is no external payout for this partnership.',
  },
  {
    value: 'custom',
    label: 'Custom',
    description: 'Use only when this agreement needs a nonstandard reporting calculation.',
  },
] as const;

type PayoutModelPreset = (typeof payoutModelPresets)[number]['value'];
type PayoutShareField = 'primarySharePercent' | 'partnerSharePercent' | 'bloomjoySharePercent';

type AllocationShares = {
  primarySharePercent: string;
  partnerSharePercent: string;
  bloomjoySharePercent: string;
};

type PreviewReadinessIssue = {
  title: string;
  message: string;
  actionLabel: string;
  actionHref: string;
};

const shareFieldsByParticipantIndex: PayoutShareField[] = ['primarySharePercent', 'partnerSharePercent'];
const payoutRecipientRole = 'revenue_share_recipient';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const participantRoleLabels: Record<string, string> = {
  venue_partner: 'Venue participant',
  event_partner: 'Event participant',
  platform_partner: 'Platform participant',
  revenue_share_recipient: 'Receives payout',
  operator: 'Operator',
  internal: 'Bloomjoy internal',
  other: 'Other participant',
};

const parseWholePercent = (value: string) => Math.round(Number(value) || 0);

const getWeekStartDate = (weekEndingDate: string) => {
  const date = new Date(`${weekEndingDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  date.setDate(date.getDate() - 6);
  return toDateInputValue(date);
};

const getWeekEndingDateForSaleDate = (saleDate: string, weekEndDay: number) => {
  const date = new Date(`${saleDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const daysForward = (weekEndDay - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + daysForward);
  return toDateInputValue(date);
};

const dateWindowOverlaps = (
  effectiveStartDate: string,
  effectiveEndDate: string | null | undefined,
  windowStartDate: string,
  windowEndDate: string
) =>
  Boolean(windowStartDate && windowEndDate) &&
  effectiveStartDate <= windowEndDate &&
  (!effectiveEndDate || effectiveEndDate >= windowStartDate);

const sanitizeWholePercentInput = (value: string) => {
  if (value.trim() === '') return '';
  const numericValue = Math.round(Number(value));
  if (Number.isNaN(numericValue)) return '';
  return String(Math.min(Math.max(numericValue, 0), 100));
};

const normalizeComparableText = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

const getParticipantRoleLabel = (role: string) => participantRoleLabels[role] ?? formatLabel(role);

const sortParticipantsByAddedDate = (participants: ReportingPartnershipParty[]) =>
  [...participants].sort(
    (left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
  );

const getPayoutRecipientParticipants = (participants: ReportingPartnershipParty[]) =>
  sortParticipantsByAddedDate(participants).filter((party) => party.party_role === payoutRecipientRole);

const getNormalizedPayoutShares = (form: typeof emptyRuleForm, participantCount: number) => ({
  primarySharePercent: participantCount >= 1 ? String(parseWholePercent(form.primarySharePercent)) : '0',
  partnerSharePercent: participantCount >= 2 ? String(parseWholePercent(form.partnerSharePercent)) : '0',
  bloomjoySharePercent: String(parseWholePercent(form.bloomjoySharePercent)),
});

const getPayoutAllocationTotal = (form: typeof emptyRuleForm, participantCount: number) => {
  const normalizedShares = getNormalizedPayoutShares(form, participantCount);
  return (
    parseWholePercent(normalizedShares.primarySharePercent) +
    parseWholePercent(normalizedShares.partnerSharePercent) +
    parseWholePercent(normalizedShares.bloomjoySharePercent)
  );
};

const getDefaultAllocationShares = (participantCount: number): AllocationShares => {
  if (participantCount >= 2) {
    return {
      primarySharePercent: '60',
      partnerSharePercent: '40',
      bloomjoySharePercent: '0',
    };
  }

  if (participantCount === 1) {
    return {
      primarySharePercent: '100',
      partnerSharePercent: '0',
      bloomjoySharePercent: '0',
    };
  }

  return {
    primarySharePercent: '0',
    partnerSharePercent: '0',
    bloomjoySharePercent: '100',
  };
};

const createRuleForm = (
  partnershipId: string,
  payoutRecipientCount: number,
  effectiveStartDate = today()
) => {
  const defaultShares = getDefaultAllocationShares(payoutRecipientCount);

  return {
    ...emptyRuleForm,
    partnershipId,
    effectiveStartDate,
    effectiveEndDate: '',
    status: 'active',
    ...(payoutRecipientCount === 0
      ? {
          calculationModel: 'internal_only',
          feeAmountDollars: '0.00',
          feeBasis: 'none',
          primarySharePercent: '0',
          partnerSharePercent: '0',
          bloomjoySharePercent: '100',
        }
      : defaultShares),
  };
};

const createRuleFormFromRule = (rule: ReportingPartnershipFinancialRule) => ({
  ruleId: rule.id,
  partnershipId: rule.partnership_id,
  calculationModel: rule.calculation_model,
  splitBase: rule.split_base,
  feeAmountDollars: dollarsFromCents(rule.fee_amount_cents),
  feeBasis: rule.fee_basis,
  costAmountDollars: dollarsFromCents(rule.cost_amount_cents),
  costBasis: rule.cost_basis,
  deductionTiming: rule.deduction_timing,
  grossToNetMethod: rule.gross_to_net_method,
  primarySharePercent: percentFromBasisPoints(rule.fever_share_basis_points),
  partnerSharePercent: percentFromBasisPoints(rule.partner_share_basis_points),
  bloomjoySharePercent: percentFromBasisPoints(rule.bloomjoy_share_basis_points),
  effectiveStartDate: rule.effective_start_date,
  effectiveEndDate: rule.effective_end_date ?? '',
  status: rule.status,
  notes: rule.notes ?? '',
});

const getRuleSortValue = (rule: ReportingPartnershipFinancialRule) =>
  `${rule.status === 'active' ? '2' : rule.status === 'draft' ? '1' : '0'}|${rule.effective_start_date}|${rule.updated_at ?? rule.created_at ?? ''}`;

const sortFinancialRulesForSetup = (rules: ReportingPartnershipFinancialRule[]) =>
  [...rules].sort((left, right) => getRuleSortValue(right).localeCompare(getRuleSortValue(left)));

const getPayoutModelPreset = (form: typeof emptyRuleForm): PayoutModelPreset => {
  if (form.calculationModel === 'internal_only') return 'internal_only';
  if (form.calculationModel === 'gross_split' && form.splitBase === 'gross_sales') {
    return 'gross_sales_split';
  }
  if (
    form.calculationModel === 'net_split' &&
    form.splitBase === 'net_sales' &&
    form.grossToNetMethod === 'machine_tax_plus_configured_fees'
  ) {
    return 'net_after_tax_fee';
  }
  return 'custom';
};

const applyPayoutModelPreset = (
  form: typeof emptyRuleForm,
  preset: PayoutModelPreset
): typeof emptyRuleForm => {
  if (preset === 'gross_sales_split') {
    return {
      ...form,
      calculationModel: 'gross_split',
      splitBase: 'gross_sales',
      feeAmountDollars: '0.00',
      feeBasis: 'none',
      costBasis: 'none',
      costAmountDollars: '0.00',
      deductionTiming: 'reporting_only',
    };
  }

  if (preset === 'internal_only') {
    return {
      ...form,
      calculationModel: 'internal_only',
      splitBase: 'net_sales',
      feeAmountDollars: '0.00',
      feeBasis: 'none',
      costBasis: 'none',
      costAmountDollars: '0.00',
      primarySharePercent: '0',
      partnerSharePercent: '0',
      bloomjoySharePercent: '100',
    };
  }

  if (preset === 'custom') {
    return form;
  }

  return {
    ...form,
    calculationModel: 'net_split',
    splitBase: 'net_sales',
    feeBasis: 'per_stick',
    grossToNetMethod: 'machine_tax_plus_configured_fees',
    deductionTiming: 'before_split',
  };
};

export default function AdminPartnershipsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedPartnershipId = searchParams.get('partnershipId') ?? '';
  const requestedStep = searchParams.get('step') as PartnershipStep | null;
  const activeStep = requestedStep && validSteps.has(requestedStep) ? requestedStep : 'details';
  const [dirtySteps, setDirtySteps] = useState<Set<PartnershipStep>>(() => new Set());
  const [pendingRouteState, setPendingRouteState] = useState<{
    partnershipId: string;
    step: PartnershipStep;
  } | null>(null);

  const {
    data: setup = emptySetup,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: setupQueryKey,
    queryFn: fetchPartnershipReportingSetup,
    staleTime: 1000 * 30,
  });

  const selectedPartnership = useMemo(
    () =>
      setup.partnerships.find((partnership) => partnership.id === selectedPartnershipId) ?? null,
    [selectedPartnershipId, setup.partnerships]
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: setupQueryKey });

  const updateRouteState = useCallback((partnershipId: string, step: PartnershipStep) => {
    const nextParams = new URLSearchParams(searchParams);
    if (partnershipId) {
      nextParams.set('partnershipId', partnershipId);
    } else {
      nextParams.delete('partnershipId');
    }
    nextParams.set('step', step);
    setSearchParams(nextParams);
  }, [searchParams, setSearchParams]);

  const markStepDirty = useCallback((step: PartnershipStep, isDirty: boolean) => {
    setDirtySteps((current) => {
      if (current.has(step) === isDirty) {
        return current;
      }
      const next = new Set(current);
      if (isDirty) {
        next.add(step);
      } else {
        next.delete(step);
      }
      return next;
    });
  }, []);

  const requestRouteState = (partnershipId: string, step: PartnershipStep) => {
    const isDifferentRoute = partnershipId !== selectedPartnershipId || step !== activeStep;
    if (isDifferentRoute && dirtySteps.has(activeStep)) {
      setPendingRouteState({ partnershipId, step });
      return;
    }
    updateRouteState(partnershipId, step);
  };

  const confirmPendingRouteState = () => {
    if (!pendingRouteState) return;
    markStepDirty(activeStep, false);
    updateRouteState(pendingRouteState.partnershipId, pendingRouteState.step);
    setPendingRouteState(null);
  };

  const stepCounts = useMemo(() => {
    if (!selectedPartnership) {
      return { participants: 0, machines: 0, terms: 0 };
    }

    return {
      participants: setup.parties.filter((party) => party.partnership_id === selectedPartnership.id).length,
      machines: setup.assignments.filter((assignment) => assignment.partnership_id === selectedPartnership.id).length,
      terms: setup.financialRules.filter((rule) => rule.partnership_id === selectedPartnership.id).length,
    };
  }, [selectedPartnership, setup.assignments, setup.financialRules, setup.parties]);

  const setActiveTab = (tab: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', tab);

    if (tab !== 'machines') {
      nextParams.delete('sunzeMachineId');
      nextParams.delete('sunzeMachineName');
    }

    setSearchParams(nextParams, { replace: true });
  };

  const clearInitialSunzeMachineMapping = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', 'machines');
    nextParams.delete('sunzeMachineId');
    nextParams.delete('sunzeMachineName');
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <AppLayout>
      <section className="section-padding">
        <div className="container-page">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Admin
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground">
                Partnerships
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                Set up reporting agreements in a guided flow. Partner records and machine tax
                readiness live in their own admin pages.
              </p>
            </div>
            <Button variant="outline" onClick={refresh} disabled={isFetching}>
              {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Unable to load partnership setup.
            </div>
          )}

          {isLoading ? (
            <div className="mt-6 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              Loading partnership setup...
            </div>
          ) : (
            <div className="mt-6 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="hidden space-y-4 xl:block">
                <PartnershipPicker
                  setup={setup}
                  selectedPartnershipId={selectedPartnershipId}
                  onSelect={(partnershipId) => requestRouteState(partnershipId, 'details')}
                />
                <StepRail
                  activeStep={activeStep}
                  selectedPartnership={selectedPartnership}
                  stepCounts={stepCounts}
                  onStepChange={(step) => requestRouteState(selectedPartnershipId, step)}
                />
                <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                  <div className="font-medium text-foreground">Related setup</div>
                  <div className="mt-3 grid gap-2">
                    <Button asChild variant="outline" size="sm" className="justify-start">
                      <Link to="/admin/partner-records">Open Partner Records</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm" className="justify-start">
                      <Link to="/admin/machines">Open Machines</Link>
                    </Button>
                  </div>
                </div>
              </aside>

              <MobileSetupControls
                setup={setup}
                activeStep={activeStep}
                selectedPartnership={selectedPartnership}
                selectedPartnershipId={selectedPartnershipId}
                stepCounts={stepCounts}
                onSelectPartnership={(partnershipId) => requestRouteState(partnershipId, 'details')}
                onStepChange={(step) => requestRouteState(selectedPartnershipId, step)}
              />

              <main className="min-w-0">
                <StepHeader
                  activeStep={activeStep}
                  selectedPartnership={selectedPartnership}
                  onNew={() => requestRouteState('', 'details')}
                />
                <div className="mt-4">
                  {activeStep === 'details' && (
                    <PartnershipDetailsSection
                      selectedPartnership={selectedPartnership}
                      onSaved={(partnershipId) => updateRouteState(partnershipId, 'participants')}
                      onRefresh={refresh}
                    />
                  )}
                  {activeStep === 'participants' && selectedPartnership && (
                    <ParticipantsSection
                      setup={setup}
                      selectedPartnership={selectedPartnership}
                      onRefresh={refresh}
                    />
                  )}
                  {activeStep === 'machines' && selectedPartnership && (
                    <MachineAssignmentsSection
                      setup={setup}
                      selectedPartnership={selectedPartnership}
                      onRefresh={refresh}
                      onDirtyChange={(isDirty) => markStepDirty('machines', isDirty)}
                    />
                  )}
                  {activeStep === 'terms' && selectedPartnership && (
                    <FinancialTermsSection
                      setup={setup}
                      selectedPartnership={selectedPartnership}
                      onRefresh={refresh}
                      onDirtyChange={(isDirty) => markStepDirty('terms', isDirty)}
                    />
                  )}
                  {activeStep === 'preview' && selectedPartnership && (
                    <WeeklyPreviewSection setup={setup} selectedPartnership={selectedPartnership} />
                  )}
                  {activeStep !== 'details' && !selectedPartnership && (
                    <EmptyState text="Create or select a partnership before continuing the setup flow." />
                  )}
                </div>
                <MobileStepFooter
                  activeStep={activeStep}
                  selectedPartnership={selectedPartnership}
                  onStepChange={(step) => requestRouteState(selectedPartnershipId, step)}
                />
              </main>
            </div>
          )}
        </div>
      </section>
      <AlertDialog
        open={Boolean(pendingRouteState)}
        onOpenChange={(open) => {
          if (!open) setPendingRouteState(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              The {steps[getStepIndex(activeStep)].label} step has unsaved changes. Save this step
              before moving on, or leave and discard the current edits.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay here</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPendingRouteState}>
              Leave without saving
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

function PartnershipPicker({
  setup,
  selectedPartnershipId,
  onSelect,
}: {
  setup: PartnershipReportingSetup;
  selectedPartnershipId: string;
  onSelect: (partnershipId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground">Partnerships</h2>
          <p className="mt-1 text-xs text-muted-foreground">Choose the agreement to configure.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => onSelect('')}>
          New
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        {setup.partnerships.length === 0 ? (
          <EmptyState text="No partnerships yet." />
        ) : (
          setup.partnerships.map((partnership) => {
            const isSelected = selectedPartnershipId === partnership.id;

            return (
              <button
                key={partnership.id}
                type="button"
                onClick={() => onSelect(partnership.id)}
                className={`w-full rounded-md border px-3 py-3 text-left text-sm transition-colors ${
                  isSelected
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-background text-foreground hover:bg-muted/40'
                }`}
              >
                <div className="font-medium">{partnership.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatLabel(partnership.partnership_type)}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function MobileSetupControls({
  setup,
  activeStep,
  selectedPartnership,
  selectedPartnershipId,
  stepCounts,
  onSelectPartnership,
  onStepChange,
}: {
  setup: PartnershipReportingSetup;
  activeStep: PartnershipStep;
  selectedPartnership: ReportingPartnership | null;
  selectedPartnershipId: string;
  stepCounts: { participants: number; machines: number; terms: number };
  onSelectPartnership: (partnershipId: string) => void;
  onStepChange: (step: PartnershipStep) => void;
}) {
  const countByStep: Partial<Record<PartnershipStep, number>> = {
    participants: stepCounts.participants,
    machines: stepCounts.machines,
    terms: stepCounts.terms,
  };

  return (
    <div className="space-y-3 xl:hidden">
      <div className="rounded-lg border border-border bg-card p-4">
        <Label htmlFor="mobile-partnership-picker">Partnership</Label>
        <select
          id="mobile-partnership-picker"
          value={selectedPartnershipId}
          onChange={(event) => onSelectPartnership(event.target.value)}
          className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">New partnership</option>
          {setup.partnerships.map((partnership) => (
            <option key={partnership.id} value={partnership.id}>
              {partnership.name}
            </option>
          ))}
        </select>
      </div>

      <nav className="rounded-lg border border-border bg-card p-4" aria-label="Partnership setup steps">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Step {getStepIndex(activeStep) + 1} of {steps.length}: {steps[getStepIndex(activeStep)].label}
        </div>
        <div className="mt-2 overflow-x-auto pb-1">
          <div className="flex min-w-max gap-2">
            {steps.map((step) => {
              const isActive = step.key === activeStep;
              const isDisabled = !selectedPartnership && step.key !== 'details';
              const count = countByStep[step.key];

              return (
                <button
                  key={step.key}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => onStepChange(step.key)}
                  aria-current={isActive ? 'step' : undefined}
                  aria-label={`Step ${getStepIndex(step.key) + 1}: ${step.label}`}
                  className={`min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground'
                  } ${isDisabled ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  {step.label}
                  {typeof count === 'number' && <span className="ml-2 opacity-80">{count}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </nav>
    </div>
  );
}

function StepRail({
  activeStep,
  selectedPartnership,
  stepCounts,
  onStepChange,
}: {
  activeStep: PartnershipStep;
  selectedPartnership: ReportingPartnership | null;
  stepCounts: { participants: number; machines: number; terms: number };
  onStepChange: (step: PartnershipStep) => void;
}) {
  const countByStep: Partial<Record<PartnershipStep, number>> = {
    participants: stepCounts.participants,
    machines: stepCounts.machines,
    terms: stepCounts.terms,
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold text-foreground">Setup flow</h2>
      <div className="mt-4 space-y-2">
        {steps.map((step, index) => {
          const isActive = activeStep === step.key;
          const isDisabled = !selectedPartnership && step.key !== 'details';
          const count = countByStep[step.key];

          return (
            <button
              key={step.key}
              type="button"
              disabled={isDisabled}
              onClick={() => onStepChange(step.key)}
              aria-current={isActive ? 'step' : undefined}
              className={`flex w-full items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors ${
                isActive
                  ? 'border-primary/40 bg-primary/10'
                  : 'border-border bg-background hover:bg-muted/40'
              } ${isDisabled ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {step.label}
                  {typeof count === 'number' && <Badge variant="outline">{count}</Badge>}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{step.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MobileStepFooter({
  activeStep,
  selectedPartnership,
  onStepChange,
}: {
  activeStep: PartnershipStep;
  selectedPartnership: ReportingPartnership | null;
  onStepChange: (step: PartnershipStep) => void;
}) {
  const currentIndex = getStepIndex(activeStep);
  const previousStep = getAdjacentStep(activeStep, -1);
  const nextStep = getAdjacentStep(activeStep, 1);
  const canMoveBack = currentIndex > 0;
  const canMoveNext = currentIndex < steps.length - 1 && Boolean(selectedPartnership);

  return (
    <div className="sticky bottom-0 z-20 mt-6 border-t border-border bg-background/95 px-1 py-3 backdrop-blur xl:hidden">
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1"
          disabled={!canMoveBack}
          onClick={() => onStepChange(previousStep)}
        >
          <ChevronLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button
          type="button"
          className="h-11 flex-1"
          disabled={!canMoveNext}
          onClick={() => onStepChange(nextStep)}
        >
          Next
          <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function StepHeader({
  activeStep,
  selectedPartnership,
  onNew,
}: {
  activeStep: PartnershipStep;
  selectedPartnership: ReportingPartnership | null;
  onNew: () => void;
}) {
  const step = steps.find((candidate) => candidate.key === activeStep) ?? steps[0];
  const stepNumber = getStepIndex(activeStep) + 1;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Step {stepNumber} of {steps.length} / {selectedPartnership ? selectedPartnership.name : 'New partnership'}
          </div>
          <h2 className="mt-2 font-display text-2xl font-bold text-foreground">{step.label}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
        </div>
        {selectedPartnership && (
          <Button variant="outline" size="sm" onClick={onNew}>
            <Plus className="mr-2 h-4 w-4" />
            New Partnership
          </Button>
        )}
      </div>
    </div>
  );
}

function PartnershipDetailsSection({
  selectedPartnership,
  onSaved,
  onRefresh,
}: {
  selectedPartnership: ReportingPartnership | null;
  onSaved: (partnershipId: string) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const [form, setForm] = useState(emptyPartnershipForm);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!selectedPartnership) {
      setForm(emptyPartnershipForm);
      return;
    }

    setForm({
      partnershipId: selectedPartnership.id,
      name: selectedPartnership.name,
      partnershipType: selectedPartnership.partnership_type,
      reportingWeekEndDay: String(selectedPartnership.reporting_week_end_day),
      timezone: selectedPartnership.timezone,
      effectiveStartDate: selectedPartnership.effective_start_date,
      effectiveEndDate: selectedPartnership.effective_end_date ?? '',
      status: selectedPartnership.status === 'archived' ? 'archived' : 'active',
      notes: selectedPartnership.notes ?? '',
    });
  }, [selectedPartnership]);

  const savePartnership = async () => {
    if (!form.name.trim() || !form.effectiveStartDate) {
      toast.error('Partnership name and effective start date are required.');
      return;
    }

    setIsSaving(true);
    try {
      const savedPartnership = await upsertReportingPartnershipAdmin({
        ...form,
        reportingWeekEndDay: Number(form.reportingWeekEndDay),
        reason: form.partnershipId ? 'Partnership details updated' : 'Partnership created',
      });
      toast.success(form.partnershipId ? 'Partnership updated.' : 'Partnership created.');
      await onRefresh();
      onSaved(savedPartnership.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save partnership.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Label htmlFor="partnership-name">Partnership name</Label>
          <Input
            id="partnership-name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Bubble Planet Seattle"
          />
        </div>
        <div>
          <Label htmlFor="partnership-type">Type</Label>
          <FieldSelect
            id="partnership-type"
            value={form.partnershipType}
            onChange={(value) => setForm({ ...form, partnershipType: value })}
            options={partnershipTypes}
          />
        </div>
        <div>
          <Label htmlFor="partnership-week-end">Reporting week ends</Label>
          <select
            id="partnership-week-end"
            value={form.reportingWeekEndDay}
            onChange={(event) => setForm({ ...form, reportingWeekEndDay: event.target.value })}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {dayNames.map((dayName, index) => (
              <option key={dayName} value={index}>
                {dayName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="partnership-timezone">Timezone</Label>
          <Input
            id="partnership-timezone"
            value={form.timezone}
            onChange={(event) => setForm({ ...form, timezone: event.target.value })}
          />
        </div>
        <DateWindowFields
          startId="partnership-start"
          endId="partnership-end"
          startValue={form.effectiveStartDate}
          endValue={form.effectiveEndDate}
          onStartChange={(value) => setForm({ ...form, effectiveStartDate: value })}
          onEndChange={(value) => setForm({ ...form, effectiveEndDate: value })}
        />
        <div className="rounded-md border border-border bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="partnership-active">Partnership active</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Inactive partnerships stay saved but are removed from normal reporting setup.
              </p>
            </div>
            <Switch
              id="partnership-active"
              checked={form.status !== 'archived'}
              onCheckedChange={(checked) =>
                setForm({ ...form, status: checked ? 'active' : 'archived' })
              }
            />
          </div>
        </div>
        <div className="lg:col-span-2">
          <Label htmlFor="partnership-notes">Notes</Label>
          <Textarea
            id="partnership-notes"
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </div>
      </div>
      <Button className="mt-5" onClick={savePartnership} disabled={isSaving}>
        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
        {form.partnershipId ? 'Save Details' : 'Create Partnership'}
      </Button>
    </section>
  );
}

function ParticipantsSection({
  setup,
  selectedPartnership,
  onRefresh,
}: {
  setup: PartnershipReportingSetup;
  selectedPartnership: ReportingPartnership;
  onRefresh: () => Promise<unknown>;
}) {
  const participants = useMemo(
    () => sortParticipantsByAddedDate(setup.parties.filter((party) => party.partnership_id === selectedPartnership.id)),
    [selectedPartnership.id, setup.parties]
  );
  const defaultParticipantForm = useMemo(
    () => ({
      ...emptyParticipantForm,
      partnershipId: selectedPartnership.id,
      partyRole: getPayoutRecipientParticipants(participants).length >= 2 ? 'other' : payoutRecipientRole,
    }),
    [participants, selectedPartnership.id]
  );
  const [form, setForm] = useState(defaultParticipantForm);
  const [isSaving, setIsSaving] = useState(false);
  const [removingPartyId, setRemovingPartyId] = useState<string | null>(null);
  const [isPartnerDialogOpen, setIsPartnerDialogOpen] = useState(false);

  useEffect(() => {
    setForm(defaultParticipantForm);
  }, [defaultParticipantForm]);

  const editParticipant = (party: ReportingPartnershipParty) => {
    setForm({
      partyId: party.id,
      partnershipId: party.partnership_id,
      partnerId: party.partner_id,
      partyRole: party.party_role,
      sharePercent: party.share_basis_points ? percentFromBasisPoints(party.share_basis_points) : '',
      isReportRecipient: party.is_report_recipient,
    });
  };

  const saveParticipant = async () => {
    if (!form.partnerId) {
      toast.error('Choose a partner record before saving.');
      return;
    }

    setIsSaving(true);
    try {
      await upsertReportingPartnershipPartyAdmin({
        partyId: form.partyId,
        partnershipId: selectedPartnership.id,
        partnerId: form.partnerId,
        partyRole: form.partyRole,
        shareBasisPoints: form.sharePercent.trim() ? basisPointsFromPercent(form.sharePercent) : null,
        isReportRecipient: form.isReportRecipient,
        reason: form.partyId ? 'Partnership participant updated' : 'Partnership participant added',
      });
      toast.success(form.partyId ? 'Participant updated.' : 'Participant added.');
      setForm(defaultParticipantForm);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save participant.');
    } finally {
      setIsSaving(false);
    }
  };

  const removeParticipant = async (party: ReportingPartnershipParty) => {
    setRemovingPartyId(party.id);
    try {
      await removeReportingPartnershipPartyAdmin(party.id, 'Partnership participant removed');
      if (form.partyId === party.id) {
        setForm(defaultParticipantForm);
      }
      toast.success('Participant removed from this partnership.');
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to remove participant.');
    } finally {
      setRemovingPartyId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold text-foreground">
              {form.partyId ? 'Edit Participant' : 'Add Participant'}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Participants are the organizations connected to this partnership. Partner record
              management lives separately, and payout percentages are configured later in Payout
              Rules.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/partner-records">Manage Partner Records</Link>
          </Button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <PartnerSelectWithAdd
            setup={setup}
            value={form.partnerId}
            onChange={(partnerId) => setForm({ ...form, partnerId })}
            onAddNew={() => setIsPartnerDialogOpen(true)}
          />
          <div>
            <Label htmlFor="participant-role">Role</Label>
            <FieldSelect
              id="participant-role"
              value={form.partyRole}
              onChange={(partyRole) => setForm({ ...form, partyRole })}
              options={participantRoles}
              getOptionLabel={getParticipantRoleLabel}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Choose Receives payout only for organizations that should appear in Payout Rules.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={saveParticipant} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Save Participant
          </Button>
          {form.partyId && (
            <Button
              variant="outline"
              onClick={() => setForm(defaultParticipantForm)}
            >
              New Participant
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <ListHeader title="Participants" count={participants.length} />
        {participants.length === 0 ? (
          <EmptyRow text="No participants added yet." />
        ) : (
          participants.map((party) => (
            <Row key={party.id}>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <div className="font-medium text-foreground">{party.partner_name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {getParticipantRoleLabel(party.party_role)}
                  </div>
                </div>
                {party.party_role === payoutRecipientRole && (
                  <Badge variant="secondary" className="w-fit">Payout recipient</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => editParticipant(party)}>
                  Edit
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-destructive/40 text-destructive hover:border-destructive hover:text-destructive"
                      disabled={removingPartyId === party.id}
                    >
                      {removingPartyId === party.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Remove
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove participant?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes {party.partner_name} from {selectedPartnership.name}. It does not
                        delete the reusable partner record.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => removeParticipant(party)}
                      >
                        Remove Participant
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </Row>
          ))
        )}
      </div>

      <PartnerRecordDialog
        open={isPartnerDialogOpen}
        onOpenChange={setIsPartnerDialogOpen}
        existingPartners={setup.partners}
        onCreated={(partner) => setForm((current) => ({ ...current, partnerId: partner.id }))}
        onRefresh={onRefresh}
      />
    </section>
  );
}

function MachineAssignmentsSection({
  setup,
  selectedPartnership,
  onRefresh,
  onDirtyChange,
}: {
  setup: PartnershipReportingSetup;
  selectedPartnership: ReportingPartnership;
  onRefresh: () => Promise<unknown>;
  onDirtyChange?: (isDirty: boolean) => void;
}) {
  const [selectedMachineIds, setSelectedMachineIds] = useState<Set<string>>(new Set());
  const [machineSearch, setMachineSearch] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isConflictDialogOpen, setIsConflictDialogOpen] = useState(false);

  const currentDate = today();
  const machineAlignmentStartDate = selectedPartnership.effective_start_date || today();

  const activeAssignmentsByMachineId = useMemo(() => {
    const assignmentMap = new Map<string, ReturnType<typeof getActiveMachineAssignments>>();
    setup.machines.forEach((machine) => {
      assignmentMap.set(machine.id, getActiveMachineAssignments(setup, machine.id, currentDate));
    });
    return assignmentMap;
  }, [currentDate, setup]);

  const activeAssignments = useMemo(
    () =>
      setup.machines.flatMap((machine) =>
        (activeAssignmentsByMachineId.get(machine.id) ?? []).filter(
          (assignment) => assignment.partnership_id === selectedPartnership.id
        )
      ),
    [activeAssignmentsByMachineId, selectedPartnership.id, setup.machines]
  );

  const originalMachineIds = useMemo(
    () => new Set(activeAssignments.map((assignment) => assignment.machine_id)),
    [activeAssignments]
  );

  const assignmentWarnings = setup.warnings.filter(
    (warning) =>
      warning.machineId &&
      originalMachineIds.has(warning.machineId) &&
      warning.warningType === 'overlapping_partnership_assignments'
  );

  useEffect(() => {
    setSelectedMachineIds(new Set(originalMachineIds));
  }, [originalMachineIds, selectedPartnership.id]);

  const filteredMachines = useMemo(() => {
    const normalizedSearch = machineSearch.trim().toLowerCase();
    if (!normalizedSearch) return setup.machines;

    return setup.machines.filter((machine) =>
      [
        machine.machine_label,
        machine.account_name,
        machine.location_name,
        machine.sunze_machine_id ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [machineSearch, setup.machines]);

  const addedMachineIds = [...selectedMachineIds].filter((machineId) => !originalMachineIds.has(machineId));
  const removedMachineIds = [...originalMachineIds].filter((machineId) => !selectedMachineIds.has(machineId));
  const assignmentsToSync = activeAssignments.filter(
    (assignment) =>
      !removedMachineIds.includes(assignment.machine_id) &&
      (assignment.effective_start_date !== machineAlignmentStartDate || assignment.effective_end_date)
  );
  const hasChanges =
    addedMachineIds.length > 0 || removedMachineIds.length > 0 || assignmentsToSync.length > 0;
  const conflictingAddedMachines = addedMachineIds
    .map((machineId) => {
      const machine = setup.machines.find((candidate) => candidate.id === machineId);
      const otherAssignments = (activeAssignmentsByMachineId.get(machineId) ?? []).filter(
        (assignment) => assignment.partnership_id !== selectedPartnership.id
      );
      return machine && otherAssignments.length > 0 ? { machine, otherAssignments } : null;
    })
    .filter(Boolean) as Array<{
      machine: PartnershipReportingSetup['machines'][number];
      otherAssignments: ReturnType<typeof getActiveMachineAssignments>;
    }>;

  useEffect(() => {
    onDirtyChange?.(hasChanges);
  }, [hasChanges, onDirtyChange]);

  const toggleMachine = (machineId: string, checked: boolean) => {
    setSelectedMachineIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(machineId);
      } else {
        next.delete(machineId);
      }
      return next;
    });
  };

  const toggleVisibleMachines = (checked: boolean) => {
    setSelectedMachineIds((current) => {
      const next = new Set(current);
      filteredMachines.forEach((machine) => {
        if (checked) {
          next.add(machine.id);
        } else {
          next.delete(machine.id);
        }
      });
      return next;
    });
  };

  const saveMachineAlignment = async () => {
    if (!hasChanges) {
      toast.info('No machine assignment changes to save.');
      return;
    }

    setIsSaving(true);
    try {
      for (const machineId of addedMachineIds) {
        await upsertReportingMachineAssignmentAdmin({
          assignmentId: null,
          machineId,
          partnershipId: selectedPartnership.id,
          assignmentRole: 'primary_reporting',
          effectiveStartDate: machineAlignmentStartDate,
          effectiveEndDate: '',
          status: 'active',
          notes: null,
          reason: 'Partnership machine alignment updated',
        });
      }

      const assignmentsToArchive = activeAssignments.filter((assignment) =>
        removedMachineIds.includes(assignment.machine_id)
      );

      for (const assignment of assignmentsToSync) {
        await upsertReportingMachineAssignmentAdmin({
          assignmentId: assignment.id,
          machineId: assignment.machine_id,
          partnershipId: selectedPartnership.id,
          assignmentRole: assignment.assignment_role,
          effectiveStartDate: machineAlignmentStartDate,
          effectiveEndDate: '',
          status: 'active',
          notes: assignment.notes ?? null,
          reason: 'Partnership machine alignment updated',
        });
      }

      for (const assignment of assignmentsToArchive) {
        await upsertReportingMachineAssignmentAdmin({
          assignmentId: assignment.id,
          machineId: assignment.machine_id,
          partnershipId: selectedPartnership.id,
          assignmentRole: assignment.assignment_role,
          effectiveStartDate: assignment.effective_start_date,
          effectiveEndDate: getSafeArchiveEndDate(assignment.effective_start_date),
          status: 'archived',
          notes: assignment.notes ?? null,
          reason: 'Partnership machine alignment updated',
        });
      }

      toast.success('Machine alignment saved.');
      onDirtyChange?.(false);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save machine alignment.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveMachineAlignment = () => {
    if (conflictingAddedMachines.length > 0) {
      setIsConflictDialogOpen(true);
      return;
    }
    void saveMachineAlignment();
  };

  return (
    <section className="space-y-4">
      {assignmentWarnings.length > 0 && <WarningList warnings={assignmentWarnings} />}
      {conflictingAddedMachines.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5" />
            <div>
              <div className="font-semibold">Review assignment conflicts before saving</div>
              <div className="mt-1">
                {conflictingAddedMachines.length} selected machine
                {conflictingAddedMachines.length === 1 ? ' is' : 's are'} already assigned to another
                active partnership.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold text-foreground">Assign Machines</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Select every machine that belongs to this partnership, then save once. Dates, status,
              and assignment role use the normal V1 defaults in the background.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/machines">Open Machines</Link>
          </Button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-end">
          <div>
            <Label htmlFor="machine-assignment-search">Find machines</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="machine-assignment-search"
                value={machineSearch}
                onChange={(event) => setMachineSearch(event.target.value)}
                className="pl-9"
                placeholder="Machine, account, location, Sunze ID"
              />
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => toggleVisibleMachines(true)}>
            Select visible
          </Button>
          <Button type="button" variant="outline" onClick={() => toggleVisibleMachines(false)}>
            Clear visible
          </Button>
        </div>

        <div className="mt-4 rounded-lg border border-border">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3 text-sm">
            <div>
              <span className="font-medium text-foreground">{selectedMachineIds.size}</span>{' '}
              <span className="text-muted-foreground">selected</span>
            </div>
            {hasChanges && (
              <Badge variant="secondary">
                +{addedMachineIds.length} / -{removedMachineIds.length}
                {assignmentsToSync.length > 0 ? ` / ${assignmentsToSync.length} date sync` : ''}
              </Badge>
            )}
          </div>
          <div className="max-h-[520px] divide-y divide-border overflow-y-auto">
            {filteredMachines.length === 0 ? (
              <EmptyRow text="No machines match this search." />
            ) : (
              filteredMachines.map((machine) => {
                const checked = selectedMachineIds.has(machine.id);
                const machineAssignments = activeAssignmentsByMachineId.get(machine.id) ?? [];
                const otherAssignments = machineAssignments.filter(
                  (assignment) => assignment.partnership_id !== selectedPartnership.id
                );
                const currentAssignment = machineAssignments.find(
                  (assignment) => assignment.partnership_id === selectedPartnership.id
                );

                return (
                  <label
                    key={machine.id}
                    className="flex cursor-pointer items-start gap-3 px-4 py-4 transition-colors hover:bg-muted/30"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => toggleMachine(machine.id, Boolean(value))}
                      className="mt-1"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-foreground">{machine.machine_label}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {machine.account_name} / {machine.location_name} / Sunze:{' '}
                        {machine.sunze_machine_id ?? 'n/a'}
                      </span>
                      {otherAssignments.length > 0 && (
                        <span className="mt-2 flex flex-wrap gap-1">
                          {otherAssignments.map((assignment) => (
                            <Badge key={assignment.id} variant="outline">
                              Already assigned: {assignment.partnership_name}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </span>
                    {currentAssignment ? (
                      <Badge variant="secondary">This partnership</Badge>
                    ) : checked ? (
                      <Badge variant={otherAssignments.length > 0 ? 'destructive' : 'secondary'}>
                        Selected
                      </Badge>
                    ) : null}
                  </label>
                );
              })
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={handleSaveMachineAlignment} disabled={isSaving || !hasChanges}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Save Machine Alignment
          </Button>
          <div className="text-sm text-muted-foreground">
            Assignments use the partnership start date: {formatDate(machineAlignmentStartDate)}.
          </div>
        </div>
      </div>
      <AlertDialog open={isConflictDialogOpen} onOpenChange={setIsConflictDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save machines with active assignment conflicts?</AlertDialogTitle>
            <AlertDialogDescription>
              These machines are already assigned to another active partnership. Saving will add this
              partnership too, which may create overlapping reporting until the other assignment is
              removed or archived.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-muted/20 p-3 text-sm">
            {conflictingAddedMachines.map(({ machine, otherAssignments }) => (
              <div key={machine.id} className="py-1">
                <span className="font-medium text-foreground">{machine.machine_label}</span>{' '}
                <span className="text-muted-foreground">
                  is assigned to {otherAssignments.map((assignment) => assignment.partnership_name).join(', ')}
                </span>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Review selection</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setIsConflictDialogOpen(false);
                void saveMachineAlignment();
              }}
            >
              Save anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function FinancialTermsSection({
  setup,
  selectedPartnership,
  onRefresh,
  onDirtyChange,
}: {
  setup: PartnershipReportingSetup;
  selectedPartnership: ReportingPartnership;
  onRefresh: () => Promise<unknown>;
  onDirtyChange?: (isDirty: boolean) => void;
}) {
  const participants = useMemo(
    () => sortParticipantsByAddedDate(setup.parties.filter((party) => party.partnership_id === selectedPartnership.id)),
    [selectedPartnership.id, setup.parties]
  );

  const payoutRecipientParticipants = useMemo(
    () => getPayoutRecipientParticipants(participants),
    [participants]
  );
  const payoutParticipants = payoutRecipientParticipants.slice(0, 2);
  const additionalPayoutParticipants = payoutRecipientParticipants.slice(2);

  const financialRules = useMemo(
    () =>
      sortFinancialRulesForSetup(
        setup.financialRules.filter((rule) => rule.partnership_id === selectedPartnership.id)
      ),
    [selectedPartnership.id, setup.financialRules]
  );
  const currentFinancialRule = financialRules[0] ?? null;
  const hiddenRuleStartDate = selectedPartnership.effective_start_date || today();
  const defaultRuleForm = useMemo(
    () =>
      currentFinancialRule
        ? createRuleFormFromRule(currentFinancialRule)
        : createRuleForm(selectedPartnership.id, payoutParticipants.length, hiddenRuleStartDate),
    [currentFinancialRule, hiddenRuleStartDate, payoutParticipants.length, selectedPartnership.id]
  );
  const [form, setForm] = useState(() => defaultRuleForm);
  const [isSaving, setIsSaving] = useState(false);
  const payoutPreset = getPayoutModelPreset(form);
  const allocationTotal = getPayoutAllocationTotal(form, payoutParticipants.length);
  const isRuleFormDirty = JSON.stringify(form) !== JSON.stringify(defaultRuleForm);
  const saveDisabledReason = additionalPayoutParticipants.length > 0
      ? 'V1 supports two payout recipients plus Bloomjoy. Change extra payout recipients to another participant role before saving.'
      : allocationTotal !== 100
        ? 'Payout allocation must total exactly 100%.'
        : '';

  const financialWarnings = setup.warnings.filter(
    (warning) =>
      warning.warningType === 'missing_financial_rule' &&
      warning.partnershipId === selectedPartnership.id
  );

  useEffect(() => {
    setForm(defaultRuleForm);
  }, [defaultRuleForm]);

  useEffect(() => {
    onDirtyChange?.(isRuleFormDirty);
  }, [isRuleFormDirty, onDirtyChange]);

  const editRule = (rule: ReportingPartnershipFinancialRule) => {
    setForm(createRuleFormFromRule(rule));
  };

  const updatePayoutPreset = (preset: PayoutModelPreset) => {
    setForm((current) => applyPayoutModelPreset(current, preset));
  };

  const updatePerStickFee = (feeAmountDollars: string) => {
    setForm((current) => ({
      ...current,
      feeAmountDollars,
      feeBasis: Number(feeAmountDollars) > 0 ? 'per_stick' : 'none',
    }));
  };

  const updateSharePercent = (field: PayoutShareField, value: string) => {
    setForm((current) => ({
      ...current,
      [field]: sanitizeWholePercentInput(value),
    }));
  };

  const saveRule = async () => {
    if (saveDisabledReason) {
      toast.error(saveDisabledReason);
      return;
    }

    const normalizedShares = getNormalizedPayoutShares(form, payoutParticipants.length);

    setIsSaving(true);
    try {
      const savedRule = await upsertReportingFinancialRuleAdmin({
        ...form,
        ruleId: form.ruleId ?? currentFinancialRule?.id ?? null,
        partnershipId: selectedPartnership.id,
        feeAmountCents: centsFromDollars(form.feeAmountDollars),
        costAmountCents: centsFromDollars(form.costAmountDollars),
        feverShareBasisPoints: basisPointsFromPercent(normalizedShares.primarySharePercent),
        partnerShareBasisPoints: basisPointsFromPercent(normalizedShares.partnerSharePercent),
        bloomjoyShareBasisPoints: basisPointsFromPercent(normalizedShares.bloomjoySharePercent),
        effectiveStartDate: hiddenRuleStartDate,
        effectiveEndDate: '',
        status: 'active',
        reason: form.ruleId || currentFinancialRule ? 'Payout rules updated' : 'Payout rules created',
      });
      toast.success(form.ruleId || currentFinancialRule ? 'Payout rules updated.' : 'Payout rules created.');
      setForm(createRuleFormFromRule(savedRule));
      onDirtyChange?.(false);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save payout rules.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      {financialWarnings.length > 0 && <WarningList warnings={financialWarnings} />}

      <div className="rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="font-semibold text-foreground">
            {form.ruleId ? 'Edit Payout Rules' : 'Create Payout Rules'}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Define how weekly sales become payout amounts. Participant records only define who is
            involved. Only participants marked Receives payout appear in the allocation below.
          </p>
        </div>

        <PayoutFlowSummary form={form} payoutParticipants={payoutParticipants} />

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div>
            <FieldLabel
              htmlFor="payout-model-preset"
              label="Payout model"
              help="Choose how weekly sales are converted into the amount that gets split."
            />
            <select
              id="payout-model-preset"
              value={payoutPreset}
              onChange={(event) => updatePayoutPreset(event.target.value as PayoutModelPreset)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {payoutModelPresets.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              {payoutModelPresets.find((preset) => preset.value === payoutPreset)?.description}
            </p>
          </div>
          <div>
            <FieldLabel
              htmlFor="fee-amount"
              label="Per-stick fee"
              help="The standard Bubble Planet-style fee is $0.40 per stick/item, deducted before the split. Set to 0 when the agreement has no stick-level fee."
            />
            <Input
              id="fee-amount"
              type="number"
              step="0.01"
              value={form.feeAmountDollars}
              onChange={(event) => updatePerStickFee(event.target.value)}
            />
          </div>
        </div>

        <PayoutAllocationSection
          form={form}
          payoutParticipants={payoutParticipants}
          additionalPayoutParticipants={additionalPayoutParticipants}
          allocationTotal={allocationTotal}
          onShareChange={updateSharePercent}
        />

        <details className="mt-4 rounded-md border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Notes and reporting details
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">
            The current payout rule is active by default and follows the partnership effective
            start date. Backend timing fields remain available for reporting history without adding
            normal setup friction.
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <div className="text-xs font-medium uppercase text-muted-foreground">Applies from</div>
              <div className="mt-1 text-sm text-foreground">{formatDate(hiddenRuleStartDate)}</div>
            </div>
            <div>
              <Label htmlFor="rule-notes">Notes</Label>
              <Input
                id="rule-notes"
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                placeholder="Optional"
              />
            </div>
            <div className="lg:col-span-2 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Reporting calculation:</span>{' '}
              {formatLabel(form.calculationModel)} / {formatLabel(form.splitBase)} /{' '}
              {formatLabel(form.feeBasis)} / {formatLabel(form.grossToNetMethod)}
            </div>
          </div>
        </details>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={saveRule} disabled={isSaving || Boolean(saveDisabledReason)}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Save Payout Rules
          </Button>
          {saveDisabledReason && (
            <div className="basis-full text-sm text-destructive">{saveDisabledReason}</div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <ListHeader title="Current Payout Rule" count={currentFinancialRule ? 1 : 0} />
        {!currentFinancialRule ? (
          <EmptyRow text="No payout rules configured." />
        ) : (
          <Row>
            <div>
              <div className="font-medium text-foreground">
                {formatLabel(currentFinancialRule.calculation_model)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Fee {formatMoney(currentFinancialRule.fee_amount_cents)}{' '}
                {formatLabel(currentFinancialRule.fee_basis)} /{' '}
                {formatRuleAllocationSummary(currentFinancialRule, payoutParticipants)}
              </div>
              {financialRules.length > 1 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {financialRules.length - 1} older rule{financialRules.length === 2 ? '' : 's'} hidden from setup.
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={currentFinancialRule.status === 'active' ? 'default' : 'outline'}>
                {currentFinancialRule.status === 'active'
                  ? 'Active'
                  : formatLabel(currentFinancialRule.status)}
              </Badge>
              <Button variant="outline" size="sm" onClick={() => editRule(currentFinancialRule)}>
                Edit
              </Button>
            </div>
          </Row>
        )}
      </div>
    </section>
  );
}

function PayoutAllocationSection({
  form,
  payoutParticipants,
  additionalPayoutParticipants,
  allocationTotal,
  onShareChange,
}: {
  form: typeof emptyRuleForm;
  payoutParticipants: ReportingPartnershipParty[];
  additionalPayoutParticipants: ReportingPartnershipParty[];
  allocationTotal: number;
  onShareChange: (field: PayoutShareField, value: string) => void;
}) {
  const allocationRows = [
    ...payoutParticipants.map((participant, index) => ({
      id: participant.id,
      name: participant.partner_name,
      description: getParticipantRoleLabel(participant.party_role),
      field: shareFieldsByParticipantIndex[index],
    })),
    {
      id: 'bloomjoy',
      name: 'Bloomjoy',
      description: 'Retained share',
      field: 'bloomjoySharePercent' as PayoutShareField,
    },
  ];
  const isBalanced = allocationTotal === 100;

  return (
    <div className="mt-5 rounded-lg border border-border bg-muted/10 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground">Payout Allocation</h3>
            <HelpTooltip label="Payout allocation">
              Split the payout base across this partnership's payout participants and Bloomjoy.
              Shares must total 100% before the rule can be saved.
            </HelpTooltip>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Assign whole-number percentages to payout recipients from the Participants step.
          </p>
        </div>
        <Badge variant={isBalanced ? 'default' : 'destructive'}>
          {allocationTotal}% allocated
        </Badge>
      </div>

      {additionalPayoutParticipants.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          This version supports two payout recipients plus Bloomjoy. Change extra payout recipients
          to Venue, Event, Platform, Operator, Internal, or Other before saving:{' '}
          {additionalPayoutParticipants.map((participant) => participant.partner_name).join(', ')}.
        </div>
      )}

      <div className="mt-4 divide-y divide-border rounded-md border border-border bg-background">
        {allocationRows.map((row) => (
          <div
            key={row.id}
            className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-center"
          >
            <div className="min-w-0">
              <div className="font-medium text-foreground">{row.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">{row.description}</div>
            </div>
            <div className="relative">
              <Input
                aria-label={`${row.name} payout share percentage`}
                type="number"
                min="0"
                max="100"
                step="1"
                inputMode="numeric"
                value={form[row.field]}
                onChange={(event) => onShareChange(row.field, event.target.value)}
                className="h-11 pr-8 text-right"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                %
              </span>
            </div>
          </div>
        ))}
      </div>

      {!isBalanced && (
        <div className="mt-3 text-sm text-destructive">
          Adjust the allocation to exactly 100% before saving.
        </div>
      )}
    </div>
  );
}

function formatRuleAllocationSummary(
  rule: ReportingPartnershipFinancialRule,
  payoutParticipants: ReportingPartnershipParty[]
) {
  const parts = [];
  if (payoutParticipants[0]) {
    parts.push(
      `${payoutParticipants[0].partner_name} ${percentFromBasisPoints(rule.fever_share_basis_points)}%`
    );
  }
  if (payoutParticipants[1]) {
    parts.push(
      `${payoutParticipants[1].partner_name} ${percentFromBasisPoints(rule.partner_share_basis_points)}%`
    );
  }
  parts.push(`Bloomjoy ${percentFromBasisPoints(rule.bloomjoy_share_basis_points)}%`);
  return parts.join(' / ');
}

function getPreviewPayoutMetrics(
  summary: PartnerWeeklyReportPreview['summary'],
  payoutParticipants: ReportingPartnershipParty[]
) {
  const metrics = [];
  if (payoutParticipants[0] || Number(summary.fever_profit_cents ?? 0) !== 0) {
    metrics.push({
      label: payoutParticipants[0]?.partner_name ?? 'Payout recipient 1',
      value: formatMoney(summary.fever_profit_cents),
    });
  }
  if (payoutParticipants[1] || Number(summary.partner_profit_cents ?? 0) !== 0) {
    metrics.push({
      label: payoutParticipants[1]?.partner_name ?? 'Payout recipient 2',
      value: formatMoney(summary.partner_profit_cents),
    });
  }
  metrics.push({
    label: 'Bloomjoy',
    value: formatMoney(summary.bloomjoy_profit_cents),
  });
  return metrics;
}

function PayoutFlowSummary({
  form,
  payoutParticipants,
}: {
  form: typeof emptyRuleForm;
  payoutParticipants: ReportingPartnershipParty[];
}) {
  const feeLabel = form.feeBasis === 'per_stick' ? 'per stick' : formatLabel(form.feeBasis);
  const feeSummary =
    Number(form.feeAmountDollars) > 0
      ? `${formatMoney(centsFromDollars(form.feeAmountDollars))} ${feeLabel}`
      : 'no fee';
  const splitSummary = [
    payoutParticipants[0] && `${payoutParticipants[0].partner_name} ${parseWholePercent(form.primarySharePercent)}%`,
    payoutParticipants[1] && `${payoutParticipants[1].partner_name} ${parseWholePercent(form.partnerSharePercent)}%`,
    `Bloomjoy ${parseWholePercent(form.bloomjoySharePercent)}%`,
  ]
    .filter(Boolean)
    .join(' / ');

  return (
    <div className="mt-5 grid gap-2 text-sm sm:grid-cols-4">
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <div className="font-medium text-foreground">Gross sales</div>
        <div className="mt-1 text-xs text-muted-foreground">Weekly paid orders</div>
      </div>
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <div className="font-medium text-foreground">Taxes and fees</div>
        <div className="mt-1 text-xs text-muted-foreground">{feeSummary}</div>
      </div>
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <div className="font-medium text-foreground">Payout base</div>
        <div className="mt-1 text-xs text-muted-foreground">{formatLabel(form.splitBase)}</div>
      </div>
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <div className="font-medium text-foreground">Split</div>
        <div className="mt-1 text-xs text-muted-foreground">{splitSummary}</div>
      </div>
    </div>
  );
}

function FieldLabel({
  htmlFor,
  label,
  help,
}: {
  htmlFor: string;
  label: string;
  help: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      <HelpTooltip label={label}>{help}</HelpTooltip>
    </div>
  );
}

function HelpTooltip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:h-7 sm:w-7"
          aria-label={`Explain ${label}`}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 text-sm leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function WeeklyPreviewSection({
  setup,
  selectedPartnership,
}: {
  setup: PartnershipReportingSetup;
  selectedPartnership: ReportingPartnership;
}) {
  const [weekEndingDate, setWeekEndingDate] = useState(() =>
    getLastCompletedWeekEndingDate(selectedPartnership.reporting_week_end_day)
  );
  const [preview, setPreview] = useState<PartnerWeeklyReportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const weekStartDate = useMemo(() => getWeekStartDate(weekEndingDate), [weekEndingDate]);
  const partnershipAssignments = useMemo(
    () =>
      setup.assignments.filter(
        (assignment) =>
          assignment.partnership_id === selectedPartnership.id &&
          assignment.assignment_role === 'primary_reporting' &&
          assignment.status === 'active'
      ),
    [selectedPartnership.id, setup.assignments]
  );
  const assignedMachineIds = useMemo(
    () => new Set(partnershipAssignments.map((assignment) => assignment.machine_id)),
    [partnershipAssignments]
  );
  const latestAssignedSaleDate = useMemo(
    () =>
      setup.machines
        .filter((machine) => assignedMachineIds.has(machine.id) && machine.latest_sale_date)
        .map((machine) => machine.latest_sale_date as string)
        .sort((left, right) => right.localeCompare(left))[0] ?? '',
    [assignedMachineIds, setup.machines]
  );
  const suggestedWeekEndingDate = useMemo(
    () =>
      latestAssignedSaleDate
        ? getWeekEndingDateForSaleDate(latestAssignedSaleDate, selectedPartnership.reporting_week_end_day)
        : '',
    [latestAssignedSaleDate, selectedPartnership.reporting_week_end_day]
  );
  const payoutParticipants = useMemo(
    () =>
      getPayoutRecipientParticipants(
        setup.parties.filter((party) => party.partnership_id === selectedPartnership.id)
      ).slice(0, 2),
    [selectedPartnership.id, setup.parties]
  );
  const assignmentsCoveringWeek = useMemo(
    () =>
      partnershipAssignments.filter(
        (assignment) =>
          dateWindowOverlaps(
            assignment.effective_start_date,
            assignment.effective_end_date,
            weekStartDate,
            weekEndingDate
          )
      ),
    [partnershipAssignments, weekEndingDate, weekStartDate]
  );
  const assignmentsCoveringFullWeek = useMemo(
    () =>
      assignmentsCoveringWeek.filter(
        (assignment) =>
          assignment.effective_start_date <= weekStartDate &&
          (!assignment.effective_end_date || assignment.effective_end_date >= weekEndingDate)
      ),
    [assignmentsCoveringWeek, weekEndingDate, weekStartDate]
  );
  const activePayoutRulesCoveringWeek = useMemo(
    () =>
      setup.financialRules.filter(
        (rule) =>
          rule.partnership_id === selectedPartnership.id &&
          rule.status === 'active' &&
          dateWindowOverlaps(
            rule.effective_start_date,
            rule.effective_end_date,
            weekStartDate,
            weekEndingDate
          )
      ),
    [selectedPartnership.id, setup.financialRules, weekEndingDate, weekStartDate]
  );
  const activePayoutRulesCoveringFullWeek = useMemo(
    () =>
      activePayoutRulesCoveringWeek.filter(
        (rule) =>
          rule.effective_start_date <= weekStartDate &&
          (!rule.effective_end_date || rule.effective_end_date >= weekEndingDate)
      ),
    [activePayoutRulesCoveringWeek, weekEndingDate, weekStartDate]
  );
  const previewReadinessIssues = useMemo(() => {
    const issues: PreviewReadinessIssue[] = [];
    const partnershipQuery = encodeURIComponent(selectedPartnership.id);

    if (weekEndingDate && assignmentsCoveringWeek.length === 0) {
      issues.push({
        title: 'No machines are assigned for this week',
        message: `Weekly Preview only includes sales from machines assigned to this partnership during ${weekStartDate || 'the selected week'} through ${weekEndingDate}. If machines were just assigned, their start date may be after this preview week.`,
        actionLabel: 'Review Machines step',
        actionHref: `/admin/partnerships?partnershipId=${partnershipQuery}&step=machines`,
      });
    } else if (assignmentsCoveringFullWeek.length < assignmentsCoveringWeek.length) {
      issues.push({
        title: 'Some machines only cover part of this week',
        message:
          'Sales before a machine assignment start date or after an assignment end date are intentionally excluded from the preview.',
        actionLabel: 'Review Machines step',
        actionHref: `/admin/partnerships?partnershipId=${partnershipQuery}&step=machines`,
      });
    }

    if (weekEndingDate && activePayoutRulesCoveringWeek.length === 0) {
      issues.push({
        title: 'No active payout rule covers this week',
        message:
          'The preview can still check sales, but payout amounts will be incomplete until an active Payout Rule covers the selected week.',
        actionLabel: 'Review Payout Rules',
        actionHref: `/admin/partnerships?partnershipId=${partnershipQuery}&step=terms`,
      });
    } else if (activePayoutRulesCoveringFullWeek.length === 0) {
      issues.push({
        title: 'Payout rule only covers part of this week',
        message:
          'Sales outside the active payout-rule date window will show sales totals but may not calculate payout amounts.',
        actionLabel: 'Review Payout Rules',
        actionHref: `/admin/partnerships?partnershipId=${partnershipQuery}&step=terms`,
      });
    }

    return issues;
  }, [
    activePayoutRulesCoveringWeek.length,
    activePayoutRulesCoveringFullWeek.length,
    assignmentsCoveringWeek.length,
    assignmentsCoveringFullWeek.length,
    selectedPartnership.id,
    weekEndingDate,
    weekStartDate,
  ]);

  const useSuggestedWeek = () => {
    if (!suggestedWeekEndingDate) return;
    setWeekEndingDate(suggestedWeekEndingDate);
    setPreview(null);
    setPreviewError(null);
  };

  useEffect(() => {
    setWeekEndingDate(getLastCompletedWeekEndingDate(selectedPartnership.reporting_week_end_day));
    setPreview(null);
    setPreviewError(null);
  }, [selectedPartnership.id, selectedPartnership.reporting_week_end_day]);

  const loadPreview = async () => {
    setPreviewError(null);

    if (!weekEndingDate) {
      setPreviewError('Week ending date is required.');
      toast.error('Week ending date is required.');
      return;
    }

    if (new Date(`${weekEndingDate}T00:00:00`).getDay() !== selectedPartnership.reporting_week_end_day) {
      const message = `Week ending date must be a ${dayNames[selectedPartnership.reporting_week_end_day]}.`;
      setPreviewError(message);
      toast.error(message);
      return;
    }

    setIsLoading(true);
    try {
      const nextPreview = await previewPartnerWeeklyReportAdmin(selectedPartnership.id, weekEndingDate);
      setPreview(nextPreview);
      toast.success('Weekly report preview loaded.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to preview report.';
      setPreviewError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <Label htmlFor="week-ending">Week ending</Label>
            <Input
              id="week-ending"
              type="date"
              value={weekEndingDate}
              onChange={(event) => {
                setWeekEndingDate(event.target.value);
                setPreview(null);
                setPreviewError(null);
              }}
            />
            <div className="mt-1 text-xs text-muted-foreground">
              Week ends {dayNames[selectedPartnership.reporting_week_end_day]}
            </div>
            {latestAssignedSaleDate && suggestedWeekEndingDate !== weekEndingDate && (
              <Button
                type="button"
                variant="link"
                className="mt-1 h-auto p-0 text-xs"
                onClick={useSuggestedWeek}
              >
                Latest assigned-machine sales are {latestAssignedSaleDate}. Preview week ending{' '}
                {suggestedWeekEndingDate}.
              </Button>
            )}
          </div>
          <Button onClick={loadPreview} disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Preview
          </Button>
        </div>
      </div>

      {previewReadinessIssues.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-3">
              <div>
                <div className="font-semibold">Preview setup needs attention</div>
                <div className="mt-1">
                  These checks explain why a preview may return no sales or incomplete payout
                  numbers for the selected week.
                </div>
              </div>
              <div className="space-y-2">
                {previewReadinessIssues.map((issue) => (
                  <div key={issue.title} className="rounded-md border border-amber-200 bg-white/70 p-3">
                    <div className="font-medium">{issue.title}</div>
                    <div className="mt-1">{issue.message}</div>
                    <Button asChild variant="outline" size="sm" className="mt-2 bg-white">
                      <Link to={issue.actionHref}>{issue.actionLabel}</Link>
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {previewError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <div className="font-semibold">Preview could not load</div>
          <div className="mt-1">{previewError}</div>
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-foreground">{selectedPartnership.name} weekly preview</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {preview.weekStartDate} through {preview.weekEndingDate}
                </p>
              </div>
              <Badge
                variant={
                  preview.warnings.length
                    ? 'destructive'
                    : Number(preview.summary.order_count ?? 0) > 0
                      ? 'default'
                      : 'outline'
                }
              >
                {preview.warnings.length
                  ? `${preview.warnings.length} warnings`
                  : Number(preview.summary.order_count ?? 0) > 0
                    ? 'Ready'
                    : 'No sales'}
              </Badge>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Orders" value={String(preview.summary.order_count ?? 0)} />
              <Metric label="Sticks/items" value={String(preview.summary.item_quantity ?? 0)} />
              <Metric label="Gross sales" value={formatMoney(preview.summary.gross_sales_cents)} />
              <Metric label="Machine taxes" value={formatMoney(preview.summary.tax_cents)} />
              <Metric label="Fees" value={formatMoney(preview.summary.fee_cents)} />
              <Metric label="Costs" value={formatMoney(preview.summary.cost_cents)} />
              <Metric label="Net sales" value={formatMoney(preview.summary.net_sales_cents)} />
              <Metric label="Split base" value={formatMoney(preview.summary.split_base_cents)} />
              {getPreviewPayoutMetrics(preview.summary, payoutParticipants).map((metric) => (
                <Metric key={metric.label} label={metric.label} value={metric.value} />
              ))}
            </div>
          </div>

          {preview.warnings.length > 0 && (
            <PreviewWarningList warnings={preview.warnings} partnershipId={selectedPartnership.id} />
          )}

          <div className="rounded-lg border border-border bg-card">
            <ListHeader title="Sales by Machine" count={preview.machines.length} />
            {preview.machines.length === 0 ? (
              <div className="p-5 text-sm">
                <div className="font-medium text-foreground">No sales found for this selected week.</div>
                <div className="mt-1 text-muted-foreground">
                  Preview checked {preview.weekStartDate} through {preview.weekEndingDate}. Sales appear
                  when imported Sunze sales and active machine assignments overlap the selected dates;
                  payout rules control whether payout amounts can be calculated.
                </div>
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <div className="font-medium text-foreground">Machine coverage</div>
                    <div className="mt-1">
                      {assignmentsCoveringWeek.length
                        ? `${assignmentsCoveringWeek.length} assignment${assignmentsCoveringWeek.length === 1 ? '' : 's'} overlap this week.`
                        : 'No active machine assignments overlap this week.'}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <div className="font-medium text-foreground">Payout rule</div>
                    <div className="mt-1">
                      {activePayoutRulesCoveringWeek.length
                        ? 'An active payout rule overlaps this week.'
                        : 'No active payout rule overlaps this week.'}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <div className="font-medium text-foreground">Imported sales</div>
                    <div className="mt-1">
                      {latestAssignedSaleDate
                        ? `Latest assigned-machine sale: ${latestAssignedSaleDate}.`
                        : 'No imported sales found for assigned machines yet.'}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {latestAssignedSaleDate && suggestedWeekEndingDate !== weekEndingDate && (
                    <Button type="button" variant="outline" size="sm" onClick={useSuggestedWeek}>
                      Preview week ending {suggestedWeekEndingDate}
                    </Button>
                  )}
                  <Button asChild variant="outline" size="sm">
                    <Link to="/admin/reporting">Check import status</Link>
                  </Button>
                </div>
              </div>
            ) : (
              preview.machines.map((machine) => (
                <Row key={machine.reporting_machine_id}>
                  <div>
                    <div className="font-medium text-foreground">{machine.machine_label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {machine.order_count} orders / {machine.item_quantity} sticks/items
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="font-medium text-foreground">{formatMoney(machine.gross_sales_cents)}</div>
                    <div className="text-xs text-muted-foreground">Net {formatMoney(machine.net_sales_cents)}</div>
                  </div>
                </Row>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function PartnerRecordDialog({
  open,
  onOpenChange,
  existingPartners,
  onCreated,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingPartners: ReportingPartner[];
  onCreated: (partner: ReportingPartner) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const [form, setForm] = useState(emptyPartnerForm);
  const [isSaving, setIsSaving] = useState(false);

  const savePartner = async () => {
    const name = form.name.trim();
    const primaryContactName = form.primaryContactName.trim();
    const primaryContactEmail = form.primaryContactEmail.trim();
    const notes = form.notes.trim();

    if (!name) {
      toast.error('Partner record name is required.');
      return;
    }

    if (primaryContactEmail && !emailPattern.test(primaryContactEmail)) {
      toast.error('Enter a valid contact email address.');
      return;
    }

    const duplicatePartner = existingPartners.find(
      (partner) => normalizeComparableText(partner.name) === normalizeComparableText(name)
    );
    if (duplicatePartner) {
      toast.error('A partner record with this name already exists. Select it instead of creating a duplicate.');
      return;
    }

    setIsSaving(true);
    try {
      const savedPartner = await upsertReportingPartnerAdmin({
        ...form,
        name,
        primaryContactName: primaryContactName || null,
        primaryContactEmail: primaryContactEmail || null,
        notes: notes || null,
        reason: 'Partner record created from partnership setup',
      });
      toast.success('Partner record created.');
      setForm(emptyPartnerForm);
      onCreated(savedPartner);
      onOpenChange(false);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create partner record.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Partner Record</DialogTitle>
          <DialogDescription>
            Create the minimum reusable record, then continue adding it as a participant.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div>
            <Label htmlFor="modal-partner-name">Name</Label>
            <Input
              id="modal-partner-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="modal-partner-type">Type</Label>
            <FieldSelect
              id="modal-partner-type"
              value={form.partnerType}
              onChange={(partnerType) => setForm({ ...form, partnerType })}
              options={partnerTypes}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="modal-contact-name">Primary contact</Label>
              <Input
                id="modal-contact-name"
                value={form.primaryContactName}
                onChange={(event) => setForm({ ...form, primaryContactName: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="modal-contact-email">Contact email</Label>
              <Input
                id="modal-contact-email"
                type="email"
                value={form.primaryContactEmail}
                onChange={(event) => setForm({ ...form, primaryContactEmail: event.target.value })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="modal-partner-notes">Notes</Label>
            <Textarea
              id="modal-partner-notes"
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={savePartner} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create and Use
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldSelect({
  id,
  value,
  onChange,
  options,
  getOptionLabel = formatLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  getOptionLabel?: (value: string) => string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {getOptionLabel(option)}
        </option>
      ))}
    </select>
  );
}

function PartnerSelectWithAdd({
  setup,
  value,
  onChange,
  onAddNew,
}: {
  setup: PartnershipReportingSetup;
  value: string;
  onChange: (partnerId: string) => void;
  onAddNew: () => void;
}) {
  return (
    <div>
      <Label htmlFor="participant-partner">Partner record</Label>
      <select
        id="participant-partner"
        value={value}
        onChange={(event) => {
          if (event.target.value === '__add_new__') {
            onAddNew();
            return;
          }
          onChange(event.target.value);
        }}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Select partner record</option>
        <option value="__add_new__">+ Add new partner record</option>
        {setup.partners.map((partner) => (
          <option key={partner.id} value={partner.id}>
            {partner.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function DateWindowFields({
  startId,
  endId,
  startValue,
  endValue,
  onStartChange,
  onEndChange,
}: {
  startId: string;
  endId: string;
  startValue: string;
  endValue: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
}) {
  return (
    <>
      <div>
        <Label htmlFor={startId}>Effective start</Label>
        <Input
          id={startId}
          type="date"
          value={startValue}
          onChange={(event) => onStartChange(event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor={endId}>Effective end</Label>
        <Input
          id={endId}
          type="date"
          value={endValue}
          onChange={(event) => onEndChange(event.target.value)}
        />
      </div>
    </>
  );
}

function WarningList({ warnings }: { warnings: PartnershipReportingSetup['warnings'] }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5" />
        <div>
          <h2 className="font-semibold">Needs attention</h2>
          <div className="mt-2 grid gap-1 text-sm">
            {warnings.map((warning, index) => (
              <div key={`${warning.warningType}-${index}`}>{warning.message}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewWarningList({
  warnings,
  partnershipId,
}: {
  warnings: PartnershipReportingSetup['warnings'];
  partnershipId: string;
}) {
  const getFixLink = (warning: PartnershipReportingSetup['warnings'][number]) => {
    if (warning.warningType === 'missing_machine_tax_rate') {
      const machineQuery = warning.machineId ? `&machineId=${encodeURIComponent(warning.machineId)}` : '';
      return `/admin/machines?tax=missing${machineQuery}`;
    }
    if (warning.warningType === 'missing_financial_rule') {
      return `/admin/partnerships?partnershipId=${encodeURIComponent(partnershipId)}&step=terms`;
    }
    if (
      warning.warningType === 'missing_partnership_assignment' ||
      warning.warningType === 'overlapping_partnership_assignments'
    ) {
      return `/admin/partnerships?partnershipId=${encodeURIComponent(partnershipId)}&step=machines`;
    }
    return '';
  };

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <div className="font-semibold">Preview warnings</div>
      <div className="mt-2 grid gap-2">
        {warnings.map((warning, index) => {
          const link = getFixLink(warning);
          return (
            <div key={`${warning.warningType}-${index}`} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span>{warning.message}</span>
              {link && (
                <Button asChild variant="outline" size="sm">
                  <Link to={link}>Fix</Link>
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border p-4">
      <h2 className="font-semibold text-foreground">{title}</h2>
      <Badge variant="outline">{count}</Badge>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">{text}</div>;
}

function EmptyRow({ text }: { text: string }) {
  return <div className="p-4 text-sm text-muted-foreground">{text}</div>;
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/70 p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}
