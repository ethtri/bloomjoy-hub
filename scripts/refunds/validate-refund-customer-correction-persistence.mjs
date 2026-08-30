import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [
  migration,
  extraction,
  extractionTests,
  factApplication,
  factApplicationTests,
  correctionEmail,
  gmailSync,
  intake,
  operations,
  managerUi,
  databaseTest,
  runbook,
  qaChecklist,
] = await Promise.all([
  read('supabase/migrations/20260830182941_refund_customer_correction_persistence.sql'),
  read('supabase/functions/_shared/refund-email-fact-extraction.ts'),
  read('supabase/functions/_shared/refund-email-fact-extraction.test.ts'),
  read('supabase/functions/_shared/refund-customer-fact-application.ts'),
  read('supabase/functions/_shared/refund-customer-fact-application.test.ts'),
  read('supabase/functions/_shared/refund-nayax-customer-correction.ts'),
  read('supabase/functions/refund-gmail-sync/index.ts'),
  read('supabase/functions/refund-case-intake/index.ts'),
  read('src/lib/refundOperations.ts'),
  read('src/pages/admin/Refunds.tsx'),
  read('supabase/tests/refund_customer_correction_persistence.sql'),
  read('Docs/REFUND_EMAIL_ASSISTANT_RUNBOOK.md'),
  read('Docs/QA_SMOKE_TEST_CHECKLIST.md'),
]);

for (const label of [
  'Card type',
  'Payment interaction',
  'Wallet provider',
  'Card last four source',
]) {
  assert(correctionEmail.includes(label), `Correction email must include ${label}`);
}

for (const field of [
  'cardNetwork',
  'paymentInteraction',
  'walletProvider',
  'cardLast4Provenance',
  'ambiguousFields',
]) {
  assert(extraction.includes(field), `Reply extraction must expose ${field}`);
}
assert(
  extractionTests.includes('conflicting or unknown labeled card facts route to manager review') &&
    extraction.includes('ambiguous_customer_facts'),
  'Unknown or conflicting structured facts must fail closed to manager review',
);
assert(
  extraction.includes('resolvedWalletUsed !== true') &&
    extractionTests.includes('wallet answers never treat emailed digits as safe physical-card evidence'),
  'Wallet/device-token digits must never become email-derived physical-card evidence',
);

for (const persistedField of [
  'card_network',
  'payment_interaction',
  'wallet_provider',
  'card_last4_provenance',
]) {
  assert(
    gmailSync.includes(`updates.${persistedField}`),
    `Verified Gmail replies must persist ${persistedField}`,
  );
}
assert(
  gmailSync.includes('service_apply_refund_gmail_customer_facts_v1') &&
    gmailSync.includes('classifyRefundCustomerFactApplication(application)') &&
    gmailSync.includes('(ingestion?.created || ingestion?.duplicate)'),
  'Gmail persistence must use the atomic RPC and safely replay duplicate ingestion',
);
assert(
  factApplication.includes('"retryable_conflict"') &&
    factApplication.includes('"invalid_response"') &&
    factApplicationTests.includes('idempotently replayed') &&
    factApplicationTests.includes('conflicts remain retryable'),
  'Edge classification must accept idempotent replay and fail closed on conflicts',
);
assert(
  migration.includes("'resulting_fact_version', case_row.deterministic_fact_version") &&
    migration.includes("'payload_redacted', true"),
  'Applied reply facts must create one redacted, version-bound audit event',
);
const atomicApplication = migration.slice(
  migration.indexOf('create function public.service_apply_refund_gmail_customer_facts_v1'),
  migration.indexOf('revoke all on function public.service_apply_refund_gmail_customer_facts_v1'),
);
assert(
  atomicApplication.includes("'outcome', 'applied'") &&
    atomicApplication.includes("'outcome', 'conflict'") &&
    atomicApplication.includes("'outcome', 'already_applied'") &&
    !atomicApplication.includes('source_message_id'),
  'Applied reply audit metadata must not retain a raw Gmail message identifier',
);

assert(
  migration.includes('card_last4_provenance') &&
    migration.includes('wallet_device_token') &&
    migration.includes('physical_card'),
  'The database must explicitly distinguish physical-card and wallet-token last four',
);
assert(
  migration.includes('new.payment_interaction is distinct from old.payment_interaction') &&
    migration.includes('new.wallet_provider is distinct from old.wallet_provider') &&
    migration.includes('new.card_last4_provenance is distinct from old.card_last4_provenance'),
  'Every corrected matching fact must invalidate the stale fact version',
);
assert(
  migration.includes("'resulting_fact_version', updated_case_row.deterministic_fact_version") &&
    !migration.includes('result := public.service_apply_refund_wallet_correction('),
  'Secure wallet correction must apply one atomic fact version',
);
assert(
  intake.includes('card_last4_provenance:') &&
    intake.includes('? "wallet_device_token"') &&
    intake.includes(': "physical_card"'),
  'New form cases must persist last-four provenance at intake',
);

assert(
  operations.includes('customerFactEvidence') &&
    operations.includes('cardLast4Provenance'),
  'The manager response type must carry redacted source/time/provenance evidence',
);
assert(
  managerUi.includes('refund-customer-fact-evidence') &&
    managerUi.includes('verified customer email reply') &&
    managerUi.includes('no version-matched customer reply') &&
    managerUi.includes('wallet/device-token digits'),
  'Managers must see structured customer-fact source, time, version, and digit provenance',
);
assert(
  !migration.slice(
    migration.indexOf('create function public.admin_get_refund_operations_overview()'),
  ).includes('source_message_id') &&
    migration.includes("set search_path = ''") &&
    migration.includes("event.metadata ->> 'resulting_fact_version'") &&
    migration.includes('= refund_case.deterministic_fact_version') &&
    migration.includes("'payloadRedacted', true"),
  'The overview must stay redacted, use an empty search path, and bind exact fact versions',
);
assert(
  databaseTest.includes('advances the deterministic fact version exactly once') &&
    databaseTest.includes('cannot apply the same correction twice'),
  'Database replay must prove one version and idempotent token consumption',
);
assert(
  runbook.includes('Card type') &&
    runbook.includes('last-four provenance') &&
    qaChecklist.includes('verified customer email reply') &&
    qaChecklist.includes('wallet/device-token'),
  'Runbook and smoke QA must cover the structured correction contract',
);

console.log('Refund customer-correction persistence validation passed.');
