import type { ReactNode } from 'react';
import { CheckCircle2, Loader2, MessageSquare } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { CashRefundEvidencePanel } from '@/components/refunds/CashRefundEvidencePanel';
import type {
  RefundCaseRecord,
  RefundCaseStatus,
  RefundDecision,
} from '@/lib/refundOperations';
import type { RefundManagerState } from '@/lib/refundManagerState';

type CashDecisionEditor = {
  status: RefundCaseStatus;
  decision: RefundDecision;
  decisionReason: string;
};

type CashPrimaryActionPresentation = {
  label: string;
  isCompletion: boolean;
  disabled: boolean;
  pending: boolean;
  amountCents: number | null;
  hasSelectedSale: boolean;
};

type CustomerUpdatePresentation = {
  label: string;
  hasPendingDenialAppeal: boolean;
  nextDraft: { subject: string; body: string } | null;
  onRequestCorrection?: () => void;
  onDeny?: () => void;
  denyDisabled?: boolean;
};

export type RefundCashDecisionWorkbenchProps = {
  refundCase: RefundCaseRecord;
  editor: CashDecisionEditor;
  managerState: RefundManagerState;
  managerNextStep: string;
  action: CashPrimaryActionPresentation;
  customerUpdate: CustomerUpdatePresentation;
  cashCompletionRecorded: boolean;
  isUsingDemoData: boolean;
  denialReasonDisabled: boolean;
  reportedTimeLabel: string;
  venueTimezone: string | null;
  correctionSummary?: ReactNode;
  revisionDeliveryReview?: ReactNode;
  denialReasons: readonly string[];
  onPrimaryAction: () => void;
  onDenialReasonChange: (reason: string) => void;
};

const formatCurrency = (cents: number | null) => {
  if (typeof cents !== 'number') return 'n/a';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
};

export function RefundCashDecisionWorkbench({
  refundCase,
  editor,
  managerState,
  managerNextStep,
  action,
  customerUpdate,
  cashCompletionRecorded,
  isUsingDemoData,
  denialReasonDisabled,
  reportedTimeLabel,
  venueTimezone,
  correctionSummary,
  revisionDeliveryReview,
  denialReasons,
  onPrimaryAction,
  onDenialReasonChange,
}: RefundCashDecisionWorkbenchProps) {
  return (
    <div data-testid="refund-cash-workbench" className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div
          data-testid="refund-cash-primary-action-panel"
          aria-live="polite"
          className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current state</p>
            <h3 data-testid="refund-manager-state" className="mt-1 text-xl font-semibold text-foreground">
              {managerState.label}
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-5 text-muted-foreground">{managerState.explanation}</p>
            <p
              data-testid="refund-manager-next-step"
              className={action.isCompletion
                ? 'mt-2 max-w-xl text-sm font-medium leading-5 text-foreground'
                : 'mt-1 max-w-xl text-sm font-medium leading-5 text-foreground'}
            >
              {action.isCompletion
                ? 'Send the refund through Zelle outside Bloomjoy Hub. After sending it, confirm it here.'
                : `Next: ${managerNextStep}`}
            </p>
            {action.isCompletion && typeof action.amountCents === 'number' && (
              <div
                data-testid="refund-cash-confirmation-amount"
                className="mt-3 max-w-xl rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm"
              >
                <span className="font-semibold text-foreground">Amount to send: {formatCurrency(action.amountCents)}</span>
                <span className="ml-1 text-muted-foreground">
                  {action.hasSelectedSale
                    ? 'Use the selected sale evidence shown below.'
                    : 'Use the reviewed customer estimate; no supported sale is selected.'}
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <Button
              data-testid="refund-cash-primary-action"
              data-dominant-action="true"
              type="button"
              className="h-auto min-h-11 w-full whitespace-normal bg-foreground px-4 py-2 text-center font-semibold leading-5 text-background hover:bg-foreground/90 sm:w-auto"
              onClick={onPrimaryAction}
              disabled={action.disabled}
            >
              {action.pending ? (
                <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4 shrink-0" />
              )}
              {action.label}
            </Button>
          </div>
        </div>

        {correctionSummary}
        {revisionDeliveryReview}
        <div className="grid border-t border-border lg:grid-cols-2 lg:divide-x lg:divide-border">
          <article data-testid="refund-cash-request-summary" className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer request</p>
            <h4 className="mt-1 text-base font-semibold text-foreground">What happened</h4>
            <div data-testid="refund-customer-comments" className="mt-3 rounded-lg bg-muted/35 px-3 py-2.5">
              <p className="whitespace-pre-line break-words text-sm leading-6 text-foreground">
                {refundCase.issueSummary || 'No customer comments were provided.'}
              </p>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 border-t border-border/70 pt-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Location</p>
                <p className="mt-1 font-medium text-foreground">{refundCase.locationName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Machine</p>
                <p className="mt-1 font-medium text-foreground">{refundCase.machineLabel}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Reported time</p>
                <p className="mt-1 font-medium text-foreground">{reportedTimeLabel}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Requested</p>
                <p className="mt-1 font-medium text-foreground">{formatCurrency(refundCase.paymentAmountCents)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Refund method</p>
                <p className="mt-1 font-medium text-foreground">Cash payment · external reimbursement</p>
                {refundCase.zellePaymentContact && (
                  <p className="mt-1 break-words text-xs text-muted-foreground">Destination: {refundCase.zellePaymentContact}</p>
                )}
              </div>
            </div>
          </article>

          <CashRefundEvidencePanel
            refundCase={refundCase}
            isUsingDemoData={isUsingDemoData}
            venueTimezone={venueTimezone}
            isCompleted={cashCompletionRecorded}
          />
        </div>
      </section>

      {(editor.decision === 'denied' || editor.status === 'denied') && (
        <section className="rounded-xl border border-border bg-background p-4">
          <Label htmlFor="cash-denial-reason">Customer-facing denial reason</Label>
          <select
            id="cash-denial-reason"
            data-testid="refund-cash-denial-reason"
            value={editor.decisionReason}
            disabled={denialReasonDisabled}
            onChange={(event) => onDenialReasonChange(event.target.value)}
            className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            <option value="">Choose a reason</option>
            {denialReasons.map((reason) => (
              <option key={reason} value={reason}>{reason}</option>
            ))}
          </select>
        </section>
      )}

      <section className="rounded-xl border border-border bg-background p-4">
        {customerUpdate.hasPendingDenialAppeal && (
          <div
            data-testid="refund-appeal-needs-review"
            className="mb-4 flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-orange-950"
            role="status"
          >
            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold">Appeal needs review</p>
              <p className="mt-1 text-xs leading-5">
                The customer replied to the denial. Recheck the same case and transaction, then make a new decision. No refund was authorized by the reply.
              </p>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer update</p>
            <p className="mt-1 text-sm font-medium text-foreground">{customerUpdate.label}</p>
          </div>
          {customerUpdate.nextDraft && (
            <details className="text-sm sm:max-w-md">
              <summary className="cursor-pointer font-medium text-primary">Preview customer email</summary>
              <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
                <p className="font-medium text-foreground">{customerUpdate.nextDraft.subject}</p>
                <p className="mt-2 whitespace-pre-line text-muted-foreground">{customerUpdate.nextDraft.body}</p>
              </div>
            </details>
          )}
        </div>

        {refundCase.status !== 'completed' && editor.status !== 'completed' &&
          (customerUpdate.onRequestCorrection || customerUpdate.onDeny) && (
            <details className="mt-4 border-t border-border pt-3">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Other decisions</summary>
              <div className="mt-3 flex flex-wrap gap-2">
                {customerUpdate.onRequestCorrection && (
                  <Button type="button" variant="outline" size="sm" onClick={customerUpdate.onRequestCorrection} disabled={isUsingDemoData}>
                    Request customer correction
                  </Button>
                )}
                {customerUpdate.onDeny && (
                  <Button type="button" variant="outline" size="sm" onClick={customerUpdate.onDeny} disabled={customerUpdate.denyDisabled}>
                    Deny request
                  </Button>
                )}
              </div>
            </details>
          )}
      </section>
    </div>
  );
}
