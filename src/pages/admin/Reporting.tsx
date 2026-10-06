import { useEffect, useMemo, useRef, useState } from 'react';
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
  mapSnapCaseMachineAdmin,
  mapSourceMachineToPartnershipAdmin,
  setSunzeMachineDiscoveryStatusAdmin,
  type AdminReportExportArtifact,
  type AdminReportSchedule,
  type AdminReportViewSnapshot,
  type AdminRefundAdjustmentReviewRow,
  type AdminReportingImportRun,
  type AdminReportingMachine,
  type AdminReportingPartnershipOption,
  type AdminSnapCaseMachineQueueItem,
  type AdminSunzeMachineQueueItem,
  type MapSourceMachineToPartnershipResult,
} from '@/lib/reporting';
import { trackEvent } from '@/lib/analytics';
import type { CanonicalMachineType } from '@/lib/machineTypes';
import {
  closeReservedSignedExportWindow,
  openSignedExportUrl,
  reserveSignedExportWindow,
} from '@/lib/signedExportWindow';
import { formatMachineType, machineTypes } from '@/pages/admin/reportingSetupUi';
import { getSnapCaseMappingEffectiveWindow } from '@/lib/snapcaseMappingWindow';
import { AdminReportingServiceStatus } from '@/pages/admin/AdminReportingServiceStatus';
import { CompanyAssignmentFields } from '@/components/admin/CompanyAssignmentFields';
import { validateCompanyAssignment, type SavedCompanyAssignment } from '@/lib/companyAssignment';
import { companyChoicesQueryKey, fetchCompanyChoices } from '@/lib/companyAssignmentApi';
import { useAuth } from '@/contexts/auth-context';
import { MachineIdentityMapping } from '@/components/admin/MachineIdentityMapping';
import { linkSunzeSourceToMachine } from '@/lib/machineWorkspace';

const sunzeStaleHours = 30;
const importedMachineSetupReason = 'Imported source machine setup';

const isEligibleExistingSnapCaseMachine = (
  machine: Pick<AdminReportingMachine, 'machine_type' | 'sunze_machine_id' | 'nayax_machine_id'>
) =>
  !machine.sunze_machine_id &&
  (machine.machine_type === 'snapcase' || Boolean(machine.nayax_machine_id?.trim()));

type ImportedMachineSetupForm = {
  partnershipId: string;
  mappingMode: 'existing' | 'new';
  reportingMachineId: string;
  accountId: string;
  locationId: string;
  machineLabel: string;
  locationName: string;
  locationTimezone: string;
  addLocation: boolean;
  expectedAccountId: string | null;
  expectedLocationId: string | null;
  savedAssignment: SavedCompanyAssignment | null;
  machineType: CanonicalMachineType;
};

const emptyImportedMachineSetupForm: ImportedMachineSetupForm = {
  partnershipId: '',
  mappingMode: 'new',
  reportingMachineId: '',
  accountId: '',
  locationId: '',
  machineLabel: '',
  locationName: '',
  locationTimezone: '',
  addLocation: false,
  expectedAccountId: null,
  expectedLocationId: null,
  savedAssignment: null,
  machineType: 'commercial',
};

export type ImportedSetupMachine =
  | { provider: 'sunze'; machine: AdminSunzeMachineQueueItem }
  | { provider: 'snapcase'; machine: AdminSnapCaseMachineQueueItem };

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

export default function AdminReportingPage({ discoveryOnly = false, sourceSetup, onSourceSetupClosed, onSourceSetupSaved }: {
  discoveryOnly?: boolean;
  sourceSetup?: ImportedSetupMachine | null;
  onSourceSetupClosed?: () => void;
  onSourceSetupSaved?: (machineId: string) => void;
} = {}) {
  const queryClient = useQueryClient();
  const { user, isSuperAdmin } = useAuth();
  const companyChoices = useQuery({ queryKey: [...companyChoicesQueryKey, user?.id], queryFn: fetchCompanyChoices, enabled: isSuperAdmin, staleTime: 30000 });
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
  const [setupMachine, setSetupMachine] = useState<ImportedSetupMachine | null>(null);
  useEffect(() => { if (sourceSetup) setSetupMachine(sourceSetup); }, [sourceSetup]);
  const [isSettingUpMachine, setIsSettingUpMachine] = useState(false);
  const [lastSetupResult, setLastSetupResult] =
    useState<MapSourceMachineToPartnershipResult | null>(null);
  const [lastMappedMachineId, setLastMappedMachineId] = useState<string | null>(null);

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
  const snapcaseMachineQueue = useMemo(
    () => overview?.snapcaseMachineQueue ?? [],
    [overview?.snapcaseMachineQueue]
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

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['admin-reporting-overview'] }),
    queryClient.invalidateQueries({ queryKey: ['admin-partnership-reporting-setup'] }),
    queryClient.invalidateQueries({ queryKey: ['admin-machine-workspace-metadata'] }),
  ]);

  const setupImportedMachine = async (form: ImportedMachineSetupForm) => {
    if (!setupMachine) return;

    const selectedPartnership = partnerships.find(
      (partnership) => partnership.id === form.partnershipId
    );
    if (setupMachine.provider === 'sunze' && !selectedPartnership) {
      toast.error('Choose the report this machine belongs to.');
      return;
    }

    if (setupMachine.provider === 'sunze' || form.mappingMode === 'new') {
      const assignmentError = validateCompanyAssignment(form, companyChoices.data?.companies ?? [], setupMachine.provider === 'sunze' ? form.savedAssignment : null, setupMachine.provider === 'snapcase');
      if (assignmentError) { toast.error(assignmentError); return; }
    }

    if (setupMachine.provider === 'snapcase') {
      if (form.mappingMode === 'existing' && !form.reportingMachineId) {
        toast.error('Choose the existing Hub machine.');
        return;
      }
      if (
        form.mappingMode === 'new' &&
        (!form.accountId || !form.machineLabel.trim() || (!form.locationId && !form.locationName.trim()))
      ) {
        toast.error('Choose a company and enter the Machine name and time zone.');
        return;
      }

      setIsSettingUpMachine(true);
      try {
        const effectiveWindow = getSnapCaseMappingEffectiveWindow(
          setupMachine.machine,
          selectedPartnership,
          new Date().toISOString().slice(0, 10)
        );
        const result = await mapSnapCaseMachineAdmin({
          providerAccountId: setupMachine.machine.providerAccountId,
          sourceMachineId: setupMachine.machine.sourceMachineId,
          reportingMachineId: form.mappingMode === 'existing' ? form.reportingMachineId : null,
          accountId: form.mappingMode === 'new' ? form.accountId : null,
          locationId: form.mappingMode === 'new' ? form.locationId : null,
          locationName: form.mappingMode === 'new' && form.addLocation ? form.locationName.trim() : null,
          locationTimezone: form.mappingMode === 'new' && form.addLocation ? form.locationTimezone : null,
          machineLabel: form.mappingMode === 'new' ? form.machineLabel.trim() : null,
          partnershipId: selectedPartnership?.id ?? null,
          effectiveStartDate: effectiveWindow.effectiveStartDate,
          effectiveEndDate: effectiveWindow.effectiveEndDate,
          reason: importedMachineSetupReason,
        });
        trackEvent('admin_snapcase_machine_mapping_completed', {
          source_machine_id: result.sourceMachineId,
          machine_id: result.machineId,
          created_machine: result.createdMachine,
        });
        toast.success(`${result.machineLabel || 'SnapCase machine'} mapped to ${result.partnershipName}.`);
        setSetupMachine(null);
        setLastMappedMachineId(result.machineId);
        await refresh();
        onSourceSetupSaved?.(result.machineId);
      } catch (setupError) {
        toast.error(setupError instanceof Error ? setupError.message : 'Unable to map SnapCase machine.');
      } finally {
        setIsSettingUpMachine(false);
      }
      return;
    }

    if (
      !form.machineLabel.trim() ||
      (!form.locationId && !form.addLocation)
    ) {
      toast.error('Enter a Machine name and choose a location.');
      return;
    }

    setIsSettingUpMachine(true);
    try {
      const result = await mapSourceMachineToPartnershipAdmin({
        externalMachineId: setupMachine.machine.sunzeMachineId,
        partnershipId: selectedPartnership!.id,
        machineLabel: form.machineLabel.trim(),
        accountId: form.accountId,
        locationId: form.addLocation ? null : form.locationId,
        locationName: form.addLocation ? form.locationName.trim() : null,
        locationTimezone: form.addLocation ? form.locationTimezone : null,
        expectedAccountId: form.expectedAccountId,
        expectedLocationId: form.expectedLocationId,
        machineType: form.machineType,
        // Compatibility value for the existing setup RPC. Reporting resolves
        // actual tax from verified source evidence; this never writes a reader.
        taxRatePercent: 0,
        assignmentStartDate: selectedPartnership!.effective_start_date,
        assignmentEndDate: selectedPartnership!.effective_end_date,
        taxEffectiveStartDate: selectedPartnership!.effective_start_date,
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
      setLastMappedMachineId(result.machineId);
      setSetupMachine(null);
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: ['admin-partnership-reporting-setup'] }),
        queryClient.invalidateQueries({ queryKey: ['partner-dashboard-partnerships'] }),
        queryClient.invalidateQueries({ queryKey: ['partner-dashboard-period-preview'] }),
      ]);
      onSourceSetupSaved?.(result.machineId);
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

  if (sourceSetup !== undefined) return <ImportedMachineSetupDialog machine={setupMachine} partnerships={partnerships} machines={machines} isSaving={isSettingUpMachine} onOpenChange={(open) => { if (!open) { setSetupMachine(null); onSourceSetupClosed?.(); } }} onSave={setupImportedMachine}/>;

  if (discoveryOnly) return <section className="mt-5 space-y-4" aria-label="Imported source discovery">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Discover source machines</h2><p className="text-sm text-muted-foreground">Review original source identities and connect them to an existing Hub machine before creating another record.</p></div><Button variant="outline" onClick={() => void refresh()} disabled={isFetching}>Refresh sources</Button></div>
    {error ? <p role="alert">Unable to load source discovery. Refresh to retry.</p> : isLoading ? <LoadingCard/> : <SyncTab importRuns={importRuns} partnerships={partnerships} sunzeMachineQueue={sunzeMachineQueue} snapcaseMachineQueue={snapcaseMachineQueue} refundReviewRows={[]} pendingSunzeMachineCount={pendingSunzeMachineQueue.length} updatingSunzeMachineId={updatingSunzeMachineId} onSetupMachine={(machine) => setSetupMachine({ provider: 'sunze', machine })} onSetupSnapCaseMachine={(machine) => setSetupMachine({ provider: 'snapcase', machine })} setSunzeQueueStatus={setSunzeQueueStatus} discoveryOnly />}
    {lastSetupResult && <ImportedMachineSetupReceipt result={lastSetupResult} onDismiss={() => setLastSetupResult(null)}/>}
    {lastMappedMachineId && <MachineIdentityMapping machineId={lastMappedMachineId} canEdit={isSuperAdmin} onSaved={refresh}/>}
    <ImportedMachineSetupDialog machine={setupMachine} partnerships={partnerships} machines={machines} isSaving={isSettingUpMachine} onOpenChange={(open) => { if (!open) setSetupMachine(null); }} onSave={setupImportedMachine}/>
  </section>;

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

          <AdminReportingServiceStatus />
          <p className="mt-4 text-sm text-muted-foreground">
            <Link to="/admin/partnerships?step=preview" className="font-medium text-primary underline underline-offset-4">
              Partner report setup
            </Link>{' '}
            shows export blockers in Weekly Preview. Choose the partnership and reporting week to review.
          </p>

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
                  snapcaseMachineQueue={snapcaseMachineQueue}
                  refundReviewRows={refundReviewRows}
                  pendingSunzeMachineCount={pendingSunzeMachineQueue.length}
                  updatingSunzeMachineId={updatingSunzeMachineId}
                  onSetupMachine={(machine) => setSetupMachine({ provider: 'sunze', machine })}
                  onSetupSnapCaseMachine={(machine) => setSetupMachine({ provider: 'snapcase', machine })}
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
        machines={machines}
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
  snapcaseMachineQueue,
  refundReviewRows,
  pendingSunzeMachineCount,
  updatingSunzeMachineId,
  onSetupMachine,
  onSetupSnapCaseMachine,
  setSunzeQueueStatus,
  discoveryOnly = false,
}: {
  importRuns: AdminReportingImportRun[];
  partnerships: AdminReportingPartnershipOption[];
  sunzeMachineQueue: AdminSunzeMachineQueueItem[];
  snapcaseMachineQueue: AdminSnapCaseMachineQueueItem[];
  refundReviewRows: AdminRefundAdjustmentReviewRow[];
  pendingSunzeMachineCount: number;
  updatingSunzeMachineId: string | null;
  onSetupMachine: (machine: AdminSunzeMachineQueueItem) => void;
  onSetupSnapCaseMachine: (machine: AdminSnapCaseMachineQueueItem) => void;
  setSunzeQueueStatus: (
    machine: AdminSunzeMachineQueueItem,
    status: 'pending' | 'ignored'
  ) => void;
  discoveryOnly?: boolean;
}) {
  if (discoveryOnly) {
    sunzeMachineQueue = sunzeMachineQueue.filter((machine) => machine.status === 'pending');
    snapcaseMachineQueue = snapcaseMachineQueue.filter((machine) => machine.mappingStatus === 'pending');
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-foreground">SnapCase Machines</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {snapcaseMachineQueue.filter((machine) => machine.mappingStatus === 'pending').length} discovered machine(s) need a Hub machine and reporting account mapping.
            </p>
          </div>
          <Badge variant="outline">Private staging</Badge>
        </div>
        {snapcaseMachineQueue.length === 0 ? (
          <EmptyRow text="No SnapCase source machines discovered." />
        ) : (
          snapcaseMachineQueue.map((machine) => (
            <Row key={`${machine.providerAccountId}:${machine.sourceMachineId}`}>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium text-foreground">
                    {machine.sourceLabel || machine.sourceMachineId}
                  </div>
                  <Badge variant={machine.mappingStatus === 'mapped' ? 'default' : 'outline'}>
                    {machine.mappingStatus}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  SnapCase machine ID {machine.sourceMachineId} / account {machine.sourceAccountKey}
                  {machine.sourceMerchantName ? ` / ${machine.sourceMerchantName}` : ''}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Provider inventory reference {machine.sourceInventoryId ?? 'n/a'} / {machine.stagedObservationCount} staged observation(s)
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:items-end">
                <div className="text-xs text-muted-foreground">Seen {formatDate(machine.lastSeenAt)}</div>
                <Button
                  type="button"
                  size="sm"
                  className="min-h-11"
                  disabled={partnerships.length === 0}
                  onClick={() => onSetupSnapCaseMachine(machine)}
                >
                  {machine.mappingStatus === 'mapped' ? 'Review mapping' : 'Set up'}
                </Button>
              </div>
            </Row>
          ))
        )}
      </div>

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
                  {discoveryOnly && <ExistingSunzeMachineLink sourceMachineId={machine.sunzeMachineId} />}
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

      {!discoveryOnly && <RefundReviewPanel rows={refundReviewRows} />}

      {!discoveryOnly && <div className="rounded-lg border border-border bg-card">
        <ListHeader title="Recent Import Runs" count={importRuns.length} />
        {importRuns.length === 0 ? (
          <EmptyRow text="No sales import runs found." />
        ) : (
          importRuns.map((run) => <ImportRunRow key={run.id} run={run} />)
        )}
      </div>}
    </div>
  );
}

function ExistingSunzeMachineLink({ sourceMachineId }: { sourceMachineId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin-reporting-overview'], queryFn: fetchAdminReportingOverview, staleTime: 30000 });
  const [machineId, setMachineId] = useState('');
  const [saving, setSaving] = useState(false);
  async function link() {
    if (!machineId || saving) return;
    setSaving(true);
    try {
      await linkSunzeSourceToMachine(machineId, sourceMachineId);
      await Promise.all(['admin-reporting-overview','admin-partnership-reporting-setup','admin-machine-workspace-metadata'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      toast.success('Source connected to the existing Hub machine. Open Manage to choose its Nayax match.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to connect source.'); }
    finally { setSaving(false); }
  }
  return <div className="max-w-full space-y-2"><Label htmlFor={`existing-sunze-${sourceMachineId}`}>Connect existing Hub machine</Label><select id={`existing-sunze-${sourceMachineId}`} value={machineId} onChange={(event) => setMachineId(event.target.value)} disabled={saving} className="min-h-11 w-full max-w-sm rounded-md border border-input bg-background px-2 text-sm"><option value="">Choose an existing machine</option>{data?.machines.filter((item) => !item.sunze_machine_id || item.sunze_machine_id === sourceMachineId).map((item) => <option key={item.id} value={item.id}>{item.machine_label} · {item.customer_accounts?.name || 'Company unavailable'}</option>)}</select><Button variant="outline" onClick={() => void link()} disabled={!machineId || saving}>{saving ? 'Connecting…' : 'Connect source'}</Button></div>;
}

function ImportedMachineSetupDialog({
  machine,
  partnerships,
  machines,
  isSaving,
  onOpenChange,
  onSave,
}: {
  machine: ImportedSetupMachine | null;
  partnerships: AdminReportingPartnershipOption[];
  machines: AdminReportingMachine[];
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (form: ImportedMachineSetupForm) => void;
}) {
  const [form, setForm] = useState<ImportedMachineSetupForm>(emptyImportedMachineSetupForm);
  const loadedSourceKeyRef = useRef('');
  const sunzeMachine = machine?.provider === 'sunze' ? machine.machine : null;
  const snapcaseMachine = machine?.provider === 'snapcase' ? machine.machine : null;
  const sourceKey = machine ? `${machine.provider}:${machine.provider === 'sunze' ? machine.machine.sunzeMachineId : machine.machine.sourceMachineId}` : '';
  const formInitialized = Boolean(sourceKey && loadedSourceKeyRef.current === sourceKey);
  const recommendedPartnership = useMemo(
    () => getRecommendedPartnership(sunzeMachine, partnerships),
    [sunzeMachine, partnerships]
  );
  const selectedPartnership = partnerships.find(
    (partnership) => partnership.id === form.partnershipId
  );

  useEffect(() => {
    if (!machine) { loadedSourceKeyRef.current = ''; return; }
    const sourceKey = `${machine.provider}:${machine.provider === 'sunze' ? machine.machine.sunzeMachineId : machine.machine.sourceMachineId}`;
    if (loadedSourceKeyRef.current === sourceKey) return;
    loadedSourceKeyRef.current = sourceKey;
    const currentSunzeMachine = machine.provider === 'sunze' ? machine.machine : null;
    const currentSnapCaseMachine = machine.provider === 'snapcase' ? machine.machine : null;
    const recommended = getRecommendedPartnership(currentSunzeMachine, partnerships);
    const mappedMachine = currentSnapCaseMachine?.reportingMachineId
      ? machines.find((item) => item.id === currentSnapCaseMachine.reportingMachineId)
      : machines.find((item) => currentSunzeMachine && item.sunze_machine_id === currentSunzeMachine.sunzeMachineId);
    setForm({
      ...emptyImportedMachineSetupForm,
      partnershipId: currentSnapCaseMachine?.partnershipId ?? recommended?.partnership.id ?? '',
      mappingMode: currentSnapCaseMachine?.reportingMachineId ? 'existing' : 'new',
      reportingMachineId: currentSnapCaseMachine?.reportingMachineId ?? '',
      accountId: mappedMachine?.account_id ?? '',
      locationId: mappedMachine?.location_id ?? '',
      expectedAccountId: mappedMachine?.account_id ?? null,
      expectedLocationId: mappedMachine?.location_id ?? null,
      savedAssignment: mappedMachine?.account_id && mappedMachine.location_id ? {
        accountId: mappedMachine.account_id,
        accountName: mappedMachine.customer_accounts?.name ?? 'Saved company',
        locationId: mappedMachine.location_id,
        locationName: mappedMachine.reporting_locations?.name ?? 'Saved location',
        locationTimezone: mappedMachine.reporting_locations?.timezone ?? '',
      } : null,
      locationTimezone: mappedMachine?.reporting_locations?.timezone ?? '',
      machineLabel: mappedMachine?.machine_label ?? currentSnapCaseMachine?.sourceLabel ?? currentSunzeMachine?.sunzeMachineName ?? '',
      locationName: inferImportedMachineLocationName(currentSunzeMachine),
    });
  }, [machine, partnerships, machines]);

  return (
    <Dialog open={Boolean(machine)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" onEscapeKeyDown={(event) => { if (event.target instanceof HTMLElement && event.target.id.endsWith('-new-company')) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Set Up Imported Machine</DialogTitle>
          <DialogDescription>
            Choose the canonical Hub machine and reporting scope for this provider identity.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Imported machine
            </div>
            <div className="mt-1 font-medium text-foreground">
              {sunzeMachine?.sunzeMachineName ?? snapcaseMachine?.sourceLabel ?? sunzeMachine?.sunzeMachineId ?? snapcaseMachine?.sourceMachineId ?? 'Imported machine'}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {snapcaseMachine
                ? `${snapcaseMachine.stagedObservationCount} private staged observations`
                : `${sunzeMachine?.pendingRowCount ?? 0} queued rows / ${formatCents(sunzeMachine?.pendingRevenueCents ?? 0)}`}
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
              <Label htmlFor="imported-machine-partnership">
                Report / partnership{snapcaseMachine ? ' (optional)' : ''}
              </Label>
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
              <p className="text-sm font-medium">{snapcaseMachine ? 'Kexiaozhan' : 'Sunze'} machine ID</p>
              <p id="imported-machine-external-id" className="mt-1 break-all text-sm text-muted-foreground">{sunzeMachine?.sunzeMachineId ?? snapcaseMachine?.sourceMachineId ?? ''}</p>
            </div>
            {snapcaseMachine && (
              <div>
                <Label htmlFor="imported-machine-mode">Hub machine</Label>
                <select
                  id="imported-machine-mode"
                  value={form.mappingMode}
                  onChange={(event) => setForm({ ...form, mappingMode: event.target.value as 'existing' | 'new' })}
                  className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="existing">Link an existing machine</option>
                  <option value="new">Create a new SnapCase machine</option>
                </select>
              </div>
            )}
            {snapcaseMachine && form.mappingMode === 'existing' && (
              <div>
                <Label htmlFor="imported-machine-existing">Existing Hub machine</Label>
                <select
                  id="imported-machine-existing"
                  value={form.reportingMachineId}
                  onChange={(event) => setForm({ ...form, reportingMachineId: event.target.value })}
                  className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Choose machine</option>
                  {machines
                    .filter(isEligibleExistingSnapCaseMachine)
                    .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.machine_label} — {item.customer_accounts?.name ?? 'Unknown company'} — {formatMachineType(item.machine_type)}{item.machine_type !== 'snapcase' ? ' · Nayax linked' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {formInitialized && (!snapcaseMachine || form.mappingMode === 'new') && <CompanyAssignmentFields id="imported-machine" internalLocationName={`Unmapped Hub ${snapcaseMachine ? `Kexiaozhan ${snapcaseMachine.providerAccountId} ${snapcaseMachine.sourceMachineId}` : `Sunze ${sunzeMachine?.sunzeMachineId || 'new-machine'}`}`} value={form} saved={sunzeMachine ? form.savedAssignment : null} enabled={Boolean(machine)} disabled={isSaving} activeTargetsOnly={Boolean(snapcaseMachine)} onChange={(assignment) => setForm((current) => ({ ...current, ...assignment }))} />}
            {(!snapcaseMachine || form.mappingMode === 'new') && <div>
              <Label htmlFor="imported-machine-label">Machine name</Label>
              <Input
                id="imported-machine-label"
                value={form.machineLabel}
                onChange={(event) => setForm({ ...form, machineLabel: event.target.value })}
                placeholder={sunzeMachine?.sunzeMachineName ?? snapcaseMachine?.sourceLabel ?? 'Machine label'}
                className="h-11"
              />
            </div>}
            {!snapcaseMachine && <div>
              <Label htmlFor="imported-machine-type">Machine type</Label>
              <select
                id="imported-machine-type"
                value={form.machineType}
                onChange={(event) =>
                  setForm({ ...form, machineType: event.target.value as CanonicalMachineType })
                }
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {machineTypes.map((machineType) => (
                  <option key={machineType} value={machineType}>
                    {formatMachineType(machineType)}
                  </option>
                ))}
              </select>
            </div>}
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
            disabled={isSaving || !machine || ((!snapcaseMachine || form.mappingMode === 'new') && !form.accountId) || (machine.provider === 'sunze' && !form.partnershipId)}
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
    const exportWindow = reserveSignedExportWindow();
    setOpeningArtifactKey(artifactKey);

    try {
      const signedUrl = await createReportExportSignedUrl(artifact.storagePath);
      openSignedExportUrl(signedUrl, exportWindow);
    } catch (error) {
      closeReservedSignedExportWindow(exportWindow);
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
