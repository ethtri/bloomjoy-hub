import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [migration, timeMigration, optionalRationaleMigration, databaseTest, selectionTest, adminUpdate, operations, managerUi, status, workflow, procedure, qa, runbook] =
  await Promise.all([
    read('supabase/migrations/20260901050000_refund_selected_nayax_transaction_evidence.sql'),
    read('supabase/migrations/20260914193919_refund_candidate_time_semantics.sql'),
    read('supabase/migrations/20260919185714_refund_optional_candidate_rationale.sql'),
    read('supabase/tests/refund_selected_nayax_transaction_evidence.sql'),
    read('supabase/tests/refund_contactless_review_selection.sql'),
    read('supabase/functions/refund-case-admin-update/index.ts'),
    read('src/lib/refundOperations.ts'),
    read('src/pages/admin/Refunds.tsx'),
    read('Docs/CURRENT_STATUS.md'),
    read('Docs/REFUND_WORKFLOW.md'),
    read('Docs/REFUND_AGENT_OPERATIONS.md'),
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
  'Provider machine clock',
  'Card or wallet details',
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
  timeMigration.includes("'candidateTimeContractVersion'") &&
    timeMigration.includes("'refund_candidate_time_v1'") &&
    timeMigration.includes("'incidentLocalDateTime'") &&
    timeMigration.includes("'providerTimestampAt'") &&
    timeMigration.includes("'payloadRedacted', true") &&
    timeMigration.includes('refund_safe_timezone_v1') &&
    timeMigration.includes('matched_nayax_site_id') &&
    timeMigration.includes("'2026-09-13.v12'") &&
    timeMigration.includes('refund_nayax_request_boundary_evidence_state_pre_candidate_time_v1'),
  'The timestamp extension must stay versioned, event-specific, and redacted',
);
assert(
  !/pg_catalog\.(?:coalesce|nullif|greatest|least)\s*\(/i.test(timeMigration),
  'PostgreSQL conditional expressions must use SQL syntax rather than invalid pg_catalog function qualification',
);
assert(
  timeMigration.includes('refund_nayax_candidate_id_state_pre_time_v1') &&
    timeMigration.includes('refund_nayax_candidate_id_state_time_v1') &&
    timeMigration.includes("if p_evidence ->> 'policy_version' = '2026-09-13.v12' then"),
  'The v12 manager-selection rules must dispatch separately without reinterpreting retained v11 evidence',
);
assert(
  databaseTest.includes('Unselected candidate projections remain tokenized') &&
    databaseTest.includes('An unrelated manager cannot discover the case') &&
    databaseTest.includes("not evidence ? 'providerPayload'") &&
    databaseTest.includes('full immutable sale identity') &&
    databaseTest.includes('without hiding the manager queue') &&
    databaseTest.includes("select plan(22)"),
  'Database coverage must prove scope, tokenization, redaction, and the complete contract',
);
assert(
  selectionTest.includes("select plan(30)") &&
    selectionTest.includes('The database accepts the current v12 bounded identifier contract') &&
    selectionTest.includes('Rough DST-gap and noncomparable time remains selectable') &&
    selectionTest.includes('without a rationale hard stop') &&
    selectionTest.includes('Unsupported closer-time context is omitted') &&
    optionalRationaleMigration.includes('optional audit context') &&
    optionalRationaleMigration.includes("nullif(normalized_disagreement_reason, '')") &&
    timeMigration.includes('$manager_selection_v12$'),
  'Database coverage must preserve v12 scorer/save parity without making optional rationale authoritative',
);
assert(
  adminUpdate.includes('The rationale is optional audit context') &&
    adminUpdate.includes('nayaxDisagreementReason = ""') &&
    !adminUpdate.includes('Choose why this alternate Nayax transaction is the correct one.') &&
    !adminUpdate.includes('nayax_time_not_comparable'),
  'The Edge boundary must degrade unsupported optional rationale instead of rejecting a valid selection',
);
assert(
  managerUi.includes('refundCandidateTimeSourceDetail') &&
    managerUi.includes('refundCustomerTimeDisplay') &&
    managerUi.includes('candidate.providerTimestampAt ?? candidate.authorizedAt') &&
    managerUi.includes('Customer-entered local time · no instant inferred'),
  'The manager UI must show bounded source/resolution details, use the explicit provider timestamp, and preserve DST wall-clock input',
);
for (const [name, document] of [
  ['current status', status],
  ['refund workflow', workflow],
  ['agent procedure', procedure],
  ['QA checklist', qa],
  ['production runbook', runbook],
]) {
  assert(
    document.includes('Selected Nayax transaction ID') ||
      document.includes('selected Nayax transaction') ||
      document.includes('selected provider transaction') ||
      document.includes('selected transaction'),
    `${name} must describe the selected transaction evidence contract`,
  );
}

console.log('Selected Nayax transaction evidence validated.');
