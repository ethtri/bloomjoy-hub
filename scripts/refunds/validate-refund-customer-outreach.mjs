import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relativePath) => readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
const [migration, truthTest, concurrencyTest] = await Promise.all([
  read('supabase/migrations/20260910095126_refund_customer_outreach_truth.sql'),
  read('supabase/tests/refund_customer_outreach_truth.sql'),
  read('supabase/tests/refund_customer_outreach_concurrency.sql'),
]);

assert.match(migration, /create function public\.refund_customer_outreach_contract/);
assert.match(migration, /'schemaVersion', 'refund_customer_outreach_v1'/);
for (const state of [
  'none', 'preparing', 'queued', 'sent_unconfirmed', 'waiting_for_customer',
  'delivery_failed', 'delivery_unknown', 'customer_replied', 'rechecking',
  'clarification_exhausted', 'policy_suppressed', 'manual_fallback',
]) assert.match(migration, new RegExp(`'${state}'`));
assert.match(migration, /cycle_row\.request_message_id is not null[\s\S]*message\.id = cycle_row\.request_message_id[\s\S]*message\.follow_up_cycle_id = cycle_row\.id/);
assert.match(migration, /'clarificationLimit', 2/);
assert.match(migration, /'manualFallbackEligible', manual_fallback_eligible/);
assert.doesNotMatch(migration, /customer_outreach_manual_fallback/);
assert.match(migration, /follow_up_review:[\s\S]*:cash-no-match-incomplete:[\s\S]*deterministic_fact_version/);
assert.match(migration, /cash_match_evaluated_fact_version = case_row\.deterministic_fact_version/);
assert.match(migration, /current_cycle\.case_fact_version = case_row\.deterministic_fact_version/);
assert.match(migration, /alter function public\.refund_lifecycle_contract\(uuid\)[\s\S]*rename to refund_lifecycle_contract_pre_customer_outreach_v1/);
assert.match(migration, /alter function public\.admin_get_refund_operations_overview\(\)[\s\S]*rename to admin_get_refund_operations_overview_pre_customer_outreach_v1/);
assert.match(migration, /item -> 'lifecycle'/);
assert.match(migration, /base -> 'internalTestCases'/);
assert.match(migration, /\{failureCode\}[\s\S]*'null'::jsonb/);

assert.match(migration, /create function public\.service_settle_refund_follow_up_pre_message_suppression/);
assert.match(migration, /select cycle\.\* into cycle_row[\s\S]*for update;[\s\S]*select refund_case\.\* into case_row[\s\S]*for update;/);
assert.match(migration, /select settings\.\* into settings_row[\s\S]*for share/);
assert.match(migration, /automatic_customer_contact_enabled, false\) then[\s\S]*not durably disabled/);
assert.match(migration, /current_correctable_fields := coalesce/);
assert.match(migration, /cycle_row\.status <> 'claimed'/);
assert.match(migration, /cycle_row\.request_message_id is not null/);
assert.match(migration, /'automatic_customer_contact_disabled',[\s\S]*'automatic_customer_contact_paused',[\s\S]*'no_customer_correctable_fact'/);
assert.match(migration, /'refund_follow_up_pre_message_suppressed'/);
assert.match(migration, /'message_created', false/);
assert.match(migration, /grant execute on function public\.service_settle_refund_follow_up_pre_message_suppression\(uuid, uuid, text\)[\s\S]*to service_role/);
assert.doesNotMatch(migration, /grant execute on function public\.service_settle_refund_follow_up_pre_message_suppression[^;]+to (anon|authenticated)/);

assert.doesNotMatch(migration, /update public\.(refund_authoritative_receipts|refund_case_nayax_refund_attempts|sales_adjustment_facts)/i);
assert.doesNotMatch(migration, /insert into public\.(refund_authoritative_receipts|refund_case_nayax_refund_attempts|sales_adjustment_facts)/i);
assert.doesNotMatch(truthTest, /session_replication_role/);
assert.match(truthTest, /Newer-fact cycle wins over stale correction evidence/);
assert.match(truthTest, /#1290 lifecycle lookup truth is not recomputed away/);
assert.match(truthTest, /Final ordinary overview coexists with #1290 and redacts outreach failure detail/);
assert.match(truthTest, /Final Operations overview coexists with #1290 and retains redacted-class failure detail/);
assert.match(truthTest, /not durably disabled/);
assert.doesNotMatch(concurrencyTest, /session_replication_role/);
assert.match(concurrencyTest, /dblink_send_query\('outreach_message'/);
assert.match(concurrencyTest, /dblink_send_query\('outreach_settle'/);
assert.match(concurrencyTest, /Exactly one of real message creation or pre-message settlement wins/);

console.log('Refund customer-outreach database contract, truth, privilege, and concurrency validation passed.');
