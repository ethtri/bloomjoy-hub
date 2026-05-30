import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Database,
  ExternalLink,
  FileText,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Table,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  createReportScheduleAdmin,
  createReportExportSignedUrl,
  fetchAdminReportingOverview,
  mapSourceMachineToPartnershipAdmin,
  setSunzeMachineDiscoveryStatusAdmin,
  type AdminReportExportArtifact,
  type AdminReportSchedule,
  type AdminReportViewSnapshot,
  type AdminRefundAdjustmentReviewRow,
  type AdminReportingImportRun,
  type AdminReportingPartnershipOption,
  type AdminSunzeMachineQueueItem,
  type MapSourceMachineToPartnershipResult,
  type ReportingMachineType,
} from '@/lib/reporting';
import { trackEvent } from '@/lib/analytics';
import { formatLabel, machineTypes } from '@/pages/admin/reportingSetupUi';

const sunzeStaleHours = 30;
const importedMachineSetupReason = 'Imported source machine setup';

type ImportedMachineSetupForm = {
  partnershipId: string;
  machineLabel: string;
  locationName: string;
  machineType: ReportingMachineType;
  taxRatePercent: string;
};

const emptyImportedMachineSetupForm: ImportedMachineSetupForm = {
  partnershipId: '',
  machineLabel: '',
  locationName: '',
  machineType: 'commercial',
  taxRatePercent: '0',
};

const splitEmails = (value: string) =>
  value
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

const formatDate = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'n/a';

const formatCents = (value: unknown) => {
  if (value === null || value === undefined) return 'n/a';
  const cents = Number(value);
  if (!Number.isFinite(cents)) return 'n/a';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
};

const getExportArtifactIcon = (artifact: AdminReportExportArtifact) =>
  artifact.format === 'csv' || artifact.format === 'xlsx' ? Table : FileText;

const normalizeComparableText = (value: string | null | undefined) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const partnershipMachineNameHints: Record<string, string[]> = {
  'merlin revenue share': ['merlin', 'madame tussauds', 'legoland', 'sea life'],
  'bubble planet revenue share': ['bubble planet'],
  'bloomjoy mini california': ['bloomjoy mini', 'mini california'],
};

const getImportedMachineDisplayName = (machine: AdminSunzeMachineQueueItem | null) =>
  machine?.sunzeMachineName?.trim() || machine?.sunzeMachineId || 'Imported machine';

const getRecommendedPartnership = (
  machine: AdminSunzeMachineQueueItem | null,
  partnerships: AdminReportingPartnershipOption[]
) => {
  if (!machine) return null;

  const machineText = normalizeComparableText(
    `${machine.sunzeMachineName ?? ''} ${machine.sunzeMachineId}`
  );
  if (!machineText) return null;

  const scored = partnerships
    .filter((partnership) => partnership.status === 'active')
    .map((partnership) => {
      const partnershipText = normalizeComparableText(partnership.name);
      const hints = [
        ...partnershipText.split(' ').filter((token) => token.length >= 4),
        ...(partnershipMachineNameHints[partnershipText] ?? []),
      ];
      const matchedHint = hints.find((hint) => machineText.includes(normalizeComparableText(hint)));
      return {
        partnership,
        matchedHint,
        score: matchedHint ? 1 : 0,
      };
    })
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.partnership.name.localeCompare(right.partnership.name)
    );

  const best = scored[0];
  if (!best) return null;

  return {
    partnership: best.partnership,
    reason: best.matchedHint
      ? `Suggested from source machine name match: ${best.matchedHint}`
      : 'Suggested from source machine details',
  };
};

const inferImportedMachineLocationName = (machine: AdminSunzeMachineQueueItem | null) => {
  const machineText = normalizeComparableText(machine?.sunzeMachineName);
  if (!machineText) return '';
  if (machineText.includes('las vegas') || machineText.includes('vegas')) return 'Las Vegas';
  if (machineText.includes('minneapolis')) return 'Minneapolis';
  if (machineText.includes('chicago')) return 'Chicago';
  if (machineText.includes('dallas')) return 'Dallas';
  return '';
};

const getImportedMachineSetupSummary = (result: MapSourceMachineToPartnershipResult) =>
  `${result.machineLabel} is ready for ${result.partnershipName}. ${result.promotedRowCount} queued row${
    result.promotedRowCount === 1 ? '' : 's'
  } / ${formatCents(result.promotedRevenueCents)} moved into reporting.`;

const metaText = (meta: Record<string, unknown> | undefined, key: string) => {
  const value = meta?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
};

const metaNumber = (meta: Record<string, unknown> | undefined, key: string) => {
  const value = Number(meta?.[key]);
  return Number.isFinite(value) ? value : null;
};

const formatStatusVariant = (status: string): 'default' | 'destructive' | 'outline' => {
  if (status === 'completed' || status === 'ready' || status === 'fresh') return 'default';
  if (status === 'failed') return 'destructive';
  return 'outline';
};

export default function AdminReportingPage() {
  const queryClient = useQueryClient();
  const [scheduleForm, setScheduleForm] = useState({
    title: 'Bubble Planet weekly machine sales',
    machineId: '',
    recipients: '',
    dayOfWeek: '1',
    sendHourLocal: '9',
    timezone: 'America/Los_Angeles',
  });
  const [isCreatingSchedule, setIsCreatingSchedule] = useState(false);
  const [updatingSunzeMachineId, setUpdatingSunzeMachineId] = useState<string | null>(null);
  const [setupMachine, setSetupMachine] = useState<AdminSunzeMachineQueueItem | null>(null);
  const [isSettingUpMachine, setIsSettingUpMachine] = useState(false);
  const [lastSetupResult, setLastSetupResult] =
    useState<MapSourceMachineToPartnershipResult | null>(null);

  const {
    data: overview,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-reporting-overview'],
    queryFn: fetchAdminReportingOverview,
    staleTime: 1000 * 30,
  });

  const machines = useMemo(() => overview?.machines ?? [], [overview?.machines]);
  const partnerships = useMemo(() => overview?.partnerships ?? [], [overview?.partnerships]);
  const importRuns = useMemo(() => overview?.importRuns ?? [], [overview?.importRuns]);
  const schedules = useMemo(() => overview?.schedules ?? [], [overview?.schedules]);
  const snapshots = useMemo(() => overview?.snapshots ?? [], [overview?.snapshots]);
  const sunzeMachineQueue = useMemo(
    () => overview?.sunzeMachineQueue ?? [],
    [overview?.sunzeMachineQueue]
  );
  const refundReviewRows = useMemo(
    () => overview?.refundReviewRows ?? [],
    [overview?.refundReviewRows]
  );
  const pendingSunzeMachineQueue = useMemo(
    () => sunzeMachineQueue.filter((machine) => machine.status === 'pending'),
    [sunzeMachineQueue]
  );
  const sunzeRuns = useMemo(
    () => importRuns.filter((run) => run.source === 'sunze_browser'),
    [importRuns]
  );
  const latestSunzeRun = sunzeRuns[0] ?? null;
  const latestCompletedSunzeRun = sunzeRuns.find((run) => run.status === 'completed') ?? null;
  const latestFailedSunzeRun = sunzeRuns.find((run) => run.status === 'failed') ?? null;
  const latestCompletedSunzeMeta = latestCompletedSunzeRun?.meta ?? {};
  const latestCompletedAt = latestCompletedSunzeRun?.completed_at ?? null;
  const latestCompletedMs = latestCompletedAt ? new Date(latestCompletedAt).getTime() : Number.NaN;
  const latestCompletedAgeMs = Number.isFinite(latestCompletedMs)
    ? Date.now() - latestCompletedMs
    : Number.POSITIVE_INFINITY;
  const sunzeIsStale = latestCompletedAgeMs > sunzeStaleHours * 60 * 60 * 1000;
  const sunzeHasRecentFailure = Boolean(latestFailedSunzeRun);
  const sunzeNeedsMapping = pendingSunzeMachineQueue.length > 0;
  const sunzeHealthLabel = sunzeNeedsMapping
    ? 'Needs Setup'
    : sunzeIsStale
      ? 'Stale'
      : sunzeHasRecentFailure
        ? 'Fresh with issue'
        : 'Fresh';
  const sunzeHealthStatus = sunzeIsStale ? 'failed' : sunzeNeedsMapping ? 'pending' : 'fresh';
  const sunzeLatestSaleDate = metaText(latestCompletedSunzeMeta, 'window_end');
  const sunzeHealthDetail = latestCompletedSunzeRun
    ? `Fresh through ${sunzeLatestSaleDate ?? 'latest import'} / last completed ${formatDate(
        latestCompletedSunzeRun.completed_at
      )}${latestFailedSunzeRun ? ` / latest issue ${formatDate(latestFailedSunzeRun.created_at)}` : ''}`
    : latestSunzeRun
      ? `${latestSunzeRun.status} / ${formatDate(latestSunzeRun.completed_at ?? latestSunzeRun.created_at)}`
      : 'No sales imports yet';

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-reporting-overview'] });

  const setupImportedMachine = async (form: ImportedMachineSetupForm) => {
    if (!setupMachine) return;

    const selectedPartnership = partnerships.find(
      (partnership) => partnership.id === form.partnershipId
    );
    if (!selectedPartnership) {
      toast.error('Choose the report this machine belongs to.');
      return;
    }

    const taxRatePercent = Number(form.taxRatePercent);
    if (
      !form.machineLabel.trim() ||
      !form.locationName.trim() ||
      !form.taxRatePercent.trim() ||
      Number.isNaN(taxRatePercent) ||
      taxRatePercent < 0 ||
      taxRatePercent > 100
    ) {
      toast.error('Enter a machine label, location, and reporting tax rate from 0 to 100.');
      return;
    }

    setIsSettingUpMachine(true);
    try {
      const result = await mapSourceMachineToPartnershipAdmin({
        externalMachineId: setupMachine.sunzeMachineId,
        partnershipId: selectedPartnership.id,
        machineLabel: form.machineLabel.trim(),
        locationName: form.locationName.trim(),
        machineType: form.machineType,
        taxRatePercent,
        assignmentStartDate: selectedPartnership.effective_start_date,
        assignmentEndDate: selectedPartnership.effective_end_date,
        taxEffectiveStartDate: selectedPartnership.effective_start_date,
        reason: importedMachineSetupReason,
      });

      trackEvent('admin_imported_machine_setup_completed', {
        external_machine_id: result.externalMachineId,
        partnership_id: result.partnershipId,
        promoted_row_count: result.promotedRowCount,
        promoted_revenue_cents: result.promotedRevenueCents,
      });
      toast.success(getImportedMachineSetupSummary(result));
      setLastSetupResult(result);
      setSetupMachine(null);
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: ['admin-partnership-reporting-setup'] }),
        queryClient.invalidateQueries({ queryKey: ['partner-dashboard-partnerships'] }),
        queryClient.invalidateQueries({ queryKey: ['partner-dashboard-period-preview'] }),
      ]);
    } catch (setupError) {
      toast.error(
        setupError instanceof Error ? setupError.message : 'Unable to set up imported machine.'
      );
    } finally {
      setIsSettingUpMachine(false);
    }
  };

  const setSunzeQueueStatus = async (
    machine: AdminSunzeMachineQueueItem,
    status: 'pending' | 'ignored'
  ) => {
    setUpdatingSunzeMachineId(machine.sunzeMachineId);
    try {
      await setSunzeMachineDiscoveryStatusAdmin({
        sunzeMachineId: machine.sunzeMachineId,
        status,
        reason:
          status === 'ignored'
            ? 'Marked non-production or not reportable from admin reporting'
            : 'Reopened for imported machine setup',
      });
      trackEvent('admin_source_machine_discovery_status_updated', {
        external_machine_id: machine.sunzeMachineId,
        status,
      });
      toast.success(status === 'ignored' ? 'Source machine ignored.' : 'Source machine reopened.');
      await refresh();
    } catch (statusError) {
      toast.error(statusError instanceof Error ? statusError.message : 'Unable to update queue.');
    } finally {
      setUpdatingSunzeMachineId(null);
    }
  };

  const createSchedule = async () => {
    if (!scheduleForm.title.trim()) {
      toast.error('Schedule title is required.');
      return;
    }

    const recipients = splitEmails(scheduleForm.recipients);
    if (recipients.length === 0) {
      toast.error('At least one recipient is required.');
      return;
    }

    setIsCreatingSchedule(true);
    try {
      await createReportScheduleAdmin({
        title: scheduleForm.title.trim(),
        filters: {
          title: scheduleForm.title.trim(),
          machineIds: scheduleForm.machineId ? [scheduleForm.machineId] : undefined,
          grain: 'week',
        },
        recipientEmails: recipients,
        dayOfWeek: Number(scheduleForm.dayOfWeek),
        sendHourLocal: Number(scheduleForm.sendHourLocal),
        timezone: scheduleForm.timezone,
      });

      trackEvent('admin_report_schedule_created', {
        title: scheduleForm.title.trim(),
        recipient_count: recipients.length,
      });
      toast.success('Report schedule created.');
      setScheduleForm({
        title: 'Bubble Planet weekly machine sales',
        machineId: '',
        recipients: '',
        dayOfWeek: '1',
        sendHourLocal: '9',
        timezone: 'America/Los_Angeles',
      });
      await refresh();
    } catch (scheduleError) {
      toast.error(
        scheduleError instanceof Error ? scheduleError.message : 'Unable to create schedule.'
      );
    } finally {
      setIsCreatingSchedule(false);
    }
  };

  return (
    <AppLayout>
      <section className="section-padding admin-touch-targets">
        <div className="container-page">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Admin
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground">
                Reporting Operations
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                Monitor sales import health, scheduled deliveries, and report exports. User access
                lives in Admin Access; machine and partnership setup lives in Admin Partnerships.
              </p>
            </div>
            <Button variant="outline" className="min-h-11" onClick={refresh} disabled={isFetching}>
              {isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Unable to load reporting overview.
            </div>
          )}

          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <StatusCard
              icon={<Database className="h-5 w-5" />}
              label="Sales Import Health"
              value={sunzeHealthLabel}
              detail={sunzeHealthDetail}
              status={sunzeHealthStatus}
            />
            <StatusCard
              icon={<CheckCircle2 className="h-5 w-5" />}
              label="Last Completed Import"
              value={latestCompletedSunzeRun ? `${latestCompletedSunzeRun.rows_imported} rows` : 'none'}
              detail={
                latestCompletedSunzeRun
                  ? `${formatDate(latestCompletedSunzeRun.completed_at)} / latest sale ${
                      sunzeLatestSaleDate ?? 'n/a'
                    }`
                  : 'No successful imports yet'
              }
              status={latestCompletedSunzeRun ? 'completed' : 'pending'}
            />
            <StatusCard
              icon={<CalendarDays className="h-5 w-5" />}
              label="Active Schedules"
              value={String(schedules.filter((schedule) => schedule.active).length)}
              detail={`${snapshots.length} recent export snapshots`}
              status="completed"
            />
            <StatusCard
              icon={<AlertTriangle className="h-5 w-5" />}
              label="Refund Review"
              value={String(refundReviewRows.filter(isRefundReviewActionable).length)}
              detail={`${refundReviewRows.filter((row) => row.match_status === 'applied').length} recently applied`}
              status={refundReviewRows.some(isRefundReviewActionable) ? 'pending' : 'completed'}
            />
          </div>

          {lastSetupResult && (
            <ImportedMachineSetupReceipt
              result={lastSetupResult}
              onDismiss={() => setLastSetupResult(null)}
            />
          )}

          <Tabs defaultValue="schedules" className="mt-6">
            <TabsList className="h-auto flex-wrap justify-start gap-1">
              <TabsTrigger className="min-h-11" value="schedules">
                Schedules
              </TabsTrigger>
              <TabsTrigger className="min-h-11" value="sync">
                Sync
              </TabsTrigger>
              <TabsTrigger className="min-h-11" value="exports">
                Exports
              </TabsTrigger>
            </TabsList>
            <TabsContent value="schedules" className="mt-6">
              {isLoading ? (
                <LoadingCard />
              ) : (
                <SchedulesTab
                  machines={machines}
                  schedules={schedules}
                  scheduleForm={scheduleForm}
                  setScheduleForm={setScheduleForm}
                  isCreatingSchedule={isCreatingSchedule}
                  createSchedule={createSchedule}
                />
              )}
            </TabsContent>
            <TabsContent value="sync" className="mt-6">
              {isLoading ? (
                <LoadingCard />
              ) : (
                <SyncTab
                  importRuns={importRuns}
                  partnerships={partnerships}
                  sunzeMachineQueue={sunzeMachineQueue}
                  refundReviewRows={refundReviewRows}
                  pendingSunzeMachineCount={pendingSunzeMachineQueue.length}
                  updatingSunzeMachineId={updatingSunzeMachineId}
                  onSetupMachine={setSetupMachine}
                  setSunzeQueueStatus={setSunzeQueueStatus}
                />
              )}
            </TabsContent>
            <TabsContent value="exports" className="mt-6">
              {isLoading ? <LoadingCard /> : <ExportsTab snapshots={snapshots} />}
            </TabsContent>
          </Tabs>
        </div>
      </section>
      <ImportedMachineSetupDialog
        machine={setupMachine}
        partnerships={partnerships}
        isSaving={isSettingUpMachine}
        onOpenChange={(open) => {
          if (!open) setSetupMachine(null);
        }}
        onSave={setupImportedMachine}
      />
    </AppLayout>
  );
}

function StatusCard({
  icon,
  label,
  value,
  detail,
  status,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  status?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-primary">{icon}</span>
        {status && <Badge variant={formatStatusVariant(status)}>{status}</Badge>}
      </div>
      <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{detail}</div>
    </div>
  );
}

function LoadingCard() {
  return (
    <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
      Loading reporting operations...
    </div>
  );
}

function ImportedMachineSetupReceipt({
  result,
  onDismiss,
}: {
  result: MapSourceMachineToPartnershipResult;
  onDismiss: () => void;
}) {
  return (
    <div className="mt-6 rounded-lg border border-primary/25 bg-primary/5 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-foreground">Imported machine setup complete</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {result.machineLabel} is assigned to {result.partnershipName}.{' '}
            {result.promotedRowCount} queued row{result.promotedRowCount === 1 ? '' : 's'} /{' '}
            {formatCents(result.promotedRevenueCents)} moved into reporting.
          </p>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                External ID
              </dt>
              <dd className="mt-1 break-all text-foreground">{result.externalMachineId}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Account
              </dt>
              <dd className="mt-1 text-foreground">{result.accountName}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Location
              </dt>
              <dd className="mt-1 text-foreground">{result.locationName}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Access
              </dt>
              <dd className="mt-1 text-foreground">Review scoped admins separately</dd>
            </div>
          </dl>
          <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-background/70 p-3 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            Partnership assignment controls reporting and settlement grouping. It does not
            automatically grant admin, tax, or scoped management rights.
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
          <Button asChild className="min-h-11">
            <Link to="/admin/access">
              Review Access
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button variant="outline" className="min-h-11" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}

function SchedulesTab({
  machines,
  schedules,
  scheduleForm,
  setScheduleForm,
  isCreatingSchedule,
  createSchedule,
}: {
  machines: Array<{ id: string; machine_label: string; sunze_machine_id: string | null }>;
  schedules: AdminReportSchedule[];
  scheduleForm: {
    title: string;
    machineId: string;
    recipients: string;
    dayOfWeek: string;
    sendHourLocal: string;
    timezone: string;
  };
  setScheduleForm: (value: {
    title: string;
    machineId: string;
    recipients: string;
    dayOfWeek: string;
    sendHourLocal: string;
    timezone: string;
  }) => void;
  isCreatingSchedule: boolean;
  createSchedule: () => void;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">Create Scheduled Delivery</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Scheduled PDFs use report filters and email recipients. Partner-specific financial
          reports are driven by the Partnerships setup.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <Label htmlFor="schedule-title">Title</Label>
            <Input
              id="schedule-title"
              value={scheduleForm.title}
              onChange={(event) => setScheduleForm({ ...scheduleForm, title: event.target.value })}
              className="h-11"
            />
          </div>
          <div>
            <Label htmlFor="schedule-machine">Optional machine filter</Label>
            <select
              id="schedule-machine"
              value={scheduleForm.machineId}
              onChange={(event) =>
                setScheduleForm({ ...scheduleForm, machineId: event.target.value })
              }
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All accessible machines in filter</option>
              {machines.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.machine_label} / {machine.sunze_machine_id ?? 'no external machine ID'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="schedule-recipients">Recipients</Label>
            <Input
              id="schedule-recipients"
              value={scheduleForm.recipients}
              onChange={(event) =>
                setScheduleForm({ ...scheduleForm, recipients: event.target.value })
              }
              placeholder="partner@example.com, finance@example.com"
              className="h-11"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="schedule-day">Send day</Label>
              <select
                id="schedule-day"
                value={scheduleForm.dayOfWeek}
                onChange={(event) =>
                  setScheduleForm({ ...scheduleForm, dayOfWeek: event.target.value })
                }
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="1">Monday</option>
                <option value="2">Tuesday</option>
                <option value="3">Wednesday</option>
                <option value="4">Thursday</option>
                <option value="5">Friday</option>
              </select>
            </div>
            <div>
              <Label htmlFor="schedule-hour">Hour</Label>
              <Input
                id="schedule-hour"
                type="number"
                min={0}
                max={23}
                value={scheduleForm.sendHourLocal}
                onChange={(event) =>
                  setScheduleForm({ ...scheduleForm, sendHourLocal: event.target.value })
                }
                className="h-11"
              />
            </div>
            <div>
              <Label htmlFor="schedule-timezone">Timezone</Label>
              <Input
                id="schedule-timezone"
                value={scheduleForm.timezone}
                onChange={(event) =>
                  setScheduleForm({ ...scheduleForm, timezone: event.target.value })
                }
                className="h-11"
              />
            </div>
          </div>
          <Button className="min-h-11" onClick={createSchedule} disabled={isCreatingSchedule}>
            {isCreatingSchedule ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CalendarDays className="mr-2 h-4 w-4" />
            )}
            Create Schedule
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <ListHeader title="Active Schedules" count={schedules.length} />
        {schedules.length === 0 ? (
          <EmptyRow text="No schedules configured." />
        ) : (
          schedules.map((schedule) => (
            <Row key={schedule.id}>
              <div>
                <div className="font-medium text-foreground">{schedule.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Day {schedule.send_day_of_week} at {schedule.send_hour_local}:00 /{' '}
                  {schedule.timezone}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Recipients:{' '}
                  {schedule.report_schedule_recipients
                    ?.filter((recipient) => recipient.active)
                    .map((recipient) => recipient.email)
                    .join(', ') || 'none'}
                </div>
              </div>
              <Badge variant={schedule.active ? 'default' : 'outline'}>
                {schedule.active ? 'active' : 'inactive'}
              </Badge>
            </Row>
          ))
        )}
      </div>
    </div>
  );
}

function SyncTab({
  importRuns,
  partnerships,
  sunzeMachineQueue,
  refundReviewRows,
  pendingSunzeMachineCount,
  updatingSunzeMachineId,
  onSetupMachine,
  setSunzeQueueStatus,
}: {
  importRuns: AdminReportingImportRun[];
  partnerships: AdminReportingPartnershipOption[];
  sunzeMachineQueue: AdminSunzeMachineQueueItem[];
  refundReviewRows: AdminRefundAdjustmentReviewRow[];
  pendingSunzeMachineCount: number;
  updatingSunzeMachineId: string | null;
  onSetupMachine: (machine: AdminSunzeMachineQueueItem) => void;
  setSunzeQueueStatus: (
    machine: AdminSunzeMachineQueueItem,
    status: 'pending' | 'ignored'
  ) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-foreground">Imported Machines Needing Setup</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {pendingSunzeMachineCount} imported machine
              {pendingSunzeMachineCount === 1 ? '' : 's'} with queued sales not yet included in reports.
            </p>
          </div>
          {pendingSunzeMachineCount > 0 && (
            <Badge variant="outline" className="w-fit text-amber-700">
              Needs setup
            </Badge>
          )}
        </div>
        {sunzeMachineQueue.length === 0 ? (
          <EmptyRow text="No discovered source machines need action." />
        ) : (
          sunzeMachineQueue.map((machine) => (
            <Row key={machine.sunzeMachineId}>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium text-foreground">
                    {getImportedMachineDisplayName(machine)}
                  </div>
                  {!machine.sunzeMachineName && (
                    <Badge variant="outline" className="text-amber-700">
                      Name missing
                    </Badge>
                  )}
                  {machine.pendingRowCount === 0 && (
                    <Badge variant="outline">No queued sales</Badge>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  External machine ID {machine.sunzeMachineId} / status {machine.status}
                </div>
                {!machine.sunzeMachineName && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Confirm the provider machine name before setup when multiple new IDs appeared
                    together.
                  </div>
                )}
                {machine.ignoreReason && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Ignored: {machine.ignoreReason}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-3 text-sm sm:items-end">
                <div className="text-left sm:text-right">
                  <div className="font-medium text-foreground">
                    {machine.pendingRowCount} rows / {formatCents(machine.pendingRevenueCents)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Latest sale {machine.latestSaleDate ?? 'n/a'} / seen{' '}
                    {formatDate(machine.lastSeenAt)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <Button
                    type="button"
                    size="sm"
                    className="min-h-11"
                    disabled={partnerships.length === 0}
                    onClick={() => onSetupMachine(machine)}
                  >
                    Set up
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    disabled={updatingSunzeMachineId === machine.sunzeMachineId}
                    onClick={() =>
                      setSunzeQueueStatus(
                        machine,
                        machine.status === 'ignored' ? 'pending' : 'ignored'
                      )
                    }
                  >
                    {updatingSunzeMachineId === machine.sunzeMachineId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : machine.status === 'ignored' ? (
                      'Reopen'
                    ) : (
                      'Ignore'
                    )}
                  </Button>
                </div>
              </div>
            </Row>
          ))
        )}
      </div>

      <RefundReviewPanel rows={refundReviewRows} />

      <div className="rounded-lg border border-border bg-card">
        <ListHeader title="Recent Import Runs" count={importRuns.length} />
        {importRuns.length === 0 ? (
          <EmptyRow text="No sales import runs found." />
        ) : (
          importRuns.map((run) => <ImportRunRow key={run.id} run={run} />)
        )}
      </div>
    </div>
  );
}

function ImportedMachineSetupDialog({
  machine,
  partnerships,
  isSaving,
  onOpenChange,
  onSave,
}: {
  machine: AdminSunzeMachineQueueItem | null;
  partnerships: AdminReportingPartnershipOption[];
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (form: ImportedMachineSetupForm) => void;
}) {
  const [form, setForm] = useState<ImportedMachineSetupForm>(emptyImportedMachineSetupForm);
  const recommendedPartnership = useMemo(
    () => getRecommendedPartnership(machine, partnerships),
    [machine, partnerships]
  );
  const selectedPartnership = partnerships.find(
    (partnership) => partnership.id === form.partnershipId
  );

  useEffect(() => {
    if (!machine) return;
    const recommended = getRecommendedPartnership(machine, partnerships);
    setForm({
      ...emptyImportedMachineSetupForm,
      partnershipId: recommended?.partnership.id ?? '',
      machineLabel: machine.sunzeMachineName ?? '',
      locationName: inferImportedMachineLocationName(machine),
    });
  }, [machine, partnerships]);

  return (
    <Dialog open={Boolean(machine)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Set Up Imported Machine</DialogTitle>
          <DialogDescription>
            Choose which report should include this imported machine. The source-owned external ID
            stays locked, and queued sales move into reporting after setup.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Imported machine
            </div>
            <div className="mt-1 font-medium text-foreground">
              {machine?.sunzeMachineName ?? machine?.sunzeMachineId ?? 'Imported machine'}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {machine?.pendingRowCount ?? 0} queued rows /{' '}
              {formatCents(machine?.pendingRevenueCents ?? 0)}
            </div>
          </div>
          {recommendedPartnership && (
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                <div>
                  <div className="font-medium text-foreground">
                    Suggested report: {recommendedPartnership.partnership.name}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {recommendedPartnership.reason}. Confirm this before finishing setup.
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <div className="font-medium text-foreground">Access review is separate</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  This assignment controls reporting and settlement grouping only. Review scoped
                  admin access after setup for users who need tax or machine management rights.
                </div>
              </div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="imported-machine-partnership">Report / partnership</Label>
              <select
                id="imported-machine-partnership"
                value={form.partnershipId}
                onChange={(event) => setForm({ ...form, partnershipId: event.target.value })}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Choose report</option>
                {partnerships.map((partnership) => (
                  <option key={partnership.id} value={partnership.id}>
                    {partnership.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="imported-machine-external-id">External machine ID</Label>
              <Input
                id="imported-machine-external-id"
                value={machine?.sunzeMachineId ?? ''}
                readOnly
                aria-readonly="true"
                className="h-11"
              />
            </div>
            <div>
              <Label htmlFor="imported-machine-label">Machine label</Label>
              <Input
                id="imported-machine-label"
                value={form.machineLabel}
                onChange={(event) => setForm({ ...form, machineLabel: event.target.value })}
                placeholder={machine?.sunzeMachineName ?? 'Machine label'}
                className="h-11"
              />
            </div>
            <div>
              <Label htmlFor="imported-machine-location">Location</Label>
              <Input
                id="imported-machine-location"
                value={form.locationName}
                onChange={(event) => setForm({ ...form, locationName: event.target.value })}
                placeholder="Las Vegas"
                className="h-11"
              />
            </div>
            <div>
              <Label htmlFor="imported-machine-type">Machine type</Label>
              <select
                id="imported-machine-type"
                value={form.machineType}
                onChange={(event) =>
                  setForm({ ...form, machineType: event.target.value as ReportingMachineType })
                }
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {machineTypes.map((machineType) => (
                  <option key={machineType} value={machineType}>
                    {formatLabel(machineType)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="imported-machine-tax">Reporting tax %</Label>
              <Input
                id="imported-machine-tax"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={form.taxRatePercent}
                onChange={(event) => setForm({ ...form, taxRatePercent: event.target.value })}
                className="h-11"
              />
            </div>
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
            {selectedPartnership ? (
              <>
                Assignment dates use {selectedPartnership.name}:{' '}
                {selectedPartnership.effective_start_date}
                {selectedPartnership.effective_end_date
                  ? ` through ${selectedPartnership.effective_end_date}`
                  : ' onward'}
                .
              </>
            ) : partnerships.length === 0 ? (
              'Create an active partnership before setting up imported machines.'
            ) : (
              'Choose a report to see the assignment dates.'
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            className="min-h-11"
            onClick={() => onSave(form)}
            disabled={isSaving || !machine || partnerships.length === 0 || !form.partnershipId}
          >
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Finish Setup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const isRefundReviewActionable = (row: AdminRefundAdjustmentReviewRow) =>
  row.resolution_status === 'unresolved' &&
  row.match_status !== 'applied' &&
  row.match_status !== 'ignored';

function RefundReviewPanel({ rows }: { rows: AdminRefundAdjustmentReviewRow[] }) {
  const counts = rows.reduce(
    (summary, row) => {
      summary.total += 1;
      if (row.match_status === 'applied') summary.applied += 1;
      if (isRefundReviewActionable(row)) summary.needsReview += 1;
      if (row.match_status === 'ambiguous') summary.ambiguous += 1;
      if (row.match_status === 'unmatched') summary.unmatched += 1;
      if (row.match_status === 'duplicate') summary.duplicate += 1;
      if (row.match_status === 'invalid') summary.invalid += 1;
      return summary;
    },
    {
      total: 0,
      applied: 0,
      needsReview: 0,
      ambiguous: 0,
      unmatched: 0,
      duplicate: 0,
      invalid: 0,
    }
  );

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-foreground">Refund Adjustment Review</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {counts.needsReview} row{counts.needsReview === 1 ? '' : 's'} need review before they can
            change partner settlement.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{counts.applied} applied</Badge>
          <Badge variant={counts.needsReview > 0 ? 'destructive' : 'outline'}>
            {counts.needsReview} review
          </Badge>
        </div>
      </div>
      <div className="grid gap-3 border-b border-border bg-muted/20 p-4 text-sm sm:grid-cols-4">
        <ReviewCount label="Ambiguous" value={counts.ambiguous} />
        <ReviewCount label="Unmatched" value={counts.unmatched} />
        <ReviewCount label="Duplicates" value={counts.duplicate} />
        <ReviewCount label="Invalid" value={counts.invalid} />
      </div>
      {rows.length === 0 ? (
        <EmptyRow text="No refund adjustment rows have been staged yet." />
      ) : (
        rows.slice(0, 8).map((row) => (
          <Row key={row.id}>
            <div>
              <div className="font-medium text-foreground">
                {row.source_location || row.reporting_machines?.machine_label || 'Unmatched refund row'}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Refund date {row.refund_date ?? 'n/a'} / status {row.source_status ?? 'n/a'} / imported{' '}
                {formatDate(row.imported_at)}
              </div>
              {row.match_reason && (
                <div className="mt-1 text-xs text-muted-foreground">{row.match_reason}</div>
              )}
            </div>
            <div className="text-left text-sm sm:text-right">
              <Badge variant={row.match_status === 'applied' ? 'default' : 'outline'}>
                {row.match_status.replaceAll('_', ' ')}
              </Badge>
              <div className="mt-2 font-medium text-foreground">
                {formatCents(row.amount_cents)}
              </div>
              <div className="text-xs text-muted-foreground">
                Confidence {Math.round(Number(row.match_confidence ?? 0) * 100)}%
              </div>
            </div>
          </Row>
        ))
      )}
    </div>
  );
}

function ReviewCount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

const neutralizeProviderCopy = (value: string | null | undefined) =>
  String(value ?? '')
    .replace(/sunze-sales-ingest/gi, 'sales import endpoint')
    .replace(/sunze-sales-sync/gi, 'sales import workflow')
    .replace(/sunze-orders/gi, 'provider import')
    .replace(/sunze_browser/gi, 'sales import')
    .replace(/\bsunze-[a-z0-9-]+\b/gi, 'sales source')
    .replace(/\b[a-z0-9_]*sunze[a-z0-9_]*\b/gi, 'sales source')
    .replace(/\bSunze\b/gi, 'sales source');

const importSourceLabel = (source: string) => {
  if (source === 'sunze_browser') return 'Sales import';
  if (source === 'google_sheets_refunds') return 'Refund adjustments';
  return neutralizeProviderCopy(source);
};

function ImportRunRow({ run }: { run: AdminReportingImportRun }) {
  const meta = run.meta ?? {};
  const isRefundImport = run.source === 'google_sheets_refunds';
  const sourceReference = run.source === 'sunze_browser'
    ? 'provider import'
    : neutralizeProviderCopy(run.source_reference ?? 'no source reference');
  const windowStart = metaText(meta, 'selected_window_start') ?? metaText(meta, 'window_start');
  const windowEnd = metaText(meta, 'selected_window_end') ?? metaText(meta, 'window_end');
  const parsedRows = metaNumber(meta, 'parsed_row_count');
  const uiRows = metaNumber(meta, 'ui_record_count');
  const parsedRevenue = metaNumber(meta, 'parsed_order_amount_cents');
  const uiRevenue = metaNumber(meta, 'ui_revenue_cents');
  const machineCount =
    metaNumber(meta, 'parsed_machine_count') ?? metaNumber(meta, 'visible_sunze_machine_count');

  return (
    <Row>
      <div>
        <div className="font-medium text-foreground">{importSourceLabel(run.source)}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {isRefundImport ? 'reviewed adjustment import' : sourceReference} / started{' '}
          {formatDate(run.started_at)}
        </div>
        {windowStart && windowEnd && (
          <div className="mt-1 text-xs text-muted-foreground">
            Window {windowStart} to {windowEnd}
          </div>
        )}
        {run.error_message && (
          <div className="mt-2 flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
            {neutralizeProviderCopy(run.error_message)}
          </div>
        )}
      </div>
      <div className="text-left text-sm sm:text-right">
        <Badge variant={formatStatusVariant(run.status)}>{run.status}</Badge>
        <div className="mt-2 text-xs text-muted-foreground">
          seen {run.rows_seen} / imported {run.rows_imported} / skipped {run.rows_skipped}
        </div>
        {run.source === 'sunze_browser' && (
          <div className="mt-1 text-xs text-muted-foreground">
            parsed {parsedRows ?? 'n/a'} vs UI {uiRows ?? 'n/a'} / {machineCount ?? 'n/a'} machines
          </div>
        )}
        {run.source === 'sunze_browser' && (
          <div className="mt-1 text-xs text-muted-foreground">
            revenue {formatCents(parsedRevenue)} vs UI {formatCents(uiRevenue)}
          </div>
        )}
      </div>
    </Row>
  );
}

function ExportsTab({ snapshots }: { snapshots: AdminReportViewSnapshot[] }) {
  const [openingArtifactKey, setOpeningArtifactKey] = useState<string | null>(null);

  const openArtifact = async (
    snapshot: AdminReportViewSnapshot,
    artifact: AdminReportExportArtifact
  ) => {
    const artifactKey = `${snapshot.id}:${artifact.storagePath}`;
    setOpeningArtifactKey(artifactKey);

    try {
      const signedUrl = await createReportExportSignedUrl(artifact.storagePath);
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to open report export.');
    } finally {
      setOpeningArtifactKey(null);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <ListHeader title="Recent Export Snapshots" count={snapshots.length} />
      {snapshots.length === 0 ? (
        <EmptyRow text="No report exports found." />
      ) : (
        snapshots.map((snapshot) => (
          <Row key={snapshot.id}>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-medium text-foreground">{snapshot.title}</div>
                <Badge variant="outline">
                  {snapshot.snapshot_type === 'partner_report' ? 'Partner report' : 'Sales report'}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Created {formatDate(snapshot.created_at)} /{' '}
                {snapshot.exports.length === 0
                  ? 'no files yet'
                  : snapshot.exports.length === 1
                    ? '1 artifact'
                    : `${snapshot.exports.length} artifacts`}
              </div>
              {snapshot.exports.length > 0 ? (
                <div className="mt-3 grid gap-2">
                  {snapshot.exports.map((artifact) => {
                    const ArtifactIcon = getExportArtifactIcon(artifact);
                    const artifactKey = `${snapshot.id}:${artifact.storagePath}`;
                    const isOpening = openingArtifactKey === artifactKey;

                    return (
                      <div
                        key={artifactKey}
                        className={`grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_auto] sm:items-center ${
                          artifact.isPrimary
                            ? 'border-primary/30 bg-primary/5'
                            : 'border-border bg-background'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
                              <ArtifactIcon className="h-4 w-4" />
                              {artifact.label}
                            </span>
                            {artifact.isPrimary && <Badge>Primary</Badge>}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {artifact.description}
                          </div>
                          <div className="mt-1 break-all text-xs text-muted-foreground">
                            Generated {formatDate(artifact.generatedAt ?? snapshot.created_at)} /{' '}
                            {artifact.fileName ?? artifact.storagePath}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void openArtifact(snapshot, artifact)}
                          disabled={Boolean(openingArtifactKey)}
                        >
                          {isOpening ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <ExternalLink className="mr-2 h-4 w-4" />
                          )}
                          Open
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                  No artifact files recorded yet.
                </div>
              )}
              {snapshot.error_message && (
                <div className="mt-2 text-xs text-destructive">{snapshot.error_message}</div>
              )}
            </div>
            <Badge variant={formatStatusVariant(snapshot.export_status)}>
              {snapshot.export_status}
            </Badge>
          </Row>
        ))
      )}
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
