#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [migration, payoutMigration, shared, messageSend, automationSweep, operations, refundsPage, databaseTest, payoutDatabaseTest] =
  await Promise.all([
    read('supabase/migrations/20260902002716_refund_manual_message_outbox.sql'),
    read('supabase/migrations/20260902004500_refund_payout_destination_follow_up.sql'),
    read('supabase/functions/_shared/refund-manual-message-outbox.ts'),
    read('supabase/functions/refund-case-message-send/index.ts'),
    read('supabase/functions/refund-case-automation-sweep/index.ts'),
    read('src/lib/refundOperations.ts'),
    read('src/pages/admin/Refunds.tsx'),
    read('supabase/tests/refund_manual_message_outbox.sql'),
    read('supabase/tests/refund_payout_destination_follow_up.sql'),
  ]);

for (const token of [
  'manual_delivery_intent_id',
  'refund_case_messages_one_active_manual_intent',
  'service_enqueue_refund_manual_message_intent',
  'service_mark_refund_manual_message_provider_attempt',
  'service_claim_refund_manual_message_deliveries',
  'service_finish_refund_manual_message_delivery',
  'admin_get_refund_gmail_draft_cases_pre_manual_outbox_20260902',
  "'officialactionversion'",
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
assert.ok(migration.includes("'zelle_payment_contact'"));
assert.ok(migration.includes("then 'waiting_on_customer'"));
assert.ok(payoutMigration.includes('requested_fields_satisfied_by_gmail_message_id'));
assert.ok(payoutMigration.includes('payout_destination_request_not_active'));
assert.ok(payoutMigration.includes('service_claim_due_refund_payout_destination_follow_ups'));
assert.ok(payoutMigration.includes('service_create_refund_payout_destination_reminder_message'));
assert.ok(payoutMigration.includes('payout_destination_reply_thread_mismatch'));
assert.ok(payoutMigration.includes('contactDisabledToReview'));
assert.ok(payoutMigration.includes('pausedThreadToReview'));
assert.ok(payoutMigration.includes("errcode = 'P4662'"));

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
assert.ok(automationSweep.includes('runPayoutDestinationReminderSweep'));
assert.ok(automationSweep.includes('payout_destination_reminder_sent'));
const payoutReminderWorker = automationSweep.slice(
  automationSweep.indexOf('const sendPayoutDestinationReminder ='),
  automationSweep.indexOf('const runPayoutDestinationReminderSweep =')
);
const payoutSentPatch = payoutReminderWorker.match(
  /const \{ error: updateError \} = await supabase\.from\("refund_case_messages"\)\s*\.update\(\{([\s\S]*?)\}\)/
);
assert.ok(payoutSentPatch, 'Payout reminder must settle its existing message intent.');
assert.match(payoutSentPatch[1], /status: "sent"/);
assert.match(payoutSentPatch[1], /sent_at:/);
assert.doesNotMatch(
  payoutSentPatch[1], /subject:|body:|recipient_email:/,
  'Actual worker must not overwrite reviewed content with Gmail thread content after sending.'
);
// Execute the actual worker's settlement object, not a hand-copied test shape.
// The database fixture pairs this patch with a different canonical Gmail subject.
const actualPayoutSentPatch = runInNewContext(`({${payoutSentPatch[1]}})`);
assert.deepEqual(Object.keys(actualPayoutSentPatch).sort(), ['sent_at', 'status']);
assert.equal(actualPayoutSentPatch.status, 'sent');
assert.ok(Number.isFinite(Date.parse(actualPayoutSentPatch.sent_at)));
const immutableReminder = {
  subject: 'Reminder: your approved reimbursement needs one detail',
  body: 'Zelle email or phone number:',
  recipient_email: 'payout-customer@example.invalid',
};
assert.deepEqual(
  { ...immutableReminder, ...actualPayoutSentPatch },
  { ...immutableReminder, status: 'sent', sent_at: actualPayoutSentPatch.sent_at },
  'The executed worker settlement preserves the message intent even when Gmail uses another thread subject.'
);
assert.ok(payoutDatabaseTest.includes('Late delivered receipt settles after reminder_sent'));
assert.ok(payoutDatabaseTest.includes('Late bounced receipt settles after the reminder send phase'));
assert.ok(payoutDatabaseTest.includes('Gmail thread subject remains transport evidence'));
assert.ok(payoutDatabaseTest.includes('Same-thread payout replies apply between provider entry and reminder settlement'));
assert.ok(payoutDatabaseTest.includes('Resend receipt binds after a same-thread reply wins'));
assert.ok(payoutDatabaseTest.includes('Late sent evidence never restarts satisfied follow-ups'));
assert.ok(payoutDatabaseTest.includes('Reply cancels only pre-provider reminders'));

assert.ok(operations.includes('expectedCaseVersion: number'));
assert.ok(operations.includes('messageIntentId: string'));
assert.ok(refundsPage.includes('manualMessageIntentRef'));
assert.ok(refundsPage.includes('crypto.randomUUID()'));
assert.ok(refundsPage.includes('messageFingerprint'));
assert.ok(refundsPage.includes('Email accepted by the provider. Delivery tracking is pending.'));

assert.ok(databaseTest.includes('select plan(27)'));
assert.ok(databaseTest.includes('Gmail draft cases expose the authoritative version required by the durable outbox'));
assert.ok(databaseTest.includes('An exact client retry reuses the same intent'));
assert.ok(databaseTest.includes('Only a sent request advances the truthful waiting lifecycle'));
assert.ok(databaseTest.includes('Internal/test classification suppresses queued contact'));
assert.ok(databaseTest.includes('A case change after provider access preserves unknown evidence'));
assert.ok(databaseTest.includes('remain payment-inert'));
assert.ok(payoutDatabaseTest.includes('queues one protected payout request'));
assert.ok(payoutDatabaseTest.includes('The only automated reminder claim is the protected payout field'));
assert.ok(payoutDatabaseTest.includes('another thread cannot satisfy the request'));
assert.ok(payoutDatabaseTest.includes('An unanswered reminder exits Waiting'));
assert.ok(payoutDatabaseTest.includes('The disabled-contact branch sends no reminder and cannot remain Waiting'));
assert.ok(payoutDatabaseTest.includes('The paused-thread branch sends no reminder and cannot remain Waiting'));
assert.ok(payoutDatabaseTest.includes('Post-exhaustion recovery cannot send a second request into a dead reminder ledger'));
assert.ok(payoutDatabaseTest.includes('cannot remain a stale customer action'));
assert.ok(payoutDatabaseTest.includes('create no provider or payment attempt'));

console.log('Refund manual-message outbox validator passed.');
