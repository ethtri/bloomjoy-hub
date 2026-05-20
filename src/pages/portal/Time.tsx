import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
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
import {
  downloadOperatorPayStatementHtml,
  fetchMyOperatorPayStatementContext,
  fetchMyOperatorTimekeepingContext,
  fetchPayStatementArtifact,
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

const todayInputValue = () => new Date().toISOString().slice(0, 10);

const defaultForm = (): TimeEntryForm => ({
  workDate: todayInputValue(),
  machineId: '',
  startTime: '',
  endTime: '',
  notes: '',
});

const formatDate = (value: string | null | undefined) => {
  if (!value) return 'Not set';

  const dateValue = value.includes('T') ? new Date(value) : new Date(`${value}T00:00:00`);

  return dateValue.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

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
  })} paid hr${minutes === 60 ? '' : 's'}`;

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

const getMachineLabel = (entry: OperatorTimeEntry) =>
  `${entry.machineLabel} - ${entry.locationName}`;

const getContextQueryKey = ['operator-timekeeping'] as const;
const getPayStatementsQueryKey = ['operator-pay-statements'] as const;
const emptyProfiles: OperatorTimekeepingProfileContext[] = [];

export default function PortalTimePage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const { entryId } = useParams<{ entryId?: string }>();
  const isTimeEntryScreen = location.pathname === '/portal/time/new' || Boolean(entryId);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [downloadingStatementId, setDownloadingStatementId] = useState<string | null>(null);
  const [form, setForm] = useState<TimeEntryForm>(() => defaultForm());

  const {
    data: context,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: getContextQueryKey,
    queryFn: () => fetchMyOperatorTimekeepingContext(),
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
        .flatMap((profile) => profile.currentEntries)
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
  const pastEntries = useMemo(() => {
    if (!selectedProfile) return [];

    const { periodStartDate, periodEndDate } = selectedProfile.currentPeriod;
    return selectedProfile.recentEntries.filter(
      (entry) => !isDateInsideRange(entry.workDate, periodStartDate, periodEndDate)
    );
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
    !isPeriodEditable;

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
      queryClient.setQueryData<OperatorTimekeepingContext>(getContextQueryKey, nextContext);
      setEditingEntryId(null);
      setForm({
        ...defaultForm(),
        machineId: nextContext.profiles[0]?.assignedMachines[0]?.machineId ?? '',
      });
      toast.success('Time entry saved.');
      navigate('/portal/time');
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
      queryClient.setQueryData<OperatorTimekeepingContext>(getContextQueryKey, nextContext);
      setEditingEntryId(null);
      toast.success('Time entry deleted.');
    },
    onError: (mutationError: Error) => {
      toast.error(mutationError.message || 'Unable to delete time entry.');
    },
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getContextQueryKey }),
      queryClient.invalidateQueries({ queryKey: getPayStatementsQueryKey }),
    ]);
  };

  const downloadStatement = async (statement: OperatorPayStatementSummary) => {
    setDownloadingStatementId(statement.id);
    try {
      const artifact = await fetchPayStatementArtifact(statement.id);
      downloadOperatorPayStatementHtml(artifact);
      toast.success('Pay stub downloaded.');
    } catch (downloadError) {
      toast.error(
        downloadError instanceof Error ? downloadError.message : 'Unable to download pay stub.'
      );
    } finally {
      setDownloadingStatementId(null);
    }
  };

  const startEditing = (entry: OperatorTimeEntry) => {
    navigate(`/portal/time/${entry.id}/edit`);
  };

  const cancelEditing = () => {
    setEditingEntryId(null);
    setForm({
      ...defaultForm(),
      machineId: effectiveMachines[0]?.machineId ?? '',
    });
    navigate('/portal/time');
  };

  const confirmDelete = (entry: OperatorTimeEntry) => {
    if (entry.lockedAt || !['draft', 'submitted'].includes(entry.status)) {
      toast.error('Locked time entries cannot be deleted.');
      return;
    }

    if (window.confirm('Delete this unlocked time entry?')) {
      deleteMutation.mutate(entry.id);
    }
  };

  return (
    <PortalLayout>
      <section className="portal-section">
        <div className="container-page">
          <PortalPageIntro
            title={isTimeEntryScreen ? (editingEntryId ? 'Edit Time' : 'Add Time') : 'Time'}
            description={
              isTimeEntryScreen
                ? 'Submit one shift at a time.'
                : 'Add time, review submitted shifts, and download pay stubs.'
            }
            badges={[
              {
                label: selectedProfile
                  ? `${getStatusLabel(selectedProfile.currentPeriod.status)} period`
                  : 'Operator timekeeping',
                tone: selectedProfile?.currentPeriod.status === 'locked' ? 'warning' : 'default',
              },
              {
                label: isFetching ? 'Refreshing' : 'Assigned-machine only',
                tone: 'muted',
              },
            ]}
            actions={
              isTimeEntryScreen ? (
                <Button asChild variant="outline">
                  <Link to="/portal/time">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Time home
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" onClick={refresh} disabled={isFetching}>
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
                  No operator payout profile yet
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Ask a Bloomjoy admin or machine manager to add your operator payout profile and
                  assigned machines before submitting time.
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
                          <h2 className="text-lg font-semibold text-foreground">
                            {editingEntryId ? 'Edit Time' : 'Add Time'}
                          </h2>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Enter one shift at a time, then return to your time summary.
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
                            min={selectedProfile.currentPeriod.periodStartDate}
                            max={selectedProfile.currentPeriod.periodEndDate}
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

                      <div className="mt-5 grid gap-3 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-2">
                        <Metric
                          label="Actual time"
                          value={
                            rawDurationMinutes ? formatMinutes(rawDurationMinutes) : 'Set times'
                          }
                        />
                        <Metric
                          label="You'll be paid for"
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
                        <Button type="button" variant="outline" onClick={cancelEditing}>
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          onClick={() => saveMutation.mutate()}
                          disabled={hasBlockingValidation || saveMutation.isPending}
                        >
                          {saveMutation.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : editingEntryId ? (
                            <Save className="mr-2 h-4 w-4" />
                          ) : (
                            <Plus className="mr-2 h-4 w-4" />
                          )}
                          {editingEntryId ? 'Save Time' : 'Add Time'}
                        </Button>
                      </div>

                      {hasBlockingValidation && !saveMutation.isPending && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Enter a date, assigned machine, start time, and end time to add time.
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
                <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)]">
                  <div className="space-y-6">
                    <div className="card-elevated p-4 sm:p-5">
                      <h2 className="text-lg font-semibold text-foreground">What do you need?</h2>
                      <div className="mt-4 grid gap-3">
                        <Button asChild size="lg" className="justify-start">
                          <Link to="/portal/time/new">
                            <Plus className="mr-2 h-4 w-4" />
                            Add Time
                          </Link>
                        </Button>
                        <Button asChild variant="outline" className="justify-start">
                          <a href="#this-period">Review submitted time</a>
                        </Button>
                        <Button asChild variant="outline" className="justify-start">
                          <a href="#pay-stubs">Download pay stubs</a>
                        </Button>
                      </div>
                    </div>

                    <div className="card-elevated p-4 sm:p-5">
                      <h2 className="text-lg font-semibold text-foreground">Current Period</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Time is due by {formatDate(selectedProfile.currentPeriod.submissionDueDate)}
                        .
                      </p>
                      <PeriodDetails profile={selectedProfile} />
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div id="pay-stubs">
                      <PayStatementsPanel
                        statements={issuedStatements}
                        isRefreshing={isFetchingStatements}
                        error={statementError}
                        downloadingStatementId={downloadingStatementId}
                        onDownload={downloadStatement}
                      />
                    </div>

                    <div id="this-period">
                      <TimeEntriesPanel
                        title="This Period"
                        description={`${formatDate(
                          selectedProfile.currentPeriod.periodStartDate
                        )} to ${formatDate(selectedProfile.currentPeriod.periodEndDate)}`}
                        entries={selectedProfile.currentEntries}
                        emptyMessage="No time entered for this period yet."
                        onEdit={startEditing}
                        onDelete={confirmDelete}
                        isDeleting={deleteMutation.isPending}
                      />
                    </div>

                    <TimeEntriesPanel
                      title="Past Shifts"
                      description="Earlier payout periods only."
                      entries={pastEntries}
                      emptyMessage="No past shifts yet."
                      onEdit={startEditing}
                      onDelete={confirmDelete}
                      isDeleting={deleteMutation.isPending}
                      compact
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
            <h2 className="text-lg font-semibold text-foreground">Pay Stubs</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Download issued pay stubs for finalized payout periods.
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="px-4 py-6 text-sm text-destructive">
          Unable to load pay stubs. Refresh and try again.
        </div>
      ) : statements.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {isRefreshing ? 'Loading pay stubs...' : 'No pay stubs yet.'}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {statements.map((statement) => (
            <article key={statement.id} className="px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="break-words font-semibold text-foreground">
                      {statement.statementLabel}
                    </h3>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      v{statement.version}
                    </span>
                    {statement.revisionCount > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                        Revised
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {statement.statementNumber}
                  </p>
                  <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    <span>
                      {formatDate(statement.periodStartDate)} to{' '}
                      {formatDate(statement.periodEndDate)}
                    </span>
                    <span>Issued {formatDate(statement.issuedAt)}</span>
                    <span>Target payout {formatDate(statement.targetPayoutDate)}</span>
                    <span className="font-semibold text-foreground">
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
                >
                  {downloadingStatementId === statement.id ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-1.5 h-4 w-4" />
                  )}
                  Download pay stub
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
    <div className="mt-4 grid gap-3 rounded-md bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric
        label="Period"
        value={`${formatDate(period.periodStartDate)} to ${formatDate(period.periodEndDate)}`}
      />
      <Metric label="Time due" value={formatDate(period.submissionDueDate)} />
      <Metric label="Locks" value={formatDate(period.lockDate)} />
      <Metric label="Rounding" value={profile.policy.roundingRule.replaceAll('_', ' ')} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-foreground">{value}</p>
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
    !isWorkDateInCurrentPeriod ? 'Work date must stay inside the current payout period.' : null,
    !hasSelectedMachine ? 'Select an assigned machine that is active for this work date.' : null,
    !isPeriodEditable ? 'This payout period is locked for operator edits.' : null,
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
    <div className="mt-4 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-3 text-sm text-amber-950">
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
        <div className="space-y-1">
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
}: {
  title: string;
  description: string;
  entries: OperatorTimeEntry[];
  emptyMessage: string;
  onEdit: (entry: OperatorTimeEntry) => void;
  onDelete: (entry: OperatorTimeEntry) => void;
  isDeleting: boolean;
  compact?: boolean;
}) {
  return (
    <div className="card-elevated overflow-hidden">
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
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
                      <h3 className="break-words font-semibold text-foreground">
                        {entry.machineLabel}
                      </h3>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {getStatusLabel(entry.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{entry.locationName}</p>
                    <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                      <span>{formatDate(entry.workDate)}</span>
                      <span>
                        {entry.startTime} to {entry.endTime}
                      </span>
                      <span>Raw: {formatMinutes(entry.rawDurationMinutes)}</span>
                      <span>Paid: {formatPaidHours(entry.roundedPaidMinutes)}</span>
                    </div>
                    {!compact && entry.notes && (
                      <p className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                        {entry.notes}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onEdit(entry)}
                      disabled={locked}
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
                    >
                      {isDeleting ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-1.5 h-4 w-4" />
                      )}
                      Delete
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
