export type RefundTransactionViewStateKind =
  | 'selected'
  | 'checking'
  | 'unavailable'
  | 'needs_selection'
  | 'no_match'
  | 'waiting';

export type RefundTransactionViewTone = 'neutral' | 'info' | 'warning' | 'success';

export type RefundTransactionViewState = {
  kind: RefundTransactionViewStateKind;
  heading: string;
  badge: string;
  description: string;
  tone: RefundTransactionViewTone;
  showCandidates: boolean;
  candidateCount: number;
  selectableCandidateCount: number;
};

type DeriveRefundTransactionViewStateInput = {
  summary: {
    lookupStatus:
      | 'not_applicable'
      | 'not_started'
      | 'checking'
      | 'match_found'
      | 'multiple_matches'
      | 'no_match'
      | 'inconclusive'
      | 'manual_exception'
      | 'setup_needed'
      | 'lookup_failed'
      | 'lookup_timed_out'
      | 'response_limited';
    recommendationState?: string;
    historicalCoverage?: 'unknown' | 'complete';
    safeRetryEligible?: boolean;
    providerRecordCount?: number | null;
    providerWindowRecordCount?: number | null;
  } | null;
  candidateCount: number;
  selectableCandidateCount: number;
  hasSelectedMatch: boolean;
  isLookingUp: boolean;
  legacyStateReviewRequired: boolean;
  lifecycleLookupStatus?: string | null;
  lifecycleReasonCode?: string | null;
  waitingOnCustomer: boolean;
};

const unavailableLookupStatuses = new Set([
  'inconclusive',
  'manual_exception',
  'setup_needed',
  'lookup_failed',
  'lookup_timed_out',
  'response_limited',
]);

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

export const deriveRefundTransactionViewState = ({
  summary,
  candidateCount,
  selectableCandidateCount,
  hasSelectedMatch,
  isLookingUp,
  legacyStateReviewRequired,
  lifecycleLookupStatus,
  lifecycleReasonCode,
  waitingOnCustomer,
}: DeriveRefundTransactionViewStateInput): RefundTransactionViewState => {
  const base = {
    candidateCount,
    selectableCandidateCount,
  };

  if (hasSelectedMatch) {
    return {
      ...base,
      kind: 'selected',
      heading: 'Transaction selected',
      badge: 'Selected',
      description: 'The selected provider transaction is saved with this case.',
      tone: 'success',
      showCandidates: false,
    };
  }

  if (isLookingUp || summary?.lookupStatus === 'checking') {
    return {
      ...base,
      kind: 'checking',
      heading: 'Checking transactions',
      badge: 'Checking',
      description: 'Bloomjoy is checking transactions near the customer-reported time. This read-only check cannot issue a refund.',
      tone: 'info',
      showCandidates: false,
    };
  }

  const resultsExpired =
    legacyStateReviewRequired ||
    lifecycleLookupStatus === 'results_expired' ||
    lifecycleReasonCode === 'lookup_results_expired';

  if (resultsExpired) {
    return {
      ...base,
      kind: 'unavailable',
      heading: 'Transaction results expired',
      badge: 'Refresh pending',
      description: 'The previous results are no longer current, so they cannot be shown or selected. Bloomjoy will run a new read-only check automatically. No refund was issued.',
      tone: 'warning',
      showCandidates: false,
    };
  }

  if (candidateCount > 0) {
    const selectableDescription = selectableCandidateCount === 0
      ? `All ${plural(candidateCount, 'current result')} are shown in this panel, but none meet the safeguards for selection.`
      : waitingOnCustomer
        ? `All ${plural(candidateCount, 'current result')} are shown in this panel. Selection will reopen after the customer replies and Bloomjoy checks again.`
        : `${plural(candidateCount, 'current result')} ${candidateCount === 1 ? 'is' : 'are'} shown in this panel. Compare the details before selecting one.`;

    return {
      ...base,
      kind: 'needs_selection',
      heading: `${plural(candidateCount, 'transaction')} found`,
      badge: `${plural(candidateCount, 'result')}`,
      description: selectableDescription,
      tone: 'info',
      showCandidates: true,
    };
  }

  if (summary?.lookupStatus === 'no_match') {
    const historicalCoverageComplete = summary.historicalCoverage === 'complete';
    const description = historicalCoverageComplete
      ? 'Bloomjoy checked the recorded purchase period and found no matching transaction.'
      : 'No usable transaction was returned, but the provider did not confirm complete coverage of the purchase period. Refund Operations owns the next internal check.';
    return {
      ...base,
      kind: historicalCoverageComplete ? 'no_match' : 'unavailable',
      heading: historicalCoverageComplete
        ? 'No matching transaction found'
        : 'Transaction history is incomplete',
      badge: historicalCoverageComplete ? 'No match' : 'History incomplete',
      description,
      tone: 'warning',
      showCandidates: false,
    };
  }

  const summaryClaimsMissingRows =
    summary?.lookupStatus === 'match_found' ||
    summary?.lookupStatus === 'multiple_matches' ||
    summary?.recommendationState === 'ambiguous';

  if (summaryClaimsMissingRows || (summary && unavailableLookupStatuses.has(summary.lookupStatus))) {
    const setupNeeded = summary?.lookupStatus === 'setup_needed';
    const historyIncomplete = summary?.lookupStatus === 'inconclusive';
    const retryAvailable = summary?.safeRetryEligible === true;
    const incompleteDescription = summary?.providerWindowRecordCount === 0 && typeof summary.providerRecordCount === 'number'
      ? `${plural(summary.providerRecordCount, 'transaction')} ${summary.providerRecordCount === 1 ? 'was' : 'were'} returned, but none covered the reported purchase window. The provider did not confirm complete history.`
      : 'The provider did not return enough history to determine whether a matching transaction exists.';
    return {
      ...base,
      kind: 'unavailable',
      heading: setupNeeded
        ? 'Transaction search is unavailable'
        : historyIncomplete
          ? 'Transaction history is incomplete'
          : 'Transaction results are unavailable',
      badge: setupNeeded
        ? 'Setup needed'
        : historyIncomplete
          ? 'History incomplete'
          : retryAvailable
            ? 'Retry pending'
            : 'Needs attention',
      description: setupNeeded
        ? 'Refund Operations owns the machine connection. No transaction results are available to show, and the customer does not need to repeat details.'
        : historyIncomplete
          ? incompleteDescription
        : retryAvailable
          ? 'Bloomjoy does not have current transaction results to show. It will run one safe read-only retry automatically. No refund was issued.'
          : 'Bloomjoy does not have current transaction results to show. Refund Operations owns the next internal check. No refund was issued.',
      tone: 'warning',
      showCandidates: false,
    };
  }

  return {
    ...base,
    kind: 'waiting',
    heading: 'Waiting for transaction search',
    badge: 'Not checked yet',
    description: 'Bloomjoy will start the read-only transaction search automatically when the required customer details are available.',
    tone: 'neutral',
    showCandidates: false,
  };
};
