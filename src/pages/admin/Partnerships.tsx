import { useMemo, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  fetchPartnershipReportingSetup,
  previewPartnerWeeklyReportAdmin,
  upsertReportingFinancialRuleAdmin,
  upsertReportingMachineAssignmentAdmin,
  upsertReportingMachineTaxRateAdmin,
  upsertReportingPartnerAdmin,
  upsertReportingPartnershipAdmin,
  type PartnerWeeklyReportPreview,
  type PartnershipReportingSetup,
  type ReportingMachinePartnershipAssignment,
  type ReportingMachineTaxRate,
  type ReportingPartner,
  type ReportingPartnership,
  type ReportingPartnershipFinancialRule,
} from '@/lib/partnershipReporting';
import {
  type ReportingMachineType,
  upsertReportingMachineAdmin,
} from '@/lib/reporting';

const today = () => new Date().toISOString().slice(0, 10);

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

const emptyTaxForm = {
  taxRateId: null as string | null,
  machineId: '',
  taxRatePercent: '',
  effectiveStartDate: today(),
  effectiveEndDate: '',
  status: 'active',
  notes: '',
  reason: 'Machine tax rate update',
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
  feverSharePercent: '60',
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
  const {
    data: setup = {
      partners: [],
      partnerships: [],
      machines: [],
      assignments: [],
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

          <Tabs defaultValue="partners" className="mt-6">
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="partners">Partners</TabsTrigger>
              <TabsTrigger value="partnerships">Partnerships</TabsTrigger>
              <TabsTrigger value="machines">Machine Assignments</TabsTrigger>
              <TabsTrigger value="tax">Machine Tax Rates</TabsTrigger>
              <TabsTrigger value="rules">Financial Rules</TabsTrigger>
              <TabsTrigger value="preview">Weekly Preview</TabsTrigger>
            </TabsList>
            {isLoading ? (
              <div className="mt-6 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
                Loading partnership setup...
              </div>
            ) : (
              <>
                <TabsContent value="partners" className="mt-6">
                  <PartnersTab setup={setup} onRefresh={refresh} />
                </TabsContent>
                <TabsContent value="partnerships" className="mt-6">
                  <PartnershipsTab setup={setup} onRefresh={refresh} />
                </TabsContent>
                <TabsContent value="machines" className="mt-6">
                  <MachineAssignmentsTab setup={setup} onRefresh={refresh} />
                </TabsContent>
                <TabsContent value="tax" className="mt-6">
                  <MachineTaxTab setup={setup} onRefresh={refresh} />
                </TabsContent>
                <TabsContent value="rules" className="mt-6">
                  <FinancialRulesTab setup={setup} onRefresh={refresh} />
                </TabsContent>
                <TabsContent value="preview" className="mt-6">
                  <WeeklyPreviewTab setup={setup} />
                </TabsContent>
              </>
            )}
          </Tabs>
        </div>
      </section>
    </AppLayout>
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

function PartnersTab({
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
          {form.partnerId ? 'Edit Partner' : 'Create Partner'}
        </h2>
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
              Save Partner
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
        <ListHeader title="Partners" count={setup.partners.length} />
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

function PartnershipsTab({
  setup,
  onRefresh,
}: {
  setup: PartnershipReportingSetup;
  onRefresh: () => Promise<unknown>;
}) {
  const [form, setForm] = useState(emptyPartnershipForm);
  const [isSaving, setIsSaving] = useState(false);

  const editPartnership = (partnership: ReportingPartnership) => {
    setForm({
      partnershipId: partnership.id,
      name: partnership.name,
      partnershipType: partnership.partnership_type,
      reportingWeekEndDay: String(partnership.reporting_week_end_day),
      timezone: partnership.timezone,
      effectiveStartDate: partnership.effective_start_date,
      effectiveEndDate: partnership.effective_end_date ?? '',
      status: partnership.status,
      notes: partnership.notes ?? '',
      reason: 'Partnership setup update',
    });
  };

  const savePartnership = async () => {
    if (!form.name.trim() || !form.effectiveStartDate || !form.reason.trim()) {
      toast.error('Partnership name, effective start date, and reason are required.');
      return;
    }

    setIsSaving(true);
    try {
      await upsertReportingPartnershipAdmin({
        ...form,
        reportingWeekEndDay: Number(form.reportingWeekEndDay),
      });
      toast.success(form.partnershipId ? 'Partnership updated.' : 'Partnership created.');
      setForm(emptyPartnershipForm);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save partnership.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">
          {form.partnershipId ? 'Edit Partnership' : 'Create Partnership'}
        </h2>
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
          <div className="flex flex-wrap gap-2">
            <Button onClick={savePartnership} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Save Partnership
            </Button>
            {form.partnershipId && (
              <Button variant="outline" onClick={() => setForm(emptyPartnershipForm)}>
                New Partnership
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <ListHeader title="Partnerships" count={setup.partnerships.length} />
        {setup.partnerships.length === 0 ? (
          <EmptyRow text="No partnerships yet." />
        ) : (
          setup.partnerships.map((partnership) => (
            <Row key={partnership.id}>
              <div>
                <div className="font-medium text-foreground">{partnership.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {partnership.partnership_type.replaceAll('_', ' ')} / {formatDate(partnership.effective_start_date)} to {formatDate(partnership.effective_end_date)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={partnership.status === 'active' ? 'default' : 'outline'}>{partnership.status}</Badge>
                <Button variant="outline" size="sm" onClick={() => editPartnership(partnership)}>
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

function MachineAssignmentsTab({
  setup,
  onRefresh,
}: {
  setup: PartnershipReportingSetup;
  onRefresh: () => Promise<unknown>;
}) {
  const [machineForm, setMachineForm] = useState(emptyMachineForm);
  const [assignmentForm, setAssignmentForm] = useState(emptyAssignmentForm);
  const [isSavingMachine, setIsSavingMachine] = useState(false);
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);

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
      partnershipId: assignment.partnership_id,
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
    if (!assignmentForm.machineId || !assignmentForm.partnershipId || !assignmentForm.effectiveStartDate || !assignmentForm.reason.trim()) {
      toast.error('Machine, partnership, effective start date, and reason are required.');
      return;
    }

    setIsSavingAssignment(true);
    try {
      await upsertReportingMachineAssignmentAdmin(assignmentForm);
      toast.success(assignmentForm.assignmentId ? 'Assignment updated.' : 'Assignment created.');
      setAssignmentForm(emptyAssignmentForm);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save assignment.');
    } finally {
      setIsSavingAssignment(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-semibold text-foreground">Machine Mapping</h2>
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

        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-semibold text-foreground">Partnership Assignment</h2>
          <div className="mt-4 space-y-3">
            <MachineSelect setup={setup} value={assignmentForm.machineId} onChange={(machineId) => setAssignmentForm({ ...assignmentForm, machineId })} id="assignment-machine" />
            <PartnershipSelect setup={setup} value={assignmentForm.partnershipId} onChange={(partnershipId) => setAssignmentForm({ ...assignmentForm, partnershipId })} id="assignment-partnership" />
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
                <Button variant="outline" onClick={() => setAssignmentForm(emptyAssignmentForm)}>
                  New Assignment
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-lg border border-border bg-card">
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
        <div className="rounded-lg border border-border bg-card">
          <ListHeader title="Partnership Assignments" count={setup.assignments.length} />
          {setup.assignments.length === 0 ? (
            <EmptyRow text="No machine partnership assignments yet." />
          ) : (
            setup.assignments.map((assignment) => (
              <Row key={assignment.id}>
                <div>
                  <div className="font-medium text-foreground">{assignment.machine_label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {assignment.partnership_name} / {assignment.assignment_role.replaceAll('_', ' ')} / {formatDate(assignment.effective_start_date)} to {formatDate(assignment.effective_end_date)}
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
    </div>
  );
}

function MachineTaxTab({
  setup,
  onRefresh,
}: {
  setup: PartnershipReportingSetup;
  onRefresh: () => Promise<unknown>;
}) {
  const [form, setForm] = useState(emptyTaxForm);
  const [isSaving, setIsSaving] = useState(false);

  const editTaxRate = (taxRate: ReportingMachineTaxRate) => {
    setForm({
      taxRateId: taxRate.id,
      machineId: taxRate.machine_id,
      taxRatePercent: String(taxRate.tax_rate_percent),
      effectiveStartDate: taxRate.effective_start_date,
      effectiveEndDate: taxRate.effective_end_date ?? '',
      status: taxRate.status,
      notes: taxRate.notes ?? '',
      reason: 'Machine tax rate update',
    });
  };

  const saveTaxRate = async () => {
    if (!form.machineId || !form.taxRatePercent || !form.effectiveStartDate || !form.reason.trim()) {
      toast.error('Machine, tax rate, effective start date, and reason are required.');
      return;
    }

    setIsSaving(true);
    try {
      await upsertReportingMachineTaxRateAdmin({
        ...form,
        taxRatePercent: Number(form.taxRatePercent),
      });
      toast.success(form.taxRateId ? 'Machine tax rate updated.' : 'Machine tax rate created.');
      setForm(emptyTaxForm);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save tax rate.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">
          {form.taxRateId ? 'Edit Machine Tax Rate' : 'Create Machine Tax Rate'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tax rates are configured at the machine level with effective dates. They are not
          partnership-level settings.
        </p>
        <div className="mt-4 space-y-3">
          <MachineSelect setup={setup} value={form.machineId} onChange={(machineId) => setForm({ ...form, machineId })} id="tax-machine" />
          <div>
            <Label htmlFor="tax-rate">Tax rate percent</Label>
            <Input id="tax-rate" type="number" step="0.0001" min={0} max={100} value={form.taxRatePercent} onChange={(event) => setForm({ ...form, taxRatePercent: event.target.value })} placeholder="7.25" />
          </div>
          <DateWindowFields
            startId="tax-start"
            endId="tax-end"
            startValue={form.effectiveStartDate}
            endValue={form.effectiveEndDate}
            onStartChange={(value) => setForm({ ...form, effectiveStartDate: value })}
            onEndChange={(value) => setForm({ ...form, effectiveEndDate: value })}
          />
          <div>
            <Label htmlFor="tax-status">Status</Label>
            <FieldSelect id="tax-status" value={form.status} onChange={(value) => setForm({ ...form, status: value })} options={statuses} />
          </div>
          <div>
            <Label htmlFor="tax-notes">Notes</Label>
            <Textarea id="tax-notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="tax-reason">Reason</Label>
            <Input id="tax-reason" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveTaxRate} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Save Machine Tax Rate
            </Button>
            {form.taxRateId && (
              <Button variant="outline" onClick={() => setForm(emptyTaxForm)}>
                New Tax Rate
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <ListHeader title="Machine Tax Rates" count={setup.taxRates.length} />
        {setup.taxRates.length === 0 ? (
          <EmptyRow text="No machine tax rates configured." />
        ) : (
          setup.taxRates.map((taxRate) => (
            <Row key={taxRate.id}>
              <div>
                <div className="font-medium text-foreground">{taxRate.machine_label}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {Number(taxRate.tax_rate_percent).toFixed(4)}% / {formatDate(taxRate.effective_start_date)} to {formatDate(taxRate.effective_end_date)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={taxRate.status === 'active' ? 'default' : 'outline'}>{taxRate.status}</Badge>
                <Button variant="outline" size="sm" onClick={() => editTaxRate(taxRate)}>
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

function FinancialRulesTab({
  setup,
  onRefresh,
}: {
  setup: PartnershipReportingSetup;
  onRefresh: () => Promise<unknown>;
}) {
  const [form, setForm] = useState(emptyRuleForm);
  const [isSaving, setIsSaving] = useState(false);

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
      feverSharePercent: percentFromBasisPoints(rule.fever_share_basis_points),
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
    if (!form.partnershipId || !form.effectiveStartDate || !form.reason.trim()) {
      toast.error('Partnership, effective start date, and reason are required.');
      return;
    }

    setIsSaving(true);
    try {
      await upsertReportingFinancialRuleAdmin({
        ...form,
        feeAmountCents: centsFromDollars(form.feeAmountDollars),
        costAmountCents: centsFromDollars(form.costAmountDollars),
        feverShareBasisPoints: basisPointsFromPercent(form.feverSharePercent),
        partnerShareBasisPoints: basisPointsFromPercent(form.partnerSharePercent),
        bloomjoyShareBasisPoints: basisPointsFromPercent(form.bloomjoySharePercent),
      });
      toast.success(form.ruleId ? 'Financial rule updated.' : 'Financial rule created.');
      setForm(emptyRuleForm);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save financial rule.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">
          {form.ruleId ? 'Edit Financial Rule' : 'Create Financial Rule'}
        </h2>
        <div className="mt-4 space-y-3">
          <PartnershipSelect setup={setup} value={form.partnershipId} onChange={(partnershipId) => setForm({ ...form, partnershipId })} id="rule-partnership" />
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
          <div>
            <Label htmlFor="gross-to-net-method">Gross-to-net method</Label>
            <FieldSelect id="gross-to-net-method" value={form.grossToNetMethod} onChange={(value) => setForm({ ...form, grossToNetMethod: value })} options={grossToNetMethods} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="fever-share">Fever %</Label>
              <Input id="fever-share" type="number" step="0.01" value={form.feverSharePercent} onChange={(event) => setForm({ ...form, feverSharePercent: event.target.value })} />
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
              <Button variant="outline" onClick={() => setForm(emptyRuleForm)}>
                New Rule
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <ListHeader title="Financial Rules" count={setup.financialRules.length} />
        {setup.financialRules.length === 0 ? (
          <EmptyRow text="No financial rules configured." />
        ) : (
          setup.financialRules.map((rule) => (
            <Row key={rule.id}>
              <div>
                <div className="font-medium text-foreground">{rule.partnership_name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {rule.calculation_model.replaceAll('_', ' ')} / fee {formatMoney(rule.fee_amount_cents)} {rule.fee_basis.replaceAll('_', ' ')} / shares {percentFromBasisPoints(rule.fever_share_basis_points)}% + {percentFromBasisPoints(rule.partner_share_basis_points)}%
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
  );
}

function WeeklyPreviewTab({ setup }: { setup: PartnershipReportingSetup }) {
  const [partnershipId, setPartnershipId] = useState(setup.partnerships[0]?.id ?? '');
  const [weekEndingDate, setWeekEndingDate] = useState(today());
  const [preview, setPreview] = useState<PartnerWeeklyReportPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const selectedPartnership = useMemo(
    () => setup.partnerships.find((partnership) => partnership.id === partnershipId),
    [partnershipId, setup.partnerships]
  );

  const loadPreview = async () => {
    if (!partnershipId || !weekEndingDate) {
      toast.error('Partnership and week ending date are required.');
      return;
    }

    setIsLoading(true);
    try {
      const nextPreview = await previewPartnerWeeklyReportAdmin(partnershipId, weekEndingDate);
      setPreview(nextPreview);
      toast.success('Weekly report preview loaded.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to preview report.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_0.5fr_auto] md:items-end">
          <PartnershipSelect setup={setup} value={partnershipId} onChange={setPartnershipId} id="preview-partnership" />
          <div>
            <Label htmlFor="week-ending">Week ending</Label>
            <Input id="week-ending" type="date" value={weekEndingDate} onChange={(event) => setWeekEndingDate(event.target.value)} />
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
              <Metric label="Fever profit" value={formatMoney(preview.summary.fever_profit_cents)} />
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

function PartnershipSelect({
  setup,
  value,
  onChange,
  id,
}: {
  setup: PartnershipReportingSetup;
  value: string;
  onChange: (partnershipId: string) => void;
  id: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>Partnership</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Select partnership</option>
        {setup.partnerships.map((partnership) => (
          <option key={partnership.id} value={partnership.id}>
            {partnership.name}
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
