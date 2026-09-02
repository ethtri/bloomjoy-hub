#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [migration, shared, messageSend, automationSweep, operations, refundsPage, databaseTest] =
  await Promise.all([
    read('supabase/migrations/20260902002716_refund_manual_message_outbox.sql'),
    read('supabase/functions/_shared/refund-manual-message-outbox.ts'),
    read('supabase/functions/refund-case-message-send/index.ts'),
    read('supabase/functions/refund-case-automation-sweep/index.ts'),
    read('src/lib/refundOperations.ts'),
    read('src/pages/admin/Refunds.tsx'),
    read('supabase/tests/refund_manual_message_outbox.sql'),
  ]);

for (const token of [
  'manual_delivery_intent_id',
  'refund_case_messages_one_active_manual_intent',
  'service_enqueue_refund_manual_message_intent',
  'service_mark_refund_manual_message_provider_attempt',
  'service_claim_refund_manual_message_deliveries',
  'service_finish_refund_manual_message_delivery',
  'admin_get_refund_gmail_draft_cases_pre_manual_outbox_20260902',
  "'officialactionversion', refund_case.official_action_version",
  'for update skip locked',
  "p_message_type = 'more_info'",
  "p_outcome = 'sent'",
]) {
  assert.ok(migration.toLowerCase().includes(token), `Migration is missing ${token}.`);
}
assert.match(
  migration,
  /manual_delivery_attempt_count\s*=\s*message\.manual_delivery_attempt_count \+ 1/,
  'Every worker claim must consume one bounded attempt.'
);
assert.match(
  migration,
  /refund_case\.official_action_version is distinct from\s+message\.manual_delivery_expected_case_version/,
  'Case-version changes must cancel a queued message before provider access.'
);
assert.ok(
  migration.includes("case_row.case_population <> 'internal_test'") &&
    migration.includes("when 'more_info' then 'more_info_needed'"),
  'Only sent, customer-eligible messages may advance customer lifecycle state.'
);
assert.ok(
  !/insert into public\.refund_case_nayax_refund_attempts/i.test(migration),
  'The message outbox must not create payment attempts.'
);

assert.ok(shared.includes('idempotencyKey: `refund-message-${message.id}`'));
assert.ok(shared.includes('manual_delivery_case_version_changed'));
assert.ok(shared.includes('TransactionalEmailDeliveryUnknownError'));
assert.ok(shared.includes('syntheticProofAuthorizationId'));

assert.ok(messageSend.includes('messageIntentId'));
assert.ok(messageSend.includes('expectedCaseVersion'));
assert.ok(messageSend.includes('service_enqueue_refund_manual_message_intent'));
assert.ok(messageSend.includes('drainRefundManualMessageOutbox'));
const managerMessageLane = messageSend.slice(messageSend.indexOf('const messageType ='));
assert.ok(!managerMessageLane.includes('.from("refund_case_messages")\n      .insert'));
assert.ok(!managerMessageLane.includes('sendRefundTransactionalEmail({'));

const outboxSweepIndex = automationSweep.indexOf('runManualMessageOutboxSweep(counters)');
const automationGateIndex = automationSweep.indexOf('if (!automationEnabled)');
assert.ok(outboxSweepIndex > 0 && outboxSweepIndex < automationGateIndex);
assert.ok(automationSweep.includes('manual_message_outbox_delivery_unknown'));

assert.ok(operations.includes('expectedCaseVersion: number'));
assert.ok(operations.includes('messageIntentId: string'));
assert.ok(refundsPage.includes('manualMessageIntentRef'));
assert.ok(refundsPage.includes('crypto.randomUUID()'));
assert.ok(refundsPage.includes('messageFingerprint'));
assert.ok(refundsPage.includes('Email accepted by the provider. Delivery tracking is pending.'));

assert.ok(databaseTest.includes('select plan(27)'));
assert.ok(databaseTest.includes('The Gmail draft projection exposes the current version'));
assert.ok(databaseTest.includes('An exact client retry reuses the same intent'));
assert.ok(databaseTest.includes('Only a sent request advances the truthful waiting lifecycle'));
assert.ok(databaseTest.includes('Internal/test classification suppresses queued contact'));
assert.ok(databaseTest.includes('A case change after provider access preserves unknown evidence'));
assert.ok(databaseTest.includes('remain payment-inert'));

console.log('Refund manual-message outbox validator passed.');
