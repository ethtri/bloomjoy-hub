import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../../supabase/migrations/20260828003503_refund_nayax_authoritative_journal_v3.sql',
  import.meta.url,
);
const testUrl = new URL(
  '../../supabase/tests/refund_nayax_authoritative_journal_v3.sql',
  import.meta.url,
);
const legacyRecoveryTestUrl = new URL(
  '../../supabase/tests/refund_nayax_pending_approval_recovery.sql',
  import.meta.url,
);
const productionSimplificationUrl = new URL(
  '../../supabase/migrations/20260830202234_refund_production_simplification.sql',
  import.meta.url,
);
const continuationMigrationUrl = new URL(
  '../../supabase/migrations/20260906202952_refund_attempt_continuation_outcomes.sql',
  import.meta.url,
);
const continuationTestUrl = new URL(
  '../../supabase/tests/refund_attempt_continuation_outcomes.sql',
  import.meta.url,
);

const [migration, test, legacyRecoveryTest, productionSimplification, continuationMigration, continuationTest] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(testUrl, 'utf8'),
  readFile(legacyRecoveryTestUrl, 'utf8'),
  readFile(productionSimplificationUrl, 'utf8'),
  readFile(continuationMigrationUrl, 'utf8'),
  readFile(continuationTestUrl, 'utf8'),
]);

const exactMarkers = [
  'nayax-provider-journal-v3',
  'nayax-production-account-contract-v2',
  'db-authoritative-exact-200-json-v1',
  'nayax-response-envelope-v1',
];
for (const marker of exactMarkers) {
  assert.match(migration, new RegExp(marker), `migration must publish ${marker}`);
  assert.match(test, new RegExp(marker), `pgTAP must verify ${marker}`);
}

assert.match(
  migration,
  /create function public\.service_get_nayax_refund_provider_journal_capability_v3\(/u,
);
assert.match(
  migration,
  /create function public\.service_record_nayax_refund_provider_stage_v3\(/u,
);
assert.match(
  migration,
  /create function public\.service_reserve_nayax_refund_manager_action_v3\(/u,
);
assert.doesNotMatch(
  migration,
  /(?:drop|alter) function public\.service_reserve_nayax_refund_manager_action_v2\(/iu,
  'v3 must not replace or rename the v2 reservation wrapper',
);
assert.doesNotMatch(
  migration,
  /(?:drop|alter) function public\.service_record_nayax_refund_provider_stage_v2\(/iu,
  'v3 must not replace or rename the v2 journal writer',
);

for (const legacyRecoveryRpc of [
  'service_record_nayax_refund_provider_stage',
  'service_reserve_nayax_pending_approval_recovery',
  'service_settle_nayax_pending_approval_recovery',
]) {
  assert.match(
    migration,
    new RegExp(
      `revoke execute on function public\\.${legacyRecoveryRpc}\\([\\s\\S]*?\\) from public, anon, authenticated, service_role;`,
      'u',
    ),
    `${legacyRecoveryRpc} must be revoked from service_role`,
  );
  assert.match(
    test,
    new RegExp(`not has_function_privilege\\([\\s\\S]*?${legacyRecoveryRpc}`, 'u'),
    `pgTAP must prove service_role cannot execute ${legacyRecoveryRpc}`,
  );
  assert.match(
    legacyRecoveryTest,
    new RegExp(
      String.raw`not has_function_privilege\('service_role',[\s\S]*?${legacyRecoveryRpc}`,
      'u',
    ),
    `historical recovery pgTAP must expect ${legacyRecoveryRpc} retirement`,
  );
}

assert.match(
  legacyRecoveryTest,
  /The retired service role cannot reserve a recovery/u,
  'historical recovery pgTAP must exercise the post-v3 permission denial',
);

for (const metadataField of [
  'http_accepted',
  'media_type_class',
  'body_kind',
  'body_length_bucket',
  'json_parsed',
  'body_json_object',
  'schema_matched',
  'result_key_present',
  'status_key_present',
  'result_value_type',
  'status_value_type',
  'semantic_pair_matched',
]) {
  assert.match(
    migration,
    new RegExp(`add column if not exists ${metadataField}`),
    `migration must add privacy-safe ${metadataField}`,
  );
}

assert.match(migration, /normalized_failure = 'response_read'/u);
assert.match(migration, /then 'provider_response_invalid'/u);
assert.match(migration, /p_http_status = 200/u);
assert.match(migration, /normalized_media_type = 'application_json'/u);
assert.match(migration, /p_schema_matched is true/u);
assert.match(migration, /p_semantic_pair_matched is true/u);
assert.match(migration, /normalized_outcome = 'accepted'/u);
assert.doesNotMatch(
  migration,
  /normalized_outcome = 'unknown'.{0,120}approval_authorized/su,
  'unknown outcomes must not authorize v3 approval',
);

for (const rpc of [
  'service_get_nayax_refund_provider_journal_capability_v3',
  'service_record_nayax_refund_provider_stage_v3',
  'service_reserve_nayax_refund_manager_action_v3',
]) {
  assert.match(
    migration,
    new RegExp(`revoke execute on function(?:\\s+public\\.)?${rpc}`, 'u'),
    `${rpc} must explicitly revoke execute`,
  );
  assert.match(
    migration,
    new RegExp(`grant execute on function(?:\\s+public\\.)?${rpc}`, 'u'),
    `${rpc} must explicitly grant service_role`,
  );
}

assert.match(
  migration,
  /journal_version not in \(\s*'nayax-provider-journal-v2',\s*'nayax-provider-journal-v3'/su,
  'historical account-hold coverage must remain readable for both journal versions',
);
assert.match(
  productionSimplification,
  /drop trigger if exists refund_nayax_account_circuit_breaker/su,
  'production must retire the account-wide circuit-breaker trigger',
);
assert.match(
  productionSimplification,
  /'blocked', false/su,
  'legacy account observability must never block an unrelated transaction',
);
assert.match(
  migration,
  /final_result\.journal_contract_version =\s*'nayax-provider-journal-v3'/su,
  'definitive rejection must recognize hardened v3 evidence',
);

for (const scenario of [
  'unknown-200',
  'json-suffix',
  'http-201',
  'malformed',
  'response-read',
  'rejected-v3',
  'unknown-v2',
]) {
  assert.match(test, new RegExp(`'${scenario}'`), `pgTAP must cover ${scenario}`);
}
assert.match(test, /select plan\(30\)/u);
assert.match(test, /select \* from finish\(\)/u);
assert.match(test, /rollback;/u);

for (const marker of [
  'refund_nayax_provider_business_outcomes',
  'refund_nayax_attempt_approval_continuations',
  'service_record_nayax_refund_provider_stage_v3_outcomes',
  'service_reserve_nayax_refund_approval_continuation_v1',
  'nayax-business-outcome-v2',
  'same-attempt-approval-continuation-v1',
]) {
  assert.match(continuationMigration, new RegExp(marker), `continuation migration must publish ${marker}`);
  assert.match(continuationTest, new RegExp(marker), `continuation pgTAP must verify ${marker}`);
}
assert.match(continuationMigration, /enable row level security/iu);
assert.match(
  continuationMigration,
  /revoke all on table public\.refund_nayax_provider_business_outcomes\s+from public, anon, authenticated, service_role;/u,
);
assert.match(
  continuationMigration,
  /request_result\.outcome = 'accepted'[\s\S]*request_result\.approval_authorized is true/u,
);
assert.match(continuationMigration, /attempt_row\.provider_claim_expires_at > statement_timestamp\(\)/u);
assert.match(continuationMigration, /approval_stage\.stage = 'approve'/u);
assert.match(continuationMigration, /current_context->>'machineAuthorizationTime' is distinct from execution_context->>'machineAuthorizationTime'/u);
assert.doesNotMatch(continuationMigration, /refund-request|\/payment\//u);
for (const scenario of [
  'Crash after proved request acceptance',
  'Duplicate click or concurrent worker',
  'Unknown or ambiguous request pair',
  'Request-not-proved',
  'Stale expected version',
  'Revoked manager authority',
  'Settlement-after-effect recovery',
  'Old Edge plus new database',
  'alphabetic names and secrets',
]) {
  assert.match(continuationTest, new RegExp(scenario), `continuation pgTAP must cover ${scenario}`);
}
assert.match(continuationTest, /select plan\(31\)/u);
assert.match(
  continuationMigration,
  /grant execute on function public\.service_record_nayax_refund_provider_stage_v3\([\s\S]*\) to service_role;/u,
  'rolling deploys must preserve the prior Edge journal-v3 recorder grant',
);

console.log(
  'Nayax journal v3 static validation passed: additive rollback compatibility, exact-200 application/json authorization, redacted response metadata, and focused pgTAP coverage are present.',
);
