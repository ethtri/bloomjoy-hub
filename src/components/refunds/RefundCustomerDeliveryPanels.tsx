import { Loader2, Mail, RefreshCw, Send, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';

export type RefundCustomerDeliveryReviewPresentation = {
  outcomeLabel: string;
  paymentMessage: string;
  recordKind: 'original-request' | 'specific-message' | 'unidentified';
  refresh: {
    label: string;
    disabled: boolean;
    pending: boolean;
  } | null;
};

type RefundCustomerDeliveryReviewPanelProps = {
  presentation: RefundCustomerDeliveryReviewPresentation;
  onRefresh: () => void;
  onReview: () => void;
};

export function RefundCustomerDeliveryReviewPanel({
  presentation,
  onRefresh,
  onReview,
}: RefundCustomerDeliveryReviewPanelProps) {
  return (
    <section
      data-testid="refund-secondary-delivery-review"
      className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
    >
      <p className="font-semibold">Customer message needs review</p>
      <p className="mt-1 leading-6">
        Saved delivery outcome: {presentation.outcomeLabel}. {presentation.paymentMessage}{' '}
        The assigned machine manager reviews the original customer email thread and saved delivery record. Do not resend this saved message until its delivery is clear.
      </p>
      {presentation.recordKind === 'original-request' ? (
        <p className="mt-2 leading-6">
          The active customer request is the record that must be reconciled. A later delivered update does not prove that request arrived.
        </p>
      ) : presentation.recordKind === 'specific-message' ? (
        <p className="mt-2 leading-6">
          This specific customer message is the record that must be reconciled. A different or later delivered message does not prove this one arrived.
        </p>
      ) : (
        <p className="mt-2 leading-6">
          Bloomjoy could not identify exactly one message for this delivery record. Keep it blocked for manager review.
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {presentation.refresh && (
          <Button
            data-testid="refund-refresh-delivery-status"
            type="button"
            size="sm"
            className="h-auto min-h-11 w-full whitespace-normal py-2 text-center leading-5 sm:w-auto"
            onClick={onRefresh}
            disabled={presentation.refresh.disabled}
          >
            {presentation.refresh.pending ? (
              <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            {presentation.refresh.label}
          </Button>
        )}
        <Button
          data-testid="refund-review-delivery-record"
          type="button"
          size="sm"
          variant="outline"
          className="h-auto min-h-11 w-full whitespace-normal border-amber-400 bg-white py-2 text-center leading-5 text-amber-950 hover:bg-amber-100 sm:w-auto"
          aria-label={`Review delivery record: ${presentation.outcomeLabel}`}
          onClick={onReview}
        >
          <Mail className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
          Review delivery record
        </Button>
      </div>
      {!presentation.refresh && (
        <p data-testid="refund-delivery-recovery-fallback" className="mt-3 text-xs leading-5">
          The exact provider record cannot be refreshed here. Keep delivery blocked and do not resend this saved message until its delivery is clear. A different specific request may still follow the documented case procedure.
        </p>
      )}
    </section>
  );
}

export type RefundCustomerCompletionRecoveryPresentation =
  | { kind: 'reconciliation' }
  | {
      kind: 'recover';
      message: string;
      disabled: boolean;
      pending: boolean;
    }
  | {
      kind: 'retry';
      disabled: boolean;
      pending: boolean;
    }
  | { kind: 'exhausted' };

type RefundCustomerCompletionRecoveryPanelProps = {
  presentation: RefundCustomerCompletionRecoveryPresentation;
  onRecover: () => void;
  onRetry: () => void;
};

export function RefundCustomerCompletionRecoveryPanel({
  presentation,
  onRecover,
  onRetry,
}: RefundCustomerCompletionRecoveryPanelProps) {
  return (
    <section
      data-testid="refund-nayax-completion-recovery"
      className="rounded-xl border border-slate-300 bg-slate-50 p-4 text-sm text-slate-950"
    >
      {presentation.kind === 'reconciliation' ? (
        <div>
          <p className="font-semibold">Check whether the customer email was sent</p>
          <p className="mt-1 leading-6">
            Gmail delivery may have started. Do not send another completion or use a generic reply. Check the original Gmail thread and escalate the stored delivery record for support review.
          </p>
        </div>
      ) : presentation.kind === 'recover' ? (
        <div>
          <p className="font-semibold">Customer completion is still pending</p>
          <p className="mt-1 leading-6">{presentation.message}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={onRecover}
            disabled={presentation.disabled}
          >
            {presentation.pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-2 h-4 w-4" />
            )}
            Recover interrupted completion
          </Button>
        </div>
      ) : presentation.kind === 'retry' ? (
        <div>
          <p className="font-semibold">Customer completion needs one controlled retry</p>
          <p className="mt-1 leading-6">
            This retries the same completion email in the original Gmail thread. It does not retry or change the refund.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={onRetry}
            disabled={presentation.disabled}
          >
            {presentation.pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Retry completion email
          </Button>
        </div>
      ) : (
        <div>
          <p className="font-semibold">Customer completion retry is exhausted</p>
          <p className="mt-1 leading-6">
            Do not send another completion message or repeat the payment. Check the original Gmail thread, then report the delivery record if the result is still unclear.
          </p>
        </div>
      )}
    </section>
  );
}
