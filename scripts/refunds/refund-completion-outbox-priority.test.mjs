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

test('canonical insert schedules one post-commit exact wakeup with scheduled fallback', () => {
  assert.match(migration, /after insert on public\.refund_case_messages/);
  assert.match(migration, /public\.is_refund_receipt_automatic_completion_message\(new\.id\)/);
  assert.match(migration, /'mode','completion_wakeup','messageId',p_message_id/);
  assert.match(migration, /exception when others then[\s\S]*'dispatch_unavailable'/);
  assert.match(migration, /service_dispatch_refund_completion_wakeup\(p_message_id uuid\)[\s\S]*set search_path=''/);
  assert.match(migration, /pg_catalog\.jsonb_build_object/);
  assert.doesNotMatch(migration, /service_dispatch_refund_completion_wakeup\(p_message_id uuid\)[\s\S]{0,200}set search_path='public'/);
  assert.match(sweep, /mode === "completion_wakeup"/);
  assert.match(sweep, /drainRefundManualMessageOutbox\(\{[\s\S]*messageId,[\s\S]*limit: 1/);
  assert.match(sweep, /already_claimed_or_deferred/);
  assert.doesNotMatch(sweep.slice(sweep.indexOf('if (mode === "completion_wakeup")'),
    sweep.indexOf('const now = new Date()', sweep.indexOf('if (mode === "completion_wakeup")'))),
    /runManualMessageOutboxSweep\(counters\)|queueAutomaticReceiptCompletions/);
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
    'disabledContactDeferralCount', 'missingRouteCount',
    'databaseAutomaticContactEnabled', 'runtimeAutomationEnabled',
    'runtimeAutomaticContactEnabled', 'runtimeManualOutboxEnabled', 'payloadRedacted',
  ]) assert.ok(migration.includes(`'${key}'`), key);
  assert.match(migration, /revoke all on function public\.service_get_refund_completion_outbox_health\(text\[\],boolean,boolean,boolean\)[\s\S]*from public,anon,authenticated,service_role/);
  assert.match(migration, /grant execute on function public\.service_get_refund_completion_outbox_health\(text\[\],boolean,boolean,boolean\) to service_role/);
  assert.match(migration, /not \(observed_health \?\| array\['messageIds','caseIds','emails','recipients'\]\)/);
});

test('incident contract coalesces, reminds, and requires stable recovery', () => {
  assert.match(migration, /pg_advisory_xact_lock\(628,1266\)/);
  assert.match(migration, /last_notification_sent_at<=now_at-interval '24 hours'/);
  assert.match(migration, /last_notified_signature is distinct from signature/);
  assert.match(migration, /notification_claimed_at>now_at-interval '5 minutes'/);
  assert.match(migration, /healthy_since>now_at-interval '60 minutes'/);
  assert.match(migration, /when incident\.initial_notification_sent_at is null then 'initial'/);
  assert.match(migration, /then 'changed'/);
  assert.match(migration, /then 'reminder'/);
  assert.match(migration, /next_type:='recovery'/);
  assert.match(migration, /service_settle_refund_completion_outbox_notification/);
  assert.match(sweep, /sendInternalEmail\(/);
  assert.match(sweep, /p_outcome: "sent"/);
  assert.match(sweep, /p_outcome: "failed"/);
  assert.match(sweep, /providerIdempotencyKey/);
  assert.match(sweep, /No customer names, email addresses, payment details, message IDs, case IDs/);
});

test('database tests cover replay, priority, crash semantics, privacy, and races', () => {
  for (const marker of [
    'first actionable observation claims one incident notification',
    'unchanged actionable health is coalesced',
    'daily reminder is bounded to the same incident',
    'stable health claims one recovery notification',
    'failed initial alert rearms promptly',
    'stale crashed alert claim is reclaimed promptly',
    'materially changed actionable health claims a bounded update alert',
    'failed recovery alert rearms promptly',
    'incident ledger is private from authenticated callers',
    'health RPC is private from authenticated callers',
  ]) assert.ok(pgTap.includes(marker), marker);
  for (const marker of [
    'The bounded sweep returns the one newly-created canonical completion identity',
    'Replay returns no newly-created priority identity',
    'Adoption, observation, and suppressed authorities return no new priority identities',
  ]) assert.ok(read('supabase/tests/refund_receipt_automatic_completion.sql').includes(marker), marker);
  assert.ok(read('supabase/tests/refund_receipt_automatic_completion.sql')
    .includes('disable trigger refund_completion_outbox_postcommit_wakeup'));
  for (const marker of [
    'Seeded completion health calculates exact median latency',
    'Seeded completion health calculates exact p95 latency',
    'The 60-second boundary is healthy',
    'The 10-minute boundary is healthy',
    'Runtime automation shutdown',
    'Runtime automatic-contact shutdown',
    'Runtime manual-outbox shutdown',
    'Database automatic-contact shutdown',
    'Mailbox collisions make every current queued or claimed route explicit',
    'A post-drain failed row retains route classification after the current route is valid',
    'Post-drain route health exposes only the aggregate and never the raw route error',
    'The credential-bearing wakeup dispatcher has an empty search path',
  ]) assert.ok(read('supabase/tests/refund_receipt_automatic_completion.sql').includes(marker), marker);
  for (const marker of [
    'concurrent notification claims coalesce to one initial action',
    'concurrent claims preserve one open incident',
  ]) assert.ok(concurrency.includes(marker), marker);
  const completionConcurrency = read('supabase/tests/refund_receipt_automatic_completion_concurrency.sql');
  assert.ok(completionConcurrency.includes('disable trigger refund_completion_outbox_postcommit_wakeup'));
  assert.ok(completionConcurrency.includes('Exact and generic concurrent drains claim the canonical completion once'));
  assert.ok(completionConcurrency.includes('claim race creates no provider effect before the shared transport boundary'));
  const deliveryUnit = read('supabase/functions/_shared/refund-manual-message-outbox.test.ts');
  assert.ok(deliveryUnit.includes('mark-only automatic crash cannot send after env shutdown'));
  assert.ok(deliveryUnit.includes('started automatic delivery reaches Gmail sent or unknown reconciliation after env shutdown'));
});

test('priority slice cannot alter payment, receipt, accounting, templates, or retry identity', () => {
  assert.doesNotMatch(migration, /(?:insert into|update|delete from) public\.(?:refund_case_nayax_refund_attempts|refund_authoritative_receipts|sales_adjustment_facts)/i);
  assert.doesNotMatch(migration, /refund_amount|provider_status\s*=/i);
  assert.doesNotMatch(migration, /create or replace function public\.service_finish_refund_manual_message_delivery/);
  assert.doesNotMatch(migration, /create or replace function public\.service_mark_refund_manual_message_provider_attempt/);
});
