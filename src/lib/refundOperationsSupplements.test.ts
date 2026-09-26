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
  unavailableSources,
});

Deno.test('loading supplements preserves the core server-owned capabilities', () => {
  const merged = mergeRefundOperationsSupplements(overview, undefined);
  assertEquals(merged.cases.length, 1);
  assertEquals(merged.cases[0].lifecycle, coreCase.lifecycle);
  assertEquals(merged.cases[0].canPerformOfficialAction, true);
  assertEquals(merged.cases[0].canSelectNayaxCandidate, true);
  assertEquals(merged.cases[0].officialActionBlockReason, null);
});

Deno.test('one failed supplement does not create a global action block', () => {
  const merged = mergeRefundOperationsSupplements(
    overview,
    supplements(['email_queue_states']),
  );
  assertEquals(merged.cases.length, 1);
  assertEquals(merged.cases[0].canPerformOfficialAction, true);
  assertEquals(merged.cases[0].canSelectNayaxCandidate, true);
  assertEquals(merged.cases[0].officialActionBlockReason, null);
});

Deno.test('available queue details enrich a case without changing its capability', () => {
  const merged = mergeRefundOperationsSupplements(overview, {
    gmailDrafts: [],
    queueStates: [{
      caseId: coreCase.id,
      intakeSource: 'form',
      exactCasePath: `/refunds?case=${coreCase.id}`,
      missingInformation: true,
      possibleDuplicate: false,
      confirmedDuplicate: true,
      duplicateOfCaseId: null,
      aging: false,
      providerHold: true,
      providerOutcome: 'unconfirmed',
      legacyStateReviewRequired: true,
      actionBlocked: true,
      payloadRedacted: true,
    }],
    unavailableSources: ['gmail_drafts'],
  });
  assertEquals(merged.cases[0].missingInformation, true);
  assertEquals(merged.cases[0].confirmedDuplicate, true);
  assertEquals(merged.cases[0].providerHold, true);
  assertEquals(merged.cases[0].providerOutcome, 'unconfirmed');
  assertEquals(merged.cases[0].legacyStateReviewRequired, true);
  assertEquals(merged.cases[0].reconciliationActionBlocked, true);
  assertEquals(merged.cases[0].canPerformOfficialAction, true);
  assertEquals(merged.cases[0].canSelectNayaxCandidate, true);
  assertEquals(merged.cases[0].officialActionBlockReason, null);
});

Deno.test('stale queue details cannot downgrade a protected approval result awaiting overview readback', () => {
  const queueState = {
    caseId: coreCase.id,
    intakeSource: 'form',
    exactCasePath: `/refunds?case=${coreCase.id}`,
    missingInformation: false,
    possibleDuplicate: false,
    confirmedDuplicate: false,
    duplicateOfCaseId: null,
    aging: false,
    providerHold: false,
    providerOutcome: 'not_attempted' as const,
    legacyStateReviewRequired: false,
    actionBlocked: false,
    payloadRedacted: true as const,
  };
  const staleSupplements: RefundOperationsSupplements = {
    gmailDrafts: [], queueStates: [queueState], unavailableSources: [],
  };
  for (const [outcome, providerHold] of [
    ['unconfirmed', true], ['succeeded', false], ['not_attempted', false],
  ] as const) {
    const heldCase = {
      ...coreCase,
      paymentMethod: 'card', decision: 'approved', status: 'card_refund_pending',
      lifecycle: null, workflowProjectionUnavailable: true,
      providerOutcome: outcome, providerHold,
    } as RefundCaseRecord;
    const merged = mergeRefundOperationsSupplements({ ...overview, cases: [heldCase] }, staleSupplements);
    assertEquals(merged.cases[0].providerOutcome, outcome);
    assertEquals(merged.cases[0].providerHold, providerHold);
  }
  const freshCase = {
    ...coreCase, paymentMethod: 'card', decision: 'approved',
    status: 'card_refund_pending', providerOutcome: 'succeeded', providerHold: false,
  } as RefundCaseRecord;
  const fresh = mergeRefundOperationsSupplements({ ...overview, cases: [freshCase] }, staleSupplements);
  assertEquals(fresh.cases[0].providerOutcome, 'not_attempted');
});

Deno.test('supplement-only Gmail drafts remain review-only without fabricated capability fields', () => {
  const gmailDraft = {
    id: 'gmail-draft',
    publicReference: 'RF-GMAIL-DRAFT',
    lifecycle: {
      managerQueue: { bucket: 'needs_action' },
    },
  } as unknown as RefundCaseRecord;
  const merged = mergeRefundOperationsSupplements(overview, {
    gmailDrafts: [gmailDraft],
    queueStates: [{
      caseId: gmailDraft.id,
      intakeSource: 'gmail',
      exactCasePath: `/refunds?case=${gmailDraft.id}`,
      missingInformation: true,
      possibleDuplicate: true,
      confirmedDuplicate: false,
      duplicateOfCaseId: null,
      aging: true,
      providerHold: true,
      providerOutcome: 'unconfirmed',
      legacyStateReviewRequired: true,
      actionBlocked: true,
      payloadRedacted: true,
    }],
    unavailableSources: [],
  });
  const mergedDraft = merged.cases.find((refundCase) => refundCase.id === gmailDraft.id);
  assertEquals(mergedDraft?.providerHold, true);
  assertEquals(mergedDraft?.providerOutcome, 'unconfirmed');
  assertEquals(mergedDraft?.legacyStateReviewRequired, true);
  assertEquals(mergedDraft?.reconciliationActionBlocked, true);
  assertEquals(mergedDraft?.canPerformOfficialAction, undefined);
  assertEquals(mergedDraft?.canSelectNayaxCandidate, undefined);
  assertEquals(mergedDraft?.officialActionBlockReason, undefined);
});

Deno.test('complete supplements restore the core server-owned action truth', () => {
  const merged = mergeRefundOperationsSupplements(overview, supplements([]));
  assertEquals(merged.cases.length, 1);
  assertEquals(merged.cases[0].canPerformOfficialAction, true);
  assertEquals(merged.cases[0].canSelectNayaxCandidate, true);
  assertEquals(merged.cases[0].officialActionBlockReason, null);
});
