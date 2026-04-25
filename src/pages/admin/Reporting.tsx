import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
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
  type AdminReportSchedule,
  type AdminReportViewSnapshot,
  type AdminReportingImportRun,
} from '@/lib/reporting';
import { trackEvent } from '@/lib/analytics';

const splitEmails = (value: string) =>
  value
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

const formatDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'n/a';

const formatStatusVariant = (status: string) => {
  if (status === 'completed' || status === 'ready') return 'default';
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
  const latestRun = importRuns[0] ?? null;
  const latestCompletedRun =
    importRuns.find((run) => run.status === 'completed' && run.completed_at) ?? null;

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-reporting-overview'] });

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
              {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Unable to load reporting overview.
            </div>
          )}

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <StatusCard
              icon={<Database className="h-5 w-5" />}
              label="Latest Sunze Run"
              value={latestRun ? latestRun.status : 'none'}
              detail={latestRun ? formatDate(latestRun.completed_at ?? latestRun.created_at) : 'No imports yet'}
              status={latestRun?.status}
            />
            <StatusCard
              icon={<CheckCircle2 className="h-5 w-5" />}
              label="Last Completed Import"
              value={latestCompletedRun ? `${latestCompletedRun.rows_imported} rows` : 'none'}
              detail={latestCompletedRun ? formatDate(latestCompletedRun.completed_at) : 'No successful imports yet'}
              status={latestCompletedRun ? 'completed' : 'pending'}
            />
            <StatusCard
              icon={<CalendarDays className="h-5 w-5" />}
              label="Active Schedules"
              value={String(schedules.filter((schedule) => schedule.active).length)}
              detail={`${snapshots.length} recent export snapshots`}
              status="completed"
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
              {isLoading ? <LoadingCard /> : <SyncTab importRuns={importRuns} />}
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
          reports will be driven by the Partnerships setup once approved.
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
              onChange={(event) => setScheduleForm({ ...scheduleForm, machineId: event.target.value })}
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
            {isCreatingSchedule ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarDays className="mr-2 h-4 w-4" />}
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
                  Day {schedule.send_day_of_week} at {schedule.send_hour_local}:00 / {schedule.timezone}
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

function SyncTab({ importRuns }: { importRuns: AdminReportingImportRun[] }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <ListHeader title="Recent Import Runs" count={importRuns.length} />
      {importRuns.length === 0 ? (
        <EmptyRow text="No sales import runs found." />
      ) : (
        importRuns.map((run) => (
          <Row key={run.id}>
            <div>
              <div className="font-medium text-foreground">{run.source}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {run.source_reference ?? 'no source reference'} / started {formatDate(run.started_at)}
              </div>
              {run.error_message && (
                <div className="mt-2 flex items-start gap-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
                  {run.error_message}
                </div>
              )}
            </div>
            <div className="text-right text-sm">
              <Badge variant={formatStatusVariant(run.status)}>{run.status}</Badge>
              <div className="mt-2 text-xs text-muted-foreground">
                seen {run.rows_seen} / imported {run.rows_imported} / skipped {run.rows_skipped}
              </div>
            </div>
          </Row>
        ))
      )}
    </div>
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
              <div className="font-medium text-foreground">{snapshot.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Created {formatDate(snapshot.created_at)} / {snapshot.export_storage_path ?? 'no file yet'}
              </div>
              {snapshot.error_message && (
                <div className="mt-2 text-xs text-destructive">{snapshot.error_message}</div>
              )}
            </div>
            <Badge variant={formatStatusVariant(snapshot.export_status)}>{snapshot.export_status}</Badge>
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
