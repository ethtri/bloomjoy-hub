#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [migration, shared, messageSend, operations, refundsPage, databaseTest] =
  await Promise.all([
    read('supabase/migrations/20260901070000_refund_transactional_delivery_truth.sql'),
    read('supabase/functions/_shared/refund-transactional-delivery.ts'),
    read('supabase/functions/refund-case-message-send/index.ts'),
    read('src/lib/refundOperations.ts'),
    read('src/pages/admin/Refunds.tsx'),
    read('supabase/tests/refund_transactional_delivery_truth.sql'),
  ]);

for (const token of [
  'refund_transactional_delivery_events',
  'service_mark_refund_transactional_delivery_attempt',
  'service_bind_refund_transactional_delivery',
  'service_record_refund_transactional_delivery_event',
  'refund_transactional_delivery_v1',
  'review_delivery_no_resend',
  'paymentReplayAllowed',
]) {
  assert.ok(migration.includes(token), `Migration is missing ${token}.`);
}
assert.ok(
  migration.includes("revoke all on table public.refund_transactional_delivery_events\n  from service_role"),
  'Provider delivery events must remain private behind security-definer RPCs.'
);
assert.ok(
  !/refund_transactional_delivery_events\s*\([^)]*(payload|recipient|subject|body)/is.test(migration),
  'The provider event ledger must not persist webhook payload or customer content.'
);
assert.ok(
  migration.includes("when 'complained' then 6") &&
    migration.includes('refund_transactional_delivery_state_rank'),
  'Out-of-order events require a monotonic terminal-state rank.'
);

assert.ok(shared.includes('sha256Hex') && shared.includes('payloadRedacted'));
assert.ok(messageSend.includes('new Webhook(secret).verify(rawBody'));
assert.ok(messageSend.includes('service_record_refund_transactional_delivery_event'));
const webhookHandler = messageSend.slice(
  messageSend.indexOf('const handleTransactionalDeliveryWebhook'),
  messageSend.indexOf('const syncAutomationFields')
);
assert.ok(!webhookHandler.includes('sendRefundTransactionalEmail('));
assert.ok(!webhookHandler.includes('nayax-card-refund'));

assert.ok(operations.includes("transactionalDeliveryContractVersion?: 'refund_transactional_delivery_v1'"));
assert.ok(operations.includes('requireRefundTransactionalDeliveryCase'));
for (const label of [
  'Accepted by provider',
  'Delivered',
  'Delivery delayed',
  'Bounced',
  'Complaint reported',
  'Delivery unknown',
]) {
  assert.ok(refundsPage.includes(label), `Manager UI is missing ${label}.`);
}
assert.ok(refundsPage.includes('isNeedsActionCase'));
assert.ok(refundsPage.includes('do not resend the message or retry a payment blindly'));

assert.ok(databaseTest.includes('select plan(20)'));
assert.ok(databaseTest.includes('Webhook-before-bind evidence is retained'));
assert.ok(databaseTest.includes('Delivery events create no message replay and no payment attempt'));
assert.ok(databaseTest.includes('Internal/test classification suppresses direct provider delivery attempts'));

console.log('Refund transactional delivery validator passed.');
