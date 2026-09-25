import { Info, Loader2, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  formatRefundDateTime,
  refundCandidateTimeMeaning,
  refundCandidateTimeSourceDetail,
  refundProviderTimeLabel,
} from '@/lib/refundTimePresentation';
import type {
  NayaxDisagreementReason,
  NayaxLookupCandidate,
} from '@/lib/refundOperations';
import { cn } from '@/lib/utils';

type NayaxMatchFactor = NonNullable<NayaxLookupCandidate['matchFactors']>[number];

type RefundTransactionCandidateReviewProps = {
  candidates: NayaxLookupCandidate[];
  selectedCandidate: NayaxLookupCandidate | null;
  selectedCandidateToken: string;
  selectableCandidateCount: number;
  paymentAmountCents: number | null;
  timezone: string | null;
  waitingOnCustomer: boolean;
  isDemoData: boolean;
  isSaving: boolean;
  reviewedFinalDecision?: boolean;
  canSelectCandidates: boolean;
  canAccessCandidateSelection: boolean;
  disagreementReason: NayaxDisagreementReason | '';
  canUseCloserTimeReason: boolean;
  describeUnavailableCandidate: (candidate: NayaxLookupCandidate) => string;
  describeMatchFactor: (
    factor: NayaxMatchFactor,
    candidate: NayaxLookupCandidate,
  ) => string;
  onSelectCandidate: (candidate: NayaxLookupCandidate) => void;
  onDisagreementReasonChange: (reason: NayaxDisagreementReason | '') => void;
  onSaveForReview: () => void;
};

const formatCurrency = (cents: number | null) => {
  if (typeof cents !== 'number') return 'n/a';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
};

const formatCandidateSummary = (candidate: NayaxLookupCandidate) =>
  [
    formatCurrency(candidate.amountCents),
    `${candidate.cardBrand || 'Card'} ending ${candidate.cardLast4 || 'n/a'}`,
  ].join(' • ');

export function RefundTransactionCandidateReview({
  candidates,
  selectedCandidate,
  selectedCandidateToken,
  selectableCandidateCount,
  paymentAmountCents,
  timezone,
  waitingOnCustomer,
  isDemoData,
  isSaving,
  reviewedFinalDecision = false,
  canSelectCandidates,
  canAccessCandidateSelection,
  disagreementReason,
  canUseCloserTimeReason,
  describeUnavailableCandidate,
  describeMatchFactor,
  onSelectCandidate,
  onDisagreementReasonChange,
  onSaveForReview,
}: RefundTransactionCandidateReviewProps) {
  const needsDisagreementReason = Boolean(
    !reviewedFinalDecision && selectedCandidate && selectedCandidate.isRecommended !== true,
  );

  return (
    <div className="border-t border-border pt-3">
      {isDemoData && (
        <p className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Demo cases are read-only, so a transaction cannot be {reviewedFinalDecision ? 'chosen' : 'saved'}.</span>
        </p>
      )}
      <div data-testid="nayax-candidate-availability" className="mb-3">
        <p className="text-sm font-semibold text-foreground">
          {candidates.length} current transaction result{candidates.length === 1 ? '' : 's'}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {selectableCandidateCount === 0
            ? 'Every current result is listed here, but none can be selected.'
            : waitingOnCustomer
              ? 'These are the current search results. Selection stays paused until the customer replies and the assistant runs the search again.'
              : reviewedFinalDecision
                ? `${selectableCandidateCount} ${selectableCandidateCount === 1 ? 'purchase is' : 'purchases are'} reviewed for this final decision. Choose the correct one only if approving; denial needs no purchase choice.`
                : `${selectableCandidateCount} ${selectableCandidateCount === 1 ? 'result is' : 'results are'} selectable. Choose one only when the machine, amount, time, and payment evidence identify the same purchase.`}
        </p>
      </div>
      <div
        data-testid="nayax-transaction-comparison"
        role="radiogroup"
        aria-label={`${candidates.length} current transaction result${candidates.length === 1 ? '' : 's'}`}
        className="space-y-2"
      >
        {candidates.map((candidate, index) => {
          const selectionDisabled =
            isDemoData || !canSelectCandidates || candidate.selectionAllowed === false;
          const visibleFactors = ['amount', 'provider_total', 'card', 'incident_time', 'request_time']
            .map((key) => candidate.matchFactors?.find((factor) => factor.key === key))
            .filter((factor): factor is NayaxMatchFactor => Boolean(factor));
          const selectionMessage = candidate.selectionAllowed === false
            ? `Not selectable: ${describeUnavailableCandidate(candidate)}`
            : waitingOnCustomer
              ? 'Selection is paused while waiting for the customer. The assistant will run a fresh search after the reply.'
              : !canAccessCandidateSelection
                ? `You can review this result, but your current case access does not allow you to ${reviewedFinalDecision ? 'decide this refund' : 'save it'}.`
                : !canSelectCandidates
                  ? 'Selection is only available while the case is in manager review.'
                  : reviewedFinalDecision ? 'Choose for the final Approve decision' : 'Select this transaction';
          const descriptionId =
            `nayax-candidate-${candidate.candidateToken.replace(/[^A-Za-z0-9_-]/g, '-')}-description`;
          const statusId =
            `nayax-candidate-${candidate.candidateToken.replace(/[^A-Za-z0-9_-]/g, '-')}-status`;
          const label = `Transaction ${index + 1}`;

          return (
            <label
              key={candidate.candidateToken}
              data-testid="nayax-candidate-option"
              aria-disabled={selectionDisabled}
              className={cn(
                'grid min-h-11 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-md border bg-background p-3 text-left text-xs text-foreground transition-colors sm:grid-cols-[auto_minmax(0,1.25fr)_minmax(0,1fr)]',
                selectionDisabled
                  ? 'cursor-not-allowed'
                  : 'cursor-pointer hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
                selectedCandidateToken === candidate.candidateToken
                  ? 'border-primary ring-2 ring-primary/20'
                  : 'border-border',
              )}
            >
              <input
                type="radio"
                name="nayax-transaction-candidate"
                value={candidate.candidateToken}
                checked={selectedCandidateToken === candidate.candidateToken}
                disabled={selectionDisabled}
                onChange={() => onSelectCandidate(candidate)}
                aria-label={`Select ${label.toLowerCase()}`}
                aria-describedby={`${descriptionId} ${statusId}`}
                className="mt-1 h-5 w-5 accent-primary"
              />
              <span id={descriptionId} className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  <span>{label}</span>
                  {candidate.isRecommended && (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] text-sky-950">
                      {candidate.identifierReviewState === 'reviewable_uncertainty'
                        ? 'Review this'
                        : 'Recommended'}
                    </span>
                  )}
                  {candidate.selectionAllowed === false && (
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] text-orange-950">
                      Not selectable
                    </span>
                  )}
                </span>
                {candidate.machineDisplayLabel && (
                  <span className="mt-1 block font-medium text-sky-900">
                    {candidate.machineDisplayLabel}
                  </span>
                )}
                <span className="mt-1 block leading-5 text-foreground">
                  {formatCandidateSummary(candidate)}
                </span>
                <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                  {refundProviderTimeLabel(candidate.timeEvidence)}:{' '}
                  {formatRefundDateTime(
                    candidate.providerTimestampAt ?? candidate.authorizedAt,
                    timezone,
                  )}
                  {' · '}shown in venue time · {timezone || 'timezone unavailable'}
                </span>
                <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                  {refundCandidateTimeSourceDetail(candidate.timeEvidence)}
                </span>
                {candidate.timeEvidence?.machineClockTimezone &&
                  candidate.timeEvidence.machineClockTimezone !== timezone && (
                    <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                      Provider machine clock:{' '}
                      {formatRefundDateTime(
                        candidate.machineAuthorizationTime,
                        candidate.timeEvidence.machineClockTimezone,
                      )}{' · '}{candidate.timeEvidence.machineClockTimezone}
                    </span>
                  )}
                <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                  {refundCandidateTimeMeaning(candidate.timeEvidence)}
                </span>
              </span>
              <span className="col-start-2 min-w-0 sm:col-start-auto">
                {visibleFactors.length > 0 && (
                  <span className="grid gap-1 leading-5 text-muted-foreground">
                    {visibleFactors.map((factor) => (
                      <span key={`${factor.key}-${factor.label}`} className="flex gap-1.5">
                        <span
                          aria-hidden="true"
                          className={cn(
                            'font-semibold',
                            factor.outcome === 'match' ? 'text-emerald-700' : 'text-orange-800',
                          )}
                        >
                          {factor.outcome === 'match' ? '✓' : '!'}
                        </span>
                        <span>{describeMatchFactor(factor, candidate)}</span>
                      </span>
                    ))}
                  </span>
                )}
                <span
                  id={statusId}
                  className={cn(
                    'mt-2 block font-medium',
                    selectionDisabled ? 'text-orange-950' : 'text-primary',
                  )}
                >
                  {selectionMessage}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {needsDisagreementReason && (
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="nayax-disagreement-reason">Why is this the right transaction?</Label>
          <select
            id="nayax-disagreement-reason"
            value={disagreementReason}
            onChange={(event) =>
              onDisagreementReasonChange(event.target.value as NayaxDisagreementReason | '')
            }
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Choose a reason</option>
            {canUseCloserTimeReason && (
              <option value="closer_time">Closer transaction time</option>
            )}
            <option value="correct_amount">Correct amount</option>
            <option value="correct_card">Correct card ending</option>
            <option value="customer_confirmation">Customer confirmed it</option>
            <option value="provider_data_issue">Transaction data appears incorrect</option>
            <option value="other_review_reason">Another reason</option>
          </select>
        </div>
      )}
      {selectedCandidate && reviewedFinalDecision && (
        <div data-testid="refund-reviewed-final-choice" className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
          <p className="font-semibold">Purchase chosen for this decision</p>
          <p className="mt-1 leading-6">
            Customer requested {formatCurrency(paymentAmountCents)}. Reviewed purchase: {formatCurrency(selectedCandidate.amountCents)}.
          </p>
          <p className="mt-1 text-xs leading-5">Approving below records this exact purchase and one final decision together. Denying the request needs no purchase choice.</p>
        </div>
      )}
      {selectedCandidate && !reviewedFinalDecision && (
        <div
          data-testid="refund-prepare-transaction-panel"
          className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950"
        >
          <p className="font-semibold">Prepare this transaction for manager review</p>
          <p data-testid="refund-prepare-amount-comparison" className="mt-1 leading-6">
            Customer requested {formatCurrency(paymentAmountCents)}. Selected transaction:{' '}
            {formatCurrency(selectedCandidate.amountCents)}
            {selectedCandidate.amountDeltaCents === 0
              ? ' (same amount).'
              : ` (${formatCurrency(Math.abs(selectedCandidate.amountDeltaCents))} difference).`}
          </p>
          <p className="mt-1 text-xs leading-5">
            Saving records the exact provider transaction and review evidence on this case. It does not approve or issue a refund, and it sends no customer message.
          </p>
          <Button
            data-testid="refund-save-transaction-for-review"
            type="button"
            variant="outline"
            className="mt-3 h-auto min-h-11 w-full whitespace-normal border-sky-300 bg-white py-2 text-center leading-5 text-sky-950 hover:bg-sky-100 sm:w-auto"
            onClick={onSaveForReview}
            disabled={
              isSaving ||
              isDemoData ||
              !canSelectCandidates
            }
          >
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            Save for manager review — no refund
          </Button>
        </div>
      )}
    </div>
  );
}
