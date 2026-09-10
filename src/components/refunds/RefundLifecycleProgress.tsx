import { Check, Circle } from 'lucide-react';
import type { RefundLifecycleContract } from '@/lib/refundLifecycle';
import { getRefundLifecycleProgressPresentation } from '@/lib/refundLifecyclePresentation';
import { cn } from '@/lib/utils';

const milestones = [
  { label: 'Received', rank: 10 },
  { label: 'Reviewing', rank: 20 },
  { label: 'Initiated', rank: 40 },
  { label: 'Confirmed', rank: 70 },
  { label: 'Update sent', rank: 80 },
] as const;

type RefundLifecycleProgressProps = {
  lifecycle: RefundLifecycleContract;
};

export function RefundLifecycleProgress({ lifecycle }: RefundLifecycleProgressProps) {
  const presentation = getRefundLifecycleProgressPresentation(lifecycle);
  if (!presentation.showMilestones) {
    return (
      <div
        data-testid="refund-lifecycle-progress"
        role="status"
        className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
      >
        <span className="font-semibold text-foreground">{presentation.label}</span>
        <span className="ml-2 text-muted-foreground">
          {presentation.note}
        </span>
      </div>
    );
  }

  return (
    <section
      data-testid="refund-lifecycle-progress"
      aria-label="Refund progress"
      className="rounded-lg border border-border bg-muted/20 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Refund progress
        </p>
        <p className="text-xs font-medium text-foreground" role="status" aria-live="polite">
          {presentation.label}
        </p>
      </div>
      <ol className="mt-3 grid gap-2 sm:grid-cols-5">
        {milestones.map((milestone) => {
          const isContactMilestone = milestone.rank === 80;
          const contactComplete = presentation.contact?.state === 'sent' ||
            presentation.contact?.state === 'delivered';
          const complete = isContactMilestone
            ? contactComplete
            : lifecycle.stageRank >= milestone.rank;
          const nextMilestone = milestones.find((candidate) => candidate.rank > lifecycle.stageRank);
          const current = (isContactMilestone && lifecycle.paymentState === 'confirmed' && !contactComplete) ||
            nextMilestone?.rank === milestone.rank ||
            (lifecycle.terminal && milestone.rank === milestones[milestones.length - 1].rank);
          const label = isContactMilestone && presentation.contact
            ? presentation.contact.progressLabel
            : milestone.label;
          return (
            <li
              key={milestone.rank}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-md border px-2.5 py-2 text-xs font-medium',
                complete
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                  : current
                    ? presentation.contact?.tone === 'warning' && isContactMilestone
                      ? 'border-orange-200 bg-orange-50 text-orange-950'
                      : 'border-sky-200 bg-sky-50 text-sky-950'
                    : 'border-border bg-background text-muted-foreground'
              )}
            >
              {complete ? (
                <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <Circle className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span>{label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
