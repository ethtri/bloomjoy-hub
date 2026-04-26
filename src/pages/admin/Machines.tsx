import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
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
import { type ReportingMachineType, upsertReportingMachineAdmin } from '@/lib/reporting';
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
type MachineSort = 'status' | 'machine' | 'account' | 'latest_sale';

const setupQueryKey = ['admin-partnership-reporting-setup'];
const initialReportingTaxStartDate = '2026-01-01';

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

  const refresh = () => queryClient.invalidateQueries({ queryKey: setupQueryKey });

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

        return {
          machine,
          taxRate,
          taxStatus,
          activeAssignments,
          machineWarnings,
          draftValue: taxDrafts[machine.id] ?? (taxRate ? String(Number(taxRate.tax_rate_percent)) : ''),
        };
      })
      .filter((row) => taxFilter === 'all' || row.taxStatus === taxFilter)
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
          row.machine.account_name,
          row.machine.location_name,
          row.machine.sunze_machine_id ?? '',
          row.activeAssignments.map((assignment) => assignment.partnership_name).join(' '),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedSearch);
      })
      .sort((left, right) => {
        if (sort === 'machine') return left.machine.machine_label.localeCompare(right.machine.machine_label);
        if (sort === 'account') {
          return `${left.machine.account_name} ${left.machine.location_name}`.localeCompare(
            `${right.machine.account_name} ${right.machine.location_name}`
          );
        }
        if (sort === 'latest_sale') {
          return (right.machine.latest_sale_date ?? '').localeCompare(left.machine.latest_sale_date ?? '');
        }
        return left.taxStatus.localeCompare(right.taxStatus);
      });
  }, [assignmentFilter, search, setup, taxDrafts, taxFilter, sort]);

  const readinessCounts = useMemo(() => {
    const currentDate = today();
    const missingTax = setup.machines.filter(
      (machine) => getTaxStatus(getCurrentTaxRate(setup.taxRates, machine.id, currentDate)) === 'missing'
    ).length;
    const unassigned = setup.machines.filter(
      (machine) => getActiveMachineAssignments(setup, machine.id, currentDate).length === 0
    ).length;
    const overlappingAssignments = setup.warnings.filter(
      (warning) => warning.warningType === 'overlapping_partnership_assignments'
    ).length;

    return { missingTax, unassigned, overlappingAssignments };
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
    setIsMachineDialogOpen(true);
  };

  const openEditMachine = (machine: PartnershipSetupMachine) => {
    setEditingMachine(machine);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('machineId', machine.id);
    setSearchParams(nextParams, { replace: true });
    setIsMachineDialogOpen(true);
  };

  const closeMachineDialog = (open: boolean) => {
    setIsMachineDialogOpen(open);
    if (!open) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('machineId');
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
                Manage machine labels, Sunze mapping, partnership assignment readiness, and
                reporting tax rates in one operational table.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={refresh} disabled={isFetching}>
                {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
              <Button onClick={openCreateMachine}>
                <Plus className="mr-2 h-4 w-4" />
                New Machine
              </Button>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Unable to load machine setup.
            </div>
          )}

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <ReadinessCard
              label="Missing tax"
              value={readinessCounts.missingTax}
              actionLabel="Show missing"
              onAction={() => updateTaxFilter('missing')}
              isWarning={readinessCounts.missingTax > 0}
            />
            <ReadinessCard
              label="Unassigned machines"
              value={readinessCounts.unassigned}
              actionLabel="Review table"
              onAction={() => updateAssignmentFilter('unassigned')}
              isWarning={readinessCounts.unassigned > 0}
            />
            <ReadinessCard
              label="Overlaps"
              value={readinessCounts.overlappingAssignments}
              actionLabel="Review rows"
              onAction={() => updateAssignmentFilter('overlap')}
              isWarning={readinessCounts.overlappingAssignments > 0}
            />
          </div>

          <div className="mt-6 rounded-lg border border-border bg-card p-4">
            <div className="mb-4 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              Reporting tax rates are used only for partner report estimates. They do not set
              machine prices or replace the accounting tax workflow.
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
                    placeholder="Machine, account, location, Sunze ID, partnership"
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
                  <option value="missing">Missing tax</option>
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
                  <option value="account">Account/location</option>
                  <option value="latest_sale">Latest sale</option>
                </select>
              </div>
              <div>
                <Label htmlFor="assignment-filter">Assignment</Label>
                <select
                  id="assignment-filter"
                  value={assignmentFilter}
                  onChange={(event) => updateAssignmentFilter(event.target.value as MachineAssignmentFilter)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All assignments</option>
                  <option value="unassigned">Unassigned</option>
                  <option value="overlap">Overlaps</option>
                </select>
              </div>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border p-4">
              <h2 className="font-semibold text-foreground">Machine Readiness</h2>
              <Badge variant="outline">{machineRows.length}</Badge>
            </div>

            {isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading machines...</div>
            ) : machineRows.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No machines match this filter.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[1120px] w-full divide-y divide-border text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Machine label / alias</th>
                      <th className="px-4 py-3 text-left font-semibold">Account</th>
                      <th className="px-4 py-3 text-left font-semibold">Location</th>
                      <th className="px-4 py-3 text-left font-semibold">Type</th>
                      <th className="px-4 py-3 text-left font-semibold">Sunze ID</th>
                      <th className="px-4 py-3 text-left font-semibold">Assignment</th>
                      <th className="px-4 py-3 text-left font-semibold">Tax status</th>
                      <th className="px-4 py-3 text-left font-semibold">Reporting tax %</th>
                      <th className="px-4 py-3 text-left font-semibold">Latest sale</th>
                      <th className="px-4 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-background">
                    {machineRows.map(({ machine, taxRate, taxStatus, activeAssignments, machineWarnings, draftValue }) => {
                      const machineTaxHistory = setup.taxRates.filter((rate) => rate.machine_id === machine.id);
                      const isHighlighted = highlightedMachineId === machine.id;
                      const hasActionableWarning = machineWarnings.some(
                        (warning) =>
                          warning.warningType === 'missing_machine_tax_rate' ||
                          warning.warningType === 'missing_partnership_assignment' ||
                          warning.warningType === 'overlapping_partnership_assignments'
                      );

                      return (
                        <tr key={machine.id} className={isHighlighted ? 'bg-primary/5' : ''}>
                          <td className="px-4 py-3">
                            <div className="font-medium text-foreground">{machine.machine_label}</div>
                            {hasActionableWarning && (
                              <div className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                Needs setup
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{machine.account_name}</td>
                          <td className="px-4 py-3 text-muted-foreground">{machine.location_name}</td>
                          <td className="px-4 py-3 text-muted-foreground">{formatLabel(machine.machine_type)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{machine.sunze_machine_id ?? 'n/a'}</td>
                          <td className="px-4 py-3">
                            {activeAssignments.length === 0 ? (
                              <Badge variant="destructive">Unassigned</Badge>
                            ) : (
                              <div className="grid gap-1">
                                {activeAssignments.map((assignment) => (
                                  <Badge key={assignment.id} variant="secondary" className="w-fit">
                                    {assignment.partnership_name}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant={
                                taxStatus === 'missing'
                                  ? 'destructive'
                                  : taxStatus === 'no_tax'
                                    ? 'secondary'
                                    : 'default'
                              }
                            >
                              {getTaxStatusLabel(taxStatus)}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Input
                              aria-label={`${machine.machine_label} reporting tax rate percent`}
                              type="number"
                              step="0.01"
                              min={0}
                              max={100}
                              value={draftValue}
                              onChange={(event) =>
                                setTaxDrafts((current) => ({
                                  ...current,
                                  [machine.id]: event.target.value,
                                }))
                              }
                              placeholder="Missing"
                              className="w-28"
                            />
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{machine.latest_sale_date ?? 'n/a'}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openEditMachine(machine)}
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setHistoryMachine(machine)}
                                disabled={machineTaxHistory.length === 0}
                              >
                                <History className="mr-2 h-4 w-4" />
                                History
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openTaxChangeDialog(machine, taxRate)}
                              >
                                <CalendarClock className="mr-2 h-4 w-4" />
                                Rate Change
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => saveTaxRate(machine, taxRate, draftValue)}
                                disabled={savingTaxMachineId === machine.id}
                              >
                                {savingTaxMachineId === machine.id && (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                )}
                                Save Tax
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      <MachineDialog
        open={isMachineDialogOpen}
        onOpenChange={closeMachineDialog}
        machine={editingMachine}
        machines={setup.machines}
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

function ReadinessCard({
  label,
  value,
  actionLabel,
  isWarning,
  onAction,
}: {
  label: string;
  value: number;
  actionLabel: string;
  isWarning: boolean;
  onAction?: () => void;
}) {
  return (
    <div className={`rounded-lg border p-4 ${isWarning ? 'border-amber-300 bg-amber-50' : 'border-border bg-card'}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold text-foreground">{value}</div>
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
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machine: PartnershipSetupMachine | null;
  machines: PartnershipSetupMachine[];
  onSaved: () => Promise<unknown>;
}) {
  const [form, setForm] = useState(emptyMachineForm);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!machine) {
      setForm(emptyMachineForm);
      return;
    }

    setForm({
      machineId: machine.id,
      accountName: machine.account_name,
      locationName: machine.location_name,
      machineLabel: machine.machine_label,
      machineType: machine.machine_type,
      sunzeMachineId: machine.sunze_machine_id ?? '',
    });
  }, [machine, open]);

  const accountOptions = useMemo(
    () => Array.from(new Set(machines.map((candidate) => candidate.account_name).filter(Boolean))).sort(),
    [machines]
  );
  const locationOptions = useMemo(
    () => Array.from(new Set(machines.map((candidate) => candidate.location_name).filter(Boolean))).sort(),
    [machines]
  );

  const saveMachine = async () => {
    if (!form.accountName.trim() || !form.locationName.trim() || !form.machineLabel.trim()) {
      toast.error('Account, location, and machine label are required.');
      return;
    }

    const accountName = form.accountName.trim();
    const locationName = form.locationName.trim();
    const machineLabel = form.machineLabel.trim();
    const sunzeMachineId = form.sunzeMachineId.trim();
    const duplicateIdentity = machines.find(
      (candidate) =>
        candidate.id !== form.machineId &&
        normalizeComparableText(candidate.account_name) === normalizeComparableText(accountName) &&
        normalizeComparableText(candidate.location_name) === normalizeComparableText(locationName) &&
        normalizeComparableText(candidate.machine_label) === normalizeComparableText(machineLabel)
    );
    if (duplicateIdentity) {
      toast.error('A machine with this account, location, and label already exists.');
      return;
    }

    const duplicateSunze = sunzeMachineId
      ? machines.find(
          (candidate) =>
            candidate.id !== form.machineId &&
            normalizeComparableText(candidate.sunze_machine_id ?? '') === normalizeComparableText(sunzeMachineId)
        )
      : null;
    if (duplicateSunze) {
      toast.error('This Sunze ID is already assigned to another machine.');
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{form.machineId ? 'Edit Machine' : 'New Machine'}</DialogTitle>
          <DialogDescription>
            Update the reporting label, account/location display, machine type, and Sunze mapping.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="machine-account">Account</Label>
            <Input
              id="machine-account"
              list="machine-account-options"
              value={form.accountName}
              onChange={(event) => setForm({ ...form, accountName: event.target.value })}
            />
            <datalist id="machine-account-options">
              {accountOptions.map((accountName) => (
                <option key={accountName} value={accountName} />
              ))}
            </datalist>
          </div>
          <div>
            <Label htmlFor="machine-location">Location</Label>
            <Input
              id="machine-location"
              list="machine-location-options"
              value={form.locationName}
              onChange={(event) => setForm({ ...form, locationName: event.target.value })}
            />
            <datalist id="machine-location-options">
              {locationOptions.map((locationName) => (
                <option key={locationName} value={locationName} />
              ))}
            </datalist>
          </div>
          <div>
            <Label htmlFor="machine-label">Machine label / alias</Label>
            <Input
              id="machine-label"
              value={form.machineLabel}
              onChange={(event) => setForm({ ...form, machineLabel: event.target.value })}
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
            <Label htmlFor="sunze-id">Sunze ID</Label>
            <Input
              id="sunze-id"
              value={form.sunzeMachineId}
              onChange={(event) => setForm({ ...form, sunzeMachineId: event.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={saveMachine} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Save Machine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
