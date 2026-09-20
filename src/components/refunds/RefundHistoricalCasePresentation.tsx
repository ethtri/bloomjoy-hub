import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { cn } from '@/lib/utils';

export type RefundActionReceiptPresentation = {
  tone: 'success' | 'warning';
  title: string;
  message: string;
  reference?: string | null;
};

export function RefundActionReceiptPanel({
  presentation,
}: {
  presentation: RefundActionReceiptPresentation;
}) {
  return (
    <div
      data-testid="refund-action-receipt"
      role={presentation.tone === 'warning' ? 'alert' : 'status'}
      className={cn(
        'mt-4 rounded-lg border px-4 py-3 text-sm',
        presentation.tone === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
          : 'border-orange-200 bg-orange-50 text-orange-950'
      )}
    >
      <div className="flex items-start gap-3">
        {presentation.tone === 'success' ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
        ) : (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-800" />
        )}
        <div>
          <p className="font-semibold">{presentation.title}</p>
          <p className="mt-1 leading-6">{presentation.message}</p>
          {presentation.reference && (
            <p className="mt-1 text-xs">Confirmation: {presentation.reference}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export type RefundCardHistoricalNoticesPresentation = {
  savedApproval: {
    amountLabel: string;
    reason: string | null;
  } | null;
  customerMessageNeedsReview: boolean;
};

export function RefundCardHistoricalNotices({
  presentation,
}: {
  presentation: RefundCardHistoricalNoticesPresentation;
}) {
  return (
    <>
      {presentation.savedApproval && (
        <div
          data-testid="refund-existing-approval"
          className="border-b border-border px-4 py-3 text-sm text-muted-foreground"
        >
          <p>Existing approval: {presentation.savedApproval.amountLabel}</p>
          {presentation.savedApproval.reason && (
            <p className="mt-1">Recorded reason: {presentation.savedApproval.reason}</p>
          )}
        </div>
      )}
      {presentation.customerMessageNeedsReview && (
        <div
          data-testid="refund-secondary-delivery-review"
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
        >
          <p className="font-semibold">Customer message needs review</p>
          <p className="mt-1">
            The latest customer message was not sent. Check the original customer email thread and the saved delivery record before sending anything again. The refund status and next step are shown above.
          </p>
        </div>
      )}
    </>
  );
}

export type RefundHistoricalReviewBannerPresentation = {
  testId: 'refund-legacy-state-review-banner' | 'refund-review-only-banner';
  title: string;
  message: string;
};

export function RefundHistoricalReviewBanner({
  presentation,
}: {
  presentation: RefundHistoricalReviewBannerPresentation;
}) {
  return (
    <div
      data-testid={presentation.testId}
      className="border-b border-border pb-4 text-sm text-muted-foreground"
    >
      <div>
        <p className="font-medium text-foreground">{presentation.title}</p>
        <p className="mt-1 leading-6">{presentation.message}</p>
      </div>
    </div>
  );
}

export type RefundHistoricalReceiptNoticePresentation =
  | { kind: 'accounting-only' }
  | { kind: 'machine-correction-review' };

export function RefundHistoricalReceiptNotice({
  presentation,
}: {
  presentation: RefundHistoricalReceiptNoticePresentation;
}) {
  return presentation.kind === 'accounting-only' ? (
    <p
      data-testid="refund-receipt-accounting-only"
      className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground"
    >
      Payment is confirmed. Accounting-date review is internal work. Review customer communication in the saved receipt section; no new payment is available here.
    </p>
  ) : (
    <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
      Machine correction review only. No payment or customer message is available in this review.
    </p>
  );
}

export type RefundTerminalHistoryPresentation = {
  primaryAction: string | undefined;
  primaryHelper: string | undefined;
  decisionReason: string | null;
};

export function RefundTerminalHistory({
  presentation,
}: {
  presentation: RefundTerminalHistoryPresentation;
}) {
  return (
    <section data-testid="refund-terminal-history" className="border-t border-border pt-4">
      <p data-testid="refund-terminal-primary-action" className="font-medium text-foreground">
        {presentation.primaryAction}
      </p>
      <p
        data-testid="refund-terminal-primary-helper"
        className="mt-1 text-sm text-muted-foreground"
      >
        {presentation.primaryHelper}
      </p>
      {presentation.decisionReason && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Decision reason
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-foreground">
            {presentation.decisionReason}
          </p>
        </div>
      )}
    </section>
  );
}
