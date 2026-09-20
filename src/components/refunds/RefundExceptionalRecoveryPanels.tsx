import { AlertTriangle, ExternalLink, Info, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export type RefundNayaxIncompleteHistoryRecoveryPresentation =
  | {
      kind: 'refresh';
      disabled: boolean;
      pending: boolean;
    }
  | { kind: 'fallback' };

export function RefundNayaxIncompleteHistoryRecoveryPanel({
  presentation,
  onRefresh,
}: {
  presentation: RefundNayaxIncompleteHistoryRecoveryPresentation;
  onRefresh: () => void;
}) {
  return presentation.kind === 'refresh' ? (
    <section
      data-testid="nayax-incomplete-history-recovery"
      className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-950"
    >
      <p className="font-semibold">Refresh the incomplete transaction history once</p>
      <p className="mt-1 leading-6">
        Bloomjoy will ask the Nayax API for this case again using the saved facts. This is read-only and cannot issue a refund or contact the customer.
      </p>
      <Button
        data-testid="nayax-incomplete-history-refresh"
        type="button"
        variant="outline"
        className="mt-3 h-auto min-h-11 w-full whitespace-normal border-orange-300 bg-white py-2 text-center leading-5 text-orange-950 hover:bg-orange-100 sm:w-auto"
        onClick={onRefresh}
        disabled={presentation.disabled}
      >
        {presentation.pending ? (
          <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        Refresh transaction history
      </Button>
    </section>
  ) : (
    <section
      data-testid="nayax-incomplete-history-fallback"
      className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-950"
    >
      <p className="font-semibold">Read-only Nayax transaction research</p>
      <p className="mt-1 leading-6">
        The one internal refresh still did not return complete history. You may research the saved machine, amount, and time in Nayax, but never issue or record a refund there. Do not guess a transaction or ask the customer to repeat facts already on this case.
      </p>
      <Button
        asChild
        variant="outline"
        className="mt-3 h-auto min-h-11 w-full whitespace-normal border-orange-300 bg-white py-2 text-center leading-5 text-orange-950 hover:bg-orange-100 sm:w-auto"
      >
        <a href="https://my.nayax.com" target="_blank" rel="noreferrer">
          <ExternalLink className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
          Open Nayax for read-only research
        </a>
      </Button>
    </section>
  );
}

export type RefundNayaxTransactionRecoveryPresentation = {
  retry: {
    disabled: boolean;
    pending: boolean;
  } | null;
  clearSelection: {
    disabled: boolean;
  } | null;
  demo: boolean;
};

export function RefundNayaxTransactionRecoveryDetails({
  presentation,
  onRetry,
  onClearSelection,
}: {
  presentation: RefundNayaxTransactionRecoveryPresentation;
  onRetry: () => void;
  onClearSelection: () => void;
}) {
  return (
    <details className="rounded-md border border-border bg-background p-2">
      <summary className="cursor-pointer text-xs font-medium text-foreground">
        Transaction search details
      </summary>
      <div className="mt-3 space-y-2">
        <p className="text-xs leading-5 text-muted-foreground">
          Transaction research is read-only here. Bloomjoy runs one automatic check and one retry after a temporary failure.
        </p>
        <div className="flex flex-wrap gap-2">
          {presentation.retry && (
            <Button
              data-testid="nayax-operations-recovery"
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetry}
              disabled={presentation.retry.disabled}
            >
              {presentation.retry.pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Run transaction check
            </Button>
          )}
          {presentation.clearSelection && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={presentation.clearSelection.disabled}
              onClick={onClearSelection}
            >
              Clear selected transaction
            </Button>
          )}
        </div>
        {presentation.demo && (
          <p className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Demo cases use fixed transaction results and cannot be refreshed.</span>
          </p>
        )}
      </div>
    </details>
  );
}

export function RefundRevisionDeliveryReview({
  disabled,
  onInspect,
}: {
  disabled: boolean;
  onInspect: () => void;
}) {
  return (
    <div role="status" className="border-b border-border p-4 text-sm">
      <p>The revision result has not been confirmed. Check its existing delivery before sending another request.</p>
      <Button variant="outline" className="mt-3" disabled={disabled} onClick={onInspect}>
        Check revision delivery
      </Button>
    </div>
  );
}

export type RefundAcknowledgementExceptionPresentation =
  | {
      kind: 'later-contact';
      disabled: boolean;
      pending: boolean;
    }
  | { kind: 'no-later-contact' };

export function RefundAcknowledgementExceptionPanel({
  presentation,
  onRecordLaterContact,
}: {
  presentation: RefundAcknowledgementExceptionPresentation;
  onRecordLaterContact: () => void;
}) {
  return (
    <section
      data-testid="refund-acknowledgement-delivery-exception"
      className="rounded-xl border border-orange-300 bg-orange-50 p-4 text-sm text-orange-950"
      role="status"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Customer acknowledgement was skipped</p>
          {presentation.kind === 'later-contact' ? (
            <>
              <p className="mt-1 leading-6">
                A later customer message was sent. Do not resend the initial acknowledgement. Do not contact the customer again for this exception. Record the later contact as the recovery disposition.
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-3 h-auto max-w-full whitespace-normal border-orange-300 bg-white py-2 text-left leading-5"
                data-testid="refund-record-later-contact-disposition"
                onClick={onRecordLaterContact}
                disabled={presentation.disabled}
              >
                {presentation.pending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 h-4 w-4" />
                )}
                Record later contact — do not resend
              </Button>
            </>
          ) : (
            <p className="mt-1 leading-6">
              No later customer message is confirmed. Review the customer acknowledgement action below. If Gmail delivery is uncertain, check the original thread before sending anything.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export type RefundDuplicateReconciliationPresentation = {
  loading: boolean;
  error: boolean;
  disabled: boolean;
  reviews: Array<{
    id: string;
    matchLabel: 'Strong possible match' | 'Possible match';
    publicReference: string;
    sourceLabel: 'Support email' | 'Website form';
    sharedSignals: string;
    otherCaseHref: string;
  }>;
};

export function RefundDuplicateReconciliationPanel({
  presentation,
  onResolve,
}: {
  presentation: RefundDuplicateReconciliationPresentation;
  onResolve: (reviewId: string, resolution: 'duplicate' | 'distinct') => void;
}) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-950">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Possible duplicate review</p>
          <p className="mt-1 leading-6">
            Compare the linked cases before issuing a refund. This review does not issue one.
          </p>
          {presentation.loading && <p className="mt-3 text-xs">Loading the linked cases...</p>}
          {presentation.error && (
            <p className="mt-3 text-xs font-medium">
              The linked case details are unavailable, so refund actions remain blocked.
            </p>
          )}
          <div className="mt-3 space-y-3">
            {presentation.reviews.map((review) => (
              <div key={review.id} className="rounded-md border border-rose-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-rose-200 bg-rose-50 text-rose-900">
                    {review.matchLabel}
                  </Badge>
                  <span className="font-semibold">{review.publicReference}</span>
                  <Badge className="border-slate-200 bg-slate-50 text-slate-700">
                    {review.sourceLabel}
                  </Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-rose-900">
                  Shared signals: {review.sharedSignals}.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onResolve(review.id, 'duplicate')}
                    disabled={presentation.disabled}
                  >
                    Same incident — keep this case
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onResolve(review.id, 'distinct')}
                    disabled={presentation.disabled}
                  >
                    Different purchases
                  </Button>
                  <Button asChild type="button" size="sm" variant="ghost">
                    <a href={review.otherCaseHref}>Open other case</a>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
