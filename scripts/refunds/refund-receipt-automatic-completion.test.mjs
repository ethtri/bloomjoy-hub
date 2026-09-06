import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const migration = read('supabase/migrations/20260906005234_refund_receipt_automatic_completion_kernel.sql');
const pgTap = read('supabase/tests/refund_receipt_automatic_completion.sql');
const concurrency = read('supabase/tests/refund_receipt_automatic_completion_concurrency.sql');
const reportBinding = read('supabase/migrations/20260904172349_nayax_report_original_refund_site_binding.sql');
const crossSite = read('supabase/migrations/20260905232428_refund_cross_site_review_linkage.sql');

test('automatic completion is authority-bound, exact, and least privilege', () => {
  assert.match(migration, /create table public\.refund_receipt_completion_automation_authorities/);
  assert.match(migration, /r\.observed_at<transaction_timestamp\(\)/);
  assert.match(migration, /source_kind='independently_validated_terminal_receipt_v1'/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.refund_receipt_completion_automation_authorities\s+from public,anon,authenticated,service_role/);
  assert.match(migration, /revoke all on function public\.refund_create_receipt_completion_automation_authority\(uuid,uuid,text\)\s+from public,anon,authenticated,service_role/);
  assert.match(migration, /grant execute on function public\.service_ensure_refund_receipt_automatic_completion\(uuid,uuid,uuid\)\s+to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.refund_create_receipt_completion_automation_authority/);
  assert.doesNotMatch(migration, /\b(auth\.role|auth\.uid)\s*\(/);
});

test('coordinator uses one case-first lock and the existing canonical contracts', () => {
  const fnStart = migration.indexOf('create function public.service_ensure_refund_receipt_automatic_completion');
  const fnEnd = migration.indexOf('\n$$;', fnStart);
  assert.ok(fnStart >= 0 && fnEnd > fnStart);
  const coordinator = migration.slice(fnStart, fnEnd);
  const caseLock = coordinator.indexOf('from public.refund_cases where id=p_case_id for update');
  const authorityRead = coordinator.indexOf('from public.refund_receipt_completion_automation_authorities');
  const receiptRead = coordinator.indexOf('from public.refund_authoritative_receipts');
  assert.ok(caseLock >= 0 && caseLock < authorityRead && authorityRead < receiptRead);
  assert.match(coordinator, /public\.refund_receipt_completion_copy\(c\.id\)/);
  assert.match(coordinator, /public\.refund_receipt_completion_message_digest\(to_jsonb\(m\)\)/);
  assert.match(coordinator, /public\.is_refund_receipt_completion_message\(to_jsonb\(m\)\)/);
  assert.match(coordinator, /from public\.refund_completion_notice_adoptions where receipt_id=r\.id/);
  assert.match(coordinator, /from public\.refund_external_notice_observations where receipt_id=r\.id/);
  assert.match(coordinator, /automatic_customer_contact_enabled/);
  assert.doesNotMatch(coordinator, /for update skip locked|\blimit\b|\bloop\b/);
});

test('migration cannot pay, date accounting, scan receipts, or classify reports', () => {
  assert.doesNotMatch(migration,
    /(?:insert into|update|delete from) public\.(?:refund_case_nayax_refund_attempts|sales_adjustment_facts|refund_authoritative_receipts)/i);
  assert.doesNotMatch(migration, /\b(?:net\.http|http_post|fetch|providerStatus|terminalEvidenceProven)\b/i);
  assert.doesNotMatch(migration, /service_record_nayax_scheduled_report|refund_nayax_scheduled_report/);
  assert.doesNotMatch(migration, /set\s+(?:refund_completed_at|reporting_adjustment_id|settled_at)\s*=/i);
  assert.equal([...migration.matchAll(/select \* into r from public\.refund_authoritative_receipts\s+where id=p_receipt_id and refund_case_id=(?:c\.id|p_case_id);/g)].length, 2);
  assert.doesNotMatch(migration, /(?:for\s+\w+\s+in\s+select|insert into public\.refund_receipt_completion_automation_authorities\s*\([^)]*\)\s*select)[\s\S]*from public\.refund_authoritative_receipts/i);
  for (const source of [reportBinding, crossSite]) {
    assert.match(source, /p_report->'terminalEvidenceProven' is distinct from 'false'::jsonb/);
    assert.match(source, /'terminal_evidence_proven',false/);
  }
});

test('focused pgTAP covers permissions, replay, races, and unknown accounting', () => {
  for (const marker of [
    'The service worker cannot mint immutable completion authority',
    'A later worker cannot grant authority to a historical receipt',
    'Crossed receipt identity cannot consume exact completion authority',
    'Crossed automation authority cannot enqueue for another receipt',
    'The database customer-contact gate stays fail closed',
    'A changed case version requires review instead of automatic completion',
    'Service replay returns the same canonical message',
    'A human queue winner is safely adopted as the canonical outcome',
    'Existing exact SENT-notice adoption wins without another message',
    'A standalone external observation wins without another message',
    'Receipt completion authority never creates a provider attempt',
    'Receipt completion authority never creates dated accounting',
    'Settlement evidence stays unknown',
  ]) assert.ok(pgTap.includes(marker), marker);
  for (const marker of [
    'Concurrent automatic completion waits for the exact case lock',
    'The waiting coordinator replays the committed canonical completion',
    'Concurrent coordinators return the same message identity',
    'Concurrent coordinators preserve exactly one intent',
    'The existing worker skips the uncommitted case and message',
  ]) assert.ok(concurrency.includes(marker), marker);
});
