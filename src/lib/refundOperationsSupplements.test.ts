import {
  assertEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { mergeRefundOperationsSupplements } from './refundOperationsSupplements.ts';
import type {
  RefundCaseRecord,
  RefundOperationsOverview,
  RefundOperationsSupplements,
} from './refundOperations.ts';

const coreCase = {
  id: 'case-1',
  publicReference: 'RF-TEST',
  canPerformOfficialAction: true,
  canSelectNayaxCandidate: true,
  officialActionBlockReason: null,
  lifecycle: {
    managerQueue: { bucket: 'ready_to_pay' },
  },
} as unknown as RefundCaseRecord;

const overview: RefundOperationsOverview = {
  cases: [coreCase],
  machines: [],
  managerAssignments: [],
};

const supplements = (
  unavailableSources: RefundOperationsSupplements['unavailableSources'],
): RefundOperationsSupplements => ({
  gmailDrafts: [],
  queueStates: [],
  manualNayaxContexts: [],
  unavailableSources,
});

Deno.test('core queue remains visible but official actions wait for supplements', () => {
  const merged = mergeRefundOperationsSupplements(overview, undefined);
  assertEquals(merged.cases.length, 1);
  assertEquals(merged.cases[0].lifecycle, coreCase.lifecycle);
  assertEquals(merged.cases[0].canPerformOfficialAction, false);
  assertEquals(merged.cases[0].canSelectNayaxCandidate, false);
  assertEquals(merged.cases[0].officialActionBlockReason, 'official_actions_disabled');
});

Deno.test('one failed supplement keeps every official action review-only', () => {
  const merged = mergeRefundOperationsSupplements(
    overview,
    supplements(['email_queue_states']),
  );
  assertEquals(merged.cases.length, 1);
  assertEquals(merged.cases[0].canPerformOfficialAction, false);
  assertEquals(merged.cases[0].canSelectNayaxCandidate, false);
  assertEquals(merged.cases[0].officialActionBlockReason, 'official_actions_disabled');
});

Deno.test('complete supplements restore the core server-owned action truth', () => {
  const merged = mergeRefundOperationsSupplements(overview, supplements([]));
  assertEquals(merged.cases.length, 1);
  assertEquals(merged.cases[0].canPerformOfficialAction, true);
  assertEquals(merged.cases[0].canSelectNayaxCandidate, true);
  assertEquals(merged.cases[0].officialActionBlockReason, null);
});
