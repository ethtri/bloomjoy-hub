import { useMemo, useState } from 'react';
import { BarChart3, Loader2, RefreshCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createReportScheduleAdmin,
  fetchAdminReportingOverview,
  grantMachineReportAccessAdmin,
  type ReportingAccessLevel,
  type ReportingMachineType,
  upsertReportingMachineAdmin,
} from '@/lib/reporting';
import { trackEvent } from '@/lib/analytics';

const machineTypes: ReportingMachineType[] = ['commercial', 'mini', 'micro', 'unknown'];
const accessLevels: ReportingAccessLevel[] = ['viewer', 'report_manager'];

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

const splitEmails = (value: string) =>
  value
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

export default function AdminReportingPage() {
  const queryClient = useQueryClient();
  const [machineForm, setMachineForm] = useState({
    accountName: 'Bubble Planet',
    locationName: 'Bubble Planet',
    machineLabel: 'Bubble Planet Machine 1',
    machineType: 'commercial' as ReportingMachineType,
    sunzeMachineId: 'BUBBLE-PLANET-01',
    reason: 'Initial reporting setup',
  });
  const [accessForm, setAccessForm] = useState({
    userEmail: '',
    machineId: '',
    accessLevel: 'viewer' as ReportingAccessLevel,
    reason: 'Weekly partner sales reporting access',
  });
  const [scheduleForm, setScheduleForm] = useState({
    title: 'Bubble Planet weekly machine sales',
    machineId: '',
    recipients: '',
    dayOfWeek: '1',
    sendHourLocal: '9',
    timezone: 'America/Los_Angeles',
  });
  const [isSavingMachine, setIsSavingMachine] = useState(false);
  const [isGrantingAccess, setIsGrantingAccess] = useState(false);
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
  const entitlements = useMemo(() => overview?.entitlements ?? [], [overview?.entitlements]);

  const machineOptions = useMemo(
    () =>
      machines.map((machine) => ({
        id: machine.id,
        label: `${machine.machine_label} (${machine.sunze_machine_id ?? 'no Sunze ID'})`,
      })),
    [machines]
  );

  const refreshReporting = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-reporting-overview'] });
  };

  const saveMachine = async () => {
    if (!machineForm.accountName.trim() || !machineForm.locationName.trim()) {
      toast.error('Account and location are required.');
      return;
    }

    if (!machineForm.machineLabel.trim() || !machineForm.reason.trim()) {
      toast.error('Machine label and reason are required.');
      return;
    }

    setIsSavingMachine(true);
    try {
      await upsertReportingMachineAdmin({
        accountName: machineForm.accountName.trim(),
        locationName: machineForm.locationName.trim(),
        machineLabel: machineForm.machineLabel.trim(),
        machineType: machineForm.machineType,
        sunzeMachineId: machineForm.sunzeMachineId.trim() || null,
        reason: machineForm.reason.trim(),
      });
      trackEvent('admin_reporting_machine_upserted', {
        sunze_machine_id: machineForm.sunzeMachineId.trim(),
      });
      toast.success('Reporting machine saved.');
      await refreshReporting();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Unable to save machine.');
    } finally {
      setIsSavingMachine(false);
    }
  };

  const grantAccess = async () => {
    if (!accessForm.userEmail.trim() || !accessForm.machineId || !accessForm.reason.trim()) {
      toast.error('Email, machine, and reason are required.');
      return;
    }

    setIsGrantingAccess(true);
    try {
      await grantMachineReportAccessAdmin({
        userEmail: accessForm.userEmail.trim(),
        machineId: accessForm.machineId,
        accessLevel: accessForm.accessLevel,
        reason: accessForm.reason.trim(),
      });
      trackEvent('admin_reporting_access_granted', {
        machine_id: accessForm.machineId,
        access_level: accessForm.accessLevel,
      });
      toast.success('Report access granted.');
      await refreshReporting();
    } catch (grantError) {
      toast.error(grantError instanceof Error ? grantError.message : 'Unable to grant access.');
    } finally {
      setIsGrantingAccess(false);
    }
  };

  const createSchedule = async () => {
    const recipientEmails = splitEmails(scheduleForm.recipients);
    if (!scheduleForm.title.trim() || recipientEmails.length === 0) {
      toast.error('Schedule title and at least one recipient are required.');
      return;
    }

    setIsCreatingSchedule(true);
    try {
      await createReportScheduleAdmin({
        title: scheduleForm.title.trim(),
        filters: {
          title: scheduleForm.title.trim(),
          datePreset: 'previous_week',
          grain: 'week',
          machineIds: scheduleForm.machineId ? [scheduleForm.machineId] : [],
          paymentMethods: [],
        },
        recipientEmails,
        dayOfWeek: Number(scheduleForm.dayOfWeek),
        sendHourLocal: Number(scheduleForm.sendHourLocal),
        timezone: scheduleForm.timezone,
      });
      trackEvent('admin_report_schedule_created', {
        title: scheduleForm.title.trim(),
        recipient_count: recipientEmails.length,
      });
      toast.success('Report schedule created.');
      await refreshReporting();
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
                Sales Reporting
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Configure reportable machines, partner access, import status, and scheduled PDF
                delivery.
              </p>
            </div>
            <Button variant="outline" onClick={refreshReporting} disabled={isFetching}>
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
              Unable to load reporting configuration.
            </div>
          )}

          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <div className="card-elevated p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Machines
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{machines.length}</p>
            </div>
            <div className="card-elevated p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Entitlements
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{entitlements.length}</p>
            </div>
            <div className="card-elevated p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Schedules
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{schedules.length}</p>
            </div>
            <div className="card-elevated p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Last Import
              </p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {formatDate(importRuns[0]?.completed_at ?? importRuns[0]?.created_at ?? null)}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <BarChart3 className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="font-semibold text-foreground">Register Machine</h2>
                  <p className="text-sm text-muted-foreground">Map a Sunze machine into reporting.</p>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                <Input
                  value={machineForm.accountName}
                  onChange={(event) =>
                    setMachineForm((current) => ({ ...current, accountName: event.target.value }))
                  }
                  placeholder="Account name"
                />
                <Input
                  value={machineForm.locationName}
                  onChange={(event) =>
                    setMachineForm((current) => ({ ...current, locationName: event.target.value }))
                  }
                  placeholder="Location name"
                />
                <Input
                  value={machineForm.machineLabel}
                  onChange={(event) =>
                    setMachineForm((current) => ({ ...current, machineLabel: event.target.value }))
                  }
                  placeholder="Machine label"
                />
                <select
                  value={machineForm.machineType}
                  onChange={(event) =>
                    setMachineForm((current) => ({
                      ...current,
                      machineType: event.target.value as ReportingMachineType,
                    }))
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {machineTypes.map((machineType) => (
                    <option key={machineType} value={machineType}>
                      {machineType}
                    </option>
                  ))}
                </select>
                <Input
                  value={machineForm.sunzeMachineId}
                  onChange={(event) =>
                    setMachineForm((current) => ({
                      ...current,
                      sunzeMachineId: event.target.value,
                    }))
                  }
                  placeholder="Sunze machine ID"
                />
                <Input
                  value={machineForm.reason}
                  onChange={(event) =>
                    setMachineForm((current) => ({ ...current, reason: event.target.value }))
                  }
                  placeholder="Required update reason"
                />
                <Button onClick={saveMachine} disabled={isSavingMachine}>
                  {isSavingMachine ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Machine'
                  )}
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
              <h2 className="font-semibold text-foreground">Grant Report Access</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Give a user or partner visibility into one configured machine.
              </p>
              <div className="mt-5 space-y-3">
                <Input
                  value={accessForm.userEmail}
                  onChange={(event) =>
                    setAccessForm((current) => ({ ...current, userEmail: event.target.value }))
                  }
                  placeholder="User email"
                />
                <select
                  value={accessForm.machineId}
                  onChange={(event) =>
                    setAccessForm((current) => ({ ...current, machineId: event.target.value }))
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select machine</option>
                  {machineOptions.map((machine) => (
                    <option key={machine.id} value={machine.id}>
                      {machine.label}
                    </option>
                  ))}
                </select>
                <select
                  value={accessForm.accessLevel}
                  onChange={(event) =>
                    setAccessForm((current) => ({
                      ...current,
                      accessLevel: event.target.value as ReportingAccessLevel,
                    }))
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {accessLevels.map((accessLevel) => (
                    <option key={accessLevel} value={accessLevel}>
                      {accessLevel}
                    </option>
                  ))}
                </select>
                <Input
                  value={accessForm.reason}
                  onChange={(event) =>
                    setAccessForm((current) => ({ ...current, reason: event.target.value }))
                  }
                  placeholder="Required grant reason"
                />
                <Button onClick={grantAccess} disabled={isGrantingAccess || machines.length === 0}>
                  {isGrantingAccess ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Granting...
                    </>
                  ) : (
                    'Grant Access'
                  )}
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
              <h2 className="font-semibold text-foreground">Schedule Partner PDF</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a Monday weekly PDF schedule for partner recipients.
              </p>
              <div className="mt-5 space-y-3">
                <Input
                  value={scheduleForm.title}
                  onChange={(event) =>
                    setScheduleForm((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder="Schedule title"
                />
                <select
                  value={scheduleForm.machineId}
                  onChange={(event) =>
                    setScheduleForm((current) => ({ ...current, machineId: event.target.value }))
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">All machines in report filter</option>
                  {machineOptions.map((machine) => (
                    <option key={machine.id} value={machine.id}>
                      {machine.label}
                    </option>
                  ))}
                </select>
                <Input
                  value={scheduleForm.recipients}
                  onChange={(event) =>
                    setScheduleForm((current) => ({ ...current, recipients: event.target.value }))
                  }
                  placeholder="partner@example.com, finance@example.com"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    type="number"
                    min={0}
                    max={6}
                    value={scheduleForm.dayOfWeek}
                    onChange={(event) =>
                      setScheduleForm((current) => ({
                        ...current,
                        dayOfWeek: event.target.value,
                      }))
                    }
                    placeholder="Day of week"
                  />
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={scheduleForm.sendHourLocal}
                    onChange={(event) =>
                      setScheduleForm((current) => ({
                        ...current,
                        sendHourLocal: event.target.value,
                      }))
                    }
                    placeholder="Hour"
                  />
                </div>
                <Input
                  value={scheduleForm.timezone}
                  onChange={(event) =>
                    setScheduleForm((current) => ({ ...current, timezone: event.target.value }))
                  }
                  placeholder="Timezone"
                />
                <Button onClick={createSchedule} disabled={isCreatingSchedule}>
                  {isCreatingSchedule ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Schedule'
                  )}
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="font-semibold text-foreground">Reporting Machines</h2>
              </div>
              <table className="min-w-[680px] w-full">
                <thead className="border-b border-border bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Machine
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Location
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Sunze ID
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={3} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        Loading machines...
                      </td>
                    </tr>
                  )}
                  {!isLoading && machines.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No reporting machines configured.
                      </td>
                    </tr>
                  )}
                  {machines.map((machine) => (
                    <tr key={machine.id} className="border-b border-border/70">
                      <td className="px-4 py-3 text-sm text-foreground">
                        <div className="font-medium">{machine.machine_label}</div>
                        <div className="text-xs text-muted-foreground">
                          {machine.customer_accounts?.name ?? 'No account'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {machine.reporting_locations?.name ?? 'No location'}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {machine.sunze_machine_id ?? 'n/a'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="font-semibold text-foreground">Recent Import Runs</h2>
              </div>
              <table className="min-w-[680px] w-full">
                <thead className="border-b border-border bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Source
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Rows
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {importRuns.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No imports recorded yet.
                      </td>
                    </tr>
                  ) : (
                    importRuns.map((run) => (
                      <tr key={run.id} className="border-b border-border/70">
                        <td className="px-4 py-3 text-sm text-foreground">
                          <div className="font-medium">{run.source}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDate(run.completed_at ?? run.created_at)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {run.status}
                          {run.error_message ? `: ${run.error_message}` : ''}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {run.rows_imported}/{run.rows_seen}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
              <h2 className="font-semibold text-foreground">Active Schedules</h2>
              <div className="mt-4 space-y-3">
                {schedules.length === 0 ? (
                  <div className="rounded-lg border border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
                    No scheduled PDFs yet.
                  </div>
                ) : (
                  schedules.map((schedule) => (
                    <div key={schedule.id} className="rounded-lg border border-border bg-background p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground">{schedule.title}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {schedule.schedule_kind}, day {schedule.send_day_of_week} at{' '}
                            {schedule.send_hour_local}:00 {schedule.timezone}
                          </p>
                        </div>
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                          {schedule.active ? 'active' : 'paused'}
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">
                        Recipients:{' '}
                        {schedule.report_schedule_recipients?.map((recipient) => recipient.email).join(', ') ||
                          'none'}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
              <h2 className="font-semibold text-foreground">Recent Entitlements</h2>
              <div className="mt-4 space-y-3">
                {entitlements.length === 0 ? (
                  <div className="rounded-lg border border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
                    No report entitlements granted yet.
                  </div>
                ) : (
                  entitlements.map((entitlement) => (
                    <div key={entitlement.id} className="rounded-lg border border-border bg-background p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-xs text-muted-foreground">
                            {entitlement.user_id}
                          </p>
                          <p className="mt-1 font-semibold text-foreground">
                            {entitlement.reporting_machines?.machine_label ??
                              entitlement.reporting_locations?.name ??
                              entitlement.customer_accounts?.name ??
                              'Scoped access'}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {entitlement.grant_reason}
                          </p>
                        </div>
                        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          {entitlement.access_level}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
