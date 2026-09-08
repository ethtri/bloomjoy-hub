import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const migration = read('supabase/migrations/20260908151153_refund_terminal_receipt_case_completion.sql');
const nayaxFunction = read('supabase/functions/nayax-card-refund/index.ts');
const completionHelper = read('supabase/functions/_shared/nayax-resolution-completion.ts');
const originalClaim = read('supabase/migrations/202608040004_refund_nayax_provider_orchestration.sql');

const functionBody = (source, marker) => {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, marker);
  const end = source.indexOf('\n$$;', start);
  assert.ok(end > start, marker);
  return source.slice(start, end);
};

test('exact API approval evidence writes payment truth before notice delivery', () => {
  const proof = functionBody(migration,
    'create function public.refund_nayax_api_terminal_evidence_proved');
  for (const evidence of [
    "request_journal.http_status=200",
    "request_journal.outcome='accepted'",
    'request_journal.approval_authorized',
    "approve_journal.http_status=200",
    "approve_journal.outcome='succeeded'",
    "'Refund status updated successfully, but the email could not be sent'",
    "request_outcome.business_status='Partial success'",
    "journal_contract_version='nayax-provider-journal-v3'",
    "provider_contract_version='nayax-production-account-contract-v2'",
  ]) assert.ok(proof.includes(evidence), evidence);
  assert.doesNotMatch(proof, /scheduled_report|terminalEvidenceProven|net_amount|status\s+is\s+null/i);

  const settle = functionBody(migration,
    'create function public.service_settle_nayax_refund_attempt(');
  assert.ok(settle.indexOf('service_settle_nayax_refund_attempt_pre_terminal_receipt_v1') <
    settle.indexOf('refund_ensure_proved_nayax_api_terminal_receipt'));
  assert.doesNotMatch(settle, /service_claim_nayax_refund_completion|service_finish_nayax_refund_completion/);
});

test('API receipt does not fabricate a DTM status or settlement time', () => {
  const writer = functionBody(migration,
    'create function public.refund_ensure_proved_nayax_api_terminal_receipt');
  assert.match(migration,
    /confirmation_source='dtm_observation'[\s\S]*provider_status is not distinct from 62/);
  assert.match(migration,
    /confirmation_source='api_stage_contract' and provider_status is null/);
  assert.match(writer,
    /'USD',null,evidence_digest,attempt\.provider_outcome_recorded_at/);
  assert.match(writer, /'proved_terminal_api',false,'api_stage_contract'/);
  assert.doesNotMatch(writer, /settled_at|adjustment_date|insert into public\.sales_adjustment_facts/);
});

test('normal claimed v2 completion uses its stored manual delivery kind', () => {
  const claimStart = originalClaim.indexOf('create or replace function public.service_claim_nayax_refund_completion');
  const claimEnd = originalClaim.indexOf('\n$$;', claimStart);
  const claim = originalClaim.slice(claimStart, claimEnd);
  assert.match(claim,
    /'deterministic_template',\s*'manual',\s*'refund_nayax_completion_v2'/);

  const deliveryStart = nayaxFunction.indexOf('deliverCustomerCompletion: async');
  const deliveryEnd = nayaxFunction.indexOf('\n        },\n      },', deliveryStart);
  const delivery = nayaxFunction.slice(deliveryStart, deliveryEnd);
  assert.match(delivery, /deliveryKind: "manual"/);
  assert.doesNotMatch(delivery, /deliveryKind: "automatic"/);
  assert.match(delivery, /deliverNayaxCompletionWithDefiniteRetry/);
  assert.match(delivery, /service_prepare_nayax_completion_retry/);
});

test('receipt guard admits only the succeeded attempt bound v2 message', () => {
  const predicate = functionBody(migration,
    'create function public.is_refund_terminal_api_completion_message');
  assert.match(predicate, /receipt\.confirmation_source='api_stage_contract'/);
  assert.match(predicate, /message\.template_version='refund_nayax_completion_v2'/);
  assert.match(predicate, /message\.template_key='refund_nayax_completed_v2'/);
  assert.match(predicate, /message\.delivery_kind='manual'/);
  assert.match(predicate, /attempt\.status='succeeded'/);
  assert.match(predicate, /attempt\.provider_outcome='success'/);
  assert.match(predicate, /other_message\.message_type='completed'/);
  assert.match(migration,
    /Authoritative receipt forbids customer resend; use the one bound completion/);
  assert.match(migration,
    /p_delivery_kind is distinct from m\.delivery_kind/);
  const change = functionBody(migration,
    'create function public.refund_terminal_api_completion_message_change_allowed');
  for (const field of ['recipient_email', 'subject', 'body', 'delivery_kind']) {
    assert.match(change, new RegExp(`'${field}'`));
  }
});

test('provider-free recovery is exact, idempotent, and adds no payment, adjustment, or notice', () => {
  const reconcile = functionBody(migration,
    'create function public.service_reconcile_terminal_refund_receipt');
  assert.match(reconcile, /where id=p_receipt_id and refund_case_id=c\.id/);
  assert.match(reconcile, /else 'already_reconciled' end/);
  assert.match(reconcile, /refund_completed_at=null/);
  assert.match(reconcile, /'provider_call_made',false,'customer_message_sent',false/);
  assert.doesNotMatch(reconcile,
    /insert into public\.(?:refund_case_nayax_refund_attempts|sales_adjustment_facts|refund_case_messages)/i);
  assert.doesNotMatch(reconcile, /net\.http|http_post|fetch\s*\(/i);
  assert.doesNotMatch(migration, /create table public\.refund_terminal_receipt_reconciliations/);
  assert.match(migration,
    /grant execute on function public\.service_reconcile_terminal_refund_receipt\(uuid,uuid,uuid\)\s+to service_role/);
});

test('confirmed payment completion is independent of contact and notice delivery', () => {
  const reconcile = functionBody(migration,
    'create function public.service_reconcile_terminal_refund_receipt');
  assert.match(reconcile, /status='completed',automation_state='completed'/);
  assert.doesNotMatch(reconcile,
    /customer_email|recipient_email|required email|completion notice must/i);
  assert.match(reconcile, /accountingState','pending'/);
});

test('API receipt overview keeps DTM-only notice controls out of the manager contract', () => {
  const overview = functionBody(migration,
    'create function public.admin_get_refund_authoritative_receipt_overview');
  assert.match(overview, /attemptBindingKind' is distinct from 'proved_terminal_api'/);
  assert.match(overview, /base-'completionNotice'-'historicalOwnerNoticeAvailable'/);
  assert.match(overview, /'noticeChoices','\[\]'::jsonb/);
});

test('API receipt lifecycle reuses v2 delivery state and keeps accounting separate', () => {
  const lifecycle = functionBody(migration,
    'create function public.refund_lifecycle_contract(p_refund_case_id uuid)');
  assert.match(lifecycle,
    /refund_lifecycle_contract_pre_authoritative_receipt_v1/);
  for (const key of [
    'stage', 'messageState', 'managerNextAction', 'managerQueue',
    'operations', 'terminal', 'refreshAfterSeconds',
  ]) assert.match(lifecycle, new RegExp(`'${key}',delivery_base->'${key}'`));
  assert.match(lifecycle, /'paymentWorkComplete',true/);
  assert.match(lifecycle, /'accountingState'.*?'state','applied'/s);
  assert.doesNotMatch(lifecycle, /'bucket','accounting_review'/);
});

test('definite failures retry once while uncertain delivery remains held', () => {
  assert.match(completionHelper,
    /if \(first\.status !== "failed"\) return first/);
  assert.match(completionHelper, /prepareSameMessageRetry\(\)/);
  assert.equal((completionHelper.match(/deliverNayaxCompletionOnce\(\{/g) ?? []).length >= 2, true);
  assert.match(nayaxFunction,
    /isDeliveryUncertain: \(error\) =>\s*error instanceof RefundGmailError && error\.deliveryUncertain/);
});

test('tracked recovery source contains no production identifiers', () => {
  for (const forbidden of [
    'a1e37876-e4f9-4ddd-b834-e238a433c592',
    'a414505a-c7d7-4022-8364-e395b6cc083a',
    'c6a493cd-fbd9-427a-87f8-5be186bacc01',
    'f9573d7e-29fa-4bc7-b7cd-acce55db77ca',
    '2207676918',
  ]) assert.doesNotMatch(migration, new RegExp(forbidden, 'i'));
});
