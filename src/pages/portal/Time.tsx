import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Edit3,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { PortalPageIntro } from '@/components/portal/PortalPageIntro';
import { cn } from '@/lib/utils';
import {
  calculateOperatorPaidShifts,
  downloadOperatorPayStatementHtml,
  fetchMyOperatorPayStatementContext,
  fetchMyOperatorTimekeepingContext,
  fetchPayStatementArtifact,
  formatOperatorPayStatementLabel,
  saveCompletedOperatorTimeEntry,
  voidOperatorTimeEntry,
  type OperatorAssignedMachine,
  type OperatorPayStatementSummary,
  type OperatorTimeEntry,
  type OperatorTimekeepingContext,
  type OperatorTimekeepingProfileContext,
} from '@/lib/operatorPayouts';
import {
  addPlainDateDays,
  combineDateAndTimeInTimekeepingZone,
  describeTimekeepingError,
  getActualDurationMinutes,
  getTodayInTimekeepingZone,
  getWeekDates,
  getWeekMonthAnchors,
  getWeekStart,
  isCompletedTimeInFuture,
  timeDraftMatchesEntry,
  timeDraftOverlapsEntry,
  TIMEKEEPING_TIME_ZONE,
} from '@/lib/timekeepingUi';

type TimeEntryForm = {
  workDate: string;
  machineId: string;
  startTime: string;
  endTime: string;
};

type FormErrors = Partial<Record<keyof TimeEntryForm | 'form', string>>;

const getContextQueryKey = (monthAnchor: string) =>
  ['operator-timekeeping', monthAnchor] as const;
const getPayStubsQueryKey = ['operator-pay-statements'] as const;
const editablePeriodStatuses = new Set(['open', 'grace_period', 'reopened']);

const isDateValue = (value: string | null): value is string =>
  Boolean(value && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value));

const isMonthValue = (value: string | null): value is string =>
  Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));

const formatPlainDate = (
  value: string,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
) =>
  new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(
    new Date(`${value}T12:00:00.000Z`)
  );

const formatTime = (value: string) => {
  const [hour, minute] = value.split(':').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
};

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  if (!remainder) return `${hours} hr${hours === 1 ? '' : 's'}`;
  return `${hours} hr ${remainder} min`;
};

const formatCurrency = (cents: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);

const formatCutoff = (cutoffAt: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TIMEKEEPING_TIME_ZONE,
  }).format(new Date(new Date(cutoffAt).getTime() - 60_000));

const machineIsEffective = (machine: OperatorAssignedMachine, workDate: string) =>
  machine.effectiveStartDate <= workDate &&
  (!machine.effectiveEndDate || machine.effectiveEndDate >= workDate);

const machineLabel = (machine: Pick<OperatorAssignedMachine, 'machineLabel' | 'locationName'>) =>
  `${machine.machineLabel} · ${machine.locationName}`;

const entryLabel = (entry: OperatorTimeEntry) =>
  `${formatPlainDate(entry.workDate, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })}, ${formatTime(entry.startTime)} to ${formatTime(entry.endTime)}, ${entry.machineLabel}`;

const mergeProfiles = (contexts: OperatorTimekeepingContext[]) => {
  const profileMap = new Map<string, OperatorTimekeepingProfileContext>();

  contexts.forEach((context) => {
    context.profiles.forEach((profile) => {
      const existing = profileMap.get(profile.id);
      if (!existing) {
        profileMap.set(profile.id, {
          ...profile,
          assignedMachines: [...profile.assignedMachines],
          currentEntries: [...profile.currentEntries],
          recentEntries: [],
        });
        return;
      }

      const assignments = new Map(
        [...existing.assignedMachines, ...profile.assignedMachines].map((machine) => [
          machine.assignmentId,
          machine,
        ])
      );
      const entries = new Map(
        [...existing.currentEntries, ...profile.currentEntries].map((entry) => [entry.id, entry])
      );
      existing.assignedMachines = [...assignments.values()];
      existing.currentEntries = [...entries.values()];
    });
  });

  return [...profileMap.values()];
};

const defaultForm = (workDate: string): TimeEntryForm => ({
  workDate,
  machineId: '',
  startTime: '',
  endTime: '',
});

export default function PortalTimePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { entryId } = useParams<{ entryId?: string }>();
  const search = new URLSearchParams(location.search);
  const today = getTodayInTimekeepingZone();
  const requestedDate = search.get('date');
  const requestedWeek = search.get('week');
  const requestedMonth = search.get('month');
  const initialDate = isDateValue(requestedDate)
    ? requestedDate
    : isDateValue(requestedWeek)
      ? requestedWeek
      : isMonthValue(requestedMonth)
        ? `${requestedMonth}-01`
        : today;
  const isFormRoute = location.pathname === '/portal/time/new' || Boolean(entryId);
  const [weekStart, setWeekStart] = useState(() => getWeekStart(initialDate));
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [form, setForm] = useState<TimeEntryForm>(() => defaultForm(initialDate));
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [initializedEntryId, setInitializedEntryId] = useState<string | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<OperatorTimeEntry | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  const [downloadingPayStubId, setDownloadingPayStubId] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    if (isFormRoute || !isDateValue(requestedWeek)) return;
    const nextWeekStart = getWeekStart(requestedWeek);
    if (nextWeekStart !== weekStart) setWeekStart(nextWeekStart);
    if (isDateValue(requestedDate) && requestedDate !== selectedDate) {
      setSelectedDate(requestedDate);
    }
  }, [isFormRoute, requestedDate, requestedWeek, selectedDate, weekStart]);

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const baseMonthAnchors = useMemo(() => getWeekMonthAnchors(weekStart), [weekStart]);
  const queryMonthAnchors = useMemo(() => {
    const anchors = [...baseMonthAnchors];
    if (entryId && isMonthValue(requestedMonth)) anchors.push(`${requestedMonth}-01`);
    if (entryId && isDateValue(requestedDate)) anchors.push(`${requestedDate.slice(0, 7)}-01`);
    return [...new Set(anchors)];
  }, [baseMonthAnchors, entryId, requestedDate, requestedMonth]);

  const contextQueries = useQueries({
    queries: queryMonthAnchors.map((monthAnchor) => ({
      queryKey: getContextQueryKey(monthAnchor),
      queryFn: () => fetchMyOperatorTimekeepingContext(monthAnchor),
      staleTime: 20_000,
      retry: false,
    })),
  });

  const contexts = contextQueries
    .map((query) => query.data)
    .filter((context): context is OperatorTimekeepingContext => Boolean(context));
  const profiles = useMemo(() => mergeProfiles(contexts), [contexts]);
  const isLoading = contextQueries.some((query) => query.isLoading);
  const isRefreshing = contextQueries.some((query) => query.isFetching);
  const loadError = contextQueries.find((query) => query.error)?.error;

  useEffect(() => {
    if (!profiles.length) return;
    if (profiles.some((profile) => profile.id === selectedProfileId)) return;
    setSelectedProfileId(
      profiles.find((profile) => profile.assignedMachines.length > 0)?.id ?? profiles[0].id
    );
  }, [profiles, selectedProfileId]);

  const selectedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? null;
  const routeEntry = entryId
    ? profiles.flatMap((profile) => profile.currentEntries).find((entry) => entry.id === entryId) ??
      null
    : null;

  useEffect(() => {
    if (!entryId || !routeEntry || initializedEntryId === entryId) return;
    setSelectedProfileId(routeEntry.operatorProfileId);
    setSelectedDate(routeEntry.workDate);
    setWeekStart(getWeekStart(routeEntry.workDate));
    setForm({
      workDate: routeEntry.workDate,
      machineId: routeEntry.machineId,
      startTime: routeEntry.startTime,
      endTime: routeEntry.endTime,
    });
    setInitializedEntryId(entryId);
  }, [entryId, initializedEntryId, routeEntry]);

  const effectiveMachines = useMemo(
    () =>
      selectedProfile?.assignedMachines.filter((machine) =>
        machineIsEffective(machine, form.workDate)
      ) ?? [],
    [form.workDate, selectedProfile]
  );

  useEffect(() => {
    if (!isFormRoute || !selectedProfile) return;
    setForm((current) => {
      if (effectiveMachines.some((machine) => machine.machineId === current.machineId)) {
        return current;
      }
      return { ...current, machineId: effectiveMachines[0]?.machineId ?? '' };
    });
  }, [effectiveMachines, isFormRoute, selectedProfile]);

  const contextForFormDate = contexts.find(
    (context) => context.workDate.slice(0, 7) === form.workDate.slice(0, 7)
  );
  const profileForFormDate = contextForFormDate?.profiles.find(
    (profile) => profile.id === selectedProfile?.id
  );
  const periodCanEdit = profileForFormDate
    ? editablePeriodStatuses.has(profileForFormDate.currentPeriod.status)
    : false;
  const entries = useMemo(
    () =>
      (selectedProfile?.currentEntries ?? [])
        .filter((entry) => entry.workDate >= weekDates[0] && entry.workDate <= weekDates[6])
        .sort(
          (left, right) =>
            left.workDate.localeCompare(right.workDate) || left.startTime.localeCompare(right.startTime)
        ),
    [selectedProfile, weekDates]
  );
  const selectedDayEntries = entries.filter((entry) => entry.workDate === selectedDate);
  const totalActualMinutes = entries.reduce(
    (total, entry) => total + entry.actualDurationMinutes,
    0
  );
  const totalPaidShifts = entries.reduce((total, entry) => total + entry.paidShifts, 0);
  const durationMinutes = getActualDurationMinutes(form.startTime, form.endTime);
  const previewPaidShifts = calculateOperatorPaidShifts(durationMinutes);
  const comparableEntries = selectedProfile?.currentEntries ?? [];
  const duplicateEntry =
    form.startTime && form.endTime
      ? comparableEntries.find(
          (entry) => entry.id !== entryId && timeDraftMatchesEntry(form, entry)
        )
      : null;
  const overlappingEntry =
    form.startTime && form.endTime && durationMinutes > 0
      ? comparableEntries.find(
          (entry) => entry.id !== entryId && timeDraftOverlapsEntry(form, entry)
        )
      : null;
  const currentWeekStart = getWeekStart(today);
  const selectedDateIsFuture = selectedDate > today;
  const selectedDayHasAssignment =
    selectedProfile?.assignedMachines.some((machine) => machineIsEffective(machine, selectedDate)) ??
    false;

  const payStubsQuery = useQuery({
    queryKey: getPayStubsQueryKey,
    queryFn: fetchMyOperatorPayStatementContext,
    staleTime: 30_000,
    enabled: !isFormRoute && profiles.length > 0,
  });
  const payStubProfile = payStubsQuery.data?.profiles.find(
    (profile) => profile.id === selectedProfile?.id
  );

  const invalidateVisibleMonths = async () => {
    await Promise.all(
      baseMonthAnchors.map((monthAnchor) =>
        queryClient.invalidateQueries({ queryKey: getContextQueryKey(monthAnchor) })
      )
    );
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!selectedProfile) throw new Error('Technician timekeeping access required.');
      return saveCompletedOperatorTimeEntry({
        timeEntryId: entryId ?? null,
        operatorProfileId: selectedProfile.id,
        machineId: form.machineId,
        actualStartAt: combineDateAndTimeInTimekeepingZone(form.workDate, form.startTime),
        actualEndAt: combineDateAndTimeInTimekeepingZone(form.workDate, form.endTime),
        notes: routeEntry?.notes ?? null,
      });
    },
    onSuccess: async ({ context, timeEntry }) => {
      const monthAnchor = `${context.workDate.slice(0, 7)}-01`;
      queryClient.setQueryData(getContextQueryKey(monthAnchor), context);
      await invalidateVisibleMonths();
      const nextWeek = getWeekStart(timeEntry.workDate);
      toast.success(
        `Saved ${formatDuration(timeEntry.actualDurationMinutes)} as ${timeEntry.paidShifts} paid ${
          timeEntry.paidShifts === 1 ? 'shift' : 'shifts'
        }.`
      );
      navigate(`/portal/time?week=${nextWeek}&date=${timeEntry.workDate}`);
    },
    onError: async (error) => {
      const message = describeTimekeepingError(error);
      setFormErrors((current) => ({ ...current, form: message }));
      if (/closed|cutoff|locked|assigned|assignment/i.test(String(error))) {
        await invalidateVisibleMonths();
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (entry: OperatorTimeEntry) =>
      voidOperatorTimeEntry({
        timeEntryId: entry.id,
        reason: 'Technician deleted an unlocked time entry from Portal Time',
      }),
    onSuccess: async (context) => {
      queryClient.setQueryData(getContextQueryKey(`${context.workDate.slice(0, 7)}-01`), context);
      setDeleteEntry(null);
      setDeleteError(null);
      await invalidateVisibleMonths();
      toast.success('Time entry deleted.');
      requestAnimationFrame(() => headingRef.current?.focus());
    },
    onError: async (error, entry) => {
      const message = describeTimekeepingError(error);
      setDeleteError({ id: entry.id, message });
      setDeleteEntry(null);
      requestAnimationFrame(() => deleteTriggerRef.current?.focus());
      if (/closed|cutoff|locked/i.test(String(error))) await invalidateVisibleMonths();
    },
  });

  const setWeek = (nextWeekStart: string) => {
    const nextSelectedDate = nextWeekStart === currentWeekStart ? today : nextWeekStart;
    setWeekStart(nextWeekStart);
    setSelectedDate(nextSelectedDate);
    navigate(`/portal/time?week=${nextWeekStart}&date=${nextSelectedDate}`);
  };

  const openAddTime = (date = selectedDate) =>
    navigate(`/portal/time/new?date=${date}&week=${weekStart}`);

  const openEditTime = (entry: OperatorTimeEntry) =>
    navigate(
      `/portal/time/${entry.id}/edit?date=${entry.workDate}&week=${weekStart}&month=${entry.workDate.slice(0, 7)}`
    );

  const validateAndSave = () => {
    const errors: FormErrors = {};
    if (!form.workDate) errors.workDate = 'Choose the day you worked.';
    if (!form.machineId) errors.machineId = 'Choose the machine you worked on.';
    if (!form.startTime) errors.startTime = 'Enter the start time.';
    if (!form.endTime) errors.endTime = 'Enter the end time.';
    if (form.startTime && form.endTime && durationMinutes <= 0) {
      errors.endTime = 'End time must be later than start time.';
    }
    if (form.workDate && form.endTime && isCompletedTimeInFuture(form.workDate, form.endTime)) {
      errors.endTime = 'Enter time only after the work has ended.';
    }
    if (!effectiveMachines.some((machine) => machine.machineId === form.machineId)) {
      errors.machineId = 'That machine was not assigned to you on this date.';
    }
    if (duplicateEntry) {
      errors.form = 'This exact time is already recorded. Edit the existing entry instead.';
    } else if (overlappingEntry) {
      errors.form = `This time overlaps your ${formatTime(overlappingEntry.startTime)} to ${formatTime(
        overlappingEntry.endTime
      )} entry on ${overlappingEntry.machineLabel}. Times may touch, but they cannot overlap.`;
    }
    if (!periodCanEdit || (routeEntry && !routeEntry.technicianEditable)) {
      errors.form =
        'Technician editing has closed for this month. Your manager can still correct the entry.';
    }

    setFormErrors(errors);
    if (Object.keys(errors).length) return;
    saveMutation.mutate();
  };

  const downloadPayStub = async (payStub: OperatorPayStatementSummary) => {
    setDownloadingPayStubId(payStub.id);
    try {
      const artifact = await fetchPayStatementArtifact(payStub.id);
      downloadOperatorPayStatementHtml(artifact);
      toast.success('Pay Stub downloaded.');
    } catch (error) {
      toast.error(describeTimekeepingError(error));
    } finally {
      setDownloadingPayStubId(null);
    }
  };

  const retryLoad = () => Promise.all(contextQueries.map((query) => query.refetch()));

  if (isLoading) {
    return (
      <PortalLayout>
        <section className="portal-section" aria-label="Loading Timekeeping">
          <div className="container-page space-y-5">
            <Skeleton className="h-44 rounded-[28px]" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
        </section>
      </PortalLayout>
    );
  }

  if (loadError) {
    return (
      <PortalLayout>
        <section className="portal-section">
          <div className="container-page">
            <PortalPageIntro
              title="Time"
              description="We could not load your time right now. Your existing entries have not changed."
              actions={
                <Button type="button" onClick={retryLoad} className="min-h-11">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Try again
                </Button>
              }
            />
          </div>
        </section>
      </PortalLayout>
    );
  }

  if (!profiles.length) {
    return (
      <PortalLayout>
        <section className="portal-section">
          <div className="container-page">
            <PortalPageIntro
              title="Time"
              description="Your account does not have an active Technician profile yet. Ask your manager to check your Technician access."
              badges={[{ label: 'Setup needed', tone: 'warning' }]}
            />
          </div>
        </section>
      </PortalLayout>
    );
  }

  if (isFormRoute) {
    const editingEntryMissing = Boolean(entryId && !routeEntry && !isLoading);
    const selectedMachine = effectiveMachines.find((machine) => machine.machineId === form.machineId);
    const formLocked = !periodCanEdit || Boolean(routeEntry && !routeEntry.technicianEditable);

    return (
      <PortalLayout>
        <section className="portal-section">
          <div className="container-page space-y-5">
            <PortalPageIntro
              eyebrow="Timekeeping"
              title={entryId ? 'Edit time' : 'Add time'}
              description="Record one completed block of work for one machine. Each entry rounds up to a whole paid shift."
              actions={
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(`/portal/time?week=${weekStart}&date=${form.workDate}`)}
                  className="min-h-11"
                >
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  Back to week
                </Button>
              }
            />

            {editingEntryMissing ? (
              <div className="rounded-xl border border-border bg-card p-6 shadow-sm" role="alert">
                <h2 className="text-lg font-semibold text-foreground">Time entry not found</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  It may have been deleted or moved. Return to the week to see your current entries.
                </p>
                <Button
                  type="button"
                  className="mt-5 min-h-11"
                  onClick={() => navigate(`/portal/time?week=${weekStart}&date=${selectedDate}`)}
                >
                  View this week
                </Button>
              </div>
            ) : (
              <div className="mx-auto max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <div className="border-b border-border px-4 py-5 sm:px-6">
                  <h2 className="text-lg font-semibold text-foreground">Work details</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Times use Bloomjoy's Pacific operating timezone.
                  </p>
                </div>

                <form
                  className="space-y-5 p-4 sm:p-6"
                  onSubmit={(event) => {
                    event.preventDefault();
                    validateAndSave();
                  }}
                  noValidate
                >
                  {profiles.length > 1 && (
                    <div className="space-y-2">
                      <label htmlFor="technician-profile" className="text-sm font-medium text-foreground">
                        Technician account
                      </label>
                      <Select value={selectedProfile?.id ?? ''} onValueChange={setSelectedProfileId}>
                        <SelectTrigger id="technician-profile" className="min-h-11">
                          <SelectValue placeholder="Choose an account" />
                        </SelectTrigger>
                        <SelectContent>
                          {profiles.map((profile) => (
                            <SelectItem key={profile.id} value={profile.id}>
                              {profile.displayName} · {profile.accountName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label htmlFor="work-date" className="text-sm font-medium text-foreground">
                      Work date
                    </label>
                    <Input
                      id="work-date"
                      type="date"
                      value={form.workDate}
                      min={weekDates[0]}
                      max={weekDates[6] < today ? weekDates[6] : today}
                      aria-invalid={Boolean(formErrors.workDate)}
                      aria-describedby={formErrors.workDate ? 'work-date-error' : undefined}
                      onChange={(event) => {
                        setForm((current) => ({ ...current, workDate: event.target.value }));
                        setFormErrors({});
                      }}
                      className="min-h-11"
                    />
                    {formErrors.workDate && (
                      <p id="work-date-error" className="text-sm text-destructive">
                        {formErrors.workDate}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="work-machine" className="text-sm font-medium text-foreground">
                      Machine
                    </label>
                    <Select
                      value={form.machineId}
                      onValueChange={(machineId) => {
                        setForm((current) => ({ ...current, machineId }));
                        setFormErrors({});
                      }}
                      disabled={!effectiveMachines.length}
                    >
                      <SelectTrigger
                        id="work-machine"
                        className="min-h-11"
                        aria-invalid={Boolean(formErrors.machineId)}
                        aria-describedby={formErrors.machineId ? 'work-machine-error' : undefined}
                      >
                        <SelectValue placeholder="Choose a machine" />
                      </SelectTrigger>
                      <SelectContent>
                        {effectiveMachines.map((machine) => (
                          <SelectItem key={machine.assignmentId} value={machine.machineId}>
                            {machineLabel(machine)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!effectiveMachines.length && (
                      <p className="text-sm text-muted-foreground">
                        No machine assignment is active for this date. Choose another day or ask your manager to check the assignment.
                      </p>
                    )}
                    {formErrors.machineId && (
                      <p id="work-machine-error" className="text-sm text-destructive">
                        {formErrors.machineId}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label htmlFor="start-time" className="text-sm font-medium text-foreground">
                        Start time
                      </label>
                      <Input
                        id="start-time"
                        type="time"
                        value={form.startTime}
                        aria-invalid={Boolean(formErrors.startTime)}
                        aria-describedby={formErrors.startTime ? 'start-time-error' : undefined}
                        onChange={(event) => {
                          setForm((current) => ({ ...current, startTime: event.target.value }));
                          setFormErrors({});
                        }}
                        className="min-h-11"
                      />
                      {formErrors.startTime && (
                        <p id="start-time-error" className="text-sm text-destructive">
                          {formErrors.startTime}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="end-time" className="text-sm font-medium text-foreground">
                        End time
                      </label>
                      <Input
                        id="end-time"
                        type="time"
                        value={form.endTime}
                        aria-invalid={Boolean(formErrors.endTime)}
                        aria-describedby={formErrors.endTime ? 'end-time-error' : undefined}
                        onChange={(event) => {
                          setForm((current) => ({ ...current, endTime: event.target.value }));
                          setFormErrors({});
                        }}
                        className="min-h-11"
                      />
                      {formErrors.endTime && (
                        <p id="end-time-error" className="text-sm text-destructive">
                          {formErrors.endTime}
                        </p>
                      )}
                    </div>
                  </div>

                  <div
                    className={cn(
                      'rounded-xl border px-4 py-4',
                      durationMinutes > 0
                        ? 'border-primary/20 bg-primary/5'
                        : 'border-border bg-muted/30'
                    )}
                    aria-live="polite"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Pay preview
                    </p>
                    {durationMinutes > 0 ? (
                      <p className="mt-1 text-base font-semibold text-foreground">
                        {formatDuration(durationMinutes)} actual{' '}
                        <span className="text-muted-foreground">→</span>{' '}
                        {previewPaidShifts} paid {previewPaidShifts === 1 ? 'shift' : 'shifts'}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Add a start and end time to see the result.
                      </p>
                    )}
                    {selectedMachine && durationMinutes > 0 && (
                      <p className="mt-1 text-sm text-muted-foreground">{machineLabel(selectedMachine)}</p>
                    )}
                  </div>

                  {formLocked && !formErrors.form && (
                    <div className="flex gap-3 rounded-xl border border-amber/30 bg-amber/10 p-4 text-sm text-foreground">
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber" />
                      <p>
                        Technician editing is closed for this month. Your manager can still correct an error.
                      </p>
                    </div>
                  )}

                  {formErrors.form && (
                    <div
                      id="time-form-error"
                      className="flex gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"
                      role="alert"
                    >
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                      <p>{formErrors.form}</p>
                    </div>
                  )}

                  <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      onClick={() => navigate(`/portal/time?week=${weekStart}&date=${form.workDate}`)}
                      disabled={saveMutation.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      className="min-h-11"
                      disabled={saveMutation.isPending || formLocked || !effectiveMachines.length}
                      aria-describedby={formErrors.form ? 'time-form-error' : undefined}
                    >
                      {saveMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
                      ) : (
                        <Clock3 className="mr-2 h-4 w-4" />
                      )}
                      {saveMutation.isPending ? 'Saving…' : 'Save time'}
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </section>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <section className="portal-section">
        <div className="container-page space-y-5">
          <PortalPageIntro
            eyebrow="Technician"
            title="Time"
            description="Record completed work by machine. Each entry rounds up independently to a whole paid shift."
            badges={[
              {
                label: `${formatDuration(totalActualMinutes)} actual · ${totalPaidShifts} paid ${
                  totalPaidShifts === 1 ? 'shift' : 'shifts'
                }`,
                tone: 'muted',
                icon: Clock3,
              },
            ]}
            actions={
              <Button
                type="button"
                onClick={() => openAddTime()}
                disabled={selectedDateIsFuture || !selectedDayHasAssignment}
                className="min-h-11"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add time
              </Button>
            }
          />

          {profiles.length > 1 && (
            <div className="max-w-md space-y-2">
              <label htmlFor="week-profile" className="text-sm font-medium text-foreground">
                Technician account
              </label>
              <Select value={selectedProfile?.id ?? ''} onValueChange={setSelectedProfileId}>
                <SelectTrigger id="week-profile" className="min-h-11 bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.displayName} · {profile.accountName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex flex-col gap-3 border-b border-border px-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Week of
                </p>
                <h2
                  ref={headingRef}
                  tabIndex={-1}
                  className="mt-1 text-lg font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {formatPlainDate(weekDates[0], { month: 'long', day: 'numeric' })} to{' '}
                  {formatPlainDate(weekDates[6], {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </h2>
              </div>
              <div className="grid grid-cols-[44px_1fr_44px] gap-2 sm:flex">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="min-h-11 min-w-11"
                  aria-label="Previous week"
                  onClick={() => setWeek(addPlainDateDays(weekStart, -7))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setWeek(currentWeekStart)}
                  disabled={weekStart === currentWeekStart}
                >
                  This week
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="min-h-11 min-w-11"
                  aria-label="Next week"
                  onClick={() => setWeek(addPlainDateDays(weekStart, 7))}
                  disabled={weekStart >= currentWeekStart}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div
              className="grid grid-cols-7 gap-0.5 border-b border-border bg-muted/30 p-2 sm:gap-2 sm:p-3"
              aria-label="Choose a day"
            >
              {weekDates.map((date) => {
                const dayEntries = entries.filter((entry) => entry.workDate === date);
                const isSelected = date === selectedDate;
                const isToday = date === today;
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => {
                      setSelectedDate(date);
                      navigate(`/portal/time?week=${weekStart}&date=${date}`, { replace: true });
                    }}
                    aria-pressed={isSelected}
                    aria-label={`${formatPlainDate(date, {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}, ${dayEntries.length} ${dayEntries.length === 1 ? 'entry' : 'entries'}${
                      isToday ? ', today' : ''
                    }`}
                    className={cn(
                      'min-h-14 min-w-0 rounded-lg px-0.5 py-2 text-center outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:duration-0 motion-reduce:transition-none sm:min-h-16 sm:px-2',
                      isSelected
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-card text-foreground hover:bg-accent',
                      date > today && !isSelected && 'text-muted-foreground'
                    )}
                  >
                    <span className="block text-[11px] font-semibold uppercase tracking-wide sm:text-xs">
                      {formatPlainDate(date, { weekday: 'short' })}
                    </span>
                    <span className="mt-0.5 block text-base font-semibold tabular-nums">
                      {formatPlainDate(date, { day: 'numeric' })}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mx-auto mt-1 block h-1 w-1 rounded-full',
                        dayEntries.length
                          ? isSelected
                            ? 'bg-primary-foreground'
                            : 'bg-primary'
                          : 'bg-transparent'
                      )}
                    />
                  </button>
                );
              })}
            </div>

            <div className="px-3 py-5 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Selected day
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-foreground">
                    {formatPlainDate(selectedDate, {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </h3>
                </div>
                <Button
                  type="button"
                  onClick={() => openAddTime(selectedDate)}
                  disabled={selectedDateIsFuture || !selectedDayHasAssignment}
                  className="min-h-11 w-full sm:w-auto"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add time
                </Button>
              </div>

              {!selectedDayHasAssignment ? (
                <div className="mt-4 rounded-xl border border-border bg-muted/30 p-5">
                  <p className="font-medium text-foreground">No machine assignment for this day</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Choose another day or ask your manager to check when your machine assignment starts.
                  </p>
                </div>
              ) : selectedDateIsFuture ? (
                <div className="mt-4 rounded-xl border border-border bg-muted/30 p-5">
                  <p className="font-medium text-foreground">This workday has not finished yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Return after the work is completed to record your time.
                  </p>
                </div>
              ) : selectedDayEntries.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/20 px-5 py-8 text-center">
                  <CalendarDays className="mx-auto h-6 w-6 text-muted-foreground" />
                  <p className="mt-3 font-medium text-foreground">No time recorded for this day</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Add each machine separately so its paid shift is easy to understand.
                  </p>
                  <Button type="button" className="mt-5 min-h-11" onClick={() => openAddTime()}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add time
                  </Button>
                </div>
              ) : (
                <div className="mt-4 divide-y divide-border rounded-xl border border-border">
                  {selectedDayEntries.map((entry) => {
                    const entryPeriod = contexts
                      .find((context) => context.workDate.slice(0, 7) === entry.workDate.slice(0, 7))
                      ?.profiles.find((profile) => profile.id === entry.operatorProfileId)
                      ?.currentPeriod;
                    const canEdit =
                      entry.technicianEditable &&
                      Boolean(entryPeriod && editablePeriodStatuses.has(entryPeriod.status));
                    return (
                      <article key={entry.id} className="p-4 sm:p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <h4 className="break-words font-semibold text-foreground">
                              {entry.machineLabel}
                            </h4>
                            <p className="mt-0.5 break-words text-sm text-muted-foreground">
                              {entry.locationName}
                            </p>
                            <p className="mt-3 text-base font-medium tabular-nums text-foreground">
                              {formatTime(entry.startTime)} to {formatTime(entry.endTime)}
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {formatDuration(entry.actualDurationMinutes)} actual ·{' '}
                              <span className="font-semibold text-foreground">
                                {entry.paidShifts} paid {entry.paidShifts === 1 ? 'shift' : 'shifts'}
                              </span>
                            </p>
                            {!canEdit && (
                              <p className="mt-2 text-sm text-muted-foreground">
                                Editing closed after {formatCutoff(entry.technicianCutoffAt)} PT. Your manager can correct an error.
                              </p>
                            )}
                            {deleteError?.id === entry.id && (
                              <p className="mt-3 text-sm text-destructive" role="alert">
                                {deleteError.message}
                              </p>
                            )}
                          </div>
                          {canEdit && (
                            <div className="flex gap-2 sm:shrink-0">
                              <Button
                                type="button"
                                variant="outline"
                                className="min-h-11 flex-1 sm:flex-none"
                                aria-label={`Edit ${entryLabel(entry)}`}
                                onClick={() => openEditTime(entry)}
                              >
                                <Edit3 className="mr-2 h-4 w-4" />
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="min-h-11 flex-1 text-destructive hover:text-destructive sm:flex-none"
                                aria-label={`Delete ${entryLabel(entry)}`}
                                onClick={(event) => {
                                  deleteTriggerRef.current = event.currentTarget;
                                  setDeleteError(null);
                                  setDeleteEntry(entry);
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </Button>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <PayStubsPanel
            payStubs={payStubProfile?.statements ?? []}
            isLoading={payStubsQuery.isLoading}
            error={payStubsQuery.error}
            downloadingId={downloadingPayStubId}
            onDownload={downloadPayStub}
          />

          <AlertDialog
            open={Boolean(deleteEntry)}
            onOpenChange={(open) => {
              if (open) return;
              setDeleteEntry(null);
              requestAnimationFrame(() => deleteTriggerRef.current?.focus());
            }}
          >
            <AlertDialogContent className="max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this time entry?</AlertDialogTitle>
                <AlertDialogDescription>
                  {deleteEntry
                    ? `${entryLabel(deleteEntry)}. This removes it from your weekly record.`
                    : 'This removes the time from your weekly record.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="min-h-11">Keep entry</AlertDialogCancel>
                <AlertDialogAction
                  className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={deleteMutation.isPending}
                  onClick={(event) => {
                    event.preventDefault();
                    if (deleteEntry) deleteMutation.mutate(deleteEntry);
                  }}
                >
                  {deleteMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
                  )}
                  Delete time
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {isRefreshing && (
            <p className="sr-only" aria-live="polite">
              Refreshing time entries.
            </p>
          )}
        </div>
      </section>
    </PortalLayout>
  );
}

function PayStubsPanel({
  payStubs,
  isLoading,
  error,
  downloadingId,
  onDownload,
}: {
  payStubs: OperatorPayStatementSummary[];
  isLoading: boolean;
  error: unknown;
  downloadingId: string | null;
  onDownload: (payStub: OperatorPayStatementSummary) => void;
}) {
  return (
    <details id="pay-stubs" className="group overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-lg bg-muted p-2 text-muted-foreground">
            <FileText className="h-5 w-5" />
          </span>
          <span>
            <span className="block font-semibold text-foreground">Pay Stubs</span>
            <span className="block text-sm text-muted-foreground">View and download published history</span>
          </span>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
      </summary>

      <div className="border-t border-border">
        {error ? (
          <p className="p-5 text-sm text-destructive" role="alert">
            Pay Stubs could not be loaded right now. Your time entries are still available above.
          </p>
        ) : isLoading ? (
          <div className="space-y-3 p-5" aria-label="Loading Pay Stubs">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : payStubs.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">
            No Pay Stubs have been published yet. They will appear here when available.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {payStubs.map((payStub) => (
              <article key={payStub.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">
                    {formatOperatorPayStatementLabel(payStub.statementLabel)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatPlainDate(payStub.periodStartDate, { month: 'short', day: 'numeric' })} to{' '}
                    {formatPlainDate(payStub.periodEndDate, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}{' '}
                    · {formatCurrency(payStub.totalPayoutCents)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 w-full sm:w-auto"
                  disabled={downloadingId === payStub.id}
                  onClick={() => onDownload(payStub)}
                >
                  {downloadingId === payStub.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Download Pay Stub
                </Button>
              </article>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
