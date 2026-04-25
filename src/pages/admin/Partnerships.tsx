import { useMemo, useState } from 'react';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
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
  calculationModels,
  centsFromDollars,
  costBases,
  dayNames,
  deductionTimings,
  dollarsFromCents,
  feeBases,
  formatDate,
  formatLabel,
  formatMoney,
  getLastCompletedWeekEndingDate,
  grossToNetMethods,
  participantRoles,
  partnerTypes,
  partnershipStatuses,
  partnershipTypes,
  percentFromBasisPoints,
  splitBases,
  today,
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
  { key: 'details', label: 'Details', description: 'Name, status, cadence' },
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
  status: 'draft',
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
  feeBasis: 'per_order',
  costAmountDollars: '0.00',
  costBasis: 'none',
  deductionTiming: 'before_split',
  grossToNetMethod: 'machine_tax_plus_configured_fees',
  primarySharePercent: '60',
  partnerSharePercent: '40',
  bloomjoySharePercent: '0',
  effectiveStartDate: today(),
  effectiveEndDate: '',
  status: 'draft',
  notes: '',
};

const payoutModelPresets = [
  {
    value: 'net_after_tax_fee',
    label: 'Net sales split',
    description: 'Taxes and the paid-order fee are deducted before splitting payout.',
  },
  {
    value: 'gross_sales_split',
    label: 'Gross sales split',
    description: 'Payout share is calculated from gross sales before deductions.',
  },
  {
    value: 'fixed_fee_plus_split',
    label: 'Fixed fee plus split',
    description: 'A paid-order fee is applied, then the remaining amount is split.',
  },
  {
    value: 'internal_only',
    label: 'Bloomjoy internal',
    description: 'Use when there is no external payout for this partnership.',
  },
  {
    value: 'custom',
    label: 'Custom',
    description: 'Advanced fields differ from the standard presets.',
  },
] as const;

type PayoutModelPreset = (typeof payoutModelPresets)[number]['value'];

const getPayoutModelPreset = (form: typeof emptyRuleForm): PayoutModelPreset => {
  if (form.calculationModel === 'internal_only') return 'internal_only';
  if (form.calculationModel === 'gross_split' && form.splitBase === 'gross_sales') {
    return 'gross_sales_split';
  }
  if (form.calculationModel === 'fixed_fee_plus_split') return 'fixed_fee_plus_split';
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

  if (preset === 'fixed_fee_plus_split') {
    return {
      ...form,
      calculationModel: 'fixed_fee_plus_split',
      splitBase: 'net_sales',
      feeBasis: 'per_order',
      grossToNetMethod: 'machine_tax_plus_configured_fees',
      deductionTiming: 'before_split',
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
    feeBasis: 'per_order',
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

  const updateRouteState = (partnershipId: string, step: PartnershipStep) => {
    const nextParams = new URLSearchParams(searchParams);
    if (partnershipId) {
      nextParams.set('partnershipId', partnershipId);
    } else {
      nextParams.delete('partnershipId');
    }
    nextParams.set('step', step);
    setSearchParams(nextParams);
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
                  onSelect={(partnershipId) => updateRouteState(partnershipId, 'details')}
                />
                <StepRail
                  activeStep={activeStep}
                  selectedPartnership={selectedPartnership}
                  stepCounts={stepCounts}
                  onStepChange={(step) => updateRouteState(selectedPartnershipId, step)}
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
                onSelectPartnership={(partnershipId) => updateRouteState(partnershipId, 'details')}
                onStepChange={(step) => updateRouteState(selectedPartnershipId, step)}
              />

              <main className="min-w-0">
                <StepHeader
                  activeStep={activeStep}
                  selectedPartnership={selectedPartnership}
                  onNew={() => updateRouteState('', 'details')}
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
                    />
                  )}
                  {activeStep === 'terms' && selectedPartnership && (
                    <FinancialTermsSection
                      setup={setup}
                      selectedPartnership={selectedPartnership}
                      onRefresh={refresh}
                    />
                  )}
                  {activeStep === 'preview' && selectedPartnership && (
                    <WeeklyPreviewSection selectedPartnership={selectedPartnership} />
                  )}
                  {activeStep !== 'details' && !selectedPartnership && (
                    <EmptyState text="Create or select a partnership before continuing the setup flow." />
                  )}
                </div>
                <MobileStepFooter
                  activeStep={activeStep}
                  selectedPartnership={selectedPartnership}
                  onStepChange={(step) => updateRouteState(selectedPartnershipId, step)}
                />
              </main>
            </div>
          )}
        </div>
      </section>
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
                  {formatLabel(partnership.partnership_type)} / {partnership.status}
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

      <div className="rounded-lg border border-border bg-card p-4">
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
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
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
      </div>
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
      status: selectedPartnership.status,
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
        <div>
          <Label htmlFor="partnership-status">Status</Label>
          <FieldSelect
            id="partnership-status"
            value={form.status}
            onChange={(value) => setForm({ ...form, status: value })}
            options={partnershipStatuses}
          />
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
  const [form, setForm] = useState({ ...emptyParticipantForm, partnershipId: selectedPartnership.id });
  const [isSaving, setIsSaving] = useState(false);
  const [removingPartyId, setRemovingPartyId] = useState<string | null>(null);
  const [isPartnerDialogOpen, setIsPartnerDialogOpen] = useState(false);

  const participants = useMemo(
    () => setup.parties.filter((party) => party.partnership_id === selectedPartnership.id),
    [selectedPartnership.id, setup.parties]
  );

  useEffect(() => {
    setForm({ ...emptyParticipantForm, partnershipId: selectedPartnership.id });
  }, [selectedPartnership.id]);

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
      setForm({ ...emptyParticipantForm, partnershipId: selectedPartnership.id });
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
        setForm({ ...emptyParticipantForm, partnershipId: selectedPartnership.id });
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
            />
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
              onClick={() => setForm({ ...emptyParticipantForm, partnershipId: selectedPartnership.id })}
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
              <div>
                <div className="font-medium text-foreground">{party.partner_name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatLabel(party.party_role)}
                </div>
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
}: {
  setup: PartnershipReportingSetup;
  selectedPartnership: ReportingPartnership;
  onRefresh: () => Promise<unknown>;
}) {
  const [selectedMachineIds, setSelectedMachineIds] = useState<Set<string>>(new Set());
  const [machineSearch, setMachineSearch] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const activeAssignments = useMemo(
    () =>
      setup.assignments.filter(
        (assignment) =>
          assignment.partnership_id === selectedPartnership.id &&
          assignment.status === 'active'
      ),
    [selectedPartnership.id, setup.assignments]
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
  const hasChanges = addedMachineIds.length > 0 || removedMachineIds.length > 0;

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
          effectiveStartDate: selectedPartnership.effective_start_date || today(),
          effectiveEndDate: '',
          status: 'active',
          notes: null,
          reason: 'Partnership machine alignment updated',
        });
      }

      const assignmentsToArchive = activeAssignments.filter((assignment) =>
        removedMachineIds.includes(assignment.machine_id)
      );

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
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save machine alignment.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      {assignmentWarnings.length > 0 && <WarningList warnings={assignmentWarnings} />}

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
              </Badge>
            )}
          </div>
          <div className="max-h-[520px] divide-y divide-border overflow-y-auto">
            {filteredMachines.length === 0 ? (
              <EmptyRow text="No machines match this search." />
            ) : (
              filteredMachines.map((machine) => {
                const checked = selectedMachineIds.has(machine.id);

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
                    </span>
                    {checked && <Badge variant="secondary">Assigned</Badge>}
                  </label>
                );
              })
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={saveMachineAlignment} disabled={isSaving || !hasChanges}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Save Machine Alignment
          </Button>
          <div className="text-sm text-muted-foreground">
            New assignments start {formatDate(selectedPartnership.effective_start_date || today())}.
          </div>
        </div>
      </div>
    </section>
  );
}

function FinancialTermsSection({
  setup,
  selectedPartnership,
  onRefresh,
}: {
  setup: PartnershipReportingSetup;
  selectedPartnership: ReportingPartnership;
  onRefresh: () => Promise<unknown>;
}) {
  const [form, setForm] = useState({ ...emptyRuleForm, partnershipId: selectedPartnership.id });
  const [isSaving, setIsSaving] = useState(false);
  const payoutPreset = getPayoutModelPreset(form);

  const financialRules = useMemo(
    () => setup.financialRules.filter((rule) => rule.partnership_id === selectedPartnership.id),
    [selectedPartnership.id, setup.financialRules]
  );

  const financialWarnings = setup.warnings.filter(
    (warning) =>
      warning.warningType === 'missing_financial_rule' &&
      warning.partnershipId === selectedPartnership.id
  );

  useEffect(() => {
    setForm({ ...emptyRuleForm, partnershipId: selectedPartnership.id });
  }, [selectedPartnership.id]);

  const editRule = (rule: ReportingPartnershipFinancialRule) => {
    setForm({
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
  };

  const updatePayoutPreset = (preset: PayoutModelPreset) => {
    setForm((current) => applyPayoutModelPreset(current, preset));
  };

  const updatePaidOrderFee = (feeAmountDollars: string) => {
    setForm((current) => ({
      ...current,
      feeAmountDollars,
      feeBasis: Number(feeAmountDollars) > 0 ? 'per_order' : 'none',
    }));
  };

  const saveRule = async () => {
    if (!form.effectiveStartDate) {
      toast.error('Effective start date is required.');
      return;
    }

    setIsSaving(true);
    try {
      await upsertReportingFinancialRuleAdmin({
        ...form,
        partnershipId: selectedPartnership.id,
        feeAmountCents: centsFromDollars(form.feeAmountDollars),
        costAmountCents: centsFromDollars(form.costAmountDollars),
        feverShareBasisPoints: basisPointsFromPercent(form.primarySharePercent),
        partnerShareBasisPoints: basisPointsFromPercent(form.partnerSharePercent),
        bloomjoyShareBasisPoints: basisPointsFromPercent(form.bloomjoySharePercent),
        reason: form.ruleId ? 'Payout rules updated' : 'Payout rules created',
      });
      toast.success(form.ruleId ? 'Payout rules updated.' : 'Payout rules created.');
      setForm({ ...emptyRuleForm, partnershipId: selectedPartnership.id });
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
            involved; payout percentages live here.
          </p>
        </div>

        <PayoutFlowSummary form={form} />

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div>
            <FieldLabel
              htmlFor="payout-model-preset"
              label="Payout model"
              help="Choose the plain-language setup that best matches this agreement. Advanced keeps the underlying reporting fields available when needed."
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
              label="Paid-order fee"
              help="A per paid-order fee deducted before the split in the standard net-sales payout model. Set to 0 when the agreement has no per-order fee."
            />
            <Input
              id="fee-amount"
              type="number"
              step="0.01"
              value={form.feeAmountDollars}
              onChange={(event) => updatePaidOrderFee(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <FieldLabel
              htmlFor="primary-share"
              label="Primary payout share %"
              help="The main external payout share for the partnership. Use this when one external participant receives the primary payout."
            />
            <Input
              id="primary-share"
              type="number"
              step="0.01"
              value={form.primarySharePercent}
              onChange={(event) => setForm({ ...form, primarySharePercent: event.target.value })}
            />
          </div>
          <div>
            <FieldLabel
              htmlFor="partner-share"
              label="Partner payout share %"
              help="Use this for an additional external participant share when the agreement has more than one recipient."
            />
            <Input
              id="partner-share"
              type="number"
              step="0.01"
              value={form.partnerSharePercent}
              onChange={(event) => setForm({ ...form, partnerSharePercent: event.target.value })}
            />
          </div>
          <div>
            <FieldLabel
              htmlFor="bloomjoy-share"
              label="Bloomjoy retained share %"
              help="The share retained by Bloomjoy after external payout shares are applied."
            />
            <Input
              id="bloomjoy-share"
              type="number"
              step="0.01"
              value={form.bloomjoySharePercent}
              onChange={(event) => setForm({ ...form, bloomjoySharePercent: event.target.value })}
            />
          </div>
        </div>

        <details className="mt-4 rounded-md border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Advanced reporting assumptions
          </summary>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <FieldLabel
                htmlFor="calculation-model"
                label="Calculation model"
                help="The backend calculation mode used by reporting. Most admins should choose the payout model preset instead."
              />
              <FieldSelect
                id="calculation-model"
                value={form.calculationModel}
                onChange={(calculationModel) => setForm({ ...form, calculationModel })}
                options={calculationModels}
              />
            </div>
            <div>
              <FieldLabel
                htmlFor="split-base"
                label="Split base"
                help="The amount the payout percentages apply to, such as gross sales, net sales, or contribution after costs."
              />
              <FieldSelect
                id="split-base"
                value={form.splitBase}
                onChange={(splitBase) => setForm({ ...form, splitBase })}
                options={splitBases}
              />
            </div>
            <div>
              <FieldLabel
                htmlFor="gross-to-net-method"
                label="Gross-to-net method"
                help="Controls which tax and fee inputs are removed from gross sales before calculating net sales."
              />
              <FieldSelect
                id="gross-to-net-method"
                value={form.grossToNetMethod}
                onChange={(grossToNetMethod) => setForm({ ...form, grossToNetMethod })}
                options={grossToNetMethods}
              />
            </div>
            <div>
              <FieldLabel
                htmlFor="fee-basis"
                label="Fee basis"
                help="Controls whether the configured fee is applied per order, per stick, per transaction, or not at all."
              />
              <FieldSelect
                id="fee-basis"
                value={form.feeBasis}
                onChange={(feeBasis) => setForm({ ...form, feeBasis })}
                options={feeBases}
              />
            </div>
            <div>
              <FieldLabel
                htmlFor="deduction-timing"
                label="Cost deduction timing"
                help="Controls whether additional costs are removed before the split, after the split, or only shown in reporting."
              />
              <FieldSelect
                id="deduction-timing"
                value={form.deductionTiming}
                onChange={(deductionTiming) => setForm({ ...form, deductionTiming })}
                options={deductionTimings}
              />
            </div>
            <div>
              <FieldLabel
                htmlFor="cost-amount"
                label="Cost amount"
                help="Optional cost value used when the agreement has a separate cost basis in addition to fees."
              />
              <Input
                id="cost-amount"
                type="number"
                step="0.01"
                value={form.costAmountDollars}
                onChange={(event) => setForm({ ...form, costAmountDollars: event.target.value })}
              />
            </div>
            <div>
              <FieldLabel
                htmlFor="cost-basis"
                label="Cost basis"
                help="Controls how the cost amount is applied. Leave as none when there is no additional cost model."
              />
              <FieldSelect
                id="cost-basis"
                value={form.costBasis}
                onChange={(costBasis) => setForm({ ...form, costBasis })}
                options={costBases}
              />
            </div>
            <DateWindowFields
              startId="rule-start"
              endId="rule-end"
              startValue={form.effectiveStartDate}
              endValue={form.effectiveEndDate}
              onStartChange={(value) => setForm({ ...form, effectiveStartDate: value })}
              onEndChange={(value) => setForm({ ...form, effectiveEndDate: value })}
            />
            <div>
              <Label htmlFor="rule-status">Status</Label>
              <FieldSelect
                id="rule-status"
                value={form.status}
                onChange={(status) => setForm({ ...form, status })}
                options={partnershipStatuses}
              />
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
          </div>
        </details>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={saveRule} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Save Payout Rules
          </Button>
          {form.ruleId && (
            <Button
              variant="outline"
              onClick={() => setForm({ ...emptyRuleForm, partnershipId: selectedPartnership.id })}
            >
              New Payout Rules
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <ListHeader title="Payout Rules" count={financialRules.length} />
        {financialRules.length === 0 ? (
          <EmptyRow text="No payout rules configured." />
        ) : (
          financialRules.map((rule) => (
            <Row key={rule.id}>
              <div>
                <div className="font-medium text-foreground">{formatLabel(rule.calculation_model)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Fee {formatMoney(rule.fee_amount_cents)} {formatLabel(rule.fee_basis)} / primary{' '}
                  {percentFromBasisPoints(rule.fever_share_basis_points)}%, partner{' '}
                  {percentFromBasisPoints(rule.partner_share_basis_points)}%, Bloomjoy{' '}
                  {percentFromBasisPoints(rule.bloomjoy_share_basis_points)}%
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={rule.status === 'active' ? 'default' : 'outline'}>{rule.status}</Badge>
                <Button variant="outline" size="sm" onClick={() => editRule(rule)}>
                  Edit
                </Button>
              </div>
            </Row>
          ))
        )}
      </div>
    </section>
  );
}

function PayoutFlowSummary({ form }: { form: typeof emptyRuleForm }) {
  const paidOrderFee =
    Number(form.feeAmountDollars) > 0 ? `${formatMoney(centsFromDollars(form.feeAmountDollars))} paid-order fee` : 'no paid-order fee';
  const splitSummary = `${Number(form.primarySharePercent || 0)}% primary / ${Number(
    form.partnerSharePercent || 0
  )}% partner / ${Number(form.bloomjoySharePercent || 0)}% Bloomjoy`;

  return (
    <div className="mt-5 grid gap-2 text-sm sm:grid-cols-4">
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <div className="font-medium text-foreground">Gross sales</div>
        <div className="mt-1 text-xs text-muted-foreground">Weekly paid orders</div>
      </div>
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <div className="font-medium text-foreground">Taxes and fees</div>
        <div className="mt-1 text-xs text-muted-foreground">{paidOrderFee}</div>
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
      <HelpTooltip>{help}</HelpTooltip>
    </div>
  );
}

function HelpTooltip({ children }: { children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Open field help"
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

function WeeklyPreviewSection({ selectedPartnership }: { selectedPartnership: ReportingPartnership }) {
  const [weekEndingDate, setWeekEndingDate] = useState(() =>
    getLastCompletedWeekEndingDate(selectedPartnership.reporting_week_end_day)
  );
  const [preview, setPreview] = useState<PartnerWeeklyReportPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setWeekEndingDate(getLastCompletedWeekEndingDate(selectedPartnership.reporting_week_end_day));
    setPreview(null);
  }, [selectedPartnership.id, selectedPartnership.reporting_week_end_day]);

  const loadPreview = async () => {
    if (!weekEndingDate) {
      toast.error('Week ending date is required.');
      return;
    }

    if (new Date(`${weekEndingDate}T00:00:00`).getDay() !== selectedPartnership.reporting_week_end_day) {
      toast.error(`Week ending date must be a ${dayNames[selectedPartnership.reporting_week_end_day]}.`);
      return;
    }

    setIsLoading(true);
    try {
      const nextPreview = await previewPartnerWeeklyReportAdmin(selectedPartnership.id, weekEndingDate);
      setPreview(nextPreview);
      toast.success('Weekly report preview loaded.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to preview report.');
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
              onChange={(event) => setWeekEndingDate(event.target.value)}
            />
            <div className="mt-1 text-xs text-muted-foreground">
              Week ends {dayNames[selectedPartnership.reporting_week_end_day]}
            </div>
          </div>
          <Button onClick={loadPreview} disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Preview
          </Button>
        </div>
      </div>

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
              <Badge variant={preview.warnings.length ? 'destructive' : 'default'}>
                {preview.warnings.length ? `${preview.warnings.length} warnings` : 'Ready'}
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
              <Metric label="Primary share payout" value={formatMoney(preview.summary.fever_profit_cents)} />
              <Metric label="Partner profit" value={formatMoney(preview.summary.partner_profit_cents)} />
              <Metric label="Bloomjoy profit" value={formatMoney(preview.summary.bloomjoy_profit_cents)} />
            </div>
          </div>

          {preview.warnings.length > 0 && (
            <PreviewWarningList warnings={preview.warnings} partnershipId={selectedPartnership.id} />
          )}

          <div className="rounded-lg border border-border bg-card">
            <ListHeader title="Sales by Machine" count={preview.machines.length} />
            {preview.machines.length === 0 ? (
              <EmptyRow text="No sales found for this partnership and week." />
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
  onCreated,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (partner: ReportingPartner) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const [form, setForm] = useState(emptyPartnerForm);
  const [isSaving, setIsSaving] = useState(false);

  const savePartner = async () => {
    if (!form.name.trim()) {
      toast.error('Partner record name is required.');
      return;
    }

    setIsSaving(true);
    try {
      const savedPartner = await upsertReportingPartnerAdmin({
        ...form,
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
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
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
          {formatLabel(option)}
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
