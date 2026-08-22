import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [
  brand,
  email,
  firstContact,
  gmailSync,
  migration,
  databaseTest,
  portal,
  envExample,
  runbook,
] = await Promise.all([
  read('supabase/functions/_shared/refund-email-brand.ts'),
  read('supabase/functions/_shared/refund-email.ts'),
  read('supabase/functions/_shared/refund-first-contact.ts'),
  read('supabase/functions/refund-gmail-sync/index.ts'),
  read('supabase/migrations/20260821100000_refund_branded_appeals.sql'),
  read('supabase/tests/refund_branded_appeals.sql'),
  read('src/pages/admin/Refunds.tsx'),
  read('.env.example'),
  read('Docs/REFUND_CUSTOMER_MESSAGES_RUNBOOK.md'),
]);

for (const proof of [
  '<table role="presentation"',
  '#b83d64',
  '#fbf4ec',
  "Georgia,'Times New Roman',serif",
  'The Bloomjoy Sweets Team',
  'safeHttpsUrl',
]) {
  assert(brand.includes(proof), `The canonical Bloomjoy renderer is missing: ${proof}`);
}
assert(
  email.includes('renderBloomjoyRefundEmail') &&
    firstContact.includes('renderBloomjoyRefundEmail') &&
    email.includes('buildBrandedRefundHtmlFromStoredText'),
  'First contact, case messages, and retries must share the canonical branded renderer.',
);
assert(
  email.includes('Good news—your refund request was approved, and your refund is on its way.') &&
    migration.includes('Good news—your refund request was approved, and your refund is on its way.'),
  'Every confirmed success path must use the required customer opening.',
);
assert(
  email.includes('sanitizeRefundCustomerSafeDenialReason') &&
    email.includes('reply in this same conversation') &&
    email.includes('case "appeal_received"'),
  'Denials must contain a customer-safe reason and a reply-based appeal path.',
);
assert(
  migration.includes('create table public.refund_case_appeals') &&
    migration.includes('service_record_refund_denial_appeal') &&
    migration.includes("status = 'needs_review'") &&
    migration.includes('decision = null') &&
    migration.includes("automation_state = 'appeal_received'") &&
    migration.includes('nayax_match_execution_eligible = false') &&
    migration.includes("'provider_attempt_created', false"),
  'A verified appeal must reopen the same case without preserving a decision or payment authority.',
);
assert(
  migration.includes("confirmation_status in ('pending_send', 'sending', 'sent', 'failed', 'delivery_unknown')") &&
    migration.includes("appeal_row.confirmation_status in ('sent', 'delivery_unknown', 'sending')") &&
    gmailSync.includes('error instanceof TypeError') &&
    gmailSync.includes('error.deliveryUncertain'),
  'Appeal receipts must be idempotent and stop blind retries when delivery is uncertain.',
);
assert(
  gmailSync.includes('automaticRefundCustomerContactEnabled()') &&
    gmailSync.includes('refund_customer_contact_settings') &&
    gmailSync.includes('processDenialAppealConfirmation') &&
    gmailSync.includes('!appealReceived') &&
    /^REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED=false$/m.test(envExample),
  'Appeal email automation must have both default-off gates and must bypass transaction fact matching.',
);
assert(
  migration.includes("content_source = 'deterministic_template'") &&
    migration.includes("message_type = 'appeal_received'") &&
    migration.includes("reason_code = 'denial_appeal'") &&
    migration.includes("template_version = 'refund_appeal_received_v1'"),
  'Automatic appeal receipts must be deterministic and cannot depend on GPT.',
);
for (const proof of [
  'An appeal does not create a second case',
  'An appeal never creates a payment-provider attempt',
  'A repeated Gmail delivery cannot duplicate the appeal',
  'Forwarded or otherwise unverified content cannot reopen a denied case',
  'An uncertain appeal receipt cannot be blindly retried',
]) {
  assert(databaseTest.includes(proof), `Database appeal coverage is missing: ${proof}`);
}
assert(
  portal.includes('Appeal received') &&
    portal.includes('Appeal needs review') &&
    portal.includes('No refund was authorized by the reply.'),
  'The manager workbench must surface the appeal and its non-payment boundary.',
);
for (const proof of [
  'Form submission creates the case',
  'Reply-based denial appeal',
  'Automatic contact remains off by default',
  'Duplicate-payment protections remain mandatory',
  'No production activation',
]) {
  assert(runbook.includes(proof), `The customer message runbook is missing: ${proof}`);
}

console.log('Refund branded appeals validation passed: one warm message system, same-case reply appeals, deterministic default-off acknowledgement, and payment boundaries are present.');
