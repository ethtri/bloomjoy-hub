import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CalendarPlus2, Clock3, Edit3, Loader2, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { PortalPageIntro } from '@/components/portal/PortalPageIntro';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  correctOperatorTimeEntry,
  createManagerTimeEntry,
  fetchMyTimeReviewContext,
  type OperatorTimeReviewContext,
  type OperatorTimeReviewEntry,
} from '@/lib/operatorPayouts';
import {
  combineDateAndTimeInTimekeepingZone,
  getActualDurationMinutes,
  getTodayInTimekeepingZone,
  isCompletedTimeInFuture,
} from '@/lib/timekeepingUi';

type CorrectionDraft = {
  machineId: string;
  workDate: string;
  startTime: string;
  endTime: string;
  notes: string;
};

type MissedTimeDraft = CorrectionDraft & {
  operatorProfileId: string;
};

const currentMonthValue = () => getTodayInTimekeepingZone().slice(0, 7);
const isMonthValue = (value: string) => /^\d{4}-\d{2}$/.test(value);
const reviewQueryKey = (workDate: string) => ['operator-time-report', workDate] as const;

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00.000Z`));

const formatMonth = (value: string) =>
  isMonthValue(value)
    ? new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${value}-01T12:00:00.000Z`)
      )
    : 'Selected month';

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

const actualMinutes = (entry: OperatorTimeReviewEntry) =>
  entry.actualDurationMinutes ?? entry.rawDurationMinutes;

const paidShifts = (entry: OperatorTimeReviewEntry) =>
  entry.paidShifts ?? Math.ceil(entry.roundedPaidMinutes / 60);

const entryLabel = (entry: OperatorTimeReviewEntry) =>
  `${entry.operatorName}, ${formatDate(entry.workDate)}, ${formatTime(entry.startTime)} to ${formatTime(
    entry.endTime
  )}, ${entry.machineLabel}`;

const draftForEntry = (entry: OperatorTimeReviewEntry): CorrectionDraft => ({
  machineId: entry.machineId,
  workDate: entry.workDate,
  startTime: entry.startTime,
  endTime: entry.endTime,
  notes: entry.notes ?? '',
});

const getDraftTiming = (draft: CorrectionDraft | null) => {
  if (!draft?.startTime || !draft.endTime) return { minutes: 0, error: null as string | null };

  try {
    return {
      minutes: getActualDurationMinutes(draft.workDate, draft.startTime, draft.endTime),
      error: null as string | null,
    };
  } catch (previewError) {
    return {
      minutes: 0,
      error:
        previewError instanceof Error
          ? previewError.message
          : 'Choose times that exist in Bloomjoy’s Pacific operating timezone.',
    };
  }
};

export default function PortalTimeReviewPage() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonthValue);
  const [technicianId, setTechnicianId] = useState('all');
  const [machineId, setMachineId] = useState('all');
  const [correctionEntry, setCorrectionEntry] = useState<OperatorTimeReviewEntry | null>(null);
  const [draft, setDraft] = useState<CorrectionDraft | null>(null);
  const [missedTimeDraft, setMissedTimeDraft] = useState<MissedTimeDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
  const addTriggerRef = useRef<HTMLButtonElement | null>(null);
  const workDate = `${month}-01`;

  const { data: context, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: reviewQueryKey(workDate),
    queryFn: () => fetchMyTimeReviewContext(workDate),
    staleTime: 20_000,
    retry: false,
  });

  const entries = useMemo(() => context?.entries ?? [], [context?.entries]);
  const technicians = useMemo(
    () =>
      [...new Map(entries.map((entry) => [entry.operatorProfileId, entry.operatorName])).entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [entries]
  );
  const availableTechnicians = useMemo(
    () =>
      [...new Map((context?.entryOptions ?? []).map((option) => [option.operatorProfileId, option.operatorName])).entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [context?.entryOptions]
  );
  const visibleEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (technicianId === 'all' || entry.operatorProfileId === technicianId) &&
          (machineId === 'all' || entry.machineId === machineId)
      ),
    [entries, machineId, technicianId]
  );
  const totalActualMinutes = visibleEntries.reduce((sum, entry) => sum + actualMinutes(entry), 0);
  const totalPaidShifts = visibleEntries.reduce((sum, entry) => sum + paidShifts(entry), 0);
  const visibleTechnicians = new Set(visibleEntries.map((entry) => entry.operatorProfileId)).size;
  const technicianGroups = useMemo(
    () =>
      [...new Map(visibleEntries.map((entry) => [entry.operatorProfileId, entry.operatorName])).entries()]
        .map(([id, name]) => {
          const technicianEntries = visibleEntries.filter((entry) => entry.operatorProfileId === id);
          return {
            id,
            name,
            entries: technicianEntries,
            actualMinutes: technicianEntries.reduce((sum, entry) => sum + actualMinutes(entry), 0),
            paidShifts: technicianEntries.reduce((sum, entry) => sum + paidShifts(entry), 0),
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
    [visibleEntries]
  );

  const { minutes: previewMinutes, error: localTimeError } = getDraftTiming(draft);
  const previewShifts = previewMinutes > 0 ? Math.ceil(previewMinutes / 60) : 0;
  const { minutes: missedPreviewMinutes, error: missedLocalTimeError } = getDraftTiming(missedTimeDraft);
  const missedPreviewShifts = missedPreviewMinutes > 0 ? Math.ceil(missedPreviewMinutes / 60) : 0;
  const missedTimeMachines = useMemo(() => {
    if (!missedTimeDraft || !context) return [];
    const eligibleMachineIds = new Set(
      context.entryOptions
        .filter(
          (option) =>
            option.operatorProfileId === missedTimeDraft.operatorProfileId &&
            option.effectiveStartDate <= missedTimeDraft.workDate &&
            (!option.effectiveEndDate || option.effectiveEndDate >= missedTimeDraft.workDate)
        )
        .map((option) => option.machineId)
    );
    return context.machines.filter((machine) => eligibleMachineIds.has(machine.machineId));
  }, [context, missedTimeDraft]);

  const correctionMutation = useMutation({
    mutationFn: () => {
      if (!correctionEntry || !draft) throw new Error('Choose a time entry to correct.');
      return correctOperatorTimeEntry({
        timeEntryId: correctionEntry.id,
        machineId: draft.machineId,
        actualStartAt: combineDateAndTimeInTimekeepingZone(draft.workDate, draft.startTime),
        actualEndAt: combineDateAndTimeInTimekeepingZone(draft.workDate, draft.endTime),
        notes: draft.notes || null,
      });
    },
    onSuccess: (nextContext) => {
      queryClient.setQueryData<OperatorTimeReviewContext>(reviewQueryKey(workDate), {
        ...nextContext,
        entryOptions: context?.entryOptions ?? [],
      });
      setCorrectionEntry(null);
      setDraft(null);
      setFormError(null);
      toast.success('Time corrected. The report is up to date.');
      requestAnimationFrame(() => editTriggerRef.current?.focus());
    },
    onError: (mutationError) => {
      setFormError(
        mutationError instanceof Error
          ? mutationError.message
          : 'We could not save this correction. Your changes are still here.'
      );
    },
  });

  const missedTimeMutation = useMutation({
    mutationFn: () => {
      if (!missedTimeDraft) throw new Error('Complete the missed time entry.');
      return createManagerTimeEntry({
        operatorProfileId: missedTimeDraft.operatorProfileId,
        machineId: missedTimeDraft.machineId,
        actualStartAt: combineDateAndTimeInTimekeepingZone(missedTimeDraft.workDate, missedTimeDraft.startTime),
        actualEndAt: combineDateAndTimeInTimekeepingZone(missedTimeDraft.workDate, missedTimeDraft.endTime),
        notes: missedTimeDraft.notes || null,
      });
    },
    onSuccess: (result) => {
      queryClient.setQueryData<OperatorTimeReviewContext>(reviewQueryKey(workDate), result.context);
      setMissedTimeDraft(null);
      setFormError(null);
      toast.success(
        result.afterTechnicianCutoff
          ? 'Missed time added after the Technician cutoff. It is included in the manager report.'
          : 'Time added. The report is up to date.'
      );
      requestAnimationFrame(() => addTriggerRef.current?.focus());
    },
    onError: (mutationError) => {
      setFormError(
        mutationError instanceof Error
          ? mutationError.message
          : 'We could not add this missed time. Your changes are still here.'
      );
    },
  });

  const openCorrection = (entry: OperatorTimeReviewEntry, trigger: HTMLButtonElement) => {
    editTriggerRef.current = trigger;
    setCorrectionEntry(entry);
    setDraft(draftForEntry(entry));
    setFormError(null);
  };

  const saveCorrection = () => {
    if (!draft) return;
    if (!draft.machineId || !draft.workDate || !draft.startTime || !draft.endTime) {
      setFormError('Complete the date, machine, start time, and end time.');
      return;
    }
    if (localTimeError) {
      setFormError(localTimeError);
      return;
    }
    if (previewMinutes <= 0) {
      setFormError('End time must be later than start time.');
      return;
    }
    if (isCompletedTimeInFuture(draft.workDate, draft.endTime)) {
      setFormError('Enter time only after the work has ended.');
      return;
    }
    setFormError(null);
    correctionMutation.mutate();
  };

  const closeCorrection = () => {
    setCorrectionEntry(null);
    setDraft(null);
    setFormError(null);
    requestAnimationFrame(() => editTriggerRef.current?.focus());
  };

  const openMissedTime = (trigger: HTMLButtonElement) => {
    if (!context || availableTechnicians.length === 0) return;
    addTriggerRef.current = trigger;
    const today = getTodayInTimekeepingZone();
    const defaultDate = today < context.periodStartDate
      ? context.periodStartDate
      : today > context.periodEndDate
        ? context.periodEndDate
        : today;
    const selectedTechnician =
      availableTechnicians.find((technician) => technician.id === technicianId) ?? availableTechnicians[0];
    const firstOption = context.entryOptions.find(
      (option) =>
        option.operatorProfileId === selectedTechnician.id &&
        option.effectiveStartDate <= defaultDate &&
        (!option.effectiveEndDate || option.effectiveEndDate >= defaultDate)
    );
    setMissedTimeDraft({
      operatorProfileId: selectedTechnician.id,
      machineId: firstOption?.machineId ?? '',
      workDate: defaultDate,
      startTime: '',
      endTime: '',
      notes: '',
    });
    setFormError(null);
  };

  const updateMissedTimeIdentity = (operatorProfileId: string, workDate: string) => {
    if (!context || !missedTimeDraft) return;
    const firstOption = context.entryOptions.find(
      (option) =>
        option.operatorProfileId === operatorProfileId &&
        option.effectiveStartDate <= workDate &&
        (!option.effectiveEndDate || option.effectiveEndDate >= workDate)
    );
    setMissedTimeDraft({
      ...missedTimeDraft,
      operatorProfileId,
      workDate,
      machineId: firstOption?.machineId ?? '',
    });
  };

  const saveMissedTime = () => {
    if (!missedTimeDraft) return;
    if (
      !missedTimeDraft.operatorProfileId ||
      !missedTimeDraft.machineId ||
      !missedTimeDraft.workDate ||
      !missedTimeDraft.startTime ||
      !missedTimeDraft.endTime
    ) {
      setFormError('Complete the Technician, date, machine, start time, and end time.');
      return;
    }
    if (missedLocalTimeError) {
      setFormError(missedLocalTimeError);
      return;
    }
    if (missedPreviewMinutes <= 0) {
      setFormError('End time must be later than start time.');
      return;
    }
    if (isCompletedTimeInFuture(missedTimeDraft.workDate, missedTimeDraft.endTime)) {
      setFormError('Enter time only after the work has ended.');
      return;
    }
    setFormError(null);
    missedTimeMutation.mutate();
  };

  const closeMissedTime = () => {
    setMissedTimeDraft(null);
    setFormError(null);
    requestAnimationFrame(() => addTriggerRef.current?.focus());
  };

  return (
    <PortalLayout>
      <section className="portal-section">
        <div className="container-page space-y-5">
          <PortalPageIntro
            eyebrow="Manager"
            title="Time Report"
            description="See completed Technician time for the machines you manage and correct errors directly. No approval is required."
            badges={[
              { label: formatMonth(month), tone: 'muted', icon: CalendarDays },
              { label: `${totalPaidShifts} paid shifts`, tone: 'primary', icon: Clock3 },
            ]}
            actions={
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <Button
                  ref={addTriggerRef}
                  type="button"
                  className="min-h-11"
                  disabled={availableTechnicians.length === 0}
                  onClick={(event) => openMissedTime(event.currentTarget)}
                >
                  <CalendarPlus2 className="mr-2 h-4 w-4" />
                  Add missed time
                </Button>
                <Button type="button" variant="outline" className="min-h-11" disabled={isFetching} onClick={() => void refetch()}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} />
                  Refresh
                </Button>
              </div>
            }
          />

          {isLoading ? (
            <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin motion-reduce:animate-none" />
              Loading the Time Report…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6" role="alert">
              <h2 className="font-semibold text-foreground">Time Report unavailable</h2>
              <p className="mt-2 text-sm text-muted-foreground">Your saved time has not changed. Refresh once, then ask Bloomjoy to confirm your manager access if this continues.</p>
              <Button type="button" className="mt-5 min-h-11" onClick={() => void refetch()}>Try again</Button>
            </div>
          ) : !context?.hasAccess || context.machines.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="font-semibold text-foreground">No managed machines</h2>
              <p className="mt-2 text-sm text-muted-foreground">Ask Bloomjoy to check your Machine Manager assignment if you should see a Time Report.</p>
            </div>
          ) : (
            <>
              <div className="grid gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:grid-cols-3 sm:p-5">
                <div>
                  <label htmlFor="time-report-month" className="text-sm font-medium text-foreground">Month</label>
                  <Input id="time-report-month" type="month" value={month} max={currentMonthValue()} className="mt-2 min-h-11" onChange={(event) => { if (isMonthValue(event.target.value)) setMonth(event.target.value); }} />
                </div>
                <div>
                  <label htmlFor="time-report-technician" className="text-sm font-medium text-foreground">Technician</label>
                  <Select value={technicianId} onValueChange={setTechnicianId}>
                    <SelectTrigger id="time-report-technician" className="mt-2 min-h-11"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All Technicians</SelectItem>{technicians.map((technician) => <SelectItem key={technician.id} value={technician.id}>{technician.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label htmlFor="time-report-machine" className="text-sm font-medium text-foreground">Machine</label>
                  <Select value={machineId} onValueChange={setMachineId}>
                    <SelectTrigger id="time-report-machine" className="mt-2 min-h-11"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All managed machines</SelectItem>{context.machines.map((machine) => <SelectItem key={machine.machineId} value={machine.machineId}>{machine.machineLabel} · {machine.locationName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3" aria-live="polite">
                <Metric label="Actual time" value={formatDuration(totalActualMinutes)} />
                <Metric label="Paid shifts" value={`${totalPaidShifts}`} />
                <Metric label="Technicians" value={`${visibleTechnicians}`} />
              </div>

              <div className="rounded-xl border border-border bg-card shadow-sm">
                <div className="border-b border-border px-4 py-5 sm:px-5">
                  <h2 className="text-lg font-semibold text-foreground">Monthly time</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Each entry rounds independently. A 61-minute entry is two paid shifts.</p>
                </div>
                {visibleEntries.length === 0 ? (
                  <div className="px-5 py-10 text-center"><Users className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-3 font-medium text-foreground">No matching time</p><p className="mt-1 text-sm text-muted-foreground">Try another Technician, machine, or month.</p></div>
                ) : (
                  <div className="space-y-4 p-4 sm:p-5">
                    {technicianGroups.map((group) => (
                      <section key={group.id} className="overflow-hidden rounded-lg border border-border" aria-labelledby={`technician-${group.id}`}>
                        <div className="flex flex-col gap-2 border-b border-border bg-muted/25 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <h3 id={`technician-${group.id}`} className="font-semibold text-foreground">{group.name}</h3>
                          <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{formatDuration(group.actualMinutes)}</span> actual · <span className="font-medium text-foreground">{group.paidShifts}</span> paid {group.paidShifts === 1 ? 'shift' : 'shifts'}</p>
                        </div>
                        <div className="divide-y divide-border">
                          {group.entries.map((entry) => (
                            <article key={entry.id} className="p-4">
                              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <p className="font-medium text-foreground">{entry.machineLabel} · {entry.locationName}</p>
                                  <p className="mt-2 text-sm tabular-nums text-foreground">{formatDate(entry.workDate)} · {formatTime(entry.startTime)} to {formatTime(entry.endTime)}</p>
                                  <p className="mt-1 text-sm text-muted-foreground">{formatDuration(actualMinutes(entry))} actual · <span className="font-semibold text-foreground">{paidShifts(entry)} paid {paidShifts(entry) === 1 ? 'shift' : 'shifts'}</span></p>
                                  {entry.notes && <p className="mt-2 text-sm text-muted-foreground">{entry.notes}</p>}
                                </div>
                                <Button type="button" variant="outline" className="min-h-11 sm:shrink-0" aria-label={`Edit ${entryLabel(entry)}`} onClick={(event) => openCorrection(entry, event.currentTarget)}><Edit3 className="mr-2 h-4 w-4" />Edit time</Button>
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <Dialog open={Boolean(correctionEntry && draft)} onOpenChange={(open) => !open && !correctionMutation.isPending && closeCorrection()}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>Correct time</DialogTitle><DialogDescription>Update the source entry directly. No approval or written reason is required, and the change remains in the audit history.</DialogDescription></DialogHeader>
          {draft && correctionEntry && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm"><p className="font-medium text-foreground">{correctionEntry.operatorName}</p><p className="text-muted-foreground">{correctionEntry.machineLabel}</p></div>
              <div><label htmlFor="correction-date" className="text-sm font-medium text-foreground">Work date</label><Input id="correction-date" type="date" value={draft.workDate} min={context?.periodStartDate} max={context?.periodEndDate} className="mt-2 min-h-11" onChange={(event) => setDraft({ ...draft, workDate: event.target.value })} /></div>
              <div><label htmlFor="correction-machine" className="text-sm font-medium text-foreground">Machine</label><Select value={draft.machineId} onValueChange={(value) => setDraft({ ...draft, machineId: value })}><SelectTrigger id="correction-machine" className="mt-2 min-h-11"><SelectValue /></SelectTrigger><SelectContent>{context?.machines.map((machine) => <SelectItem key={machine.machineId} value={machine.machineId}>{machine.machineLabel} · {machine.locationName}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label htmlFor="correction-start" className="text-sm font-medium text-foreground">Start time</label><Input id="correction-start" type="time" value={draft.startTime} className="mt-2 min-h-11" onChange={(event) => setDraft({ ...draft, startTime: event.target.value })} /></div>
                <div><label htmlFor="correction-end" className="text-sm font-medium text-foreground">End time</label><Input id="correction-end" type="time" value={draft.endTime} className="mt-2 min-h-11" onChange={(event) => setDraft({ ...draft, endTime: event.target.value })} /></div>
              </div>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4" aria-live="polite"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Updated pay preview</p><p className="mt-1 font-semibold text-foreground">{previewMinutes > 0 ? `${formatDuration(previewMinutes)} actual → ${previewShifts} paid ${previewShifts === 1 ? 'shift' : 'shifts'}` : 'Enter a valid start and end time.'}</p></div>
              <div><label htmlFor="correction-notes" className="text-sm font-medium text-foreground">Notes (optional)</label><Textarea id="correction-notes" value={draft.notes} className="mt-2" onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></div>
              {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
            </div>
          )}
          <DialogFooter><Button type="button" variant="outline" className="min-h-11" disabled={correctionMutation.isPending} onClick={closeCorrection}>Cancel</Button><Button type="button" className="min-h-11" disabled={correctionMutation.isPending} onClick={saveCorrection}>{correctionMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}Save correction</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(missedTimeDraft)} onOpenChange={(open) => !open && !missedTimeMutation.isPending && closeMissedTime()}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add missed time</DialogTitle>
            <DialogDescription>
              Add completed work that a Technician forgot to enter. This works after the monthly cutoff and stays in the audit history.
            </DialogDescription>
          </DialogHeader>
          {missedTimeDraft && (
            <div className="space-y-4">
              <div>
                <label htmlFor="missed-time-technician" className="text-sm font-medium text-foreground">Technician</label>
                <Select
                  value={missedTimeDraft.operatorProfileId}
                  onValueChange={(value) => updateMissedTimeIdentity(value, missedTimeDraft.workDate)}
                >
                  <SelectTrigger id="missed-time-technician" className="mt-2 min-h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {availableTechnicians.map((technician) => (
                      <SelectItem key={technician.id} value={technician.id}>{technician.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label htmlFor="missed-time-date" className="text-sm font-medium text-foreground">Work date</label>
                <Input
                  id="missed-time-date"
                  type="date"
                  value={missedTimeDraft.workDate}
                  min={context?.periodStartDate}
                  max={context?.periodEndDate}
                  className="mt-2 min-h-11"
                  onChange={(event) => updateMissedTimeIdentity(missedTimeDraft.operatorProfileId, event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="missed-time-machine" className="text-sm font-medium text-foreground">Machine</label>
                <Select
                  value={missedTimeDraft.machineId}
                  onValueChange={(value) => setMissedTimeDraft({ ...missedTimeDraft, machineId: value })}
                >
                  <SelectTrigger id="missed-time-machine" className="mt-2 min-h-11"><SelectValue placeholder="Choose a machine" /></SelectTrigger>
                  <SelectContent>
                    {missedTimeMachines.map((machine) => (
                      <SelectItem key={machine.machineId} value={machine.machineId}>{machine.machineLabel} · {machine.locationName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {missedTimeMachines.length === 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">This Technician was not assigned to one of your machines on that date.</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="missed-time-start" className="text-sm font-medium text-foreground">Start time</label>
                  <Input id="missed-time-start" type="time" value={missedTimeDraft.startTime} className="mt-2 min-h-11" onChange={(event) => setMissedTimeDraft({ ...missedTimeDraft, startTime: event.target.value })} />
                </div>
                <div>
                  <label htmlFor="missed-time-end" className="text-sm font-medium text-foreground">End time</label>
                  <Input id="missed-time-end" type="time" value={missedTimeDraft.endTime} className="mt-2 min-h-11" onChange={(event) => setMissedTimeDraft({ ...missedTimeDraft, endTime: event.target.value })} />
                </div>
              </div>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4" aria-live="polite">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pay preview</p>
                <p className="mt-1 font-semibold text-foreground">
                  {missedPreviewMinutes > 0
                    ? `${formatDuration(missedPreviewMinutes)} actual → ${missedPreviewShifts} paid ${missedPreviewShifts === 1 ? 'shift' : 'shifts'}`
                    : 'Enter a valid start and end time.'}
                </p>
              </div>
              <div>
                <label htmlFor="missed-time-notes" className="text-sm font-medium text-foreground">Notes (optional)</label>
                <Textarea id="missed-time-notes" value={missedTimeDraft.notes} className="mt-2" onChange={(event) => setMissedTimeDraft({ ...missedTimeDraft, notes: event.target.value })} />
              </div>
              {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11" disabled={missedTimeMutation.isPending} onClick={closeMissedTime}>Cancel</Button>
            <Button type="button" className="min-h-11" disabled={missedTimeMutation.isPending || missedTimeMachines.length === 0} onClick={saveMissedTime}>
              {missedTimeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}
              Add to report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold text-foreground">{value}</p></div>;
}
