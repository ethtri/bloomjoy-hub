import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const migration = read('supabase/migrations/20260906005234_refund_receipt_automatic_completion_kernel.sql');
const pgTap = read('supabase/tests/refund_receipt_automatic_completion.sql');
const concurrency = read('supabase/tests/refund_receipt_automatic_completion_concurrency.sql');
const reportBinding = read('supabase/migrations/20260904172349_nayax_report_original_refund_site_binding.sql');
const crossSite = read('supabase/migrations/20260905232428_refund_cross_site_review_linkage.sql');
const sweep = read('supabase/functions/refund-case-automation-sweep/index.ts');
const outbox = read('supabase/functions/_shared/refund-manual-message-outbox.ts');
const gmailTransport = read('supabase/functions/_shared/refund-gmail-transport.ts');
const transactional = read('supabase/functions/_shared/refund-transactional-delivery.ts');
const coreDispatch = read('supabase/migrations/20260902182311_refund_all_message_delivery_bookkeeping.sql');

test('automatic completion is authority-bound, exact, and least privilege', () => {
  assert.match(migration, /create table public\.refund_receipt_completion_automation_authorities/);
  assert.match(migration, /add column creation_transaction_id xid8 not null default pg_current_xact_id\(\)/);
  assert.match(migration, /r\.creation_transaction_id is distinct from pg_current_xact_id\(\)/);
  assert.doesNotMatch(migration, /r\.observed_at\s*[<>=]/);
  assert.match(migration, /source_kind in \('nayax_api_terminal','nayax_report_terminal'\)/);
  assert.match(migration, /source_policy='verified_terminal_refund_v1'/);
  assert.match(migration, /source_event_digest text not null unique/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.refund_receipt_completion_automation_authorities\s+from public,anon,authenticated,service_role/);
  assert.match(migration, /revoke all on function public\.refund_create_receipt_completion_automation_authority\(uuid,uuid,text,text,text\)\s+from public,anon,authenticated,service_role/);
  assert.match(migration, /grant execute on function public\.service_ensure_refund_receipt_automatic_completion\(uuid,uuid,uuid\)\s+to service_role/);
  assert.match(migration, /grant execute on function public\.service_mark_refund_manual_message_provider_attempt\(uuid,uuid\)\s+to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.refund_create_receipt_completion_automation_authority/);
  const authorityStart = migration.indexOf(
    'create function public.refund_create_receipt_completion_automation_authority',
  );
  const authorityEnd = migration.indexOf('\n$$;', authorityStart);
  assert.ok(authorityStart >= 0 && authorityEnd > authorityStart);
  assert.doesNotMatch(
    migration.slice(authorityStart, authorityEnd),
    /\b(auth\.role|auth\.uid)\s*\(/,
  );
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

test('receipt accounting separates payment truth from delivery polling and provider hold', () => {
  const fnStart = migration.indexOf('create function public.refund_lifecycle_contract(p_refund_case_id uuid)');
  const fnEnd = migration.indexOf('\n$$;', fnStart);
  assert.ok(fnStart >= 0 && fnEnd > fnStart);
  const lifecycle = migration.slice(fnStart, fnEnd);
  assert.match(lifecycle, /public\.refund_lifecycle_contract_pre_receipt_accounting_v1\(p_refund_case_id\)/);
  assert.match(lifecycle, /'paymentWorkComplete',true/);
  assert.match(lifecycle, /'accountingState',jsonb_build_object\(/);
  assert.match(lifecycle, /'state','pending','owner','Refund Operations','settlementTimePrecision','unknown'/);
  assert.match(lifecycle, /'settledAt',null,'blocksPaymentCompletion',false,'blocksCustomerNotice',false/);
  assert.match(lifecycle, /'bucket','accounting_review'/);
  assert.match(lifecycle, /'label','Refund confirmed · accounting review','nextAction','review_accounting_date'/);
  assert.doesNotMatch(lifecycle, /'terminal'|'refreshAfterSeconds'|'stage'|'messageState'/);
});

test('receipt accounting visibility is projected after manager authorization on list and direct reads', () => {
  const projectionStart = migration.indexOf('create function public.refund_project_receipt_lifecycle_for_manager');
  const projectionEnd = migration.indexOf('\n$$;', projectionStart);
  const projection = migration.slice(projectionStart, projectionEnd);
  assert.ok(projectionStart >= 0 && projectionEnd > projectionStart);
  assert.match(projection, /p_lifecycle-'accountingState'-'paymentWorkComplete'/);
  assert.match(projection, /'managerVisibility','restricted'/);
  assert.match(projection, /'bucket',projected_bucket/);
  assert.match(projection, /projected_bucket:=case when notice_complete then 'completed' else 'in_progress' end/);
  assert.match(projection, /'owner','System','safeRetryEligible',false/);
  assert.match(projection, /'terminal',notice_complete/);
  assert.match(projection, /'refreshAfterSeconds',case when notice_complete then null else 5 end/);
  assert.doesNotMatch(projection, /'owner','Refund Operations'|'review_accounting_date'/);

  const overviewStart = migration.indexOf('create function public.admin_get_refund_operations_overview()');
  const overviewEnd = migration.indexOf('\n$$;', overviewStart);
  const overview = migration.slice(overviewStart, overviewEnd);
  assert.match(overview, /admin_get_refund_operations_overview_pre_receipt_visibility_v1\(\)/);
  assert.match(overview, /actor_role='service_role'/);
  assert.match(overview, /public\.is_super_admin\(auth\.uid\(\)\) is true/);
  assert.match(overview, /refund_project_receipt_cases_for_manager/);

  const directStart = migration.indexOf('create or replace function public.get_refund_lifecycle_for_manager');
  const directEnd = migration.indexOf('\n$$;', directStart);
  const direct = migration.slice(directStart, directEnd);
  assert.match(direct, /auth\.uid\(\)/);
  assert.match(direct, /public\.can_manage_refund_case\(actor_user_id,p_refund_case_id\)/);
  assert.match(direct, /public\.is_super_admin\(actor_user_id\) is true/);
  assert.match(direct, /refund_project_receipt_lifecycle_for_manager/);

  assert.match(pgTap, /Service automation retains the full canonical accounting lifecycle/);
  assert.match(pgTap, /current super admin direct read retains Refund Operations accounting review/);
  assert.match(pgTap, /scoped manager raw lifecycle contains no internal accounting queue/);
  assert.match(pgTap, /scoped manager overview\/search cannot recover internal accounting details/);
});

test('migration cannot pay, date accounting, scan receipts, or classify reports', () => {
  assert.doesNotMatch(migration,
    /(?:insert into|update|delete from) public\.(?:refund_case_nayax_refund_attempts|sales_adjustment_facts|refund_authoritative_receipts)/i);
  assert.doesNotMatch(migration, /\b(?:net\.http|http_post|fetch|providerStatus|terminalEvidenceProven)\b/i);
  assert.doesNotMatch(migration, /service_record_nayax_scheduled_report|refund_nayax_scheduled_report/);
  assert.doesNotMatch(migration, /set\s+(?:refund_completed_at|reporting_adjustment_id|settled_at)\s*=/i);
  assert.equal([...migration.matchAll(/select \* into r from public\.refund_authoritative_receipts\s+where id=p_receipt_id and refund_case_id=(?:c\.id|p_case_id);/g)].length, 2);
  for (const source of [reportBinding, crossSite]) {
    assert.match(source, /p_report->'terminalEvidenceProven' is distinct from 'false'::jsonb/);
    assert.match(source, /'terminal_evidence_proven',false/);
  }
});

test('bounded scheduler consumes authority rows and never discovers receipts', () => {
  const start = migration.indexOf('create function public.service_ensure_refund_receipt_automatic_completions');
  const end = migration.indexOf('\n$$;', start);
  const scheduler = migration.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(scheduler, /from public\.refund_cases c[\s\S]*join public\.refund_receipt_completion_automation_authorities a/);
  assert.match(scheduler, /limit normalized_limit[\s\S]*for update of c skip locked/);
  assert.match(scheduler, /c\.official_action_version=a\.expected_case_version/);
  assert.match(scheduler, /lower\(btrim\(coalesce\(c\.customer_email,''\)\)\)/);
  assert.match(scheduler, /not exists\(select 1 from public\.refund_case_messages message[\s\S]*message\.message_type='completed'[\s\S]*message\.manual_delivery_state in \('queued','claimed','delivery_unknown'\)[\s\S]*limit normalized_limit/);
  assert.doesNotMatch(scheduler, /from public\.refund_authoritative_receipts/);
});

test('automatic authority remains explicit through queue, claim, and attempt marks', () => {
  assert.match(migration, /m\.delivery_kind:='automatic'/);
  assert.match(migration, /p_delivery_kind is distinct from m\.delivery_kind/);
  assert.match(migration, /is_refund_receipt_automatic_completion_message\(message_row\.id\)/);
  assert.match(migration, /manual_delivery_provider_attempted_at is not null[\s\S]*replayed',true[\s\S]*message_row\.delivery_kind='automatic'/);
  assert.match(migration, /m\.delivery_kind='automatic'[\s\S]*automatic_customer_contact_enabled/);
  assert.match(outbox, /delivery_kind,[\s\S]*deliveryKind: message\.delivery_kind/);
  assert.match(outbox, /Deno\.env\.get\("REFUND_AUTOMATION_ENABLED"\)/);
  assert.match(outbox, /refundOutboxAutomaticSendGate\s*=\s*\([\s\S]*automaticRefundCustomerContactEnabled\(\)/);
  assert.doesNotMatch(gmailTransport, /automaticOperationStarted/);
  assert.ok(gmailTransport.indexOf('if (!claim.claimed)') <
    gmailTransport.lastIndexOf('automaticRefundProviderSendGate()'));
  assert.ok(gmailTransport.lastIndexOf('automaticRefundProviderSendGate()') <
    gmailTransport.indexOf('sendRefundGmailReply({'));
  assert.ok(outbox.indexOf('automaticTransactionalRecovery(message)') <
    outbox.indexOf('markProviderAttempt(supabase, reference)'));
  assert.match(transactional, /result\.status === "automatic_contact_disabled"/);
  assert.match(migration, /for update;\s+perform public\.assert_no_active_refund_owner_resolution\(case_id\);\s+select \* into message_row/);
});

test('terminal automatic exception is exact and generic automatic work stays denied', () => {
  assert.match(migration, /authority_bound_completion boolean:=false/);
  assert.match(migration, /public\.is_refund_receipt_automatic_completion_message\(m\.id\)/);
  assert.match(migration, /and not authority_bound_completion then[\s\S]*'terminal_case'/);
  assert.match(migration, /delivery_kind='automatic'[\s\S]*template_version='refund_receipt_completion_v1'/);
});

test('sent and unknown Gmail evidence reconciles before fresh-send shutdown gates', () => {
  const start = coreDispatch.indexOf('create or replace function public.service_claim_refund_gmail_outbound_v3');
  const end = coreDispatch.indexOf('\n$$;', start);
  const claim = coreDispatch.slice(start, end);
  assert.ok(claim.indexOf('from public.refund_gmail_messages') <
    claim.indexOf('service_authorize_refund_customer_outbound'));
  assert.match(migration, /manual_delivery_provider_attempted_at is not null[\s\S]*'replayed',true/);
});

test('sweep gates bounded receipt queueing before the shared outbox', () => {
  assert.match(sweep, /automationEnabled[\s\S]*policyWindowIsOpen\(scheduledAt\)[\s\S]*automaticCustomerContactAllowed\(\)/);
  assert.ok(sweep.indexOf('await queueAutomaticReceiptCompletions(counters)') <
    sweep.indexOf('await runManualMessageOutboxSweep(counters)'));
});

test('focused pgTAP covers permissions, replay, races, and unknown accounting', () => {
  assert.match(pgTap,
    /create function pg_temp\.ensure\(n integer\) returns jsonb language plpgsql\s+security definer set search_path='' as/);
  assert.match(pgTap,
    /create function pg_temp\.ensure_triplet\(case_n integer,receipt_n integer,authority_n integer\)\s+returns jsonb language plpgsql security definer set search_path='' as/);
  for (const marker of [
    'Manual outbox provider mark preserves the owner-resolution stop',
    'The service worker cannot mint immutable completion authority',
    'Crossed receipt identity cannot consume exact completion authority',
    'Crossed automation authority cannot enqueue for another receipt',
    'The database customer-contact gate stays fail closed',
    'A changed case version requires review instead of automatic completion',
    'A bounded authority sweep queues the valid case',
    'A review-required case does not consume the bounded candidate window',
    'Service replay returns the same canonical message',
    'Queued automatic completion marks payment work complete',
    'Queued automatic completion keeps unknown-date accounting separate and nonblocking',
    'Receipt accounting preserves the existing terminal state',
    'Queued automatic completion keeps polling',
    'Authoritative payment leaves the provider hold queue',
    'Unknown-date accounting enters its truthful Refund Operations queue',
    'Receipt accounting preserves the existing message state',
    'A receipt without a completion intent keeps the missing notice observable',
    'A failed pre-provider notice remains observable and polling',
    'An unknown delivery remains observable and polling',
    'An adopted sent notice remains observable while accounting stays open',
    'A human queue winner is safely adopted as the canonical outcome',
    'Existing exact SENT-notice adoption wins without another message',
    'A standalone external observation wins without another message',
    'Receipt completion authority never creates a provider attempt',
    'Receipt completion authority never creates dated accounting',
    'Settlement evidence stays unknown',
  ]) assert.ok(pgTap.includes(marker), marker);
  for (const marker of [
    'Concurrent automatic completion waits for the exact case lock',
    'The separately committed receipt records the writer transaction identity',
    'A producer transaction cannot mint authority from a receipt committed by another transaction',
    'Cross-transaction receipt interleaving creates no completion authority',
    'The waiting coordinator replays the committed canonical completion',
    'Concurrent coordinators return the same message identity',
    'Concurrent coordinators preserve exactly one intent',
    'The existing worker skips the uncommitted case and message',
  ]) assert.ok(concurrency.includes(marker), marker);
});
