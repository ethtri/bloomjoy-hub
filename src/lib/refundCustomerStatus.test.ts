/// <reference lib="deno.ns" />

import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import {
  getRefundCustomerRefreshMs,
  getRefundCustomerStatusCopy,
  requireRefundCustomerLifecycle,
} from './refundCustomerStatus.ts';

const reasonCodes: Record<string, string> = {
  matching: 'lookup_in_progress',
  waiting_on_customer: 'waiting_for_purchase_evidence',
  needs_transaction_selection: 'candidate_review_required',
  transaction_confirmed: 'exact_transaction_confirmed',
  awaiting_payout: 'external_payment_ready',
  refund_initiated: 'payment_attempt_started',
  confirming_with_nayax: 'provider_confirmation_pending',
  refund_confirmed: 'customer_notification_pending',
  customer_notified: 'completion_sent',
  needs_refund_operations: 'provider_outcome_unknown',
  integrity_hold: 'card_payment_state_without_attempt',
  denied: 'refund_denied',
  unable_to_complete: 'closed_without_denial',
};
const publicCopyKeys: Record<string, string> = {
  matching: 'refund_request_received',
  waiting_on_customer: 'refund_waiting_on_customer',
  needs_transaction_selection: 'refund_reviewing_purchase',
  transaction_confirmed: 'refund_transaction_confirmed',
  awaiting_payout: 'refund_manual_payment_review',
  refund_initiated: 'refund_initiated',
  confirming_with_nayax: 'refund_confirming',
  refund_confirmed: 'refund_confirmed_bank_pending',
  customer_notified: 'refund_customer_notified',
  needs_refund_operations: 'refund_confirmation_in_progress',
  integrity_hold: 'refund_confirmation_in_progress',
  denied: 'refund_denied',
  unable_to_complete: 'refund_unable_to_complete',
};

const lifecycle = (stage: string, stageRank: number, terminal = false) => ({
  schemaVersion: 'refund_lifecycle_v2',
  version: 3,
  stage,
  stageRank,
  reasonCode: reasonCodes[stage] ?? 'lookup_in_progress',
  customerAction: {
    action: stage === 'waiting_on_customer' ? 'reply_in_existing_thread' : 'none',
    required: stage === 'waiting_on_customer',
    requestedFields: stage === 'waiting_on_customer' ? ['incident_time'] : [],
    payloadRedacted: true,
  },
  paymentState: ['refund_confirmed', 'customer_notified'].includes(stage)
    ? 'confirmed'
    : 'not_requested',
  messageState: { state: 'none', payloadRedacted: true },
  lastUpdatedAt: '2026-08-26T17:00:00.000Z',
  publicCopyKey: publicCopyKeys[stage] ?? 'refund_request_received',
  terminal,
  refreshAfterSeconds: terminal ? null : 5,
  payloadRedacted: true,
});

Deno.test('customer lifecycle rejects technical or unknown contracts', () => {
  assertThrows(() => requireRefundCustomerLifecycle({
    ...lifecycle('matching', 10),
    schemaVersion: 'refund_lifecycle_v3',
  }));
  assertThrows(() => requireRefundCustomerLifecycle({
    ...lifecycle('matching', 10),
    payloadRedacted: false,
  }));
  assertThrows(() => requireRefundCustomerLifecycle(lifecycle('provider_timeout', 50)));
});

Deno.test('customer lifecycle reconstructs nested objects and rejects private or release-skewed values', () => {
  const safe = lifecycle('waiting_on_customer', 15);
  const parsed = requireRefundCustomerLifecycle({
    ...safe,
    managerNextAction: 'refund_operations',
    providerReference: 'private',
  });
  assertEquals(Object.keys(parsed).includes('providerReference'), false);
  assertEquals(Object.keys(parsed).includes('managerNextAction'), false);
  assertEquals(parsed.customerAction, safe.customerAction);
  assertEquals(parsed.messageState, safe.messageState);

  const fixtures: unknown[] = [];
  const add = (mutate: (fixture: Record<string, unknown>) => void) => {
    const fixture = structuredClone(safe) as Record<string, unknown>;
    mutate(fixture);
    fixtures.push(fixture);
  };
  const customerAction = (fixture: Record<string, unknown>) =>
    fixture.customerAction as Record<string, unknown>;
  const messageState = (fixture: Record<string, unknown>) =>
    fixture.messageState as Record<string, unknown>;
  add((fixture) => customerAction(fixture).providerReference = 'private');
  add((fixture) => customerAction(fixture).action = 'send_provider_account');
  add((fixture) => customerAction(fixture).required = 'true');
  add((fixture) => customerAction(fixture).payloadRedacted = false);
  add((fixture) => customerAction(fixture).requestedFields = [7]);
  add((fixture) => customerAction(fixture).requestedFields = [
    'incident_time',
    'incident_time',
  ]);
  add((fixture) => customerAction(fixture).requestedFields = ['provider_account']);
  add((fixture) => messageState(fixture).providerReference = 'private');
  add((fixture) => messageState(fixture).state = 'provider_message_sent');
  add((fixture) => messageState(fixture).payloadRedacted = false);
  add((fixture) => fixture.reasonCode = 'provider_account_identifier');
  add((fixture) => fixture.paymentState = 'provider_account_linked');
  add((fixture) => fixture.publicCopyKey = 'refund_provider_account_reference');

  for (const fixture of fixtures) {
    assertThrows(() => requireRefundCustomerLifecycle(fixture));
  }
});

Deno.test('customer copy maps every canonical stage without provider troubleshooting', () => {
  const expected = new Map([
    ['matching', 'Request received'],
    ['waiting_on_customer', 'Waiting for your reply'],
    ['needs_transaction_selection', 'Reviewing your purchase'],
    ['transaction_confirmed', 'Reviewing your purchase'],
    ['awaiting_payout', 'Preparing your reimbursement'],
    ['refund_initiated', 'Refund initiated'],
    ['confirming_with_nayax', 'Confirming the refund'],
    ['needs_refund_operations', 'Confirming the refund'],
    ['integrity_hold', 'Confirming the refund'],
    ['refund_confirmed', 'Refund confirmed'],
    ['customer_notified', 'Refund confirmed'],
    ['denied', 'Review complete'],
    ['unable_to_complete', 'We could not complete the refund'],
  ]);
  for (const [stage, title] of expected) {
    const contract = requireRefundCustomerLifecycle(
      lifecycle(stage, stage === 'denied' ? 90 : 10, stage === 'denied'),
    );
    const copy = getRefundCustomerStatusCopy(contract);
    assertEquals(copy.title, title);
    assertEquals(/code|credential|DTM|response|transaction id/i.test(
      `${copy.title} ${copy.detail} ${copy.nextExpectation}`,
    ), false);
  }
});

Deno.test('waiting-on-customer copy directs one reply without restarting intake', () => {
  const copy = getRefundCustomerStatusCopy(
    requireRefundCustomerLifecycle(lifecycle('waiting_on_customer', 15)),
  );
  assertEquals(copy.nextExpectation, 'Please reply to the existing Bloomjoy email. You do not need to submit another form.');
});

Deno.test('payout wait names only the approved reimbursement destination', () => {
  const contract = lifecycle('waiting_on_customer', 15);
  contract.customerAction.requestedFields = ['zelle_payment_contact'];
  const copy = getRefundCustomerStatusCopy(
    requireRefundCustomerLifecycle(contract),
  );
  assertEquals(copy.title, 'Waiting for your payment details');
  assertEquals(copy.detail.includes('Zelle'), true);
  assertEquals(/purchase|transaction|card/i.test(copy.detail), false);
});

Deno.test('active customer status refreshes within 15 seconds and terminal status stops', () => {
  assertEquals(getRefundCustomerRefreshMs(
    requireRefundCustomerLifecycle(lifecycle('matching', 10)),
  ), 5_000);
  assertEquals(getRefundCustomerRefreshMs(
    requireRefundCustomerLifecycle(lifecycle('customer_notified', 80, true)),
  ), false);
});

Deno.test('confirmed copy distinguishes Nayax approval from bank posting', () => {
  const copy = getRefundCustomerStatusCopy(
    requireRefundCustomerLifecycle(lifecycle('refund_confirmed', 70)),
  );
  assertEquals(copy.detail, 'Nayax has approved your refund. Your bank may take up to 4 business days to show it on your account.');
});
