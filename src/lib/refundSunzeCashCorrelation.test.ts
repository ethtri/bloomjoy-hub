/// <reference lib="deno.ns" />
import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import {
  parseRefundSunzeCashCorrelation,
  refundSunzeCashSelectionOperationOwnsMarker,
  refundSunzeCashSelectionRefreshIsAuthoritative,
  type RefundSunzeCashCorrelation,
} from './refundSunzeCashCorrelation.ts';

const id = (suffix: string) => `13530000-0000-4000-8000-${suffix.padStart(12, '0')}`;

const candidate = (suffix: string, rank = 1) => ({
  salesFactId: id(suffix),
  rank,
  paymentTime: '2026-09-14T19:04:00.000Z',
  amountCents: 825,
  actualAmountCents: 825,
  timeDeltaSeconds: 42,
  amountDeltaCents: 0,
  evidenceCodes: ['machine_exact', 'cash_payment', 'validated_coverage'],
  selectionConflict: false,
  machineLabel: 'Machine A',
  locationName: 'Synthetic Market',
  tradeLabel: 'Gummy Bears',
});

const overview = (overrides: Partial<Record<string, unknown>> = {}) => ({
  caseFactVersion: 3,
  attemptId: id('000000000101'),
  policyVersion: 'sunze_cash_correlation_v1',
  state: 'sale_found',
  reason: null,
  sourceReadiness: 'complete_coverage',
  coverageStartedAt: '2026-09-14T18:00:00.000Z',
  coveredThrough: '2026-09-14T20:00:00.000Z',
  freshnessExpiresAt: '2026-09-15T20:00:00.000Z',
  evaluatedAt: '2026-09-14T20:05:00.000Z',
  candidateCount: 1,
  returnedCandidateCount: 1,
  candidatesTruncated: false,
  candidates: [candidate('000000000201')],
  selectedSalesFactId: id('000000000201'),
  selectedLinkVersion: 1,
  expectedLinkVersion: 1,
  selectedSale: {
    salesFactId: id('000000000201'),
    paymentTime: '2026-09-14T19:04:00.000Z',
    actualAmountCents: 825,
    machineLabel: 'Machine A',
    locationName: 'Synthetic Market',
    tradeLabel: 'Gummy Bears',
  },
  evidenceOnly: true,
  ...overrides,
});

Deno.test('parses a unique selected sale and preserves safe display evidence', () => {
  const parsed = parseRefundSunzeCashCorrelation(overview());
  assertEquals(parsed.state, 'sale_found');
  assertEquals(parsed.candidates[0].actualAmountCents, 825);
  assertEquals(parsed.candidates[0].machineLabel, 'Machine A');
  assertEquals(parsed.selectedSalesFactId, id('000000000201'));
  assertEquals(parsed.selectedSale?.actualAmountCents, 825);
  assertEquals(parsed.evidenceOnly, true);
});

Deno.test('parses multiple, checking, no-match, and unavailable without making them gates', () => {
  const states: RefundSunzeCashCorrelation['state'][] = [
    'multiple_possible_sales',
    'checking_sales_history',
    'no_sale_found_with_complete_coverage',
    'sales_history_unavailable',
  ];
  for (const state of states) {
    const parsed = parseRefundSunzeCashCorrelation(overview({
      state,
      sourceReadiness: state === 'checking_sales_history'
        ? 'awaiting_coverage'
        : state === 'sales_history_unavailable' ? 'unavailable' : 'complete_coverage',
      candidates: state === 'multiple_possible_sales'
        ? [candidate('000000000201'), candidate('000000000202', 2)]
        : [],
      candidateCount: state === 'multiple_possible_sales' ? 2 : 0,
      returnedCandidateCount: state === 'multiple_possible_sales' ? 2 : 0,
      selectedSalesFactId: null,
      selectedLinkVersion: 0,
      expectedLinkVersion: 0,
      selectedSale: null,
    }));
    assertEquals(parsed.state, state);
  }
});

Deno.test('accepts first selection token version zero and rejects malformed or private payloads', () => {
  assertEquals(parseRefundSunzeCashCorrelation(overview({
    selectedSalesFactId: null,
    selectedLinkVersion: 0,
    expectedLinkVersion: 0,
    selectedSale: null,
  })).expectedLinkVersion, 0);
  assertThrows(() => parseRefundSunzeCashCorrelation(overview({ evidenceOnly: false })));
  assertThrows(() => parseRefundSunzeCashCorrelation(overview({ candidates: [{ ...candidate('000000000201'), rawPayload: {} }] })));
  assertThrows(() => parseRefundSunzeCashCorrelation(overview({
    selectedSalesFactId: id('000000000202'),
  })));
  assertThrows(() => parseRefundSunzeCashCorrelation(overview({ caseFactVersion: 0 })));
});

Deno.test('an unknown selection clears only after a newer authoritative refresh', () => {
  const pending = { operationId: 'selection-a', afterDataUpdatedAt: 100, recoveryAvailable: true };
  assertEquals(refundSunzeCashSelectionRefreshIsAuthoritative({
    ...pending,
    recoveryAvailable: false,
  }, 101, true), false);
  assertEquals(refundSunzeCashSelectionRefreshIsAuthoritative(pending, 100, true), false);
  assertEquals(refundSunzeCashSelectionRefreshIsAuthoritative(pending, 101, false), false);
  assertEquals(refundSunzeCashSelectionRefreshIsAuthoritative(pending, 101, true), true);
});

Deno.test('only the owning cash selection operation may mutate its pending marker', () => {
  const pending = { operationId: 'selection-a', afterDataUpdatedAt: 100, recoveryAvailable: false };
  assertEquals(refundSunzeCashSelectionOperationOwnsMarker(pending, 'selection-a'), true);
  assertEquals(refundSunzeCashSelectionOperationOwnsMarker(pending, 'selection-b'), false);
  assertEquals(refundSunzeCashSelectionOperationOwnsMarker(null, 'selection-a'), false);
});
