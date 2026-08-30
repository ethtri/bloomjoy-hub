import { Check, Circle } from 'lucide-react';
import type { RefundLifecycleContract } from '@/lib/refundLifecycle';
import { cn } from '@/lib/utils';

const milestones = [
  { label: 'Received', rank: 10 },
  { label: 'Reviewing', rank: 20 },
  { label: 'Initiated', rank: 40 },
  { label: 'Confirmed', rank: 70 },
  { label: 'Customer updated', rank: 80 },
] as const;

const stageLabel: Record<RefundLifecycleContract['stage'], string> = {
  matching: 'Matching the purchase',
  waiting_on_customer: 'Waiting for customer reply',
  needs_transaction_selection: 'Waiting for transaction confirmation',
  transaction_confirmed: 'Transaction confirmed',
  refund_initiated: 'Refund initiated',
  confirming_with_nayax: 'Confirming the refund',
  refund_confirmed: 'Refund confirmed',
  customer_notified: 'Customer updated',
  needs_refund_operations: 'Refund Operations review',
  denied: 'Request denied',
};

type RefundLifecycleProgressProps = {
  lifecycle: RefundLifecycleContract;
};

export function RefundLifecycleProgress({ lifecycle }: RefundLifecycleProgressProps) {
  if (lifecycle.stage === 'denied') {
    return (
      <div
        data-testid="refund-lifecycle-progress"
        role="status"
        className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
      >
        <span className="font-semibold text-foreground">Request denied</span>
        <span className="ml-2 text-muted-foreground">
          No refund was issued.
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
          {stageLabel[lifecycle.stage]}
        </p>
      </div>
      <ol className="mt-3 grid gap-2 sm:grid-cols-5">
        {milestones.map((milestone) => {
          const complete = lifecycle.stageRank >= milestone.rank;
          const nextMilestone = milestones.find((candidate) => candidate.rank > lifecycle.stageRank);
          const current = nextMilestone?.rank === milestone.rank ||
            (lifecycle.terminal && milestone.rank === milestones[milestones.length - 1].rank);
          return (
            <li
              key={milestone.label}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-md border px-2.5 py-2 text-xs font-medium',
                complete
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                  : current
                    ? 'border-sky-200 bg-sky-50 text-sky-950'
                    : 'border-border bg-background text-muted-foreground'
              )}
            >
              {complete ? (
                <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <Circle className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span>{milestone.label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
