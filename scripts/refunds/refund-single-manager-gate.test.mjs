import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const migration = await readFile(new URL(
  'supabase/migrations/20260913090000_refund_single_manager_gate.sql', root
), 'utf8');
const officialAction = await readFile(new URL(
  'supabase/functions/_shared/refund-official-action.ts', root
), 'utf8');
const orchestration = await readFile(new URL(
  'supabase/functions/_shared/nayax-refund-orchestration.ts', root
), 'utf8');
const portal = await readFile(new URL('src/pages/admin/Refunds.tsx', root), 'utf8');

test('one normalized authority resolver feeds one canonical authorization path', () => {
  assert.match(migration, /create or replace function public\.refund_official_action_authority/);
  assert.match(migration, /'kind','machine_manager'/);
  assert.match(migration, /'kind','super_admin'/);
  assert.doesNotMatch(migration, /pre_single_manager_gate|super_admin_only/i);
  assert.equal((migration.match(/create or replace function public\.admin_authorize_refund_official_action\(/g) ?? []).length, 1);
  assert.equal((migration.match(/create or replace function public\.service_reserve_nayax_refund_manager_action\(/g) ?? []).length, 1);
});

test('authority identity is separate from case readiness blockers', () => {
  const resolver = migration.match(
    /create or replace function public\.refund_official_action_authority\([\s\S]*?revoke all on function public\.refund_official_action_authority/
  )?.[0] ?? '';
  assert.doesNotMatch(resolver, /duplicate_of_refund_case_id|unresolved_reconciliation|gmail_case_link_review/);
  assert.match(migration, /c\.duplicate_of_refund_case_id is not null/);
  assert.match(migration, /refund_case_has_unresolved_reconciliation\(c\.id\)/);
  assert.match(migration, /review\.status='pending'/);
});

test('normal manager confirmation creates one receipt and no step-up artifact', () => {
  assert.equal((migration.match(/insert into public\.refund_case_official_action_authorizations/g) ?? []).length, 2,
    'one generic decision receipt insert plus one direct Nayax receipt insert');
  assert.match(migration, /Nayax execution authorization is created only by the atomic refund reservation/);
  assert.doesNotMatch(migration, /insert into public\.refund_manager_action_step_up_intents/);
  assert.match(migration, /'authorized'.*null,null,evidence_hash,'manager_session'/s);
  assert.match(migration, /receipt\.step_up_intent_id is not null or receipt\.verified_totp_at is not null/);
  assert.match(orchestration, /authorizationMethod === "manager_session" && action\.stepUpIntentId != null/);
  assert.doesNotMatch(portal, /manual_nayax_approval|handleApproveManualNayaxRefund|Approve refund for Nayax portal/);
  assert.match(
    migration,
    /service_settle_nayax_refund_attempt_pre_definitive_retry_v1\(text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text\)/,
    'the receipt predicate is rewritten in the deepest settlement implementation, not a later wrapper',
  );
});

test('the four execution protections remain explicit and customer mail stays success-only', () => {
  assert.match(migration, /Manager authority changed before confirmation/);
  assert.match(migration, /Refund case changed since review/);
  assert.match(migration, /selected Nayax transaction is not ready for refund/i);
  assert.match(migration, /idempotency key is bound to different immutable context/i);
  assert.match(migration, /provider_outcome='success'/);
  assert.match(orchestration, /deliverCustomerCompletion/);
  assert.match(orchestration, /attempt\.providerOutcome === "success"/);
  assert.doesNotMatch(officialAction, /scoped_admin/);
});

test('approval continuation preserves the original receipt without a second manager gate', () => {
  assert.match(migration, /refund_official_action_receipt_authority_valid/);
  assert.match(migration, /drop column current_manager_mapping_id/);
  assert.match(migration, /candidate\.approving_actor_user_id/);
  assert.match(migration, /body:=replace\(body,E'      ''currentManagerMappingId''/);
  assert.match(migration, /It never creates or repeats the refund request/);
});

test('typed authority parsing rejects unknown roles', () => {
  assert.match(officialAction, /\["machine_manager", "super_admin"\]/);
  assert.match(officialAction, /return null/);
});
