import { useMemo, useState } from 'react';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Plus, RefreshCw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  fetchPartnershipReportingSetup,
  previewPartnerWeeklyReportAdmin,
  upsertReportingFinancialRuleAdmin,
  upsertReportingMachineAssignmentAdmin,
  upsertReportingPartnerAdmin,
  upsertReportingPartnershipAdmin,
  upsertReportingPartnershipPartyAdmin,
  type PartnerWeeklyReportPreview,
  type PartnershipReportingSetup,
  type ReportingMachinePartnershipAssignment,
  type ReportingPartner,
  type ReportingPartnership,
  type ReportingPartnershipFinancialRule,
  type ReportingPartnershipParty,
} from '@/lib/partnershipReporting';
import {
  assignmentRoles,
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
  statuses,
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
  { key: 'terms', label: 'Financial Terms', description: 'Fees, split model, shares' },
  { key: 'preview', label: 'Weekly Preview', description: 'Check report output' },
];

const validSteps = new Set<PartnershipStep>(steps.map((step) => step.key));

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

const emptyAssignmentForm = {
  assignmentId: null as string | null,
  machineId: '',
  partnershipId: '',
  assignmentRole: 'primary_reporting',
  effectiveStartDate: today(),
  effectiveEndDate: '',
  status: 'active',
  notes: '',
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
              <aside className="space-y-4">
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

              <main>
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

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {selectedPartnership ? selectedPartnership.name : 'New partnership'}
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
              management lives separately, but you can create a missing record here without leaving
              the flow.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/partner-records">Manage Partner Records</Link>
          </Button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr_0.6fr]">
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
          <div>
            <Label htmlFor="participant-share">Share %</Label>
            <Input
              id="participant-share"
              type="number"
              step="0.01"
              min={0}
              max={100}
              value={form.sharePercent}
              onChange={(event) => setForm({ ...form, sharePercent: event.target.value })}
              placeholder="Optional"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <Checkbox
              checked={form.isReportRecipient}
              onCheckedChange={(checked) => setForm({ ...form, isReportRecipient: Boolean(checked) })}
            />
            Report recipient
          </label>
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
                  {formatLabel(party.party_role)} / share{' '}
                  {party.share_basis_points ? percentFromBasisPoints(party.share_basis_points) : 'n/a'}%
                </div>
              </div>
              <div className="flex items-center gap-2">
                {party.is_report_recipient && <Badge variant="secondary">Recipient</Badge>}
                <Button variant="outline" size="sm" onClick={() => editParticipant(party)}>
                  Edit
                </Button>
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
  const [form, setForm] = useState({ ...emptyAssignmentForm, partnershipId: selectedPartnership.id });
  const [isSaving, setIsSaving] = useState(false);

  const partnershipAssignments = useMemo(
    () =>
      setup.assignments.filter((assignment) => assignment.partnership_id === selectedPartnership.id),
    [selectedPartnership.id, setup.assignments]
  );

  const assignedMachineIds = useMemo(
    () => new Set(partnershipAssignments.map((assignment) => assignment.machine_id)),
    [partnershipAssignments]
  );

  const assignmentWarnings = setup.warnings.filter(
    (warning) =>
      warning.machineId &&
      assignedMachineIds.has(warning.machineId) &&
      warning.warningType === 'overlapping_partnership_assignments'
  );

  useEffect(() => {
    setForm({ ...emptyAssignmentForm, partnershipId: selectedPartnership.id });
  }, [selectedPartnership.id]);

  const editAssignment = (assignment: ReportingMachinePartnershipAssignment) => {
    setForm({
      assignmentId: assignment.id,
      machineId: assignment.machine_id,
      partnershipId: selectedPartnership.id,
      assignmentRole: assignment.assignment_role,
      effectiveStartDate: assignment.effective_start_date,
      effectiveEndDate: assignment.effective_end_date ?? '',
      status: assignment.status,
      notes: assignment.notes ?? '',
    });
  };

  const saveAssignment = async () => {
    if (!form.machineId || !form.effectiveStartDate) {
      toast.error('Machine and effective start date are required.');
      return;
    }

    setIsSaving(true);
    try {
      await upsertReportingMachineAssignmentAdmin({
        ...form,
        partnershipId: selectedPartnership.id,
        reason: form.assignmentId ? 'Machine assignment updated' : 'Machine assigned to partnership',
      });
      toast.success(form.assignmentId ? 'Assignment updated.' : 'Machine assigned.');
      setForm({ ...emptyAssignmentForm, partnershipId: selectedPartnership.id });
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save assignment.');
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
            <h2 className="font-semibold text-foreground">
              {form.assignmentId ? 'Edit Machine Assignment' : 'Assign Machine'}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Assign existing reporting machines to this partnership. Machine aliases and tax
              readiness are managed on the Machines page.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/machines">Open Machines</Link>
          </Button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <MachineSelect
            setup={setup}
            value={form.machineId}
            onChange={(machineId) => setForm({ ...form, machineId })}
            id="assignment-machine"
          />
          <div>
            <Label htmlFor="assignment-role">Assignment role</Label>
            <FieldSelect
              id="assignment-role"
              value={form.assignmentRole}
              onChange={(assignmentRole) => setForm({ ...form, assignmentRole })}
              options={assignmentRoles}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
          <DateWindowFields
            startId="assignment-start"
            endId="assignment-end"
            startValue={form.effectiveStartDate}
            endValue={form.effectiveEndDate}
            onStartChange={(value) => setForm({ ...form, effectiveStartDate: value })}
            onEndChange={(value) => setForm({ ...form, effectiveEndDate: value })}
          />
          <div>
            <Label htmlFor="assignment-status">Status</Label>
            <FieldSelect
              id="assignment-status"
              value={form.status}
              onChange={(status) => setForm({ ...form, status })}
              options={statuses}
            />
          </div>
          <div>
            <Label htmlFor="assignment-notes">Notes</Label>
            <Input
              id="assignment-notes"
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Optional"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={saveAssignment} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Save Assignment
          </Button>
          {form.assignmentId && (
            <Button
              variant="outline"
              onClick={() => setForm({ ...emptyAssignmentForm, partnershipId: selectedPartnership.id })}
            >
              New Assignment
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <ListHeader title="Machines in this Partnership" count={partnershipAssignments.length} />
        {partnershipAssignments.length === 0 ? (
          <EmptyRow text="No machines assigned to this partnership yet." />
        ) : (
          partnershipAssignments.map((assignment) => (
            <Row key={assignment.id}>
              <div>
                <div className="font-medium text-foreground">{assignment.machine_label}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatLabel(assignment.assignment_role)} / {formatDate(assignment.effective_start_date)} to{' '}
                  {formatDate(assignment.effective_end_date)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={assignment.status === 'active' ? 'default' : 'outline'}>{assignment.status}</Badge>
                <Button variant="outline" size="sm" onClick={() => editAssignment(assignment)}>
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
        reason: form.ruleId ? 'Financial terms updated' : 'Financial terms created',
      });
      toast.success(form.ruleId ? 'Financial terms updated.' : 'Financial terms created.');
      setForm({ ...emptyRuleForm, partnershipId: selectedPartnership.id });
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save financial terms.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      {financialWarnings.length > 0 && <WarningList warnings={financialWarnings} />}

      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">
          {form.ruleId ? 'Edit Financial Terms' : 'Create Financial Terms'}
        </h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <Label htmlFor="calculation-model">Calculation model</Label>
            <FieldSelect
              id="calculation-model"
              value={form.calculationModel}
              onChange={(calculationModel) => setForm({ ...form, calculationModel })}
              options={calculationModels}
            />
          </div>
          <div>
            <Label htmlFor="split-base">Split base</Label>
            <FieldSelect
              id="split-base"
              value={form.splitBase}
              onChange={(splitBase) => setForm({ ...form, splitBase })}
              options={splitBases}
            />
          </div>
          <div>
            <Label htmlFor="fee-amount">Fee amount</Label>
            <Input
              id="fee-amount"
              type="number"
              step="0.01"
              value={form.feeAmountDollars}
              onChange={(event) => setForm({ ...form, feeAmountDollars: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="fee-basis">Fee basis</Label>
            <FieldSelect
              id="fee-basis"
              value={form.feeBasis}
              onChange={(feeBasis) => setForm({ ...form, feeBasis })}
              options={feeBases}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="primary-share">Primary share %</Label>
            <Input
              id="primary-share"
              type="number"
              step="0.01"
              value={form.primarySharePercent}
              onChange={(event) => setForm({ ...form, primarySharePercent: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="partner-share">Partner share %</Label>
            <Input
              id="partner-share"
              type="number"
              step="0.01"
              value={form.partnerSharePercent}
              onChange={(event) => setForm({ ...form, partnerSharePercent: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="bloomjoy-share">Bloomjoy share %</Label>
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
              <Label htmlFor="gross-to-net-method">Gross-to-net method</Label>
              <FieldSelect
                id="gross-to-net-method"
                value={form.grossToNetMethod}
                onChange={(grossToNetMethod) => setForm({ ...form, grossToNetMethod })}
                options={grossToNetMethods}
              />
            </div>
            <div>
              <Label htmlFor="deduction-timing">Cost deduction timing</Label>
              <FieldSelect
                id="deduction-timing"
                value={form.deductionTiming}
                onChange={(deductionTiming) => setForm({ ...form, deductionTiming })}
                options={deductionTimings}
              />
            </div>
            <div>
              <Label htmlFor="cost-amount">Cost amount</Label>
              <Input
                id="cost-amount"
                type="number"
                step="0.01"
                value={form.costAmountDollars}
                onChange={(event) => setForm({ ...form, costAmountDollars: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="cost-basis">Cost basis</Label>
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
            Save Financial Terms
          </Button>
          {form.ruleId && (
            <Button
              variant="outline"
              onClick={() => setForm({ ...emptyRuleForm, partnershipId: selectedPartnership.id })}
            >
              New Terms
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <ListHeader title="Financial Terms" count={financialRules.length} />
        {financialRules.length === 0 ? (
          <EmptyRow text="No financial terms configured." />
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

function MachineSelect({
  setup,
  value,
  onChange,
  id,
}: {
  setup: PartnershipReportingSetup;
  value: string;
  onChange: (machineId: string) => void;
  id: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>Machine</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Select machine</option>
        {setup.machines.map((machine) => (
          <option key={machine.id} value={machine.id}>
            {machine.machine_label} / {machine.account_name} / {machine.location_name}
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
