import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const [historicalJournal, current, regression, sweep] = await Promise.all([
  read('supabase/migrations/20260828003503_refund_nayax_authoritative_journal_v3.sql'),
  read('supabase/migrations/20260913090000_refund_single_manager_gate.sql'),
  read('supabase/tests/refund_single_manager_gate.sql'),
  read('supabase/functions/refund-case-automation-sweep/index.ts'),
]);

for (const marker of [
  'nayax-provider-journal-v3',
  'nayax-production-account-contract-v2',
  'db-authoritative-exact-200-json-v1',
  'nayax-response-envelope-v1',
]) assert.match(historicalJournal + current, new RegExp(marker));

assert.match(current, /service_claim_due_nayax_refund_attempts_v1/);
assert.match(current, /service_reclaim_nayax_refund_attempt_no_call_v1/);
assert.match(current, /j\.event='started'/);
assert.match(current, /status='manual_review'/);
assert.match(current, /service_hold_nayax_refund_attempt_v1/);
assert.match(sweep, /service_record_nayax_refund_provider_stage_v4_diagnostics/);
assert.doesNotMatch(sweep, /approval_continuation|pending_approval_recovery/);
for (const retired of [
  'service_reserve_nayax_pending_approval_recovery',
  'service_settle_nayax_pending_approval_recovery',
  'service_claim_due_nayax_approval_continuations_v1',
]) {
  assert.match(current, new RegExp(`revoke all on function public\\.${retired}`));
}
assert.match(regression, /expired no-start claim resets the same row and generation/);
assert.match(regression, /provider-started claim becomes a permanent hold/);

console.log('Nayax journal v3 validation passed: the historical journal feeds one current System-owned queue with no continuation or retry writer.');
