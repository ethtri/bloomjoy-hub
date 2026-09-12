/// <reference lib="deno.ns" />

import { deriveRefundTransactionViewState } from './refundTransactionViewState.ts';

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, received ${actual}`);
};

const summary = (
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
    | 'response_limited',
  overrides: Record<string, unknown> = {},
) => ({
  lookupStatus,
  ...overrides,
});

const baseInput = {
  summary: null,
  candidateCount: 0,
  selectableCandidateCount: 0,
  hasSelectedMatch: false,
  isLookingUp: false,
  legacyStateReviewRequired: false,
  lifecycleLookupStatus: null,
  lifecycleReasonCode: null,
  waitingOnCustomer: false,
};

Deno.test('expired lifecycle overrides a stale multiple-match summary with no rows', () => {
  const state = deriveRefundTransactionViewState({
    ...baseInput,
    summary: summary('multiple_matches', { recommendationState: 'ambiguous', candidateCount: 3 }),
    lifecycleLookupStatus: 'results_expired',
    lifecycleReasonCode: 'lookup_results_expired',
  });

  assertEquals(state.kind, 'unavailable', 'state');
  assertEquals(state.heading, 'Transaction results expired', 'heading');
  assertEquals(state.showCandidates, false, 'candidate visibility');
});

Deno.test('a stale multiple-match summary never claims options when current rows are empty', () => {
  const state = deriveRefundTransactionViewState({
    ...baseInput,
    summary: summary('multiple_matches', { recommendationState: 'ambiguous', candidateCount: 4 }),
  });

  assertEquals(state.kind, 'unavailable', 'state');
  assertEquals(state.heading, 'Transaction results are unavailable', 'heading');
  assertEquals(state.candidateCount, 0, 'current result count');
});

Deno.test('every current candidate is represented by the needs-selection state', () => {
  const state = deriveRefundTransactionViewState({
    ...baseInput,
    summary: summary('multiple_matches', { candidateCount: 3 }),
    candidateCount: 3,
    selectableCandidateCount: 2,
  });

  assertEquals(state.kind, 'needs_selection', 'state');
  assertEquals(state.heading, '3 transactions found', 'heading');
  assertEquals(state.badge, '3 results', 'badge');
  assertEquals(state.showCandidates, true, 'candidate visibility');
});

Deno.test('unavailable candidates remain visible even when none can be selected', () => {
  const state = deriveRefundTransactionViewState({
    ...baseInput,
    summary: summary('multiple_matches', { candidateCount: 2 }),
    candidateCount: 2,
    selectableCandidateCount: 0,
  });

  assertEquals(state.kind, 'needs_selection', 'state');
  assertEquals(state.showCandidates, true, 'candidate visibility');
  assertEquals(state.selectableCandidateCount, 0, 'selectable count');
});

Deno.test('authoritative no-match stays distinct from incomplete history', () => {
  const complete = deriveRefundTransactionViewState({
    ...baseInput,
    summary: summary('no_match', { historicalCoverage: 'complete' }),
  });
  const unknown = deriveRefundTransactionViewState({
    ...baseInput,
    summary: summary('no_match', { historicalCoverage: 'unknown' }),
  });

  assertEquals(complete.heading, 'No matching transaction found', 'complete history heading');
  assertEquals(unknown.heading, 'Transaction history is incomplete', 'unknown history heading');
  assertEquals(complete.kind, 'no_match', 'complete history state');
  assertEquals(unknown.kind, 'unavailable', 'unknown history fails closed');
});

Deno.test('selection and active checking take precedence over other lookup summaries', () => {
  const selected = deriveRefundTransactionViewState({
    ...baseInput,
    summary: summary('lookup_failed'),
    hasSelectedMatch: true,
  });
  const checking = deriveRefundTransactionViewState({
    ...baseInput,
    summary: summary('multiple_matches'),
    isLookingUp: true,
  });

  assertEquals(selected.kind, 'selected', 'selected precedence');
  assertEquals(checking.kind, 'checking', 'checking precedence');
});
