import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildReceiptWrapperParityTest, extractReceiptParityBody, COMPLETION_MIGRATION,
  CORE_DISPATCH_MIGRATION, TERMINAL_API_MIGRATION, RECEIPT_HANDOFF_MIGRATION,
  PAYOUT_REMINDER_MIGRATION, GIFT_DENIAL_NOTICE_MIGRATION, applyPayoutReminderMessageBoundary } from './refund-receipt-wrapper-parity.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
test('source-derived runtime proof includes exact current core delegates and receipt outer wrappers', () => {
  const sql = buildReceiptWrapperParityTest(root);
  assert(sql.includes('select plan(35)'));
  for (const name of ['service_claim_refund_gmail_outbound_v3', 'service_mark_refund_transactional_delivery_attempt']) {
    let core = extractReceiptParityBody(read(CORE_DISPATCH_MIGRATION), name);
    if (name === 'service_claim_refund_gmail_outbound_v3') {
      core = applyPayoutReminderMessageBoundary(core, read(PAYOUT_REMINDER_MIGRATION));
    }
    const receipt = extractReceiptParityBody(read(
      name === 'service_claim_refund_gmail_outbound_v3'
        ? TERMINAL_API_MIGRATION
        : COMPLETION_MIGRATION,
    ), name);
    assert(sql.includes(`$receipt_parity$${core}$receipt_parity$`));
    assert(sql.includes(`$receipt_parity$${receipt}$receipt_parity$`));
    assert(core.includes('Follow-up reminder requires a non-failed original request'));
    assert(receipt.includes("errcode='P4663'"));
    assert(receipt.includes('assert_no_active_refund_owner_resolution'));
  }
  const handoff = extractReceiptParityBody(read(RECEIPT_HANDOFF_MIGRATION), 'service_claim_refund_gmail_outbound_v3');
  assert(sql.includes(`$receipt_parity$${handoff}$receipt_parity$`));
  assert(handoff.includes('service_claim_refund_gmail_outbound_pre_receipt_thread_v1'));
  assert(handoff.includes('i.gmail_thread_id is distinct from p_target_gmail_thread_id'));
  assert(handoff.includes('r.nayax_refund_attempt_id is distinct from m.nayax_refund_attempt_id'));
  assert(sql.includes("'public.service_claim_refund_gmail_outbound_pre_receipt_thread_v1(uuid,uuid,text,text,text,text,text[],text,uuid)'"));
  const manualMark = extractReceiptParityBody(
    read(COMPLETION_MIGRATION),
    'service_mark_refund_manual_message_provider_attempt',
  );
  assert(manualMark.includes('assert_no_active_refund_owner_resolution(case_id)'));
  assert(manualMark.indexOf('for update;') < manualMark.indexOf('assert_no_active_refund_owner_resolution(case_id)'));
  assert(sql.includes('if not public.is_refund_gift_card_message(to_jsonb(message_row))\n      and not exists(select 1 from public.refund_customer_contact_settings settings'));
  assert(sql.includes('if not public.is_refund_receipt_automatic_completion_message(message_row.id) then'));
  assert(sql.includes("raise exception 'Refund manual-message delivery claim changed' using errcode='P4659'"));
  const complaintGuard = extractReceiptParityBody(read(GIFT_DENIAL_NOTICE_MIGRATION),
    'service_mark_refund_manual_message_provider_attempt');
  assert(sql.includes(`$receipt_parity$${complaintGuard}$receipt_parity$`));
  assert(sql.includes("'public.service_mark_refund_manual_provider_pre_gift_complaint_v1(uuid,uuid)'"));
  assert(sql.includes("has_function_privilege('service_role','public.service_mark_refund_manual_provider_pre_gift_complaint_v1(uuid,uuid)','execute'), false"));
  assert(sql.includes("has_function_privilege('service_role','public.service_mark_refund_manual_message_provider_attempt(uuid,uuid)','execute'), true"));
  assert(complaintGuard.includes('private.is_refund_gift_denial_notice(to_jsonb(m))'));
  assert(complaintGuard.includes('private.refund_gift_denial_recipient_complained(m.refund_case_id,m.recipient_email)'));
  assert(complaintGuard.includes("errcode='P4684'"));
  assert(complaintGuard.indexOf('refund_cases where id=case_id for update') < complaintGuard.indexOf('where id=p_refund_case_message_id for update'));
  assert(complaintGuard.indexOf("errcode='P4684'") < complaintGuard.indexOf('return public.service_mark_refund_manual_provider_pre_gift_complaint_v1('));
  assert.doesNotMatch(complaintGuard, /set\s+manual_delivery_provider_attempted_at/iu);
  assert.doesNotMatch(sql, /disable\s+trigger|session_replication_role/iu);
  assert(sql.endsWith('rollback;\n'));
});
test('parity extraction fails closed on missing or unsafe source', () => {
  assert.throws(() => extractReceiptParityBody('', 'missing'), /Missing exact/);
  assert.throws(() => extractReceiptParityBody('create function public.f()\nreturns void as $$\n$receipt_parity$\n$$;', 'f'), /Unsafe/);
  assert.equal(extractReceiptParityBody('create function public.f()\nreturns void as $$\nbegin return; end $$;', 'f'), '\nbegin return; end ');
  assert.throws(() => extractReceiptParityBody('create function public.f()\nreturns void as $$\nbegin return; end', 'f'), /Missing exact/);
  assert.throws(() => applyPayoutReminderMessageBoundary('', read(PAYOUT_REMINDER_MIGRATION)), /not exact/);
  assert.throws(() => applyPayoutReminderMessageBoundary(
    extractReceiptParityBody(read(CORE_DISPATCH_MIGRATION), 'service_claim_refund_gmail_outbound_v3'), ''), /not exact/);
});
test('disposable runner proves wrapper composition before and after populated upgrade work', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/validate-supabase-migrations.mjs'), 'utf8');
  const first = source.indexOf('runReceiptWrapperParity();');
  const second = source.indexOf('runReceiptWrapperParity();', first + 1);
  assert(first >= 0 && second > first);
  assert(first < source.indexOf('writePopulatedDeliveryUpgradeTest(repoRoot, tempRoot)'));
  assert(second > source.indexOf('writeSettledCompletionDeliveryTest(repoRoot, tempRoot)'));
});
