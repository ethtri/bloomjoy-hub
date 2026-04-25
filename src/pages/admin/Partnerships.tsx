import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  fetchPartnershipReportingSetup,
  previewPartnerWeeklyReportAdmin,
  upsertReportingFinancialRuleAdmin,
  upsertReportingMachineAssignmentAdmin,
  upsertReportingMachineTaxRateAdmin,
  upsertReportingPartnerAdmin,
  upsertReportingPartnershipPartyAdmin,
  upsertReportingPartnershipAdmin,
  type PartnerWeeklyReportPreview,
  type PartnershipReportingSetup,
  type ReportingMachinePartnershipAssignment,
  type ReportingMachineTaxRate,
  type ReportingPartner,
  type ReportingPartnershipParty,
  type ReportingPartnership,
  type ReportingPartnershipFinancialRule,
} from '@/lib/partnershipReporting';
import {
  type ReportingMachineType,
  upsertReportingMachineAdmin,
} from '@/lib/reporting';

const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const today = () => toDateInputValue(new Date());

const getLastCompletedWeekEndingDate = (weekEndDay: number) => {
  const date = new Date();
  const currentDay = date.getDay();
  let daysBack = (currentDay - weekEndDay + 7) % 7;
  if (daysBack === 0) daysBack = 7;
  date.setDate(date.getDate() - daysBack);
  return toDateInputValue(date);
};

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const centsFromDollars = (value: string) => Math.round((Number(value) || 0) * 100);
const dollarsFromCents = (value: number) => (Number(value ?? 0) / 100).toFixed(2);
const basisPointsFromPercent = (value: string) => Math.round((Number(value) || 0) * 100);
const percentFromBasisPoints = (value: number) => (Number(value ?? 0) / 100).toFixed(2);

const formatMoney = (cents: number | undefined) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(Number(cents ?? 0) / 100);

const formatDate = (value: string | null | undefined) => value || 'open-ended';
const formatLabel = (value: string) => value.replaceAll('_', ' ');

const partnerTypes = [
  'venue',
  'event_operator',
  'platform_partner',
  'revenue_share_partner',
  'internal',
  'other',
];
const partnershipTypes = ['venue', 'event', 'platform', 'revenue_share', 'internal', 'other'];
const statuses = ['active', 'archived'];
const partnershipStatuses = ['draft', 'active', 'archived'];
const partyRoles = [
  'venue_partner',
  'event_partner',
  'platform_partner',
  'revenue_share_recipient',
  'operator',
  'internal',
  'other',
];
const assignmentRoles = ['primary_reporting', 'venue', 'event', 'platform', 'internal'];
const machineTypes: ReportingMachineType[] = ['commercial', 'mini', 'micro', 'unknown'];
const calculationModels = [
  'gross_split',
  'net_split',
  'contribution_split',
  'fixed_fee_plus_split',
  'internal_only',
];
const splitBases = ['gross_sales', 'net_sales', 'contribution_after_costs'];
const feeBases = ['none', 'per_order', 'per_stick', 'per_transaction'];
const costBases = ['none', 'per_stick', 'per_order', 'percentage_of_sales'];
const deductionTimings = ['before_split', 'after_split', 'reporting_only'];
const grossToNetMethods = [
  'machine_tax_plus_configured_fees',
  'imported_tax_plus_configured_fees',
  'configured_fees_only',
];

const emptyPartnerForm = {
  partnerId: null as string | null,
  name: '',
  partnerType: 'revenue_share_partner',
  primaryContactName: '',
  primaryContactEmail: '',
  status: 'active',
  notes: '',
  reason: 'Partner setup update',
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
  reason: 'Partnership setup update',
};

const emptyMachineForm = {
  machineId: null as string | null,
  accountName: '',
  locationName: '',
  machineLabel: '',
  machineType: 'unknown' as ReportingMachineType,
  sunzeMachineId: '',
  reason: 'Machine mapping update',
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
  reason: 'Machine partnership assignment update',
};

const emptyPartyForm = {
  partyId: null as string | null,
  partnershipId: '',
  partnerId: '',
  partyRole: 'revenue_share_recipient',
  sharePercent: '',
  isReportRecipient: false,
  reason: 'Partnership participant update',
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
  reason: 'Financial rule update',
};

export default function AdminPartnershipsPage() {
  const queryClient = useQueryClient();
  const [selectedPartnershipId, setSelectedPartnershipId] = useState('');
  const {
    data: setup = {
      partners: [],
      partnerships: [],
      machines: [],
      assignments: [],
      parties: [],
      taxRates: [],
      financialRules: [],
      warnings: [],
    },
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-partnership-reporting-setup'],
    queryFn: fetchPartnershipReportingSetup,
    staleTime: 1000 * 30,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-partnership-reporting-setup'] });

  const firstPartnershipId = setup.partnerships[0]?.id ?? '';
  const selectedPartnership = useMemo(
    () =>
      setup.partnerships.find((partnership) => partnership.id === selectedPartnershipId) ?? null,
    [selectedPartnershipId, setup.partnerships]
  );

  useEffect(() => {
    if (!selectedPartnershipId && firstPartnershipId) {
      setSelectedPartnershipId(firstPartnershipId);
    }
  }, [firstPartnershipId, selectedPartnershipId]);

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
                Configure partners, partnership agreements, machine assignments, machine-level tax
                rates, and financial rules for partner reporting.
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

          {setup.warnings.length > 0 && (
            <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5" />
                <div>
                  <h2 className="font-semibold">Setup warnings</h2>
                  <div className="mt-2 grid gap-1 text-sm">
                    {setup.warnings.slice(0, 8).map((warning, index) => (
                      <div key={`${warning.warningType}-${index}`}>{warning.message}</div>
                    ))}
                    {setup.warnings.length > 8 && (
                      <div>{setup.warnings.length - 8} more warnings hidden.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="mt-6 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              Loading partnership setup...
            </div>
          ) : (
            <div className="mt-6 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
              <PartnershipPicker
                setup={setup}
                selectedPartnershipId={selectedPartnershipId}
                onSelect={setSelectedPartnershipId}
              />

              <div className="space-y-6">
                <PartnershipDetailsSection
                  selectedPartnership={selectedPartnership}
                  onSelect={setSelectedPartnershipId}
                  onRefresh={refresh}
                />

                {selectedPartnership ? (
                  <>
                    <ParticipantsSection
                      setup={setup}
                      selectedPartnership={selectedPartnership}
                      onRefresh={refresh}
                    />
                    <MachineAssignmentsSection
                      setup={setup}
                      selectedPartnership={selectedPartnership}
                      onRefresh={refresh}
                    />
                    <MachineTaxSection
                      setup={setup}
                      selectedPartnership={selectedPartnership}
                      onRefresh={refresh}
                    />
                    <FinancialTermsSection
                      setup={setup}
                      selectedPartnership={selectedPartnership}
                      onRefresh={refresh}
                    />
                    <WeeklyPreviewSection selectedPartnership={selectedPartnership} />
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
                    Create or select a partnership to manage participants, machines, tax setup,
                    financial terms, and weekly preview in one workflow.
                  </div>
                )}
              </div>
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
    <aside className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-foreground">Partnerships</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Select one setup workspace.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => onSelect('')}>
            New
          </Button>
        </div>

        <div className="mt-4 space-y-2">
          {setup.partnerships.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              No partnerships yet.
            </div>
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

      <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        Partnership setup now keeps participants, machine assignments, tax rates, financial terms,
        and preview together. Report delivery recipients still live in Reporting Operations.
      </div>
    </aside>
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
          {option.replaceAll('_', ' ')}
        </option>
      ))}
    </select>
  );
}

function PartnerRecordsSection({
  setup,
  onRefresh,
}: {
  setup: PartnershipReportingSetup;
  onRefresh: () => Promise<unknown>;
}) {
  const [form, setForm] = useState(emptyPartnerForm);
  const [isSaving, setIsSaving] = useState(false);

  const editPartner = (partner: ReportingPartner) => {
    setForm({
      partnerId: partner.id,
      name: partner.name,
      partnerType: partner.partner_type,
      primaryContactName: partner.primary_contact_name ?? '',
      primaryContactEmail: partner.primary_contact_email ?? '',
      status: partner.status,
      notes: partner.notes ?? '',
      reason: 'Partner setup update',
    });
  };

  const savePartner = async () => {
    if (!form.name.trim() || !form.reason.trim()) {
      toast.error('Partner name and reason are required.');
      return;
    }

    setIsSaving(true);
    try {
      await upsertReportingPartnerAdmin(form);
      toast.success(form.partnerId ? 'Partner updated.' : 'Partner created.');
      setForm(emptyPartnerForm);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save partner.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">
          {form.partnerId ? 'Edit Partner Record' : 'Create Partner Record'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Create reusable organizations or contacts before adding them as participants.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <Label htmlFor="partner-name">Partner name</Label>
            <Input id="partner-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="partner-type">Partner type</Label>
            <FieldSelect id="partner-type" value={form.partnerType} onChange={(value) => setForm({ ...form, partnerType: value })} options={partnerTypes} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="partner-contact-name">Primary contact</Label>
              <Input id="partner-contact-name" value={form.primaryContactName} onChange={(event) => setForm({ ...form, primaryContactName: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="partner-contact-email">Contact email</Label>
              <Input id="partner-contact-email" type="email" value={form.primaryContactEmail} onChange={(event) => setForm({ ...form, primaryContactEmail: event.target.value })} />
            </div>
          </div>
          <div>
            <Label htmlFor="partner-status">Status</Label>
            <FieldSelect id="partner-status" value={form.status} onChange={(value) => setForm({ ...form, status: value })} options={statuses} />
          </div>
          <div>
            <Label htmlFor="partner-notes">Notes</Label>
            <Textarea id="partner-notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="partner-reason">Reason</Label>
            <Input id="partner-reason" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={savePartner} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Save Partner Record
            </Button>
            {form.partnerId && (
              <Button variant="outline" onClick={() => setForm(emptyPartnerForm)}>
                New Partner
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <ListHeader title="Partner Records" count={setup.partners.length} />
        {setup.partners.length === 0 ? (
          <EmptyRow text="No partner records yet." />
        ) : (
          setup.partners.map((partner) => (
            <Row key={partner.id}>
              <div>
                <div className="font-medium text-foreground">{partner.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {partner.partner_type.replaceAll('_', ' ')} / {partner.primary_contact_email ?? 'no contact email'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={partner.status === 'active' ? 'default' : 'outline'}>{partner.status}</Badge>
                <Button variant="outline" size="sm" onClick={() => editPartner(partner)}>
                  Edit
                </Button>
              </div>
            </Row>
          ))
        )}
      </div>
    </div>
  );
}

function PartnershipDetailsSection({
  selectedPartnership,
  onSelect,
  onRefresh,
}: {
  selectedPartnership: ReportingPartnership | null;
  onSelect: (partnershipId: string) => void;
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
      reason: 'Partnership setup update',
    });
  }, [selectedPartnership]);

  const savePartnership = async () => {
    if (!form.name.trim() || !form.effectiveStartDate || !form.reason.trim()) {
      toast.error('Partnership name, effective start date, and reason are required.');
      return;
    }

    setIsSaving(true);
    try {
      const savedPartnership = await upsertReportingPartnershipAdmin({
        ...form,
        reportingWeekEndDay: Number(form.reportingWeekEndDay),
      });
      toast.success(form.partnershipId ? 'Partnership updated.' : 'Partnership created.');
      onSelect(savedPartnership.id);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save partnership.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground">
            {form.partnershipId ? 'Partnership Details' : 'Create Partnership'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This is the reporting agreement that owns participants, assigned machines, financial
            terms, and weekly preview.
          </p>
        </div>
        {form.partnershipId && (
          <Button variant="outline" size="sm" onClick={() => onSelect('')}>
            New Partnership
          </Button>
        )}
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <Label htmlFor="partnership-name">Partnership name</Label>
          <Input id="partnership-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Bubble Planet Seattle" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="partnership-type">Type</Label>
            <FieldSelect id="partnership-type" value={form.partnershipType} onChange={(value) => setForm({ ...form, partnershipType: value })} options={partnershipTypes} />
          </div>
          <div>
            <Label htmlFor="partnership-week-end">Week ends</Label>
            <select
              id="partnership-week-end"
              value={form.reportingWeekEndDay}
              onChange={(event) => setForm({ ...form, reportingWeekEndDay: event.target.value })}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Sunday</option>
              <option value="1">Monday</option>
              <option value="2">Tuesday</option>
              <option value="3">Wednesday</option>
              <option value="4">Thursday</option>
              <option value="5">Friday</option>
              <option value="6">Saturday</option>
            </select>
          </div>
        </div>
        <div>
          <Label htmlFor="partnership-timezone">Timezone</Label>
          <Input id="partnership-timezone" value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} />
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
          <FieldSelect id="partnership-status" value={form.status} onChange={(value) => setForm({ ...form, status: value })} options={partnershipStatuses} />
        </div>
        <div>
          <Label htmlFor="partnership-notes">Notes</Label>
          <Textarea id="partnership-notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </div>
        <div>
          <Label htmlFor="partnership-reason">Reason</Label>
          <Input id="partnership-reason" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
        </div>
        <Button onClick={savePartnership} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
          Save Partnership
        </Button>
      </div>
    </div>
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
  const [form, setForm] = useState(emptyPartyForm);
  const [isSaving, setIsSaving] = useState(false);

  const participants = useMemo(
    () => setup.parties.filter((party) => party.partnership_id === selectedPartnership.id),
    [selectedPartnership.id, setup.parties]
  );

  useEffect(() => {
    setForm({
      ...emptyPartyForm,
      partnershipId: selectedPartnership.id,
    });
  }, [selectedPartnership.id]);

  const editParticipant = (party: ReportingPartnershipParty) => {
    setForm({
      partyId: party.id,
      partnershipId: party.partnership_id,
      partnerId: party.partner_id,
      partyRole: party.party_role,
      sharePercent: party.share_basis_points
        ? percentFromBasisPoints(party.share_basis_points)
        : '',
      isReportRecipient: party.is_report_recipient,
      reason: 'Partnership participant update',
    });
  };

  const saveParticipant = async () => {
    if (!form.partnerId || !form.reason.trim()) {
      toast.error('Partner and reason are required.');
      return;
    }

    setIsSaving(true);
    try {
      await upsertReportingPartnershipPartyAdmin({
        partyId: form.partyId,
        partnershipId: selectedPartnership.id,
        partnerId: form.partnerId,
        partyRole: form.partyRole,
        shareBasisPoints: form.sharePercent.trim()
          ? basisPointsFromPercent(form.sharePercent)
          : null,
        isReportRecipient: form.isReportRecipient,
        reason: form.reason,
      });
      toast.success(form.partyId ? 'Participant updated.' : 'Participant added.');
      setForm({
        ...emptyPartyForm,
        partnershipId: selectedPartnership.id,
      });
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save participant.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-semibold text-foreground">Participants</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add every organization that participates in {selectedPartnership.name}. Use report
          recipient for people who should be considered when schedules are configured.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
        <div className="rounded-lg border border-border bg-background p-4">
          <h3 className="font-medium text-foreground">
            {form.partyId ? 'Edit Participant' : 'Add Participant'}
          </h3>
          <div className="mt-4 space-y-3">
            <PartnerSelect
              setup={setup}
              value={form.partnerId}
              onChange={(partnerId) => setForm({ ...form, partnerId })}
              id="participant-partner"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="participant-role">Role</Label>
                <FieldSelect
                  id="participant-role"
                  value={form.partyRole}
                  onChange={(partyRole) => setForm({ ...form, partyRole })}
                  options={partyRoles}
                />
              </div>
              <div>
                <Label htmlFor="participant-share">Share % (optional)</Label>
                <Input
                  id="participant-share"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  value={form.sharePercent}
                  onChange={(event) => setForm({ ...form, sharePercent: event.target.value })}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 rounded-md border border-border p-3 text-sm">
              <Checkbox
                checked={form.isReportRecipient}
                onCheckedChange={(checked) =>
                  setForm({ ...form, isReportRecipient: Boolean(checked) })
                }
              />
              Report recipient
            </label>
            <div>
              <Label htmlFor="participant-reason">Reason</Label>
              <Input
                id="participant-reason"
                value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.target.value })}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={saveParticipant} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Save Participant
              </Button>
              {form.partyId && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setForm({
                      ...emptyPartyForm,
                      partnershipId: selectedPartnership.id,
                    })
                  }
                >
                  New Participant
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background">
          <ListHeader title="Participants in this Partnership" count={participants.length} />
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
      </div>

      <PartnerRecordsSection setup={setup} onRefresh={onRefresh} />
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
  const [machineForm, setMachineForm] = useState(emptyMachineForm);
  const [assignmentForm, setAssignmentForm] = useState(emptyAssignmentForm);
  const [isSavingMachine, setIsSavingMachine] = useState(false);
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);

  const partnershipAssignments = useMemo(
    () =>
      setup.assignments.filter(
        (assignment) => assignment.partnership_id === selectedPartnership.id
      ),
    [selectedPartnership.id, setup.assignments]
  );

  useEffect(() => {
    setAssignmentForm({
      ...emptyAssignmentForm,
      partnershipId: selectedPartnership.id,
    });
  }, [selectedPartnership.id]);

  const editMachine = (machine: PartnershipReportingSetup['machines'][number]) => {
    setMachineForm({
      machineId: machine.id,
      accountName: machine.account_name,
      locationName: machine.location_name,
      machineLabel: machine.machine_label,
      machineType: machine.machine_type,
      sunzeMachineId: machine.sunze_machine_id ?? '',
      reason: 'Machine mapping update',
    });
  };

  const editAssignment = (assignment: ReportingMachinePartnershipAssignment) => {
    setAssignmentForm({
      assignmentId: assignment.id,
      machineId: assignment.machine_id,
      partnershipId: selectedPartnership.id,
      assignmentRole: assignment.assignment_role,
      effectiveStartDate: assignment.effective_start_date,
      effectiveEndDate: assignment.effective_end_date ?? '',
      status: assignment.status,
      notes: assignment.notes ?? '',
      reason: 'Machine partnership assignment update',
    });
  };

  const saveMachine = async () => {
    if (!machineForm.accountName.trim() || !machineForm.locationName.trim() || !machineForm.machineLabel.trim() || !machineForm.reason.trim()) {
      toast.error('Account, location, machine label, and reason are required.');
      return;
    }

    setIsSavingMachine(true);
    try {
      await upsertReportingMachineAdmin(machineForm);
      toast.success(machineForm.machineId ? 'Machine mapping updated.' : 'Machine mapping created.');
      setMachineForm(emptyMachineForm);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save machine mapping.');
    } finally {
      setIsSavingMachine(false);
    }
  };

  const saveAssignment = async () => {
    if (!assignmentForm.machineId || !assignmentForm.effectiveStartDate || !assignmentForm.reason.trim()) {
      toast.error('Machine, effective start date, and reason are required.');
      return;
    }

    setIsSavingAssignment(true);
    try {
      await upsertReportingMachineAssignmentAdmin({
        ...assignmentForm,
        partnershipId: selectedPartnership.id,
      });
      toast.success(assignmentForm.assignmentId ? 'Assignment updated.' : 'Assignment created.');
      setAssignmentForm({
        ...emptyAssignmentForm,
        partnershipId: selectedPartnership.id,
      });
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save assignment.');
    } finally {
      setIsSavingAssignment(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-semibold text-foreground">Assigned Machines</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Map imported machines once, then assign the relevant machines to {selectedPartnership.name}.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-4">
          <h3 className="font-medium text-foreground">Reporting Machine Directory</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Assign imported Sunze machines to real reporting account/location names before
            partnership reporting uses them.
          </p>
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="machine-account">Account</Label>
                <Input id="machine-account" value={machineForm.accountName} onChange={(event) => setMachineForm({ ...machineForm, accountName: event.target.value })} />
              </div>
              <div>
                <Label htmlFor="machine-location">Location</Label>
                <Input id="machine-location" value={machineForm.locationName} onChange={(event) => setMachineForm({ ...machineForm, locationName: event.target.value })} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="machine-label">Machine label</Label>
                <Input id="machine-label" value={machineForm.machineLabel} onChange={(event) => setMachineForm({ ...machineForm, machineLabel: event.target.value })} />
              </div>
              <div>
                <Label htmlFor="machine-type">Machine type</Label>
                <FieldSelect id="machine-type" value={machineForm.machineType} onChange={(value) => setMachineForm({ ...machineForm, machineType: value as ReportingMachineType })} options={machineTypes} />
              </div>
            </div>
            <div>
              <Label htmlFor="sunze-id">Sunze ID</Label>
              <Input id="sunze-id" value={machineForm.sunzeMachineId} onChange={(event) => setMachineForm({ ...machineForm, sunzeMachineId: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="machine-reason">Reason</Label>
              <Input id="machine-reason" value={machineForm.reason} onChange={(event) => setMachineForm({ ...machineForm, reason: event.target.value })} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={saveMachine} disabled={isSavingMachine}>
                {isSavingMachine ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Settings2 className="mr-2 h-4 w-4" />}
                Save Machine Mapping
              </Button>
              {machineForm.machineId && (
                <Button variant="outline" onClick={() => setMachineForm(emptyMachineForm)}>
                  New Mapping
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background p-4">
          <h3 className="font-medium text-foreground">Assign to this Partnership</h3>
          <div className="mt-4 space-y-3">
            <MachineSelect setup={setup} value={assignmentForm.machineId} onChange={(machineId) => setAssignmentForm({ ...assignmentForm, machineId })} id="assignment-machine" />
            <div>
              <Label htmlFor="assignment-role">Assignment role</Label>
              <FieldSelect id="assignment-role" value={assignmentForm.assignmentRole} onChange={(value) => setAssignmentForm({ ...assignmentForm, assignmentRole: value })} options={assignmentRoles} />
            </div>
            <DateWindowFields
              startId="assignment-start"
              endId="assignment-end"
              startValue={assignmentForm.effectiveStartDate}
              endValue={assignmentForm.effectiveEndDate}
              onStartChange={(value) => setAssignmentForm({ ...assignmentForm, effectiveStartDate: value })}
              onEndChange={(value) => setAssignmentForm({ ...assignmentForm, effectiveEndDate: value })}
            />
            <div>
              <Label htmlFor="assignment-status">Status</Label>
              <FieldSelect id="assignment-status" value={assignmentForm.status} onChange={(value) => setAssignmentForm({ ...assignmentForm, status: value })} options={statuses} />
            </div>
            <div>
              <Label htmlFor="assignment-notes">Notes</Label>
              <Textarea id="assignment-notes" value={assignmentForm.notes} onChange={(event) => setAssignmentForm({ ...assignmentForm, notes: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="assignment-reason">Reason</Label>
              <Input id="assignment-reason" value={assignmentForm.reason} onChange={(event) => setAssignmentForm({ ...assignmentForm, reason: event.target.value })} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={saveAssignment} disabled={isSavingAssignment}>
                {isSavingAssignment ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Save Assignment
              </Button>
              {assignmentForm.assignmentId && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setAssignmentForm({
                      ...emptyAssignmentForm,
                      partnershipId: selectedPartnership.id,
                    })
                  }
                >
                  New Assignment
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-lg border border-border bg-background">
          <ListHeader title="Mapped Machines" count={setup.machines.length} />
          {setup.machines.map((machine) => (
            <Row key={machine.id}>
              <div>
                <div className="font-medium text-foreground">{machine.machine_label}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {machine.account_name} / {machine.location_name} / Sunze: {machine.sunze_machine_id ?? 'n/a'}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => editMachine(machine)}>
                Edit
              </Button>
            </Row>
          ))}
        </div>
        <div className="rounded-lg border border-border bg-background">
          <ListHeader title="Machines in this Partnership" count={partnershipAssignments.length} />
          {partnershipAssignments.length === 0 ? (
            <EmptyRow text="No machines assigned to this partnership yet." />
          ) : (
            partnershipAssignments.map((assignment) => (
              <Row key={assignment.id}>
                <div>
                  <div className="font-medium text-foreground">{assignment.machine_label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatLabel(assignment.assignment_role)} / {formatDate(assignment.effective_start_date)} to {formatDate(assignment.effective_end_date)}
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
      </div>
    </section>
  );
}

type MachineTaxFilter = 'all' | 'missing' | 'no_tax' | 'configured';
type MachineTaxSort = 'machine' | 'account' | 'status' | 'latest_sale';

function MachineTaxSection({
  setup,
  selectedPartnership,
  onRefresh,
}: {
  setup: PartnershipReportingSetup;
  selectedPartnership: ReportingPartnership;
  onRefresh: () => Promise<unknown>;
}) {
  const [taxFilter, setTaxFilter] = useState<MachineTaxFilter>('all');
  const [taxSort, setTaxSort] = useState<MachineTaxSort>('status');
  const [taxDrafts, setTaxDrafts] = useState<Record<string, string>>({});
  const [taxReason, setTaxReason] = useState('Current machine tax rate update');
  const [savingMachineId, setSavingMachineId] = useState<string | null>(null);

  const activeAssignedMachineIds = useMemo(() => {
    return new Set(
      setup.assignments
        .filter(
          (assignment) =>
            assignment.partnership_id === selectedPartnership.id &&
            assignment.status === 'active'
        )
        .map((assignment) => assignment.machine_id)
    );
  }, [selectedPartnership.id, setup.assignments]);

  const taxRows = useMemo(() => {
    const currentDate = today();

    return setup.machines
      .filter((machine) => activeAssignedMachineIds.has(machine.id))
      .map((machine) => {
        const taxRate = setup.taxRates
          .filter(
            (candidate) =>
              candidate.machine_id === machine.id &&
              candidate.status === 'active' &&
              candidate.effective_start_date <= currentDate &&
              (!candidate.effective_end_date || candidate.effective_end_date >= currentDate)
          )
          .sort((left, right) =>
            right.effective_start_date.localeCompare(left.effective_start_date)
          )[0];
        const numericRate = Number(taxRate?.tax_rate_percent ?? NaN);
        const taxStatus = !taxRate ? 'missing' : numericRate === 0 ? 'no_tax' : 'configured';

        return {
          machine,
          taxRate,
          taxStatus,
          draftValue:
            taxDrafts[machine.id] ??
            (taxRate ? String(Number(taxRate.tax_rate_percent)) : ''),
        };
      })
      .filter((row) => taxFilter === 'all' || row.taxStatus === taxFilter)
      .sort((left, right) => {
        if (taxSort === 'account') {
          return `${left.machine.account_name} ${left.machine.location_name}`.localeCompare(
            `${right.machine.account_name} ${right.machine.location_name}`
          );
        }
        if (taxSort === 'latest_sale') {
          return (right.machine.latest_sale_date ?? '').localeCompare(
            left.machine.latest_sale_date ?? ''
          );
        }
        if (taxSort === 'status') {
          return left.taxStatus.localeCompare(right.taxStatus);
        }

        return left.machine.machine_label.localeCompare(right.machine.machine_label);
      });
  }, [activeAssignedMachineIds, setup.machines, setup.taxRates, taxDrafts, taxFilter, taxSort]);

  const saveTaxRate = async (
    machine: PartnershipReportingSetup['machines'][number],
    taxRate: ReportingMachineTaxRate | undefined,
    draftValue: string
  ) => {
    const parsedRate = Number(draftValue);

    if (!draftValue.trim() || Number.isNaN(parsedRate) || parsedRate < 0 || parsedRate > 100) {
      toast.error('Enter a tax rate from 0 to 100. Use 0 for explicit no-tax machines.');
      return;
    }

    if (!taxReason.trim()) {
      toast.error('Reason is required.');
      return;
    }

    setSavingMachineId(machine.id);
    try {
      await upsertReportingMachineTaxRateAdmin({
        taxRateId: taxRate?.id ?? null,
        machineId: machine.id,
        taxRatePercent: parsedRate,
        effectiveStartDate: taxRate?.effective_start_date ?? today(),
        effectiveEndDate: taxRate?.effective_end_date ?? '',
        status: 'active',
        notes: taxRate?.notes ?? '',
        reason: taxReason,
      });
      toast.success(`${machine.machine_label} tax rate updated.`);
      setTaxDrafts((current) => {
        const next = { ...current };
        delete next[machine.id];
        return next;
      });
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save machine tax rate.');
    } finally {
      setSavingMachineId(null);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground">Current Machine Tax Rates</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Update current tax rates inline for machines assigned to {selectedPartnership.name}.
            Effective dates stay in the backend for audit/history.
          </p>
        </div>
        <Badge variant="outline">{taxRows.length} shown</Badge>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-end">
        <div>
          <Label htmlFor="tax-reason">Reason for tax updates</Label>
          <Input
            id="tax-reason"
            value={taxReason}
            onChange={(event) => setTaxReason(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="tax-filter">Filter</Label>
          <select
            id="tax-filter"
            value={taxFilter}
            onChange={(event) => setTaxFilter(event.target.value as MachineTaxFilter)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">All tax states</option>
            <option value="missing">Missing tax</option>
            <option value="no_tax">Explicit no tax</option>
            <option value="configured">Configured tax</option>
          </select>
        </div>
        <div>
          <Label htmlFor="tax-sort">Sort</Label>
          <select
            id="tax-sort"
            value={taxSort}
            onChange={(event) => setTaxSort(event.target.value as MachineTaxSort)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="status">Status</option>
            <option value="machine">Machine</option>
            <option value="account">Account/location</option>
            <option value="latest_sale">Latest sale</option>
          </select>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="min-w-[900px] w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-3 text-left font-semibold">Machine</th>
              <th className="px-3 py-3 text-left font-semibold">Account / Location</th>
              <th className="px-3 py-3 text-left font-semibold">Sunze ID</th>
              <th className="px-3 py-3 text-left font-semibold">Tax status</th>
              <th className="px-3 py-3 text-left font-semibold">Current rate %</th>
              <th className="px-3 py-3 text-left font-semibold">Latest sale</th>
              <th className="px-3 py-3 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {taxRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  {activeAssignedMachineIds.size === 0
                    ? 'Assign machines to this partnership before setting tax rates.'
                    : 'No machines match this tax filter.'}
                </td>
              </tr>
            ) : (
              taxRows.map(({ machine, taxRate, taxStatus, draftValue }) => (
                <tr key={machine.id}>
                  <td className="px-3 py-3 font-medium text-foreground">
                    {machine.machine_label}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {machine.account_name} / {machine.location_name}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {machine.sunze_machine_id ?? 'n/a'}
                  </td>
                  <td className="px-3 py-3">
                    <Badge
                      variant={
                        taxStatus === 'missing'
                          ? 'destructive'
                          : taxStatus === 'no_tax'
                            ? 'secondary'
                            : 'default'
                      }
                    >
                      {taxStatus === 'missing'
                        ? 'Missing'
                        : taxStatus === 'no_tax'
                          ? 'No tax'
                          : 'Configured'}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <Input
                      aria-label={`${machine.machine_label} current tax rate percent`}
                      type="number"
                      step="0.0001"
                      min={0}
                      max={100}
                      value={draftValue}
                      onChange={(event) =>
                        setTaxDrafts((current) => ({
                          ...current,
                          [machine.id]: event.target.value,
                        }))
                      }
                      placeholder="0 or 7.25"
                      className="w-32"
                    />
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {machine.latest_sale_date ?? 'n/a'}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Button
                      size="sm"
                      onClick={() => saveTaxRate(machine, taxRate, draftValue)}
                      disabled={savingMachineId === machine.id}
                    >
                      {savingMachineId === machine.id && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Save
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        A blank row is missing configuration. Enter 0 to mark a machine as intentionally no-tax.
      </p>
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
  const [form, setForm] = useState(emptyRuleForm);
  const [isSaving, setIsSaving] = useState(false);

  const financialRules = useMemo(
    () => setup.financialRules.filter((rule) => rule.partnership_id === selectedPartnership.id),
    [selectedPartnership.id, setup.financialRules]
  );

  useEffect(() => {
    setForm({
      ...emptyRuleForm,
      partnershipId: selectedPartnership.id,
    });
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
      reason: 'Financial rule update',
    });
  };

  const saveRule = async () => {
    if (!form.effectiveStartDate || !form.reason.trim()) {
      toast.error('Effective start date and reason are required.');
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
      });
      toast.success(form.ruleId ? 'Financial rule updated.' : 'Financial rule created.');
      setForm({
        ...emptyRuleForm,
        partnershipId: selectedPartnership.id,
      });
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save financial rule.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-semibold text-foreground">Financial Split Terms</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure how {selectedPartnership.name} converts sales into payout/share reporting.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-lg border border-border bg-background p-4">
          <h3 className="font-medium text-foreground">
            {form.ruleId ? 'Edit Financial Terms' : 'Create Financial Terms'}
          </h3>
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="calculation-model">Calculation model</Label>
              <FieldSelect id="calculation-model" value={form.calculationModel} onChange={(value) => setForm({ ...form, calculationModel: value })} options={calculationModels} />
            </div>
            <div>
              <Label htmlFor="split-base">Split base</Label>
              <FieldSelect id="split-base" value={form.splitBase} onChange={(value) => setForm({ ...form, splitBase: value })} options={splitBases} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="fee-amount">Fee amount</Label>
              <Input id="fee-amount" type="number" step="0.01" value={form.feeAmountDollars} onChange={(event) => setForm({ ...form, feeAmountDollars: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="fee-basis">Fee basis</Label>
              <FieldSelect id="fee-basis" value={form.feeBasis} onChange={(value) => setForm({ ...form, feeBasis: value })} options={feeBases} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cost-amount">Cost amount</Label>
              <Input id="cost-amount" type="number" step="0.01" value={form.costAmountDollars} onChange={(event) => setForm({ ...form, costAmountDollars: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="cost-basis">Cost basis</Label>
              <FieldSelect id="cost-basis" value={form.costBasis} onChange={(value) => setForm({ ...form, costBasis: value })} options={costBases} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="gross-to-net-method">Gross-to-net method</Label>
              <FieldSelect id="gross-to-net-method" value={form.grossToNetMethod} onChange={(value) => setForm({ ...form, grossToNetMethod: value })} options={grossToNetMethods} />
            </div>
            <div>
              <Label htmlFor="deduction-timing">Cost deduction timing</Label>
              <FieldSelect id="deduction-timing" value={form.deductionTiming} onChange={(value) => setForm({ ...form, deductionTiming: value })} options={deductionTimings} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="primary-share">Primary share %</Label>
              <Input id="primary-share" type="number" step="0.01" value={form.primarySharePercent} onChange={(event) => setForm({ ...form, primarySharePercent: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="partner-share">Partner %</Label>
              <Input id="partner-share" type="number" step="0.01" value={form.partnerSharePercent} onChange={(event) => setForm({ ...form, partnerSharePercent: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="bloomjoy-share">Bloomjoy %</Label>
              <Input id="bloomjoy-share" type="number" step="0.01" value={form.bloomjoySharePercent} onChange={(event) => setForm({ ...form, bloomjoySharePercent: event.target.value })} />
            </div>
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
            <FieldSelect id="rule-status" value={form.status} onChange={(value) => setForm({ ...form, status: value })} options={partnershipStatuses} />
          </div>
          <div>
            <Label htmlFor="rule-notes">Notes</Label>
            <Textarea id="rule-notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="rule-reason">Reason</Label>
            <Input id="rule-reason" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveRule} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Save Financial Rule
            </Button>
            {form.ruleId && (
              <Button
                variant="outline"
                onClick={() =>
                  setForm({
                    ...emptyRuleForm,
                    partnershipId: selectedPartnership.id,
                  })
                }
              >
                New Rule
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background">
        <ListHeader title="Financial Terms for this Partnership" count={financialRules.length} />
        {financialRules.length === 0 ? (
          <EmptyRow text="No financial terms configured." />
        ) : (
          financialRules.map((rule) => (
            <Row key={rule.id}>
              <div>
                <div className="font-medium text-foreground">
                  {formatLabel(rule.calculation_model)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Fee {formatMoney(rule.fee_amount_cents)} {formatLabel(rule.fee_basis)} / shares primary {percentFromBasisPoints(rule.fever_share_basis_points)}%, partner {percentFromBasisPoints(rule.partner_share_basis_points)}%, Bloomjoy {percentFromBasisPoints(rule.bloomjoy_share_basis_points)}%
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
      </div>
    </section>
  );
}

function WeeklyPreviewSection({
  selectedPartnership,
}: {
  selectedPartnership: ReportingPartnership;
}) {
  const [weekEndingDate, setWeekEndingDate] = useState(() => getLastCompletedWeekEndingDate(0));
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

    if (
      new Date(`${weekEndingDate}T00:00:00`).getDay() !==
      selectedPartnership.reporting_week_end_day
    ) {
      toast.error(
        `Week ending date must be a ${dayNames[selectedPartnership.reporting_week_end_day]}.`
      );
      return;
    }

    setIsLoading(true);
    try {
      const nextPreview = await previewPartnerWeeklyReportAdmin(
        selectedPartnership.id,
        weekEndingDate
      );
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
      <div>
        <h2 className="font-semibold text-foreground">Weekly Preview</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Preview the partnership report before scheduled delivery.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-background p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <Label htmlFor="week-ending">Week ending</Label>
            <Input id="week-ending" type="date" value={weekEndingDate} onChange={(event) => setWeekEndingDate(event.target.value)} />
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
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-foreground">
                  {selectedPartnership?.name ?? 'Partnership'} weekly preview
                </h2>
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
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              {preview.warnings.map((warning, index) => (
                <div key={`${warning.warningType}-${index}`}>{warning.message}</div>
              ))}
            </div>
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
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor={startId}>Effective start</Label>
        <Input id={startId} type="date" value={startValue} onChange={(event) => onStartChange(event.target.value)} />
      </div>
      <div>
        <Label htmlFor={endId}>Effective end</Label>
        <Input id={endId} type="date" value={endValue} onChange={(event) => onEndChange(event.target.value)} />
      </div>
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

function PartnerSelect({
  setup,
  value,
  onChange,
  id,
}: {
  setup: PartnershipReportingSetup;
  value: string;
  onChange: (partnerId: string) => void;
  id: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>Partner</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Select partner</option>
        {setup.partners.map((partner) => (
          <option key={partner.id} value={partner.id}>
            {partner.name}
          </option>
        ))}
      </select>
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
