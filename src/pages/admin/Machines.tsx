import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Check,
  X,
  History,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  fetchPartnershipReportingSetup,
  setReportingMachineTaxRateAdmin,
  type PartnershipReportingSetup,
  type PartnershipSetupMachine,
  type ReportingMachineTaxRate,
} from '@/lib/partnershipReporting';
import {
  fetchAdminAccountSummaries,
  type AdminAccountSummary,
} from '@/lib/adminAccounts';
import {
  fetchRefundManagerSetup,
  setMachineRefundManagersAdmin,
  type RefundManagerSetup,
} from '@/lib/refundOperations';
import {
  lookupReportingUserByEmailAdmin,
  type ReportingMachineType,
  upsertReportingMachineAdmin,
} from '@/lib/reporting';
import { cn } from '@/lib/utils';
import {
  formatLabel,
  formatDate,
  getActiveMachineAssignments,
  getCurrentTaxRate,
  getTaxStatus,
  getTaxStatusLabel,
  machineTypes,
  type TaxStatus,
  today,
} from '@/pages/admin/reportingSetupUi';

type MachineTaxFilter = 'all' | TaxStatus;
type MachineAssignmentFilter = 'all' | 'unassigned' | 'overlap';
type MachineSort = 'status' | 'machine' | 'latest_sale';
type MachineSetupRowViewModel = {
  machine: PartnershipSetupMachine;
  taxRate: ReportingMachineTaxRate | undefined;
  taxStatus: TaxStatus;
  activeAssignments: PartnershipReportingSetup['assignments'];
  machineWarnings: PartnershipReportingSetup['warnings'];
  machineManagerEmails: string[];
  draftValue: string;
};

const setupQueryKey = ['admin-partnership-reporting-setup'];
const refundManagerSetupQueryKey = ['admin-refund-manager-setup'];
const initialReportingTaxStartDate = '2026-01-01';
const hiddenManualMachineAccountName = 'Manual Reporting Machines';
const hiddenFallbackLocationName = 'Unmapped source machines';

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

const emptyRefundManagerSetup: RefundManagerSetup = {
  machines: [],
};

const emptyAccountSummaries: AdminAccountSummary[] = [];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emptyMachineForm = {
  machineId: null as string | null,
  accountName: '',
  locationName: '',
  machineLabel: '',
  machineType: 'unknown' as ReportingMachineType,
  sunzeMachineId: '',
};

const emptyTaxChangeForm = {
  machineId: '',
  taxRatePercent: '',
  effectiveStartDate: today(),
};

const parseTaxFilter = (value: string | null): MachineTaxFilter => {
  if (value === 'missing' || value === 'no_tax' || value === 'configured') return value;
  return 'all';
};

const parseAssignmentFilter = (value: string | null): MachineAssignmentFilter => {
  if (value === 'unassigned' || value === 'overlap') return value;
  return 'all';
};

const normalizeComparableText = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const normalizeEmail = (value: string) => value.trim().toLowerCase();

const uniqueEmails = (values: string[]) =>
  Array.from(new Set(values.map(normalizeEmail).filter(Boolean)));

const emailListsEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((email, index) => email === right[index]);

export default function AdminMachinesPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [taxFilter, setTaxFilter] = useState<MachineTaxFilter>(() => parseTaxFilter(searchParams.get('tax')));
  const [assignmentFilter, setAssignmentFilter] = useState<MachineAssignmentFilter>(() =>
    parseAssignmentFilter(searchParams.get('assignment'))
  );
  const [sort, setSort] = useState<MachineSort>('status');
  const [taxDrafts, setTaxDrafts] = useState<Record<string, string>>({});
  const [savingTaxMachineId, setSavingTaxMachineId] = useState<string | null>(null);
  const [taxChangeForm, setTaxChangeForm] = useState(emptyTaxChangeForm);
  const [isTaxChangeDialogOpen, setIsTaxChangeDialogOpen] = useState(false);
  const [historyMachine, setHistoryMachine] = useState<PartnershipSetupMachine | null>(null);
  const [editingMachine, setEditingMachine] = useState<PartnershipSetupMachine | null>(null);
  const [isMachineDialogOpen, setIsMachineDialogOpen] = useState(false);

  const highlightedMachineId = searchParams.get('machineId');
  const isMachineEditorRequested = searchParams.get('edit') === 'machine';
  const pendingSourceMachineId =
    searchParams.get('externalMachineId') ?? searchParams.get('sunzeMachineId');

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

  const {
    data: refundManagerSetup = emptyRefundManagerSetup,
    isLoading: isRefundManagerSetupLoading,
  } = useQuery({
    queryKey: refundManagerSetupQueryKey,
    queryFn: fetchRefundManagerSetup,
    staleTime: 1000 * 30,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: setupQueryKey }),
      queryClient.invalidateQueries({ queryKey: refundManagerSetupQueryKey }),
    ]);
  };

  const refundManagerSetupByMachineId = useMemo(
    () => new Map(refundManagerSetup.machines.map((machine) => [machine.id, machine])),
    [refundManagerSetup.machines]
  );

  const selectedMachineForEditor =
    editingMachine ??
    (highlightedMachineId
      ? setup.machines.find((machine) => machine.id === highlightedMachineId) ?? null
      : null);
  const isMachineEditorOpen =
    isMachineDialogOpen ||
    (isMachineEditorRequested && (!highlightedMachineId || Boolean(selectedMachineForEditor)));

  useEffect(() => {
    setTaxFilter(parseTaxFilter(searchParams.get('tax')));
    setAssignmentFilter(parseAssignmentFilter(searchParams.get('assignment')));
  }, [searchParams]);

  const machineRows = useMemo(() => {
    const currentDate = today();
    const normalizedSearch = search.trim().toLowerCase();

    return setup.machines
      .map((machine) => {
        const taxRate = getCurrentTaxRate(setup.taxRates, machine.id, currentDate);
        const taxStatus = getTaxStatus(taxRate);
        const activeAssignments = getActiveMachineAssignments(setup, machine.id, currentDate);
        const machineWarnings = setup.warnings.filter((warning) => warning.machineId === machine.id);
        const machineManagerEmails = uniqueEmails(
          refundManagerSetupByMachineId.get(machine.id)?.managerEmails ?? []
        );

        return {
          machine,
          taxRate,
          taxStatus,
          activeAssignments,
          machineWarnings,
          machineManagerEmails,
          draftValue: taxDrafts[machine.id] ?? (taxRate ? String(Number(taxRate.tax_rate_percent)) : ''),
        };
      })
      .filter((row) => {
        if (taxFilter === 'all') return true;
        if (taxFilter === 'missing') {
          return row.activeAssignments.length > 0 && row.taxStatus === 'missing';
        }
        return row.taxStatus === taxFilter;
      })
      .filter((row) => {
        if (assignmentFilter === 'all') return true;
        if (assignmentFilter === 'unassigned') return row.activeAssignments.length === 0;
        return (
          row.activeAssignments.length > 1 ||
          row.machineWarnings.some(
            (warning) => warning.warningType === 'overlapping_partnership_assignments'
          )
        );
      })
      .filter((row) => {
        if (!normalizedSearch) return true;
        return [
          row.machine.machine_label,
          row.machine.sunze_machine_id ?? '',
          row.activeAssignments.map((assignment) => assignment.partnership_name).join(' '),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedSearch);
      })
      .sort((left, right) => {
        if (sort === 'machine') return left.machine.machine_label.localeCompare(right.machine.machine_label);
        if (sort === 'latest_sale') {
          return (right.machine.latest_sale_date ?? '').localeCompare(left.machine.latest_sale_date ?? '');
        }
        return left.taxStatus.localeCompare(right.taxStatus);
      });
  }, [assignmentFilter, refundManagerSetupByMachineId, search, setup, taxDrafts, taxFilter, sort]);

  const readinessCounts = useMemo(() => {
    const currentDate = today();
    const missingTax = setup.machines.filter(
      (machine) =>
        getActiveMachineAssignments(setup, machine.id, currentDate).length > 0 &&
        getTaxStatus(getCurrentTaxRate(setup.taxRates, machine.id, currentDate)) === 'missing'
    ).length;
    const overlappingAssignments = setup.warnings.filter(
      (warning) => warning.warningType === 'overlapping_partnership_assignments'
    ).length;

    return { missingTax, overlappingAssignments };
  }, [setup]);

  const updateTaxFilter = (nextFilter: MachineTaxFilter) => {
    setTaxFilter(nextFilter);
    const nextParams = new URLSearchParams(searchParams);
    if (nextFilter === 'all') {
      nextParams.delete('tax');
    } else {
      nextParams.set('tax', nextFilter);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const updateAssignmentFilter = (nextFilter: MachineAssignmentFilter) => {
    setAssignmentFilter(nextFilter);
    const nextParams = new URLSearchParams(searchParams);
    if (nextFilter === 'all') {
      nextParams.delete('assignment');
    } else {
      nextParams.set('assignment', nextFilter);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const openCreateMachine = () => {
    setEditingMachine(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('machineId');
    nextParams.delete('sunzeMachineId');
    nextParams.delete('sunzeMachineName');
    nextParams.delete('externalMachineId');
    nextParams.delete('externalMachineName');
    nextParams.set('edit', 'machine');
    setSearchParams(nextParams, { replace: true });
    setIsMachineDialogOpen(true);
  };

  const openEditMachine = (machine: PartnershipSetupMachine) => {
    setEditingMachine(machine);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('machineId', machine.id);
    nextParams.delete('sunzeMachineId');
    nextParams.delete('sunzeMachineName');
    nextParams.delete('externalMachineId');
    nextParams.delete('externalMachineName');
    nextParams.set('edit', 'machine');
    setSearchParams(nextParams, { replace: true });
    setIsMachineDialogOpen(true);
  };

  const closeMachineDialog = (open: boolean) => {
    setIsMachineDialogOpen(open);
    if (!open) {
      setEditingMachine(null);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('machineId');
      nextParams.delete('sunzeMachineId');
      nextParams.delete('sunzeMachineName');
      nextParams.delete('externalMachineId');
      nextParams.delete('externalMachineName');
      nextParams.delete('edit');
      setSearchParams(nextParams, { replace: true });
    }
  };

  const openTaxChangeDialog = (machine: PartnershipSetupMachine, taxRate?: ReportingMachineTaxRate) => {
    setTaxChangeForm({
      machineId: machine.id,
      taxRatePercent: taxRate ? String(Number(taxRate.tax_rate_percent)) : '',
      effectiveStartDate: today(),
    });
    setIsTaxChangeDialogOpen(true);
  };

  const closeTaxChangeDialog = (open: boolean) => {
    setIsTaxChangeDialogOpen(open);
    if (!open) {
      setTaxChangeForm(emptyTaxChangeForm);
    }
  };

  const taxHistoryRates = useMemo(
    () =>
      historyMachine
        ? setup.taxRates
            .filter((taxRate) => taxRate.machine_id === historyMachine.id)
            .sort((left, right) => right.effective_start_date.localeCompare(left.effective_start_date))
        : [],
    [historyMachine, setup.taxRates]
  );

  const saveTaxRate = async (
    machine: PartnershipSetupMachine,
    taxRate: ReportingMachineTaxRate | undefined,
    draftValue: string
  ) => {
    const parsedRate = Number(draftValue);

    if (!draftValue.trim() || Number.isNaN(parsedRate) || parsedRate < 0 || parsedRate > 100) {
      toast.error('Enter a tax rate from 0 to 100. Use 0 for explicit no-tax machines.');
      return;
    }

    setSavingTaxMachineId(machine.id);
    try {
      await setReportingMachineTaxRateAdmin({
        machineId: machine.id,
        taxRatePercent: parsedRate,
        effectiveStartDate: taxRate?.effective_start_date ?? initialReportingTaxStartDate,
        reason: taxRate
          ? 'Reporting tax rate updated from Machines admin'
          : 'Initial reporting tax rate documented from Machines admin',
      });
      toast.success(`${machine.machine_label} tax rate updated.`);
      setTaxDrafts((current) => {
        const nextDrafts = { ...current };
        delete nextDrafts[machine.id];
        return nextDrafts;
      });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save machine tax rate.');
    } finally {
      setSavingTaxMachineId(null);
    }
  };

  const saveTaxChange = async () => {
    const machine = setup.machines.find((candidate) => candidate.id === taxChangeForm.machineId);
    const parsedRate = Number(taxChangeForm.taxRatePercent);

    if (!machine) {
      toast.error('Select a machine before recording a tax change.');
      return;
    }

    if (
      !taxChangeForm.taxRatePercent.trim() ||
      Number.isNaN(parsedRate) ||
      parsedRate < 0 ||
      parsedRate > 100
    ) {
      toast.error('Enter a tax rate from 0 to 100. Use 0 for explicit no-tax machines.');
      return;
    }

    if (!taxChangeForm.effectiveStartDate) {
      toast.error('Choose when the new reporting tax rate applies from.');
      return;
    }

    setSavingTaxMachineId(machine.id);
    try {
      await setReportingMachineTaxRateAdmin({
        machineId: machine.id,
        taxRatePercent: parsedRate,
        effectiveStartDate: taxChangeForm.effectiveStartDate,
        reason: 'Reporting tax rate change recorded from Machines admin',
      });
      toast.success(`${machine.machine_label} tax change recorded.`);
      closeTaxChangeDialog(false);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to record tax change.');
    } finally {
      setSavingTaxMachineId(null);
    }
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
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground">Machines</h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                Manage machine labels, external machine IDs, machine managers, assignment readiness,
                and reporting tax rates. Report membership is assigned from Partnerships.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={refresh} disabled={isFetching}>
                {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
              <Button onClick={openCreateMachine}>
                <Plus className="mr-2 h-4 w-4" />
                New Manual Machine
              </Button>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Unable to load machine setup.
            </div>
          )}

          {pendingSourceMachineId && (
            <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Imported machine setup now happens from Reporting Operations so the report assignment,
              tax setup, and queued sales are handled together.
            </div>
          )}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <ReadinessCard
              label="Assigned machines missing tax"
              value={readinessCounts.missingTax}
              description="Only machines assigned to partner reports need reporting tax."
              actionLabel="Show missing"
              onAction={() => updateTaxFilter('missing')}
              isWarning={readinessCounts.missingTax > 0}
            />
            <ReadinessCard
              label="Assignment overlaps"
              value={readinessCounts.overlappingAssignments}
              description="A machine is assigned to more than one active report window."
              actionLabel="Review rows"
              onAction={() => updateAssignmentFilter('overlap')}
              isWarning={readinessCounts.overlappingAssignments > 0}
            />
          </div>

          <div className="mt-6 rounded-lg border border-border bg-card p-4">
            <div className="mb-4 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              Reporting tax rates are used only for partner report estimates. They do not set
              machine prices or replace the accounting tax workflow. Machines without a partnership
              assignment are not included in partner reports, and that is a normal state.
            </div>
            <div className="grid gap-3 xl:grid-cols-[1fr_auto_auto_auto] xl:items-end">
              <div>
                <Label htmlFor="machine-search">Search machines</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="machine-search"
                    className="pl-9"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Machine, external machine ID, partnership"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="tax-filter">Tax status</Label>
                <select
                  id="tax-filter"
                  value={taxFilter}
                  onChange={(event) => updateTaxFilter(event.target.value as MachineTaxFilter)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All tax states</option>
                  <option value="missing">Missing tax for assigned machines</option>
                  <option value="no_tax">Explicit no tax</option>
                  <option value="configured">Configured tax</option>
                </select>
              </div>
              <div>
                <Label htmlFor="machine-sort">Sort</Label>
                <select
                  id="machine-sort"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as MachineSort)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="status">Tax status</option>
                  <option value="machine">Machine</option>
                  <option value="latest_sale">Latest sale</option>
                </select>
              </div>
              <div>
                <Label htmlFor="assignment-filter">Partner report status</Label>
                <select
                  id="assignment-filter"
                  value={assignmentFilter}
                  onChange={(event) => updateAssignmentFilter(event.target.value as MachineAssignmentFilter)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All machines</option>
                  <option value="unassigned">Not in partner reports</option>
                  <option value="overlap">Assignment overlaps</option>
                </select>
              </div>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border p-4">
              <h2 className="font-semibold text-foreground">Machine Setup</h2>
              <Badge variant="outline">{machineRows.length}</Badge>
            </div>

            {isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading machines...</div>
            ) : machineRows.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No machines match this filter.</div>
            ) : (
              <div role="table" aria-label="Machine setup">
                <div
                  role="row"
                  className="hidden border-b border-border bg-muted/40 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground xl:grid xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,1.05fr)] xl:gap-4"
                >
                  <div role="columnheader">Machine</div>
                  <div role="columnheader">Partner reports</div>
                  <div role="columnheader">Reporting tax</div>
                  <div role="columnheader">Activity</div>
                  <div role="columnheader" className="text-right">Actions</div>
                </div>
                <div role="rowgroup" className="divide-y divide-border bg-background">
                  {machineRows.map((row) => (
                    <MachineSetupRow
                      key={row.machine.id}
                      row={row}
                      taxHistoryCount={
                        setup.taxRates.filter((rate) => rate.machine_id === row.machine.id).length
                      }
                      isHighlighted={highlightedMachineId === row.machine.id}
                      isSavingTax={savingTaxMachineId === row.machine.id}
                      onEdit={openEditMachine}
                      onShowHistory={setHistoryMachine}
                      onOpenTaxChange={openTaxChangeDialog}
                      onSaveTax={saveTaxRate}
                      onTaxDraftChange={(machineId, value) =>
                        setTaxDrafts((current) => ({
                          ...current,
                          [machineId]: value,
                        }))
                      }
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <MachineDialog
        open={isMachineEditorOpen}
        onOpenChange={closeMachineDialog}
        machine={selectedMachineForEditor}
        machines={setup.machines}
        refundManagerSetup={
          selectedMachineForEditor
            ? refundManagerSetupByMachineId.get(selectedMachineForEditor.id) ?? null
            : null
        }
        isRefundManagerSetupLoading={isRefundManagerSetupLoading}
        onSaved={refresh}
      />
      <TaxChangeDialog
        open={isTaxChangeDialogOpen}
        onOpenChange={closeTaxChangeDialog}
        form={taxChangeForm}
        setForm={setTaxChangeForm}
        machine={setup.machines.find((machine) => machine.id === taxChangeForm.machineId) ?? null}
        isSaving={Boolean(taxChangeForm.machineId && savingTaxMachineId === taxChangeForm.machineId)}
        onSave={saveTaxChange}
      />
      <Sheet open={Boolean(historyMachine)} onOpenChange={(open) => !open && setHistoryMachine(null)}>
        <SheetContent className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Reporting tax history</SheetTitle>
            <SheetDescription>
              {historyMachine
                ? `${historyMachine.machine_label} reporting tax rates used for historical partner reports.`
                : 'Machine reporting tax rates used for historical partner reports.'}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 grid gap-3">
            {taxHistoryRates.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                No reporting tax rates have been saved for this machine.
              </div>
            ) : (
              taxHistoryRates.map((taxRate) => (
                <div key={taxRate.id} className="rounded-md border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-foreground">
                        {Number(taxRate.tax_rate_percent).toFixed(2)}%
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Applies {formatDate(taxRate.effective_start_date)}
                        {taxRate.effective_end_date
                          ? ` through ${formatDate(taxRate.effective_end_date)}`
                          : ' onward'}
                      </div>
                    </div>
                    <Badge variant={taxRate.status === 'active' ? 'default' : 'outline'}>
                      {formatLabel(taxRate.status)}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}

function MachineSetupRow({
  row,
  taxHistoryCount,
  isHighlighted,
  isSavingTax,
  onEdit,
  onShowHistory,
  onOpenTaxChange,
  onSaveTax,
  onTaxDraftChange,
}: {
  row: MachineSetupRowViewModel;
  taxHistoryCount: number;
  isHighlighted: boolean;
  isSavingTax: boolean;
  onEdit: (machine: PartnershipSetupMachine) => void;
  onShowHistory: (machine: PartnershipSetupMachine) => void;
  onOpenTaxChange: (machine: PartnershipSetupMachine, taxRate?: ReportingMachineTaxRate) => void;
  onSaveTax: (
    machine: PartnershipSetupMachine,
    taxRate: ReportingMachineTaxRate | undefined,
    draftValue: string
  ) => void;
  onTaxDraftChange: (machineId: string, value: string) => void;
}) {
  const { machine, taxRate, taxStatus, activeAssignments, machineWarnings, machineManagerEmails, draftValue } = row;
  const hasMissingRequiredTax = activeAssignments.length > 0 && taxStatus === 'missing';
  const hasAssignmentOverlap = machineWarnings.some(
    (warning) => warning.warningType === 'overlapping_partnership_assignments'
  );
  const hasActionableWarning = hasMissingRequiredTax || hasAssignmentOverlap;
  const taxStatusLabel =
    activeAssignments.length === 0 && taxStatus === 'missing'
      ? 'Not required'
      : getTaxStatusLabel(taxStatus);
  const taxBadgeVariant =
    activeAssignments.length === 0 && taxStatus === 'missing'
      ? 'outline'
      : taxStatus === 'missing'
        ? 'destructive'
        : taxStatus === 'no_tax'
          ? 'secondary'
          : 'default';

  return (
    <div
      role="row"
      className={cn(
        'grid gap-4 p-4 text-sm md:grid-cols-2 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,1.05fr)]',
        isHighlighted ? 'bg-primary/5' : 'bg-background'
      )}
    >
      <div role="cell" className="min-w-0">
        <CellLabel>Machine</CellLabel>
        <div className="font-medium leading-5 text-foreground">{machine.machine_label}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{formatLabel(machine.machine_type)}</Badge>
          {hasActionableWarning && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5" />
              Needs setup
            </span>
          )}
        </div>
        <dl className="mt-3 grid gap-1.5 text-xs text-muted-foreground">
          <div className="grid gap-0.5 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
            <dt className="font-medium text-foreground/70">External ID</dt>
            <dd className="min-w-0 break-all">{machine.sunze_machine_id ?? 'Not mapped'}</dd>
          </div>
          <div className="grid gap-0.5 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
            <dt className="font-medium text-foreground/70">Account</dt>
            <dd className="min-w-0 break-words">{machine.account_name || 'n/a'}</dd>
          </div>
          <div className="grid gap-0.5 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
            <dt className="font-medium text-foreground/70">Machine Managers</dt>
            <dd className="min-w-0 break-words">
              {machineManagerEmails.length > 0 ? machineManagerEmails.join(', ') : 'None assigned'}
            </dd>
          </div>
        </dl>
      </div>

      <div role="cell" className="min-w-0">
        <CellLabel>Partner reports</CellLabel>
        {activeAssignments.length === 0 ? (
          <Badge variant="outline" className="whitespace-normal text-left">
            Not in partner reports
          </Badge>
        ) : (
          <div className="grid gap-1.5">
            {activeAssignments.map((assignment) => (
              <Badge
                key={assignment.id}
                variant="secondary"
                className="w-fit max-w-full whitespace-normal text-left"
              >
                {assignment.partnership_name}
              </Badge>
            ))}
          </div>
        )}
        {hasAssignmentOverlap && (
          <p className="mt-2 text-xs text-amber-700">
            Assigned to overlapping active report windows.
          </p>
        )}
      </div>

      <div role="cell" className="min-w-0">
        <CellLabel>Reporting tax</CellLabel>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={taxBadgeVariant}>{taxStatusLabel}</Badge>
          {taxRate && (
            <span className="text-xs text-muted-foreground">
              Current {Number(taxRate.tax_rate_percent).toFixed(2)}%
            </span>
          )}
        </div>
        <div className="mt-2 flex max-w-xs items-center gap-2">
          <Input
            aria-label={`${machine.machine_label} reporting tax rate percent`}
            type="number"
            step="0.01"
            min={0}
            max={100}
            value={draftValue}
            onChange={(event) => onTaxDraftChange(machine.id, event.target.value)}
            placeholder={activeAssignments.length === 0 ? 'Optional' : 'Missing'}
            className="h-9 w-24"
          />
          <Button
            size="sm"
            onClick={() => onSaveTax(machine, taxRate, draftValue)}
            disabled={isSavingTax}
            className="shrink-0"
          >
            {isSavingTax && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </div>

      <div role="cell" className="min-w-0">
        <CellLabel>Activity</CellLabel>
        <div className="text-sm text-foreground">{machine.latest_sale_date ?? 'No sales yet'}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Status {formatLabel(machine.status || 'unknown')}
        </div>
      </div>

      <div role="cell" className="min-w-0">
        <CellLabel className="xl:text-right">Actions</CellLabel>
        <div className="flex flex-wrap gap-2 xl:justify-end">
          <Button variant="outline" size="sm" onClick={() => onEdit(machine)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onShowHistory(machine)}
            disabled={taxHistoryCount === 0}
          >
            <History className="mr-2 h-4 w-4" />
            History
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenTaxChange(machine, taxRate)}>
            <CalendarClock className="mr-2 h-4 w-4" />
            Rate Change
          </Button>
        </div>
      </div>
    </div>
  );
}

function CellLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground xl:sr-only',
        className
      )}
    >
      {children}
    </div>
  );
}

function ReadinessCard({
  label,
  value,
  description,
  actionLabel,
  isWarning,
  onAction,
}: {
  label: string;
  value: number;
  description?: string;
  actionLabel: string;
  isWarning: boolean;
  onAction?: () => void;
}) {
  return (
    <div className={`rounded-lg border p-4 ${isWarning ? 'border-amber-300 bg-amber-50' : 'border-border bg-card'}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold text-foreground">{value}</div>
      {description && <div className="mt-1 text-xs text-muted-foreground">{description}</div>}
      {onAction ? (
        <Button variant="outline" size="sm" className="mt-3" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : (
        <div className="mt-3 text-xs text-muted-foreground">{actionLabel}</div>
      )}
    </div>
  );
}

function TaxChangeDialog({
  open,
  onOpenChange,
  form,
  setForm,
  machine,
  isSaving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: typeof emptyTaxChangeForm;
  setForm: (form: typeof emptyTaxChangeForm) => void;
  machine: PartnershipSetupMachine | null;
  isSaving: boolean;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Rate Change</DialogTitle>
          <DialogDescription>
            Use this when a machine moves or a jurisdiction changes. The previous reporting tax
            rate will close automatically the day before this rate applies.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
            <div className="text-xs font-medium uppercase text-muted-foreground">Machine</div>
            <div className="mt-1 font-medium text-foreground">{machine?.machine_label ?? 'Select a machine'}</div>
          </div>
          <div>
            <Label htmlFor="tax-change-rate">New reporting tax %</Label>
            <Input
              id="tax-change-rate"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={form.taxRatePercent}
              onChange={(event) => setForm({ ...form, taxRatePercent: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="tax-change-start">Applies from</Label>
            <Input
              id="tax-change-start"
              type="date"
              value={form.effectiveStartDate}
              onChange={(event) => setForm({ ...form, effectiveStartDate: event.target.value })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              For initial setup, use the inline table save. It applies documented rates from 01/01/2026.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Record Change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MachineDialog({
  open,
  onOpenChange,
  machine,
  machines,
  refundManagerSetup,
  isRefundManagerSetupLoading,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machine: PartnershipSetupMachine | null;
  machines: PartnershipSetupMachine[];
  refundManagerSetup: RefundManagerSetup['machines'][number] | null;
  isRefundManagerSetupLoading: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const [form, setForm] = useState(emptyMachineForm);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedMachineManagerEmails, setSelectedMachineManagerEmails] = useState<string[]>([]);
  const [managerSearch, setManagerSearch] = useState('');
  const [isAddingMachineManager, setIsAddingMachineManager] = useState(false);
  const [isSavingMachineManagers, setIsSavingMachineManagers] = useState(false);
  const [machineManagerSaveState, setMachineManagerSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const loadedMachineManagerKeyRef = useRef('');
  const savedMachineManagerEmails = useMemo(
    () => uniqueEmails(refundManagerSetup?.managerEmails ?? []),
    [refundManagerSetup]
  );
  const normalizedManagerSearch = normalizeEmail(managerSearch);
  const selectedMachineManagerSet = useMemo(
    () => new Set(selectedMachineManagerEmails),
    [selectedMachineManagerEmails]
  );
  const {
    data: managerSuggestions = emptyAccountSummaries,
    isFetching: isSearchingMachineManagers,
    error: managerSearchError,
  } = useQuery({
    queryKey: ['admin-machine-manager-search', normalizedManagerSearch],
    queryFn: () => fetchAdminAccountSummaries(normalizedManagerSearch),
    enabled: open && Boolean(form.machineId) && normalizedManagerSearch.length >= 3,
    staleTime: 1000 * 30,
  });
  const visibleManagerSuggestions = useMemo(
    () =>
      managerSuggestions
        .filter((account) => account.customer_email)
        .filter((account) => !selectedMachineManagerSet.has(normalizeEmail(account.customer_email ?? '')))
        .slice(0, 5),
    [managerSuggestions, selectedMachineManagerSet]
  );

  useEffect(() => {
    if (!open) return;
    if (!machine) {
      setForm({
        ...emptyMachineForm,
        accountName: hiddenManualMachineAccountName,
        locationName: hiddenFallbackLocationName,
      });
      return;
    }

    setForm({
      machineId: machine.id,
      accountName: machine.account_name || hiddenManualMachineAccountName,
      locationName: machine.location_name,
      machineLabel: machine.machine_label,
      machineType: machine.machine_type,
      sunzeMachineId: machine.sunze_machine_id ?? '',
    });
  }, [machine, open]);

  useEffect(() => {
    if (!open) return;
    const nextLoadedKey = `${form.machineId ?? 'new'}:${savedMachineManagerEmails.join('\n')}`;
    if (loadedMachineManagerKeyRef.current === nextLoadedKey) return;
    loadedMachineManagerKeyRef.current = nextLoadedKey;
    if (!emailListsEqual(selectedMachineManagerEmails, savedMachineManagerEmails)) {
      setSelectedMachineManagerEmails(savedMachineManagerEmails);
      setMachineManagerSaveState('idle');
    }
    setManagerSearch('');
  }, [form.machineId, open, savedMachineManagerEmails, selectedMachineManagerEmails]);

  const saveMachine = async () => {
    if (!form.machineLabel.trim()) {
      toast.error('Machine label is required.');
      return;
    }

    const accountName =
      form.accountName.trim() || machine?.account_name || hiddenManualMachineAccountName;
    const locationName =
      form.locationName.trim() || machine?.location_name || hiddenFallbackLocationName;
    const machineLabel = form.machineLabel.trim();
    const sunzeMachineId = form.sunzeMachineId.trim();
    const duplicateSunze = sunzeMachineId
      ? machines.find(
          (candidate) =>
            candidate.id !== form.machineId &&
            normalizeComparableText(candidate.sunze_machine_id ?? '') === normalizeComparableText(sunzeMachineId)
        )
      : null;
    if (duplicateSunze) {
      toast.error('This external machine ID is already assigned to another machine.');
      return;
    }

    setIsSaving(true);
    try {
      await upsertReportingMachineAdmin({
        ...form,
        accountName,
        locationName,
        machineLabel,
        sunzeMachineId: sunzeMachineId || null,
        reason: form.machineId ? 'Reporting machine identity updated' : 'Reporting machine created',
      });
      toast.success(form.machineId ? 'Machine updated.' : 'Machine created.');
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save machine.');
    } finally {
      setIsSaving(false);
    }
  };

  const persistMachineManagerEmails = async (
    nextEmails: string[],
    successMessage: string
  ) => {
    if (!form.machineId) return false;

    if (nextEmails.length > 3) {
      toast.error('Each machine can have up to 3 machine managers.');
      return false;
    }

    const previousEmails = selectedMachineManagerEmails;
    setSelectedMachineManagerEmails(nextEmails);
    setIsSavingMachineManagers(true);
    setMachineManagerSaveState('idle');

    try {
      await setMachineRefundManagersAdmin({
        machineId: form.machineId,
        managerEmails: nextEmails,
        reason: 'Machine manager assignment updated from Admin Machines',
      });
      setMachineManagerSaveState('saved');
      toast.success(successMessage);
      await onSaved();
      return true;
    } catch (error) {
      setSelectedMachineManagerEmails(previousEmails);
      setMachineManagerSaveState('error');
      toast.error(error instanceof Error ? error.message : 'Unable to save machine managers.');
      return false;
    } finally {
      setIsSavingMachineManagers(false);
    }
  };

  const addMachineManagerEmail = async (email: string, options: { verifyAuthUser?: boolean } = {}) => {
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail) return;

    if (!emailPattern.test(normalizedEmail)) {
      toast.error('Enter a valid manager email address.');
      return;
    }

    if (selectedMachineManagerSet.has(normalizedEmail)) {
      setManagerSearch('');
      return;
    }

    if (selectedMachineManagerEmails.length >= 3) {
      toast.error('Each machine can have up to 3 machine managers.');
      return;
    }

    setIsAddingMachineManager(true);
    try {
      if (options.verifyAuthUser ?? true) {
        const person = await lookupReportingUserByEmailAdmin(normalizedEmail);
        if (!person.userEmail) {
          throw new Error('This authenticated user does not have an email on file.');
        }
      }
      const nextEmails = uniqueEmails([...selectedMachineManagerEmails, normalizedEmail]);
      const saved = await persistMachineManagerEmails(nextEmails, 'Machine manager added.');
      if (saved) {
        setManagerSearch('');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to find an authenticated user for that email.');
    } finally {
      setIsAddingMachineManager(false);
    }
  };

  const removeMachineManagerEmail = (email: string) => {
    const nextEmails = selectedMachineManagerEmails.filter((entry) => entry !== email);
    void persistMachineManagerEmails(nextEmails, 'Machine manager removed.');
  };

  const machineManagerCount = selectedMachineManagerEmails.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{form.machineId ? 'Edit Machine' : 'New Manual Machine'}</SheetTitle>
          <SheetDescription>
            Manage machine identity and reporting account. Report membership is assigned from
            Partnerships, and imported machines with queued sales are set up from Reporting
            Operations.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="machine-label">Machine label / alias</Label>
            <Input
              id="machine-label"
              value={form.machineLabel}
              onChange={(event) => setForm({ ...form, machineLabel: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="machine-account">Reporting account</Label>
            <Input
              id="machine-account"
              value={form.accountName}
              onChange={(event) => setForm({ ...form, accountName: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="machine-type">Machine type</Label>
            <select
              id="machine-type"
              value={form.machineType}
              onChange={(event) => setForm({ ...form, machineType: event.target.value as ReportingMachineType })}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {machineTypes.map((machineType) => (
                <option key={machineType} value={machineType}>
                  {formatLabel(machineType)}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="sunze-id">External machine ID</Label>
            <Input
              id="sunze-id"
              value={form.sunzeMachineId || 'Not mapped from a provider import yet'}
              readOnly
              aria-readonly="true"
            />
          </div>
        </div>
        {form.machineId && (
          <div className="mt-6 rounded-lg border border-border bg-muted/15 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-semibold text-foreground">Machine Managers</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Select the people responsible for this machine. They can handle customer
                  inquiries, refund review, and machine follow-up from Portal &gt; Refunds.
                </p>
              </div>
              <Badge variant="outline">
                {machineManagerCount === 0
                  ? 'No managers assigned'
                  : machineManagerCount === 1
                    ? '1 manager assigned'
                    : `${machineManagerCount} managers assigned`}
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {isSavingMachineManagers ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving changes...
                </span>
              ) : machineManagerSaveState === 'saved' ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Saved
                </span>
              ) : machineManagerSaveState === 'error' ? (
                <span className="inline-flex items-center gap-1.5 text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Last change was not saved
                </span>
              ) : (
                <span>Machine Manager changes save as soon as you add or remove someone.</span>
              )}
            </div>

            <div className="mt-4 grid gap-4">
              {isRefundManagerSetupLoading && (
                <div className="rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                  Loading current machine manager assignments...
                </div>
              )}
              <div>
                <Label htmlFor="machine-manager-search">People</Label>
                <div className="mt-2 rounded-md border border-input bg-background p-2">
                  {selectedMachineManagerEmails.length > 0 ? (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {selectedMachineManagerEmails.map((email) => (
                        <span
                          key={email}
                          className="inline-flex min-h-8 max-w-full items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
                        >
                          <span className="truncate">{email}</span>
                          <button
                            type="button"
                            onClick={() => removeMachineManagerEmail(email)}
                            disabled={isSavingMachineManagers || isAddingMachineManager}
                            className="rounded-full p-0.5 text-primary/70 hover:bg-primary/15 hover:text-primary"
                            aria-label={`Remove ${email}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mb-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                      No Machine Managers assigned yet.
                    </p>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="machine-manager-search"
                        value={managerSearch}
                        onChange={(event) => setManagerSearch(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            if (isAddingMachineManager || isSavingMachineManagers || machineManagerCount >= 3) {
                              return;
                            }
                            void addMachineManagerEmail(managerSearch);
                          }
                        }}
                        className="pl-9"
                        placeholder="Search or enter an email"
                        disabled={isAddingMachineManager || isSavingMachineManagers || machineManagerCount >= 3}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void addMachineManagerEmail(managerSearch)}
                      disabled={
                        isAddingMachineManager ||
                        isSavingMachineManagers ||
                        machineManagerCount >= 3 ||
                        !managerSearch.trim()
                      }
                    >
                      {isAddingMachineManager ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="mr-2 h-4 w-4" />
                      )}
                      Add
                    </Button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  One manager is enough. Add up to three authenticated Bloomjoy users.
                </p>
                {managerSearchError && (
                  <p className="mt-2 text-sm text-destructive">Unable to search matching users.</p>
                )}
                {managerSearch.trim().length >= 3 && (
                  <div className="mt-2 rounded-md border border-border bg-background">
                    <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Matching users
                      </span>
                      {isSearchingMachineManagers && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    {visibleManagerSuggestions.length === 0 && !isSearchingMachineManagers ? (
                      <p className="px-3 py-3 text-sm text-muted-foreground">
                        No matching account user found. Enter the full email and choose Add if the
                        person already has a Bloomjoy login.
                      </p>
                    ) : (
                      <div className="divide-y divide-border">
                        {visibleManagerSuggestions.map((account) => {
                          const email = normalizeEmail(account.customer_email ?? '');

                          return (
                            <button
                              key={account.user_id}
                              type="button"
                              onClick={() => void addMachineManagerEmail(email, { verifyAuthUser: false })}
                              disabled={isSavingMachineManagers || isAddingMachineManager}
                              className="flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-muted/30"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-foreground">
                                  {email}
                                </span>
                                <span className="block text-xs text-muted-foreground">Bloomjoy user</span>
                              </span>
                              <Check className="h-4 w-4 shrink-0 text-muted-foreground" />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        <SheetFooter className="mt-6 gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={saveMachine} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Save machine details
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
