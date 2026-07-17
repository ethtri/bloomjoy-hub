import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Loader2,
  Lock,
  MessageSquareWarning,
  RefreshCw,
} from 'lucide-react';
import { Link } from 'react-router-dom';
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
  fetchMyTimeReviewContext,
  reviewOperatorTimeEntry,
  type OperatorTimeReviewContext,
  type OperatorTimeReviewEntry,
  type TimeEntryManagerReviewStatus,
} from '@/lib/operatorPayouts';
import { cn } from '@/lib/utils';

type ReviewFilter = 'needs_review' | 'needs_correction' | 'approved' | 'all';

const getLocalDateInputValue = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const currentMonthValue = () => getLocalDateInputValue().slice(0, 7);

const formatDate = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const formatMonth = (value: string) =>
  new Date(`${value}-01T00:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

const formatTime = (value: string) =>
  new Date(`1970-01-01T${value}:00`).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours === 0) return `${remainder} min`;
  if (remainder === 0) return `${hours} hr${hours === 1 ? '' : 's'}`;
  return `${hours} hr ${remainder} min`;
};

const formatPaidHours = (minutes: number) =>
  `${(minutes / 60).toLocaleString(undefined, { maximumFractionDigits: 2 })} rounded hr${
    minutes === 60 ? '' : 's'
  }`;

const getReviewLabel = (
  reviewStatus: TimeEntryManagerReviewStatus,
  entryStatus: OperatorTimeReviewEntry['status']
) => {
  if (entryStatus === 'paid') return 'Paid';
  if (entryStatus === 'included_in_payout') return 'Included in pay';
  if (entryStatus === 'locked') return 'Locked';
  if (reviewStatus === 'approved') return 'Approved';
  if (reviewStatus === 'needs_correction') return 'Correction requested';
  return 'Needs review';
};

const getReviewBadgeClass = (
  reviewStatus: TimeEntryManagerReviewStatus,
  entryStatus: OperatorTimeReviewEntry['status']
) => {
  if (entryStatus !== 'submitted') return 'border-border bg-muted/60 text-foreground';
  if (reviewStatus === 'approved') return 'border-sage/40 bg-sage/10 text-foreground';
  if (reviewStatus === 'needs_correction') {
    return 'border-amber/40 bg-amber/10 text-foreground';
  }
  return 'border-primary/20 bg-primary/10 text-primary';
};

const matchesFilter = (entry: OperatorTimeReviewEntry, filter: ReviewFilter) => {
  if (filter === 'all') return true;
  if (filter === 'needs_review') {
    return entry.status === 'submitted' && entry.managerReviewStatus === 'pending';
  }

  return entry.managerReviewStatus === filter;
};

const reviewQueryKey = (workDate: string) => ['operator-time-review', workDate] as const;
const emptyReviewEntries: OperatorTimeReviewEntry[] = [];

export default function PortalTimeReviewPage() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonthValue);
  const [machineId, setMachineId] = useState('all');
  const [filter, setFilter] = useState<ReviewFilter>('needs_review');
  const [correctionEntry, setCorrectionEntry] = useState<OperatorTimeReviewEntry | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [reviewAnnouncement, setReviewAnnouncement] = useState('');
  const queueHeadingRef = useRef<HTMLHeadingElement>(null);
  const workDate = `${month}-01`;

  const { data: context, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: reviewQueryKey(workDate),
    queryFn: () => fetchMyTimeReviewContext(workDate),
    staleTime: 1000 * 20,
    retry: false,
  });

  const entries = context?.entries ?? emptyReviewEntries;
  const summary = useMemo(
    () => ({
      needsReview: entries.filter(
        (entry) => entry.status === 'submitted' && entry.managerReviewStatus === 'pending'
      ).length,
      approved: entries.filter((entry) => entry.managerReviewStatus === 'approved').length,
      needsCorrection: entries.filter(
        (entry) => entry.managerReviewStatus === 'needs_correction'
      ).length,
      paidMinutes: entries.reduce((total, entry) => total + entry.roundedPaidMinutes, 0),
    }),
    [entries]
  );

  const visibleEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (machineId === 'all' || entry.machineId === machineId) && matchesFilter(entry, filter)
      ),
    [entries, filter, machineId]
  );

  const reviewMutation = useMutation({
    mutationFn: reviewOperatorTimeEntry,
    onSuccess: (nextContext, variables) => {
      queryClient.setQueryData<OperatorTimeReviewContext>(
        reviewQueryKey(variables.workDate ?? workDate),
        nextContext
      );
      void queryClient.invalidateQueries({ queryKey: ['operator-timekeeping'] });
      toast.success(
        variables.decision === 'approved' ? 'Shift approved.' : 'Correction requested.'
      );
      setReviewAnnouncement(
        variables.decision === 'approved'
          ? 'Shift approved. The review queue is updated.'
          : 'Correction requested. The review queue is updated.'
      );
      setCorrectionEntry(null);
      setCorrectionReason('');
    },
    onError: (mutationError) => {
      toast.error(mutationError instanceof Error ? mutationError.message : 'Unable to review shift.');
    },
  });

  const approveEntry = (entry: OperatorTimeReviewEntry) => {
    reviewMutation.mutate({
      timeEntryId: entry.id,
      decision: 'approved',
      workDate,
    });
  };

  const requestCorrection = () => {
    if (!correctionEntry || correctionReason.trim().length === 0) return;

    reviewMutation.mutate({
      timeEntryId: correctionEntry.id,
      decision: 'needs_correction',
      reason: correctionReason.trim(),
      workDate,
    });
  };

  const isMutatingEntry = (entryId: string) =>
    reviewMutation.isPending && reviewMutation.variables?.timeEntryId === entryId;

  useEffect(() => {
    if (!reviewAnnouncement) return;

    queueHeadingRef.current?.focus();
  }, [reviewAnnouncement, visibleEntries.length]);

  return (
    <PortalLayout>
      <section className="portal-section">
        <div className="container-page">
          <PortalPageIntro
            eyebrow="Manager workspace"
            title="Review time"
            description="Approve completed shifts for the machines you manage, or return a shift with a clear correction note."
            badges={[
              { label: formatMonth(month), tone: 'muted', icon: CalendarDays },
              {
                label: `${summary.needsReview} waiting`,
                tone: summary.needsReview > 0 ? 'accent' : 'success',
                icon: summary.needsReview > 0 ? Clock3 : CheckCircle2,
              },
            ]}
            actions={
              <Button
                type="button"
                variant="outline"
                onClick={() => void refetch()}
                disabled={isFetching}
              >
                {isFetching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Refresh
              </Button>
            }
          />

          {isLoading ? (
            <div className="mt-6 rounded-[24px] border border-border bg-background px-5 py-12 text-center text-sm text-muted-foreground shadow-[var(--shadow-sm)]">
              <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
              Loading submitted time...
            </div>
          ) : error ? (
            <div className="mt-6 rounded-[24px] border border-destructive/20 bg-destructive/5 px-5 py-8">
              <h2 className="font-display text-xl font-semibold text-foreground">
                Time review is unavailable
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                The review queue could not be loaded. Refresh once, then ask Bloomjoy to confirm the
                timekeeping update is deployed if this continues.
              </p>
              <Button type="button" variant="outline" className="mt-5" onClick={() => void refetch()}>
                Try again
              </Button>
            </div>
          ) : !context?.hasAccess || context.machines.length === 0 ? (
            <div className="mt-6 rounded-[24px] border border-border bg-background px-5 py-8 shadow-[var(--shadow-sm)]">
              <Lock className="h-6 w-6 text-muted-foreground" />
              <h2 className="mt-4 font-display text-xl font-semibold text-foreground">
                No managed machines
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                This page opens only for people who already manage at least one machine. Ask Bloomjoy
                to update your machine assignment if you should review time.
              </p>
              <Button asChild variant="outline" className="mt-5">
                <Link to="/portal">Back to dashboard</Link>
              </Button>
            </div>
          ) : (
            <div className="mt-6 space-y-5">
              {reviewMutation.isError && (
                <div
                  role="alert"
                  className="rounded-[20px] border border-destructive/20 bg-destructive/5 px-4 py-4 text-sm"
                >
                  <p className="font-semibold text-foreground">Review was not saved</p>
                  <p className="mt-1 max-w-2xl text-pretty leading-6 text-muted-foreground">
                    The shift is unchanged. Check your connection, then approve it or request a
                    correction again.
                  </p>
                </div>
              )}

              <div className="rounded-[24px] border border-border bg-background p-4 shadow-[var(--shadow-sm)] sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="review-month" className="mb-1.5 block text-sm font-medium">
                        Month
                      </label>
                      <Input
                        id="review-month"
                        type="month"
                        value={month}
                        max={currentMonthValue()}
                        onChange={(event) => setMonth(event.target.value || currentMonthValue())}
                        className="min-h-11 sm:w-48"
                      />
                    </div>
                    <div>
                      <label htmlFor="review-machine" className="mb-1.5 block text-sm font-medium">
                        Machine
                      </label>
                      <Select value={machineId} onValueChange={setMachineId}>
                        <SelectTrigger id="review-machine" className="min-h-11 sm:w-72">
                          <SelectValue placeholder="All managed machines" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All managed machines</SelectItem>
                          {context.machines.map((machine) => (
                            <SelectItem key={machine.machineId} value={machine.machineId}>
                              {machine.machineLabel} · {machine.locationName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                    <span>
                      <strong className="font-semibold tabular-nums text-foreground">
                        {summary.approved}
                      </strong>{' '}
                      approved
                    </span>
                    <span>
                      <strong className="font-semibold tabular-nums text-foreground">
                        {summary.needsCorrection}
                      </strong>{' '}
                      returned
                    </span>
                    <span>
                      <strong className="font-semibold tabular-nums text-foreground">
                        {formatPaidHours(summary.paidMinutes)}
                      </strong>{' '}
                      entered
                    </span>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2" aria-label="Review filters">
                  {(
                    [
                      ['needs_review', `Needs review (${summary.needsReview})`],
                      ['needs_correction', `Returned (${summary.needsCorrection})`],
                      ['approved', `Approved (${summary.approved})`],
                      ['all', `All (${entries.length})`],
                    ] as const
                  ).map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={filter === value ? 'default' : 'outline'}
                      aria-pressed={filter === value}
                      className="shrink-0"
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="overflow-hidden rounded-[24px] border border-border bg-background shadow-[var(--shadow-sm)]">
                <div className="border-b border-border px-4 py-4 sm:px-5">
                  <h2
                    id="time-review-queue-heading"
                    ref={queueHeadingRef}
                    tabIndex={-1}
                    aria-describedby="time-review-queue-status"
                    className="font-display text-xl font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {filter === 'needs_review' ? 'Ready for your review' : 'Monthly time'}
                  </h2>
                  <p
                    id="time-review-queue-status"
                    role="status"
                    aria-live="polite"
                    className="mt-1 text-sm text-muted-foreground"
                  >
                    {reviewAnnouncement ||
                      `${formatDate(context.periodStartDate)} to ${formatDate(context.periodEndDate)}`}
                  </p>
                </div>

                {visibleEntries.length === 0 ? (
                  <div className="px-5 py-12 text-center">
                    <CheckCircle2 className="mx-auto h-7 w-7 text-sage" />
                    <h3 className="mt-3 font-semibold text-foreground">
                      {filter === 'needs_review' ? 'Nothing waiting for review' : 'No matching shifts'}
                    </h3>
                    <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                      {filter === 'needs_review'
                        ? 'You are caught up for this month. New submitted shifts will appear here.'
                        : 'Try another status, machine, or month.'}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {visibleEntries.map((entry) => {
                      const canReview = entry.status === 'submitted' && !entry.lockedAt;
                      const isSaving = isMutatingEntry(entry.id);

                      return (
                        <article key={entry.id} className="px-4 py-5 sm:px-5">
                          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-semibold text-foreground">{entry.operatorName}</h3>
                                <span
                                  data-time-status-badge={getReviewLabel(
                                    entry.managerReviewStatus,
                                    entry.status
                                  )}
                                  className={cn(
                                    'rounded-full border px-2.5 py-1 text-xs font-semibold',
                                    getReviewBadgeClass(entry.managerReviewStatus, entry.status)
                                  )}
                                >
                                  {getReviewLabel(entry.managerReviewStatus, entry.status)}
                                </span>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {entry.machineLabel} · {entry.locationName}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm tabular-nums text-muted-foreground">
                                <span className="font-medium text-foreground">
                                  {formatDate(entry.workDate)}
                                </span>
                                <span>
                                  {formatTime(entry.startTime)}–{formatTime(entry.endTime)}
                                </span>
                                <span>{formatDuration(entry.rawDurationMinutes)} actual</span>
                                <span className="font-medium text-foreground">
                                  {formatPaidHours(entry.roundedPaidMinutes)}
                                </span>
                              </div>
                              {entry.notes && (
                                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                                  <span className="font-medium text-foreground">Worker note:</span>{' '}
                                  {entry.notes}
                                </p>
                              )}
                              {entry.managerReviewStatus === 'needs_correction' &&
                                entry.managerReviewReason && (
                                  <p className="mt-3 max-w-3xl rounded-xl border border-amber/20 bg-amber/10 px-3 py-2 text-sm leading-6 text-foreground">
                                    <span className="font-medium">Correction requested:</span>{' '}
                                    {entry.managerReviewReason}
                                  </p>
                                )}
                            </div>

                            {canReview && (
                              <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:justify-end">
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={isSaving}
                                  aria-label={`Request correction for ${entry.operatorName}'s shift on ${formatDate(entry.workDate)}, ${formatTime(entry.startTime)} to ${formatTime(entry.endTime)}, ${entry.machineLabel} at ${entry.locationName}`}
                                  onClick={() => {
                                    setCorrectionEntry(entry);
                                    setCorrectionReason(entry.managerReviewReason ?? '');
                                  }}
                                >
                                  <MessageSquareWarning className="mr-2 h-4 w-4" />
                                  Request correction
                                </Button>
                                <Button
                                  type="button"
                                  disabled={isSaving || entry.managerReviewStatus === 'approved'}
                                  aria-label={`${entry.managerReviewStatus === 'approved' ? 'Approved' : 'Approve'} ${entry.operatorName}'s shift on ${formatDate(entry.workDate)}, ${formatTime(entry.startTime)} to ${formatTime(entry.endTime)}, ${entry.machineLabel} at ${entry.locationName}`}
                                  onClick={() => approveEntry(entry)}
                                >
                                  {isSaving ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  ) : entry.managerReviewStatus === 'approved' ? (
                                    <Check className="mr-2 h-4 w-4" />
                                  ) : (
                                    <CheckCircle2 className="mr-2 h-4 w-4" />
                                  )}
                                  {entry.managerReviewStatus === 'approved' ? 'Approved' : 'Approve'}
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
          )}
        </div>
      </section>

      <Dialog
        open={Boolean(correctionEntry)}
        onOpenChange={(open) => {
          if (!open && !reviewMutation.isPending) {
            setCorrectionEntry(null);
            setCorrectionReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request a correction</DialogTitle>
            <DialogDescription>
              Tell {correctionEntry?.operatorName ?? 'the worker'} exactly what should change. They
              will see this note beside the shift.
            </DialogDescription>
          </DialogHeader>
          {correctionEntry && (
            <div className="rounded-xl border border-border bg-muted/35 px-3 py-3 text-sm">
              <p className="font-medium text-foreground">
                {correctionEntry.machineLabel} · {formatDate(correctionEntry.workDate)}
              </p>
              <p className="mt-1 text-muted-foreground">
                {formatTime(correctionEntry.startTime)}–{formatTime(correctionEntry.endTime)} ·{' '}
                {formatPaidHours(correctionEntry.roundedPaidMinutes)}
              </p>
            </div>
          )}
          <div>
            <label htmlFor="correction-reason" className="mb-1.5 block text-sm font-medium">
              What needs to change?
            </label>
            <Textarea
              id="correction-reason"
              rows={4}
              autoFocus
              value={correctionReason}
              placeholder="For example: Please change the end time to 4:30 PM."
              onChange={(event) => setCorrectionReason(event.target.value)}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">A reason is required.</p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={reviewMutation.isPending}
              onClick={() => {
                setCorrectionEntry(null);
                setCorrectionReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={correctionReason.trim().length === 0 || reviewMutation.isPending}
              onClick={requestCorrection}
            >
              {reviewMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send correction request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}
