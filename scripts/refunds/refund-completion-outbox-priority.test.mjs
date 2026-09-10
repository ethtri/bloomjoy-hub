import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const migration = read('supabase/migrations/20260910163735_refund_completion_outbox_priority_health.sql');
const sweep = read('supabase/functions/refund-case-automation-sweep/index.ts');
const outbox = read('supabase/functions/_shared/refund-manual-message-outbox.ts');
const pgTap = read('supabase/tests/refund_completion_outbox_priority_health.sql');
const concurrency = read('supabase/tests/refund_completion_outbox_priority_concurrency.sql');

test('coordinator returns a bounded, newly-created-only redacted identity set', () => {
  assert.match(migration, /newly_created_message_ids uuid\[\]:='\{\}'::uuid\[\]/);
  assert.match(migration, /elsif \(result->>'messageId'\) ~/);
  assert.match(migration, /newMessageIds',to_jsonb\(newly_created_message_ids\)/);
  assert.match(migration, /normalized_limit integer:=least\(greatest\(coalesce\(p_limit,10\),1\),25\)/);
  assert.doesNotMatch(migration, /newMessageIds'.*recipient|newMessageIds'.*caseId/i);
});

test('new completions exact-drain before generic recovery through the one shared atomic claim', () => {
  const queue = sweep.indexOf('await queueAutomaticReceiptCompletions(counters)');
  const exact = sweep.indexOf('runManualMessageOutboxSweep(counters, messageId, 1)');
  const generic = sweep.indexOf('await runManualMessageOutboxSweep(counters);', exact);
  assert.ok(queue >= 0 && queue < exact && exact < generic);
  assert.match(outbox, /service_claim_refund_manual_message_deliveries/);
  assert.match(outbox, /p_refund_case_message_id: messageId/);
  assert.match(migration, /for update of c skip locked/);
  assert.doesNotMatch(sweep.slice(queue, generic), /sendRefundTransactionalEmail|dispatchRefundCaseGmailReply/);
});

test('strict ID validation fails closed instead of widening to a generic claim', () => {
  assert.match(sweep, /result\.newMessageIds\.every/);
  assert.match(sweep, /newMessageIds\.length !== queued \|\| queued > 25/);
  assert.match(sweep, /invalid new-message identities/);
});

test('health is aggregate-only, permission-restricted, and covers every actionable class', () => {
  for (const key of [
    'sampleCount', 'queueToFirstProviderAttemptMedianSeconds',
    'queueToFirstProviderAttemptP95Seconds', 'agingQueuedCount',
    'staleClaimedCount', 'definiteFailedCount', 'deliveryUnknownCount',
    'disabledContactDeferralCount', 'missingRouteCount', 'payloadRedacted',
  ]) assert.ok(migration.includes(`'${key}'`), key);
  assert.match(migration, /revoke all on function public\.service_get_refund_completion_outbox_health\(\)[\s\S]*from public,anon,authenticated,service_role/);
  assert.match(migration, /grant execute on function public\.service_get_refund_completion_outbox_health\(\) to service_role/);
  assert.match(migration, /not \(observed_health \?\| array\['messageIds','caseIds','emails','recipients'\]\)/);
});

test('incident contract coalesces, reminds, and requires stable recovery', () => {
  assert.match(migration, /pg_advisory_xact_lock\(628,1266\)/);
  assert.match(migration, /last_notification_claimed_at<=now_at-interval '24 hours'/);
  assert.match(migration, /healthy_since>now_at-interval '60 minutes'/);
  assert.match(migration, /notificationType','initial'/);
  assert.match(migration, /notificationType','reminder'/);
  assert.match(migration, /notificationType','recovery'/);
  assert.match(sweep, /sendInternalEmail\(/);
  assert.match(sweep, /No customer names, email addresses, payment details, message IDs, case IDs/);
});

test('database tests cover replay, priority, crash semantics, privacy, and races', () => {
  for (const marker of [
    'health result is explicitly redacted',
    'first actionable observation claims one incident notification',
    'unchanged actionable health is coalesced',
    'daily reminder is bounded to the same incident',
    'stable health claims one recovery notification',
    'incident ledger is private from authenticated callers',
    'health RPC is private from authenticated callers',
  ]) assert.ok(pgTap.includes(marker), marker);
  for (const marker of [
    'The bounded sweep returns the one newly-created canonical completion identity',
    'Replay returns no newly-created priority identity',
    'Adoption, observation, and suppressed authorities return no new priority identities',
  ]) assert.ok(read('supabase/tests/refund_receipt_automatic_completion.sql').includes(marker), marker);
  for (const marker of [
    'concurrent notification claims coalesce to one initial action',
    'concurrent claims preserve one open incident',
  ]) assert.ok(concurrency.includes(marker), marker);
  const completionConcurrency = read('supabase/tests/refund_receipt_automatic_completion_concurrency.sql');
  assert.ok(completionConcurrency.includes('Exact and generic concurrent drains claim the canonical completion once'));
  assert.ok(completionConcurrency.includes('claim race creates no provider effect before the shared transport boundary'));
  const deliveryUnit = read('supabase/functions/_shared/refund-manual-message-outbox.test.ts');
  assert.ok(deliveryUnit.includes('mark-only automatic crash cannot send after env shutdown'));
  assert.ok(deliveryUnit.includes('started automatic delivery reaches Gmail sent or unknown reconciliation after env shutdown'));
});

test('priority slice cannot alter payment, receipt, accounting, templates, or retry identity', () => {
  assert.doesNotMatch(migration, /(?:insert into|update|delete from) public\.(?:refund_case_nayax_refund_attempts|refund_authoritative_receipts|sales_adjustment_facts)/i);
  assert.doesNotMatch(migration, /net\.http|refund_amount|provider_status\s*=/i);
  assert.doesNotMatch(migration, /create or replace function public\.service_finish_refund_manual_message_delivery/);
  assert.doesNotMatch(migration, /create or replace function public\.service_mark_refund_manual_message_provider_attempt/);
});
