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

const [migration, test] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(testUrl, 'utf8'),
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
  'the account hold must protect both v2 and v3 reservations',
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
assert.match(test, /select plan\(29\)/u);
assert.match(test, /select \* from finish\(\)/u);
assert.match(test, /rollback;/u);

console.log(
  'Nayax journal v3 static validation passed: additive rollback compatibility, exact-200 application/json authorization, redacted response metadata, and focused pgTAP coverage are present.',
);
