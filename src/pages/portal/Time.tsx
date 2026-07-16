import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Edit3,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  downloadOperatorPayStatementHtml,
  fetchMyOperatorPayStatementContext,
  fetchMyOperatorTimekeepingContext,
  fetchPayStatementArtifact,
  formatOperatorPayStatementLabel,
  paidMinutesToHours,
  roundOperatorPaidMinutes,
  submitOperatorTimeEntry,
  updateOperatorTimeEntry,
  voidOperatorTimeEntry,
  type OperatorAssignedMachine,
  type OperatorPayStatementSummary,
  type OperatorTimeEntry,
  type OperatorTimekeepingContext,
  type OperatorTimekeepingProfileContext,
} from '@/lib/operatorPayouts';

type TimeEntryForm = {
  workDate: string;
  machineId: string;
  startTime: string;
  endTime: string;
  notes: string;
};

const todayInputValue = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const defaultForm = (): TimeEntryForm => ({
  workDate: todayInputValue(),
  machineId: '',
  startTime: '',
  endTime: '',
  notes: '',
});

const isValidMonthValue = (value: string | null): value is string =>
  Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));

const formatDate = (value: string | null | undefined) => {
  if (!value) return 'Not set';

  const dateValue = value.includes('T') ? new Date(value) : new Date(`${value}T00:00:00`);

  return dateValue.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatMonth = (value: string) =>
  new Date(`${value}-01T00:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

const formatMinutes = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) return `${remainingMinutes} min`;
  if (remainingMinutes === 0) return `${hours} hr${hours === 1 ? '' : 's'}`;
  return `${hours} hr ${remainingMinutes} min`;
};

const formatPaidHours = (minutes: number) =>
  `${paidMinutesToHours(minutes).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })} rounded hr${minutes === 60 ? '' : 's'}`;

const formatCurrency = (cents: number | null | undefined) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format((cents ?? 0) / 100);

const timeToMinutes = (value: string) => {
  const [hour, minute] = value.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  return hour * 60 + minute;
};

const calculateRawDuration = (startTime: string, endTime: string) => {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);

  if (start === null || end === null || end <= start) return 0;

  return end - start;
};

const isDateInsideRange = (date: string, startDate: string, endDate: string) =>
  date >= startDate && date <= endDate;

const machineIsEffectiveOnDate = (machine: OperatorAssignedMachine, workDate: string) =>
  machine.effectiveStartDate <= workDate &&
  (!machine.effectiveEndDate || machine.effectiveEndDate >= workDate);

const entriesOverlap = (candidate: TimeEntryForm, entry: OperatorTimeEntry) => {
  if (candidate.workDate !== entry.workDate) return false;

  const candidateStart = timeToMinutes(candidate.startTime);
  const candidateEnd = timeToMinutes(candidate.endTime);
  const entryStart = timeToMinutes(entry.startTime);
  const entryEnd = timeToMinutes(entry.endTime);

  if (
    candidateStart === null ||
    candidateEnd === null ||
    entryStart === null ||
    entryEnd === null
  ) {
    return false;
  }

  return candidateStart < entryEnd && entryStart < candidateEnd;
};

const entryMatchesExactly = (candidate: TimeEntryForm, entry: OperatorTimeEntry) =>
  candidate.workDate === entry.workDate &&
  candidate.machineId === entry.machineId &&
  candidate.startTime === entry.startTime &&
  candidate.endTime === entry.endTime;

const getStatusLabel = (status: string) =>
  status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const getEntryReviewLabel = (entry: OperatorTimeEntry) => {
  if (entry.status === 'draft') return 'Draft';
  if (entry.status === 'paid') return 'Paid';
  if (entry.status === 'included_in_payout') return 'Included';
  if (entry.status === 'locked') return 'Locked';
  if (entry.managerReviewStatus === 'approved') return 'Approved';
  if (entry.managerReviewStatus === 'needs_correction') return 'Correction requested';
  return 'Waiting for review';
};

const getEntryReviewClassName = (entry: OperatorTimeEntry) => {
  if (entry.status !== 'submitted') return 'border-border bg-muted text-muted-foreground';
  if (entry.managerReviewStatus === 'approved') return 'border-sage/25 bg-sage-light text-sage';
  if (entry.managerReviewStatus === 'needs_correction') {
    return 'border-amber/25 bg-amber/10 text-amber';
  }
  return 'border-primary/20 bg-primary/10 text-primary';
};

const getMachineLabel = (entry: OperatorTimeEntry) =>
  `${entry.machineLabel} - ${entry.locationName}`;

const getContextQueryKey = (workDate: string) => ['operator-timekeeping', workDate] as const;
const getPayStatementsQueryKey = ['operator-pay-statements'] as const;
const emptyProfiles: OperatorTimekeepingProfileContext[] = [];
const timeActionClassName =
  'min-h-11 transition-[transform,box-shadow,background-color,border-color,color] duration-150 ease-out active:scale-[0.96]';
const timeSmallActionClassName =
  'min-h-10 transition-[transform,box-shadow,background-color,border-color,color] duration-150 ease-out active:scale-[0.96]';
const timeInsetPanelClassName =
  'rounded-lg bg-muted/30 p-3 shadow-[inset_0_0_0_1px_hsl(var(--border))]';

export default function PortalTimePage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const { entryId } = useParams<{ entryId?: string }>();
  const isTimeEntryScreen = location.pathname === '/portal/time/new' || Boolean(entryId);
  const requestedMonth = new URLSearchParams(location.search).get('month');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [downloadingStatementId, setDownloadingStatementId] = useState<string | null>(null);
  const [form, setForm] = useState<TimeEntryForm>(() => {
    const initialForm = defaultForm();

    return entryId && isValidMonthValue(requestedMonth)
      ? { ...initialForm, workDate: `${requestedMonth}-01` }
      : initialForm;
  });
  const [viewMonth, setViewMonth] = useState(() =>
    isValidMonthValue(requestedMonth)
      ? requestedMonth
      : todayInputValue().slice(0, 7)
  );
  const contextMonth = isTimeEntryScreen
    ? (form.workDate || todayInputValue()).slice(0, 7)
    : viewMonth;
  const contextWorkDate = `${contextMonth}-01`;

  const {
    data: context,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: getContextQueryKey(contextWorkDate),
    queryFn: () => fetchMyOperatorTimekeepingContext(contextWorkDate),
    staleTime: 1000 * 20,
  });

  const {
    data: statementContext,
    isFetching: isFetchingStatements,
    error: statementError,
  } = useQuery({
    queryKey: getPayStatementsQueryKey,
    queryFn: fetchMyOperatorPayStatementContext,
    staleTime: 1000 * 30,
  });

  const profiles = context?.profiles ?? emptyProfiles;

  useEffect(() => {
    if (!selectedProfileId && profiles.length > 0) {
      setSelectedProfileId(profiles[0].id);
    }
  }, [profiles, selectedProfileId]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0],
    [profiles, selectedProfileId]
  );
  const routeEntry = useMemo(() => {
    if (!entryId) return null;

    return (
      profiles
        .flatMap((profile) => [...profile.currentEntries, ...profile.recentEntries])
        .find((entry) => entry.id === entryId) ?? null
    );
  }, [entryId, profiles]);
  const selectedStatementProfile = useMemo(
    () =>
      selectedProfile
        ? statementContext?.profiles.find((profile) => profile.id === selectedProfile.id)
        : statementContext?.profiles[0],
    [selectedProfile, statementContext?.profiles]
  );
  const issuedStatements = selectedStatementProfile?.statements ?? [];
  const periodSummary = useMemo(() => {
    const entries = selectedProfile?.currentEntries ?? [];

    return {
      rawMinutes: entries.reduce((total, entry) => total + entry.rawDurationMinutes, 0),
      roundedMinutes: entries.reduce((total, entry) => total + entry.roundedPaidMinutes, 0),
      waiting: entries.filter(
        (entry) => entry.status === 'submitted' && entry.managerReviewStatus === 'pending'
      ).length,
      approved: entries.filter((entry) => entry.managerReviewStatus === 'approved').length,
      needsCorrection: entries.filter(
        (entry) => entry.managerReviewStatus === 'needs_correction'
      ).length,
    };
  }, [selectedProfile]);

  useEffect(() => {
    if (routeEntry && routeEntry.operatorProfileId !== selectedProfileId) {
      setSelectedProfileId(routeEntry.operatorProfileId);
    }
  }, [routeEntry, selectedProfileId]);

  useEffect(() => {
    if (!isTimeEntryScreen) return;

    if (!entryId) {
      setEditingEntryId(null);
      return;
    }

    if (!routeEntry) return;

    setEditingEntryId(routeEntry.id);
    setForm({
      workDate: routeEntry.workDate,
      machineId: routeEntry.machineId,
      startTime: routeEntry.startTime,
      endTime: routeEntry.endTime,
      notes: routeEntry.notes ?? '',
    });
  }, [entryId, isTimeEntryScreen, routeEntry]);

  useEffect(() => {
    if (!isTimeEntryScreen && editingEntryId) {
      setEditingEntryId(null);
    }
  }, [editingEntryId, isTimeEntryScreen]);

  const effectiveMachines = useMemo(() => {
    if (!selectedProfile) return [];

    return selectedProfile.assignedMachines.filter((machine) =>
      machineIsEffectiveOnDate(machine, form.workDate)
    );
  }, [form.workDate, selectedProfile]);

  useEffect(() => {
    if (!selectedProfile) return;

    setForm((current) => {
      if (
        current.machineId &&
        selectedProfile.assignedMachines.some((machine) => machine.machineId === current.machineId)
      ) {
        return current;
      }

      return {
        ...current,
        machineId: effectiveMachines[0]?.machineId ?? '',
      };
    });
  }, [effectiveMachines, selectedProfile]);

  const rawDurationMinutes = calculateRawDuration(form.startTime, form.endTime);
  const roundedPaidMinutes = selectedProfile
    ? roundOperatorPaidMinutes(rawDurationMinutes, selectedProfile.policy.roundingRule)
    : 0;
  const editableEntries = selectedProfile?.currentEntries ?? [];
  const entryBeingEdited = editingEntryId
    ? editableEntries.find((entry) => entry.id === editingEntryId) ?? null
    : null;
  const isPeriodEditable =
    selectedProfile?.currentPeriod.status === 'open' ||
    selectedProfile?.currentPeriod.status === 'grace_period' ||
    selectedProfile?.currentPeriod.status === 'reopened';
  const isWorkDateInCurrentPeriod = selectedProfile
    ? isDateInsideRange(
        form.workDate,
        selectedProfile.currentPeriod.periodStartDate,
        selectedProfile.currentPeriod.periodEndDate
      )
    : false;
  const selectedMachine = effectiveMachines.find((machine) => machine.machineId === form.machineId);
  const overlappingEntries = editableEntries.filter(
    (entry) => entry.id !== editingEntryId && entriesOverlap(form, entry)
  );
  const exactDuplicate = editableEntries.find(
    (entry) => entry.id !== editingEntryId && entryMatchesExactly(form, entry)
  );
  const longShiftWarning = rawDurationMinutes >= 10 * 60;
  const hasBlockingValidation =
    !selectedProfile ||
    !form.machineId ||
    !form.workDate ||
    !form.startTime ||
    !form.endTime ||
    rawDurationMinutes <= 0 ||
    !selectedMachine ||
    !isWorkDateInCurrentPeriod ||
    !isPeriodEditable ||
    Boolean(exactDuplicate);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProfile) {
        throw new Error('No operator profile is selected.');
      }

      if (editingEntryId) {
        return updateOperatorTimeEntry({
          timeEntryId: editingEntryId,
          operatorProfileId: selectedProfile.id,
          machineId: form.machineId,
          workDate: form.workDate,
          startTime: form.startTime,
          endTime: form.endTime,
          notes: form.notes,
          status: 'submitted',
        });
      }

      return submitOperatorTimeEntry({
        operatorProfileId: selectedProfile.id,
        machineId: form.machineId,
        workDate: form.workDate,
        startTime: form.startTime,
        endTime: form.endTime,
        notes: form.notes,
        status: 'submitted',
      });
    },
    onSuccess: (nextContext) => {
      const nextMonth = nextContext.workDate.slice(0, 7);
      queryClient.setQueryData<OperatorTimekeepingContext>(
        getContextQueryKey(`${nextMonth}-01`),
        nextContext
      );
      setViewMonth(nextMonth);
      setEditingEntryId(null);
      setForm({
        ...defaultForm(),
        machineId: nextContext.profiles[0]?.assignedMachines[0]?.machineId ?? '',
      });
      toast.success('Time entry saved.');
      navigate(`/portal/time?month=${nextMonth}`);
    },
    onError: (mutationError: Error) => {
      toast.error(mutationError.message || 'Unable to save time entry.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (timeEntryId: string) =>
      voidOperatorTimeEntry({
        timeEntryId,
        reason: 'Operator deleted unlocked shift from Portal Time',
      }),
    onSuccess: (nextContext) => {
      const nextMonth = nextContext.workDate.slice(0, 7);
      queryClient.setQueryData<OperatorTimekeepingContext>(
        getContextQueryKey(`${nextMonth}-01`),
        nextContext
      );
      setEditingEntryId(null);
      toast.success('Time entry deleted.');
    },
    onError: (mutationError: Error) => {
      toast.error(mutationError.message || 'Unable to delete time entry.');
    },
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['operator-timekeeping'] }),
      queryClient.invalidateQueries({ queryKey: getPayStatementsQueryKey }),
    ]);
  };

  const downloadStatement = async (statement: OperatorPayStatementSummary) => {
    setDownloadingStatementId(statement.id);
    try {
      const artifact = await fetchPayStatementArtifact(statement.id);
      downloadOperatorPayStatementHtml(artifact);
      toast.success('Pay statement downloaded.');
    } catch (downloadError) {
      toast.error(
        downloadError instanceof Error ? downloadError.message : 'Unable to download pay statement.'
      );
    } finally {
      setDownloadingStatementId(null);
    }
  };

  const startEditing = (entry: OperatorTimeEntry) => {
    navigate(`/portal/time/${entry.id}/edit?month=${entry.workDate.slice(0, 7)}`);
  };

  const cancelEditing = () => {
    setEditingEntryId(null);
    setForm({
      ...defaultForm(),
      machineId: effectiveMachines[0]?.machineId ?? '',
    });
    navigate(`/portal/time?month=${form.workDate.slice(0, 7)}`);
  };

  const confirmDelete = (entry: OperatorTimeEntry) => {
    if (entry.lockedAt || !['draft', 'submitted'].includes(entry.status)) {
      toast.error('Locked time entries cannot be deleted.');
      return;
    }

    const shiftSummary = `${formatDate(entry.workDate)} / ${entry.startTime} to ${
      entry.endTime
    } / ${getMachineLabel(entry)}`;

    if (
      window.confirm(
        `Delete this submitted time entry?\n\n${shiftSummary}\n\nIt will be removed from this pay period.`
      )
    ) {
      deleteMutation.mutate(entry.id);
    }
  };

  const saveTime = () => {
    if (exactDuplicate) {
      toast.error('This matches an existing shift. Review the existing entry instead.');
      return;
    }

    const warnings = [
      overlappingEntries.length > 0
        ? `This shift overlaps ${overlappingEntries.length} existing entr${
            overlappingEntries.length === 1 ? 'y' : 'ies'
          }.`
        : null,
      longShiftWarning ? 'This shift is 10+ hours.' : null,
    ].filter(Boolean) as string[];

    if (warnings.length > 0) {
      const shiftSummary = `${formatDate(form.workDate)} / ${form.startTime} to ${
        form.endTime
      } / ${selectedMachine ? `${selectedMachine.machineLabel} - ${selectedMachine.locationName}` : 'Selected machine'}`;

      if (
        !window.confirm(
          `${warnings.join('\n')}\n\n${shiftSummary}\n\nSave this time entry anyway?`
        )
      ) {
        return;
      }
    }

    saveMutation.mutate();
  };

  return (
    <PortalLayout>
      <section className="portal-section">
        <div className="container-page">
          <PortalPageIntro
            title={isTimeEntryScreen ? (editingEntryId ? 'Edit Time' : 'Add Time') : 'Time'}
            description={
              isTimeEntryScreen
                ? 'Enter one completed shift. You can correct it until the period locks.'
                : 'Enter completed shifts, follow manager review, and access issued statements.'
            }
            badges={[
              {
                label: selectedProfile
                  ? `${getStatusLabel(selectedProfile.currentPeriod.status)} period`
                  : 'Timekeeping',
                tone: selectedProfile?.currentPeriod.status === 'locked' ? 'warning' : 'default',
              },
              {
                label: isFetching ? 'Refreshing' : 'Whole-hour rounding',
                tone: 'muted',
              },
            ]}
            actions={
              isTimeEntryScreen ? (
                <Button asChild variant="outline" className={timeActionClassName}>
                  <Link to={`/portal/time?month=${contextMonth}`}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Time home
                  </Link>
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={refresh}
                  disabled={isFetching}
                  className={timeActionClassName}
                >
                  {isFetching ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Refresh
                </Button>
              )
            }
          />

          {error && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Unable to load timekeeping. Please refresh and try again.
            </div>
          )}

          {isLoading && (
            <div className="mt-6 card-elevated px-5 py-10 text-center text-sm text-muted-foreground">
              Loading timekeeping...
            </div>
          )}

          {!isLoading && profiles.length === 0 && (
            <div className="mt-6 card-elevated px-5 py-10">
              <div className="mx-auto max-w-xl text-center">
                <Clock3 className="mx-auto h-10 w-10 text-muted-foreground" />
                <h2 className="mt-4 text-xl font-semibold text-foreground">
                  Timekeeping setup needed
                </h2>
                <p className="mt-2 text-pretty text-sm text-muted-foreground">
                  Ask a Bloomjoy admin or machine manager to add your timekeeping profile and
                  assigned machines before entering shifts.
                </p>
              </div>
            </div>
          )}

          {selectedProfile && (
            <>
              {isTimeEntryScreen ? (
                <div className="mx-auto mt-6 max-w-3xl">
                  {entryId && !routeEntry ? (
                    <div className="card-elevated p-5 text-sm text-muted-foreground">
                      This time entry is not available for editing.
                    </div>
                  ) : (
                    <div className="card-elevated p-4 sm:p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h2 className="text-balance text-lg font-semibold text-foreground">
                            {editingEntryId ? 'Edit completed shift' : 'Add completed shift'}
                          </h2>
                          <p className="mt-1 text-pretty text-sm text-muted-foreground">
                            Use the actual start and end time. Bloomjoy rounds each saved shift up to
                            the next full hour.
                          </p>
                        </div>
                        {profiles.length > 1 && (
                          <div className="w-full sm:w-56">
                            <label className="mb-1 block text-sm font-medium text-foreground">
                              Operator profile
                            </label>
                            <Select
                              value={selectedProfile.id}
                              onValueChange={(value) => {
                                setSelectedProfileId(value);
                                setEditingEntryId(null);
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {profiles.map((profile) => (
                                  <SelectItem key={profile.id} value={profile.id}>
                                    {profile.accountName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>

                      <PeriodDetails profile={selectedProfile} />

                      <div className="mt-5 grid gap-4">
                        <div>
                          <label htmlFor="work-date" className="mb-1 block text-sm font-medium">
                            Work date
                          </label>
                          <Input
                            id="work-date"
                            type="date"
                            value={form.workDate}
                            max={todayInputValue()}
                            onChange={(event) =>
                              setForm((current) => ({ ...current, workDate: event.target.value }))
                            }
                          />
                        </div>

                        <div>
                          <label htmlFor="machine-id" className="mb-1 block text-sm font-medium">
                            Machine
                          </label>
                          <Select
                            value={form.machineId}
                            onValueChange={(value) =>
                              setForm((current) => ({ ...current, machineId: value }))
                            }
                            disabled={effectiveMachines.length === 0}
                          >
                            <SelectTrigger id="machine-id">
                              <SelectValue placeholder="Select an assigned machine" />
                            </SelectTrigger>
                            <SelectContent>
                              {effectiveMachines.map((machine) => (
                                <SelectItem key={machine.machineId} value={machine.machineId}>
                                  {machine.machineLabel} - {machine.locationName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label htmlFor="start-time" className="mb-1 block text-sm font-medium">
                              Start time
                            </label>
                            <Input
                              id="start-time"
                              type="time"
                              value={form.startTime}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  startTime: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label htmlFor="end-time" className="mb-1 block text-sm font-medium">
                              End time
                            </label>
                            <Input
                              id="end-time"
                              type="time"
                              value={form.endTime}
                              onChange={(event) =>
                                setForm((current) => ({ ...current, endTime: event.target.value }))
                              }
                            />
                          </div>
                        </div>

                        <div>
                          <label htmlFor="time-notes" className="mb-1 block text-sm font-medium">
                            Notes{' '}
                            <span className="font-normal text-muted-foreground">(optional)</span>
                          </label>
                          <Textarea
                            id="time-notes"
                            value={form.notes}
                            rows={2}
                            placeholder="Add context only if it helps"
                            onChange={(event) =>
                              setForm((current) => ({ ...current, notes: event.target.value }))
                            }
                          />
                        </div>
                      </div>

                      <div className={cn('mt-5 grid gap-3 sm:grid-cols-2', timeInsetPanelClassName)}>
                        <Metric
                          label="Actual time"
                          value={
                            rawDurationMinutes ? formatMinutes(rawDurationMinutes) : 'Set times'
                          }
                        />
                        <Metric
                          label="Rounded time"
                          value={
                            roundedPaidMinutes ? formatPaidHours(roundedPaidMinutes) : 'Set times'
                          }
                        />
                      </div>

                      <ValidationPanel
                        hasInvalidTimes={Boolean(
                          form.startTime && form.endTime && rawDurationMinutes <= 0
                        )}
                        isWorkDateInCurrentPeriod={isWorkDateInCurrentPeriod}
                        hasSelectedMachine={Boolean(selectedMachine)}
                        isPeriodEditable={isPeriodEditable}
                        overlappingEntries={overlappingEntries}
                        exactDuplicate={exactDuplicate}
                        longShiftWarning={longShiftWarning}
                      />

                      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={cancelEditing}
                          className={timeActionClassName}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          onClick={saveTime}
                          disabled={hasBlockingValidation || saveMutation.isPending}
                          className={timeActionClassName}
                        >
                          {saveMutation.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : editingEntryId ? (
                            <Save className="mr-2 h-4 w-4" />
                          ) : (
                            <Plus className="mr-2 h-4 w-4" />
                          )}
                          {editingEntryId ? 'Save changes' : 'Submit shift'}
                        </Button>
                      </div>

                      {hasBlockingValidation && !saveMutation.isPending && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Enter a date, assigned machine, start time, and end time to submit the
                          shift.
                        </p>
                      )}

                      {entryBeingEdited && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Editing {formatDate(entryBeingEdited.workDate)} shift at{' '}
                          {getMachineLabel(entryBeingEdited)}.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-6 space-y-6">
                  <div className="rounded-[24px] border border-border bg-background p-4 shadow-[var(--shadow-sm)] sm:p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h2 className="font-display text-xl font-semibold text-foreground">
                          Record completed work
                        </h2>
                        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                          Add each shift after you finish. Your machine manager will review submitted
                          time here.
                        </p>
                      </div>
                      <Button asChild size="lg" className={timeActionClassName}>
                        <Link to="/portal/time/new">
                          <Plus className="mr-2 h-4 w-4" />
                          Add completed shift
                        </Link>
                      </Button>
                    </div>

                    {periodSummary.needsCorrection > 0 && (
                      <a
                        href="#this-period"
                        className="mt-5 flex items-start gap-3 rounded-xl border border-amber/25 bg-amber/10 px-3 py-3 text-sm text-foreground transition-colors hover:bg-amber/20"
                      >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
                        <span>
                          <strong className="font-semibold">
                            {periodSummary.needsCorrection}{' '}
                            {periodSummary.needsCorrection === 1 ? 'shift needs' : 'shifts need'} a
                            correction.
                          </strong>{' '}
                          Open the shift below to see your manager&apos;s note.
                        </span>
                      </a>
                    )}

                    <div className="mt-5 border-t border-border pt-5">
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label htmlFor="time-month" className="mb-1.5 block text-sm font-medium">
                              Month
                            </label>
                            <div className="relative">
                              <CalendarDays className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                              <Input
                                id="time-month"
                                type="month"
                                value={viewMonth}
                                max={todayInputValue().slice(0, 7)}
                                onChange={(event) =>
                                  setViewMonth(event.target.value || todayInputValue().slice(0, 7))
                                }
                                className="min-h-11 pl-9 sm:w-52"
                              />
                            </div>
                          </div>
                          {profiles.length > 1 && (
                            <div>
                              <label className="mb-1.5 block text-sm font-medium">
                                Work profile
                              </label>
                              <Select value={selectedProfile.id} onValueChange={setSelectedProfileId}>
                                <SelectTrigger className="min-h-11 sm:w-64">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {profiles.map((profile) => (
                                    <SelectItem key={profile.id} value={profile.id}>
                                      {profile.accountName}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground">
                          <span>
                            <strong className="block text-base font-semibold tabular-nums text-foreground">
                              {formatMinutes(periodSummary.rawMinutes)}
                            </strong>
                            actual time
                          </span>
                          <span>
                            <strong className="block text-base font-semibold tabular-nums text-foreground">
                              {formatPaidHours(periodSummary.roundedMinutes)}
                            </strong>
                            rounded time
                          </span>
                          <span>
                            <strong className="block text-base font-semibold tabular-nums text-foreground">
                              {periodSummary.waiting}
                            </strong>
                            waiting
                          </span>
                          <span>
                            <strong className="block text-base font-semibold tabular-nums text-foreground">
                              {periodSummary.approved}
                            </strong>
                            approved
                          </span>
                        </div>
                      </div>
                      <p className="mt-4 text-sm leading-6 text-muted-foreground">
                        Due {formatDate(selectedProfile.currentPeriod.submissionDueDate)}. Each shift
                        is rounded up to the next full hour.
                      </p>
                    </div>
                  </div>

                  <div id="this-period">
                    <TimeEntriesPanel
                      title={`${formatMonth(viewMonth)} shifts`}
                      description={`${formatDate(
                        selectedProfile.currentPeriod.periodStartDate
                      )} to ${formatDate(selectedProfile.currentPeriod.periodEndDate)}`}
                      entries={selectedProfile.currentEntries}
                      emptyMessage="No shifts entered for this month yet. Add a completed shift to get started."
                      onEdit={startEditing}
                      onDelete={confirmDelete}
                      isDeleting={deleteMutation.isPending}
                    />
                  </div>

                  <div id="pay-statements">
                    <PayStatementsPanel
                      statements={issuedStatements}
                      isRefreshing={isFetchingStatements}
                      error={statementError}
                      downloadingStatementId={downloadingStatementId}
                      onDownload={downloadStatement}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </PortalLayout>
  );
}

function PayStatementsPanel({
  statements,
  isRefreshing,
  error,
  downloadingStatementId,
  onDownload,
}: {
  statements: OperatorPayStatementSummary[];
  isRefreshing: boolean;
  error: unknown;
  downloadingStatementId: string | null;
  onDownload: (statement: OperatorPayStatementSummary) => void;
}) {
  return (
    <div className="card-elevated overflow-hidden">
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-balance text-lg font-semibold text-foreground">Pay Statements</h2>
            <p className="mt-1 text-pretty text-sm text-muted-foreground">
              Download issued pay statements here when they become available.
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="px-4 py-6 text-sm text-destructive">
          Unable to load pay statements. Refresh and try again.
        </div>
      ) : statements.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {isRefreshing ? 'Loading pay statements...' : 'No pay statements yet.'}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {statements.map((statement) => (
            <article key={statement.id} className="px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="break-words text-balance font-semibold text-foreground">
                      {formatOperatorPayStatementLabel(statement.statementLabel)}
                    </h3>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                      v{statement.version}
                    </span>
                    {statement.revisionCount > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                        Revised
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                    {statement.statementNumber}
                  </p>
                  <div className="mt-3 grid gap-2 text-sm tabular-nums text-muted-foreground sm:grid-cols-2">
                    <span>
                      {formatDate(statement.periodStartDate)} to{' '}
                      {formatDate(statement.periodEndDate)}
                    </span>
                    <span>Issued {formatDate(statement.issuedAt)}</span>
                    <span>Target pay date {formatDate(statement.targetPayoutDate)}</span>
                    <span className="font-semibold tabular-nums text-foreground">
                      {formatCurrency(statement.totalPayoutCents)}
                    </span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onDownload(statement)}
                  disabled={downloadingStatementId === statement.id}
                  className={timeSmallActionClassName}
                >
                  {downloadingStatementId === statement.id ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-1.5 h-4 w-4" />
                  )}
                  Download pay statement
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function PeriodDetails({ profile }: { profile: OperatorTimekeepingProfileContext }) {
  const period = profile.currentPeriod;

  return (
    <div className={cn('mt-4 grid gap-3 sm:grid-cols-3', timeInsetPanelClassName)}>
      <Metric
        label="Period"
        value={`${formatDate(period.periodStartDate)} to ${formatDate(period.periodEndDate)}`}
      />
      <Metric label="Time due" value={formatDate(period.submissionDueDate)} />
      <Metric label="Rounding" value="Each shift up to the next full hour" />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

function ValidationPanel({
  hasInvalidTimes,
  isWorkDateInCurrentPeriod,
  hasSelectedMachine,
  isPeriodEditable,
  overlappingEntries,
  exactDuplicate,
  longShiftWarning,
}: {
  hasInvalidTimes: boolean;
  isWorkDateInCurrentPeriod: boolean;
  hasSelectedMachine: boolean;
  isPeriodEditable: boolean;
  overlappingEntries: OperatorTimeEntry[];
  exactDuplicate: OperatorTimeEntry | undefined;
  longShiftWarning: boolean;
}) {
  const messages = [
    hasInvalidTimes ? 'End time must be after start time.' : null,
    !isWorkDateInCurrentPeriod ? 'Work date must stay inside the current pay period.' : null,
    !hasSelectedMachine ? 'Select an assigned machine that is active for this work date.' : null,
    !isPeriodEditable ? 'This pay period is locked for operator edits.' : null,
    exactDuplicate ? 'This looks like a duplicate of an existing shift.' : null,
    overlappingEntries.length > 0
      ? `This shift overlaps ${overlappingEntries.length} existing entr${
          overlappingEntries.length === 1 ? 'y' : 'ies'
        }.`
      : null,
    longShiftWarning ? 'This shift is 10+ hours. Confirm the times before saving.' : null,
  ].filter(Boolean) as string[];

  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-950 shadow-[inset_0_0_0_1px_hsl(43_96%_56%/0.45)]">
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
        <div className="space-y-1 text-pretty">
          {messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

function TimeEntriesPanel({
  title,
  description,
  entries,
  emptyMessage,
  onEdit,
  onDelete,
  isDeleting,
  compact = false,
  allowActions = true,
  readOnlyMessage,
}: {
  title: string;
  description: string;
  entries: OperatorTimeEntry[];
  emptyMessage: string;
  onEdit: (entry: OperatorTimeEntry) => void;
  onDelete: (entry: OperatorTimeEntry) => void;
  isDeleting: boolean;
  compact?: boolean;
  allowActions?: boolean;
  readOnlyMessage?: string;
}) {
  return (
    <div className="card-elevated overflow-hidden">
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <h2 className="text-balance text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-pretty text-sm text-muted-foreground">{description}</p>
      </div>

      {entries.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>
      ) : (
        <div className="divide-y divide-border">
          {entries.map((entry) => {
            const locked = Boolean(entry.lockedAt) || !['draft', 'submitted'].includes(entry.status);

            return (
              <article key={entry.id} className="px-4 py-4 sm:px-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-words text-balance font-semibold text-foreground">
                        {entry.machineLabel}
                      </h3>
                      <span
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-xs font-semibold',
                          getEntryReviewClassName(entry)
                        )}
                      >
                        {getEntryReviewLabel(entry)}
                      </span>
                    </div>
                    <p className="mt-1 text-pretty text-sm text-muted-foreground">
                      {entry.locationName}
                    </p>
                    <div className="mt-3 grid gap-2 text-sm tabular-nums text-muted-foreground sm:grid-cols-2">
                      <span>{formatDate(entry.workDate)}</span>
                      <span>
                        {entry.startTime} to {entry.endTime}
                      </span>
                      <span>Raw: {formatMinutes(entry.rawDurationMinutes)}</span>
                      <span>Paid: {formatPaidHours(entry.roundedPaidMinutes)}</span>
                    </div>
                    {!compact && entry.notes && (
                      <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-pretty text-sm text-muted-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]">
                        {entry.notes}
                      </p>
                    )}
                    {!compact &&
                      entry.managerReviewStatus === 'needs_correction' &&
                      entry.managerReviewReason && (
                        <div className="mt-3 rounded-xl border border-amber/25 bg-amber/10 px-3 py-3 text-sm leading-6 text-foreground">
                          <p className="font-semibold">Your manager requested a correction</p>
                          <p className="mt-1 text-pretty">{entry.managerReviewReason}</p>
                        </div>
                      )}
                    {!compact &&
                      entry.managerReviewStatus === 'approved' &&
                      entry.status === 'submitted' && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Editing this shift will send it back for manager review.
                        </p>
                      )}
                  </div>

                  {allowActions ? (
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onEdit(entry)}
                        disabled={locked}
                        className={timeSmallActionClassName}
                      >
                        <Edit3 className="mr-1.5 h-4 w-4" />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(entry)}
                        disabled={locked || isDeleting}
                        className={timeSmallActionClassName}
                      >
                        {isDeleting ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1.5 h-4 w-4" />
                        )}
                        Delete
                      </Button>
                    </div>
                  ) : (
                    readOnlyMessage && (
                      <p className="text-pretty text-sm text-muted-foreground lg:max-w-56 lg:text-right">
                        {readOnlyMessage}
                      </p>
                    )
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
