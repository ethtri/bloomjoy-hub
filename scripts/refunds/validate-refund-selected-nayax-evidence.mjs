import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [migration, databaseTest, operations, managerUi, status, decisions, qa, runbook] =
  await Promise.all([
    read('supabase/migrations/20260901050000_refund_selected_nayax_transaction_evidence.sql'),
    read('supabase/tests/refund_selected_nayax_transaction_evidence.sql'),
    read('src/lib/refundOperations.ts'),
    read('src/pages/admin/Refunds.tsx'),
    read('Docs/CURRENT_STATUS.md'),
    read('Docs/DECISIONS.md'),
    read('Docs/QA_SMOKE_TEST_CHECKLIST.md'),
    read('Docs/PRODUCTION_RUNBOOK.md'),
  ]);

for (const field of [
  'transactionId',
  'saleAmountCents',
  'currencyCode',
  'machineLabel',
  'customerReportedAt',
  'providerAuthorizedAt',
  'machineTimezone',
  'cardLast4',
  'matchExplanation',
  'payloadRedacted',
]) {
  assert(migration.includes(`'${field}'`), `Selected transaction contract must include ${field}`);
}
assert(
  migration.includes('matched_nayax_transaction_id is not null') &&
    migration.includes('is_review_safe_nayax_transaction_reference') &&
    migration.includes('pre_selected_nayax_evidence_v1'),
  'The provider reference must come only from the existing safe selected transaction in the actor-scoped wrapper',
);
assert(
  !migration.includes("'providerPayload'") && !migration.includes("'accountToken'"),
  'The selected evidence projection must not include provider payloads or credentials',
);
assert(
  operations.includes("schemaVersion: 'refund_selected_nayax_transaction_v1'") &&
    operations.includes('requireRefundSelectedNayaxTransaction') &&
    operations.includes("evidence.payloadRedacted !== true") &&
    operations.includes('Unsupported selected Nayax transaction response.'),
  'The client must version, validate, and fail closed on malformed selected evidence',
);
for (const label of [
  'Selected Nayax transaction ID',
  'Copy ID',
  'Provider-confirmed sale',
  'Customer-reported time',
  'Provider machine-local time',
  'Safe card and wallet context',
  'Why this transaction was selected',
]) {
  assert(managerUi.includes(label), `Manager evidence card must render ${label}`);
}
assert(
  managerUi.includes('navigator.clipboard.writeText') &&
    managerUi.includes('Do not ask the customer to repeat purchase details.'),
  'The manager must be able to copy the ID and missing evidence must remain an internal exception',
);
assert(
  databaseTest.includes('Unselected candidate projections remain tokenized') &&
    databaseTest.includes('An unrelated manager cannot discover the case') &&
    databaseTest.includes("not evidence ? 'providerPayload'") &&
    databaseTest.includes("select plan(13)"),
  'Database coverage must prove scope, tokenization, redaction, and the complete contract',
);
for (const document of [status, decisions, qa, runbook]) {
  assert(
    document.includes('Selected Nayax transaction ID') ||
      document.includes('selected Nayax transaction') ||
      document.includes('selected provider transaction'),
    'Canonical status, policy, QA, and runbook docs must describe the selected transaction evidence contract',
  );
}

console.log('Selected Nayax transaction evidence validated.');
