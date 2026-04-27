import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  createReportScheduleAdmin,
  fetchAdminReportingOverview,
  setSunzeMachineDiscoveryStatusAdmin,
  type AdminReportSchedule,
  type AdminReportViewSnapshot,
  type AdminRefundAdjustmentReviewRow,
  type AdminReportingImportRun,
  type AdminSunzeMachineQueueItem,
} from '@/lib/reporting';
import { trackEvent } from '@/lib/analytics';

const sunzeStaleHours = 30;

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
    ? 'Needs Mapping'
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
      : 'No Sunze imports yet';

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-reporting-overview'] });

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
            : 'Reopened for reporting machine mapping',
      });
      trackEvent('admin_sunze_machine_discovery_status_updated', {
        sunze_machine_id: machine.sunzeMachineId,
        status,
      });
      toast.success(status === 'ignored' ? 'Sunze machine ignored.' : 'Sunze machine reopened.');
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
      <section className="section-padding">
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
                Monitor Sunze sync health, scheduled deliveries, and report exports. User access
                lives in Admin Access; machine and partnership setup lives in Admin Partnerships.
              </p>
            </div>
            <Button variant="outline" onClick={refresh} disabled={isFetching}>
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
              label="Sunze Sync Health"
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

          <Tabs defaultValue="schedules" className="mt-6">
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="schedules">Schedules</TabsTrigger>
              <TabsTrigger value="sync">Sync</TabsTrigger>
              <TabsTrigger value="exports">Exports</TabsTrigger>
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
                  sunzeMachineQueue={sunzeMachineQueue}
                  refundReviewRows={refundReviewRows}
                  pendingSunzeMachineCount={pendingSunzeMachineQueue.length}
                  updatingSunzeMachineId={updatingSunzeMachineId}
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
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All accessible machines in filter</option>
              {machines.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.machine_label} / {machine.sunze_machine_id ?? 'no Sunze ID'}
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
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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
              />
            </div>
          </div>
          <Button onClick={createSchedule} disabled={isCreatingSchedule}>
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
  sunzeMachineQueue,
  refundReviewRows,
  pendingSunzeMachineCount,
  updatingSunzeMachineId,
  setSunzeQueueStatus,
}: {
  importRuns: AdminReportingImportRun[];
  sunzeMachineQueue: AdminSunzeMachineQueueItem[];
  refundReviewRows: AdminRefundAdjustmentReviewRow[];
  pendingSunzeMachineCount: number;
  updatingSunzeMachineId: string | null;
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
            <h2 className="font-semibold text-foreground">Sunze Mapping Queue</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {pendingSunzeMachineCount} pending machine
              {pendingSunzeMachineCount === 1 ? '' : 's'} with queued sales.
            </p>
          </div>
          {pendingSunzeMachineCount > 0 && (
            <Badge variant="outline" className="w-fit text-amber-700">
              Needs mapping
            </Badge>
          )}
        </div>
        {sunzeMachineQueue.length === 0 ? (
          <EmptyRow text="No discovered Sunze machines need action." />
        ) : (
          sunzeMachineQueue.map((machine) => {
            const mappingUrl = `/admin/machines?sunzeMachineId=${encodeURIComponent(
              machine.sunzeMachineId
            )}&sunzeMachineName=${encodeURIComponent(
              machine.sunzeMachineName ?? machine.sunzeMachineId
            )}`;
            return (
              <Row key={machine.sunzeMachineId}>
                <div>
                  <div className="font-medium text-foreground">
                    {machine.sunzeMachineName ?? machine.sunzeMachineId}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Sunze {machine.sunzeMachineId} / status {machine.status}
                  </div>
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
                    <Button asChild size="sm">
                      <Link to={mappingUrl}>Map</Link>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
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
            );
          })
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

const importSourceLabel = (source: string) => {
  if (source === 'google_sheets_refunds') return 'Refund adjustments';
  return source;
};

function ImportRunRow({ run }: { run: AdminReportingImportRun }) {
  const meta = run.meta ?? {};
  const isRefundImport = run.source === 'google_sheets_refunds';
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
          {isRefundImport ? 'reviewed adjustment import' : run.source_reference ?? 'no source reference'} / started{' '}
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
            {run.error_message}
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
                {snapshot.export_storage_path ?? 'no file yet'}
              </div>
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
