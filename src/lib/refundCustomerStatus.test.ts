/// <reference lib="deno.ns" />

import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import {
  getRefundCustomerRefreshMs,
  getRefundCustomerStatusCopy,
  requireRefundCustomerLifecycle,
} from './refundCustomerStatus.ts';

const lifecycle = (stage: string, stageRank: number, terminal = false) => ({
  schemaVersion: 'refund_lifecycle_v2',
  version: 3,
  stage,
  stageRank,
  reasonCode: `test_${stage}`,
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
  publicCopyKey: `refund_${stage}`,
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
