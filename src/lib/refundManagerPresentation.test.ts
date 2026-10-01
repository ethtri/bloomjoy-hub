/// <reference lib="deno.ns" />

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  isRefundDecisionRecommendation,
  type RefundDecisionRecommendation,
} from './refundLifecycle.ts';
import {
  refundCanShowCandidateInventory,
  refundDecisionRecommendation,
  refundIsWaitingOnCustomer,
  refundManagerView,
  refundNeedsDecision,
  refundPlainStatus,
  type RefundManagerPresentationCase,
} from './refundManagerPresentation.ts';

const refundRecommendation = (
  overrides: Partial<RefundDecisionRecommendation> = {},
): RefundDecisionRecommendation => ({
  schemaVersion: 'refund_decision_recommendation_v1',
  kind: 'refund',
  reasonCode: 'clear_purchase_match',
  summary: 'One provider purchase clearly matches this request.',
  decisionReady: true,
  officialActionVersion: 7,
  deterministicFactVersion: 4,
  purchase: {
    source: 'nayax',
    amountCents: 1080,
    currencyCode: 'USD',
    transactionAt: '2026-09-24T21:15:00Z',
    timeMeaning: 'unknown',
    cardLast4: '1234',
    candidateToken: 'candidate-1',
  },
  waitingSince: null,
  lastMeaningfulInputAt: '2026-09-24T21:20:00Z',
  eligibleAt: '2026-09-24T21:25:00Z',
  payloadRedacted: true,
  ...overrides,
});

const refundCase = (overrides: Record<string, unknown> = {}): RefundManagerPresentationCase => ({
  id: 'case-1',
  publicReference: 'RF-TEST-1',
  status: 'needs_review',
  paymentMethod: 'card',
  paymentAmountCents: 1080,
  zellePaymentContact: null,
  decision: null,
  canPerformOfficialAction: true,
  officialActionVersion: 7,
  customerFactEvidence: {
    source: 'current_case_record',
    appliedAt: '2026-09-24T21:20:00Z',
    changedFields: [],
    factVersion: 4,
    payloadRedacted: true,
  },
  nayaxLookupCandidates: [],
  lifecycle: {
    nextWork: {
      schemaVersion: 'refund_next_work_v1',
      isOpen: true,
      actor: 'manager',
      actionCode: 'approve_or_deny_request',
      actionLabel: 'Review the prepared recommendation.',
      lastProgressAt: '2026-09-24T21:25:00Z',
      dueAt: null,
      blocker: null,
      payloadRedacted: true,
    },
    decisionRecommendation: refundRecommendation(),
    paymentState: 'not_requested',
    messageState: { state: 'none' },
    managerQueue: { bucket: 'ready_to_pay' },
  },
  ...overrides,
} as unknown as RefundManagerPresentationCase);

Deno.test('decision recommendation parser accepts the canonical contract and rejects purchase-time overclaims', () => {
  assert(isRefundDecisionRecommendation(refundRecommendation()));
  assert(isRefundDecisionRecommendation(refundRecommendation({
    purchase: {
      source: 'nayax',
      amountCents: 1080,
      currencyCode: 'USD',
      transactionAt: '2026-09-24T21:15:00Z',
      timeMeaning: 'unknown',
      cardLast4: null,
      candidateToken: null,
    },
  })));
  assertEquals(isRefundDecisionRecommendation({
    ...refundRecommendation(),
    purchase: {
      ...refundRecommendation().purchase,
      timeMeaning: 'authorization',
    },
  }), false);
});

Deno.test('Decision needed uses only one fresh canonical recommendation, never local candidate inventory', () => {
  const withoutRecommendation = refundCase({
    lifecycle: {
      ...refundCase().lifecycle,
      decisionRecommendation: null,
    },
    nayaxLookupCandidates: Array.from({ length: 10 }, (_, index) => ({
      candidateToken: `candidate-${index}`,
      isRecommended: index === 0,
      selectionAllowed: true,
    })),
  });
  assertEquals(refundNeedsDecision(withoutRecommendation), false);
  assertEquals(refundManagerView(withoutRecommendation), 'all_open');

  const oneRecommendation = refundCase();
  assertEquals(refundDecisionRecommendation(oneRecommendation)?.purchase?.candidateToken, 'candidate-1');
  assertEquals(refundManagerView(oneRecommendation), 'decisions');

  const manyCandidates = refundCase({
    nayaxLookupCandidates: Array.from({ length: 198 }, (_, index) => ({
      candidateToken: `inventory-${index}`,
      isRecommended: index === 0,
      selectionAllowed: true,
    })),
  });
  assertEquals(refundDecisionRecommendation(manyCandidates)?.purchase?.candidateToken, 'candidate-1');
});

Deno.test('stale action or fact versions cannot enter Decision needed', () => {
  const staleAction = refundCase({ officialActionVersion: 8 });
  const staleFacts = refundCase({
    customerFactEvidence: {
      ...refundCase().customerFactEvidence,
      factVersion: 5,
    },
  });
  assertEquals(refundNeedsDecision(staleAction), false);
  assertEquals(refundNeedsDecision(staleFacts), false);
  assertEquals(refundManagerView(staleAction), 'all_open');
  assertEquals(refundManagerView(staleFacts), 'all_open');
});

Deno.test('an unknown payment method cannot inherit a cash recommendation', () => {
  const item = refundCase({
    paymentMethod: 'unknown',
    lifecycle: {
      ...refundCase().lifecycle,
      decisionRecommendation: refundRecommendation({
        purchase: {
          source: 'sunze',
          amountCents: 650,
          currencyCode: 'USD',
          transactionAt: '2026-09-24T21:15:00Z',
          timeMeaning: 'purchase',
        },
      }),
    },
  });
  assertEquals(refundNeedsDecision(item), false);
  assertEquals(refundManagerView(item), 'all_open');
});

Deno.test('30-day rejection stays advisory until the current Manager makes the final decision', () => {
  const recommendation = refundRecommendation({
    kind: 'reject',
    reasonCode: 'no_match_after_30_days',
    summary: 'No matching purchase was found after the delivered question remained unanswered for 30 days.',
    purchase: null,
    waitingSince: '2026-08-20T12:00:00Z',
    lastMeaningfulInputAt: '2026-08-20T12:00:00Z',
    eligibleAt: '2026-09-19T12:00:00Z',
  });
  const item = refundCase({
    lifecycle: {
      ...refundCase().lifecycle,
      nextWork: {
        ...refundCase().lifecycle?.nextWork,
        actionCode: 'reject_request',
      },
      decisionRecommendation: recommendation,
    },
  });
  assertEquals(refundDecisionRecommendation(item)?.kind, 'reject');
  assertEquals(item.decision, null);
  assertEquals(refundPlainStatus(item), 'Review rejection');

  const actionOnly = refundCase({
    lifecycle: {
      ...item.lifecycle,
      decisionRecommendation: null,
    },
  });
  assertEquals(refundNeedsDecision(actionOnly), false);
});

Deno.test('cash recommendations use Sunze proof and approved cash payment work stays active', () => {
  const cashResearch = refundCase({
    paymentMethod: 'cash',
    lifecycle: {
      ...refundCase().lifecycle,
      decisionRecommendation: null,
      nextWork: {
        ...refundCase().lifecycle?.nextWork,
        actor: 'agent',
        actionCode: 'research_purchase',
      },
    },
  });
  assertEquals(refundNeedsDecision(cashResearch), false);
  assertEquals(refundManagerView(cashResearch), 'all_open');
  assertEquals(refundPlainStatus(cashResearch), 'Finding the purchase');

  const cashDecision = refundCase({
    paymentMethod: 'cash',
    zellePaymentContact: 'customer@example.test',
    lifecycle: {
      ...refundCase().lifecycle,
      decisionRecommendation: refundRecommendation({
        purchase: {
          source: 'sunze',
          amountCents: 650,
          currencyCode: 'USD',
          transactionAt: '2026-09-24T21:15:00Z',
          timeMeaning: 'purchase',
        },
      }),
    },
  });
  assertEquals(refundNeedsDecision(cashDecision), true);
  const snapcaseDecision = refundCase({
    ...cashDecision,
    lifecycle: {
      ...cashDecision.lifecycle,
      decisionRecommendation: refundRecommendation({
        purchase: { ...cashDecision.lifecycle!.decisionRecommendation!.purchase!, source: 'snapcase' },
      }),
    },
  });
  assertEquals(refundNeedsDecision(snapcaseDecision), true);
  assertEquals(refundManagerView(snapcaseDecision), 'decisions');
  assertEquals(refundNeedsDecision({ ...snapcaseDecision, paymentMethod: 'card' }), false);
  assertEquals(refundNeedsDecision({ ...snapcaseDecision, canPerformOfficialAction: false }), false);
  assertEquals(refundNeedsDecision({ ...snapcaseDecision, officialActionVersion: 99 }), false);

  const approvedCash = refundCase({
    paymentMethod: 'cash',
    status: 'cash_zelle_pending',
    decision: 'approved',
    zellePaymentContact: 'customer@example.test',
    lifecycle: {
      ...refundCase().lifecycle,
      decisionRecommendation: null,
      nextWork: {
        ...refundCase().lifecycle?.nextWork,
        actionCode: 'send_cash_refund_and_confirm',
      },
    },
  });
  assertEquals(refundManagerView(approvedCash), 'all_open');
  assertEquals(refundPlainStatus(approvedCash), 'Send cash refund');
});

Deno.test('canonical internal work keeps provider candidate inventory out of the Manager view', () => {
  const research = refundCase({
    lifecycle: {
      ...refundCase().lifecycle,
      decisionRecommendation: null,
      nextWork: {
        ...refundCase().lifecycle?.nextWork,
        actor: 'agent',
        actionCode: 'research_purchase',
      },
    },
  });
  assertEquals(refundCanShowCandidateInventory(research), false);

  const systemLookup = refundCase({
    lifecycle: {
      ...research.lifecycle,
      nextWork: {
        ...research.lifecycle?.nextWork,
        actor: 'system',
        actionCode: 'run_lookup',
      },
    },
  });
  assertEquals(refundCanShowCandidateInventory(systemLookup), false);

  const customerWait = refundCase({
    lifecycle: {
      ...research.lifecycle,
      nextWork: {
        ...research.lifecycle?.nextWork,
        actor: 'customer',
        actionCode: 'answer_question',
      },
    },
  });
  assertEquals(refundCanShowCandidateInventory(customerWait), false);
});

Deno.test('Waiting on customer requires sent-question proof and the four views form complete unions', () => {
  const waiting = refundCase({
    lifecycle: {
      ...refundCase().lifecycle,
      decisionRecommendation: null,
      nextWork: {
        ...refundCase().lifecycle?.nextWork,
        actor: 'customer',
        actionCode: 'answer_question',
      },
      customerOutreach: {
        state: 'waiting_for_customer',
        owner: 'Customer',
        nextAction: 'wait_for_customer',
        requestMessageId: 'message-1',
        requestSentAt: '2026-09-24T21:15:00Z',
        replyReceivedAt: null,
      },
    },
  });
  assert(refundIsWaitingOnCustomer(waiting));
  assertEquals(refundManagerView(waiting), 'waiting_on_customer');

  const unsent = refundCase({
    lifecycle: {
      ...waiting.lifecycle,
      customerOutreach: {
        ...waiting.lifecycle?.customerOutreach,
        requestMessageId: null,
        requestSentAt: null,
      },
    },
  });
  assertEquals(refundIsWaitingOnCustomer(unsent), false);
  assertEquals(refundManagerView(unsent), 'all_open');

  const active = refundCase({
    lifecycle: {
      ...refundCase().lifecycle,
      decisionRecommendation: null,
      nextWork: {
        ...refundCase().lifecycle?.nextWork,
        actor: 'agent',
        actionCode: 'research_purchase',
      },
    },
  });
  const closed = refundCase({
    status: 'closed',
    lifecycle: {
      ...refundCase().lifecycle,
      decisionRecommendation: null,
      nextWork: {
        ...refundCase().lifecycle?.nextWork,
        isOpen: false,
        actor: 'system',
        actionCode: 'none',
      },
    },
  });
  const cases = [refundCase(), waiting, active, closed];
  assertEquals(cases.filter((item) => refundManagerView(item) !== 'completed').length, 3);
  assertEquals(cases.filter((item) => refundManagerView(item) === 'decisions').length, 1);
  assertEquals(cases.filter((item) => refundManagerView(item) === 'waiting_on_customer').length, 1);
  assertEquals(cases.filter((item) => refundManagerView(item) === 'completed').length, 1);
  assertEquals(refundPlainStatus(active), 'Finding the purchase');
  assertEquals(refundPlainStatus(closed), 'Closed');
});
