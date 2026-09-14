#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260913201714_sunze_cash_source_readiness.sql');
const intake = read('supabase/functions/refund-case-intake/index.ts');
const ingest = read('supabase/functions/sunze-sales-ingest/index.ts');
const sync = read('scripts/sunze/sync-orders.mjs');
const sqlTest = read('supabase/tests/refund_sunze_cash_readiness.sql');
const followUp = read('supabase/migrations/202608030005_refund_deterministic_follow_up_cycles.sql');

for (const state of [
  'checking_sales_history',
  'sale_found',
  'multiple_possible_sales',
  'no_sale_found_with_complete_coverage',
  'sales_history_unavailable',
]) {
  assert.match(migration, new RegExp(`'${state}'`), `${state} must be constrained server-side`);
  assert.match(sqlTest, new RegExp(`'${state}'`), `${state} must have a database fixture`);
}

assert.match(migration, /primary key \(reporting_machine_id, import_run_id\)/u);
assert.doesNotMatch(migration, /least\(target\.coverage_started_at/u);
assert.doesNotMatch(migration, /greatest\(target\.covered_through/u);
assert.match(sqlTest, /Disjoint import intervals never fabricate continuous coverage/u);
assert.match(migration, /timestamp_proof_scope = 'account'/u);
assert.match(migration, /run\.meta ->> 'timestamp_proof_scope' = 'account'/u);
assert.match(migration, /security_invoker = true/u);
assert.match(migration, /revoke all on table public\.sunze_cash_source_watermarks from public, anon, authenticated/u);
assert.match(migration, /grant execute on function public\.service_match_sunze_cash_sale[\s\S]*to service_role/u);
assert.match(migration, /create unique index refund_cases_completed_sunze_sale_unique_idx/u);
assert.doesNotMatch(
  migration,
  /fact\.net_sales_cents = p_amount_cents/u,
  'Reported amount must remain advisory rather than filtering reviewed Sunze sales',
);
assert.match(sqlTest, /One exact Sunze sale cannot complete a second non-duplicate case/u);
assert.match(intake, /service_correlate_sunze_cash_case/u);
assert.doesNotMatch(intake, /\.from\("machine_sales_facts"\)[\s\S]*\.eq\("payment_method", "cash"\)/u);
assert.match(intake, /cash_match_evaluated_fact_version: null/u);
assert.match(
  followUp,
  /correlation_status = 'no_match'[\s\S]*cash_match_evaluated_fact_version = case_row\.deterministic_fact_version/u,
  'Null evaluation versions cannot trigger or repeat deterministic cash no-match outreach',
);
assert.match(ingest, /service_record_sunze_cash_watermarks/u);
assert.match(sync, /SUNZE_PAYMENT_TIME_SEMANTICS_STATUS/u);
assert.match(sync, /SUNZE_PAYMENT_TIME_PROOF_SCOPE/u);
assert.match(sync, /SUNZE_PAYMENT_TIME_TIMEZONE/u);

console.log('Sunze cash readiness contract validated.');
