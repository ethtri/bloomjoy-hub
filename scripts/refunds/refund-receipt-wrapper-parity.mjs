import fs from 'node:fs';
import path from 'node:path';

export const RECEIPT_MIGRATION = '20260902191832_refund_authoritative_reconciliation_receipt.sql';
export const CORE_DISPATCH_MIGRATION = '20260902182311_refund_all_message_delivery_bookkeeping.sql';
export const PRIOR_COMPLETION_MIGRATION = '20260903154800_refund_receipt_customer_completion.sql';
export const COMPLETION_MIGRATION = '20260906052200_refund_receipt_automatic_completion_kernel.sql';
export const TERMINAL_API_MIGRATION = '20260908163714_refund_terminal_receipt_case_completion.sql';
export const RECEIPT_HANDOFF_MIGRATION = '20260930234847_refund_api_receipt_completion_handoff.sql';
export const OWNER_RESOLUTION_MIGRATION = '20260904182000_refund_owner_nonrefund_adoption.sql';
export const GIFT_CARD_MIGRATION = '20260930222531_refund_gift_card_issuance.sql';
export const PAYOUT_REMINDER_MIGRATION = '20261002170300_refund_legacy_payout_reminder_authority.sql';
const TEST_FILE = 'refund_receipt_wrapper_parity.sql';
const gmailArgs = 'uuid,uuid,text,text,text,text,text[],text,uuid';
const definitions = [
  [TERMINAL_API_MIGRATION, 'service_claim_refund_gmail_outbound_v3', 'service_claim_refund_gmail_outbound_pre_receipt_thread_v1', gmailArgs, false],
  [RECEIPT_HANDOFF_MIGRATION, 'service_claim_refund_gmail_outbound_v3', 'service_claim_refund_gmail_outbound_v3', gmailArgs, true],
  [CORE_DISPATCH_MIGRATION, 'service_claim_refund_gmail_outbound_v3', 'service_claim_refund_gmail_outbound_pre_receipt_v1', gmailArgs, false],
  [COMPLETION_MIGRATION, 'service_mark_refund_transactional_delivery_attempt', 'service_mark_refund_transactional_delivery_attempt', 'uuid', true],
  [CORE_DISPATCH_MIGRATION, 'service_mark_refund_transactional_delivery_attempt', 'service_mark_refund_delivery_pre_receipt_v1', 'uuid', false],
  [COMPLETION_MIGRATION, 'service_mark_refund_manual_message_provider_attempt', 'service_mark_refund_manual_message_provider_attempt', 'uuid,uuid', true],
];
const guardByRuntimeName = new Map([
  ['service_claim_refund_gmail_outbound_v3', ['  select official_action_version into case_version from public.refund_cases where id=p_refund_case_id for update;', '  perform public.assert_no_active_refund_owner_resolution(p_refund_case_id);']],
  ['service_mark_refund_transactional_delivery_attempt', ['  select official_action_version into case_version from public.refund_cases where id=case_id for update;', '  perform public.assert_no_active_refund_owner_resolution(case_id);']],
  ['service_mark_refund_manual_message_provider_attempt', ['  select * into case_row from public.refund_cases where id=case_id for update;', '  perform public.assert_no_active_refund_owner_resolution(case_id);']],
]);

export function extractReceiptParityBody(source, name) {
  const normalized = source.replaceAll('\r\n', '\n');
  const start = normalized.search(new RegExp(`^create(?: or replace)? function public\\.${name}\\(`, 'm'));
  const bodyStart = normalized.indexOf('as $$', start);
  const bodyEnd = normalized.indexOf('\n$$;', bodyStart);
  if (start < 0 || bodyStart < start || bodyEnd < bodyStart) throw new Error(`Missing exact function body: ${name}`);
  const body = normalized.slice(bodyStart + 'as $$'.length, bodyEnd + 1);
  if (body.includes('$receipt_parity$')) throw new Error('Unsafe receipt parity delimiter');
  return body;
}

export function applyOwnerResolutionBoundary(body, runtimeName, ownerResolutionSource) {
  const guard = guardByRuntimeName.get(runtimeName);
  if (!guard) return body;
  const [anchor, statement] = guard;
  if (!ownerResolutionSource.replaceAll('\r\n', '\n').includes(`array['public.${runtimeName}(`) || body.split(anchor).length !== 2) {
    throw new Error(`Owner resolution boundary is not exact: ${runtimeName}`);
  }
  return body.replace(anchor, `${anchor}\n${statement}`);
}

export function applyPayoutReminderMessageBoundary(body, migrationSource) {
  const anchor = 'delivery_authorization := public.service_authorize_refund_customer_outbound(\n    p_refund_case_id,\n    normalized_recipient,';
  const replacement = 'delivery_authorization := public.service_authorize_refund_customer_message_outbound(\n    p_refund_case_id,\n    p_refund_case_message_id,\n    normalized_recipient,';
  if (body.split(anchor).length !== 2 || !migrationSource.replaceAll('\r\n', '\n').includes(replacement)) {
    throw new Error('Payout reminder exact-message boundary is not exact');
  }
  return body.replace(anchor, replacement);
}

export function buildReceiptWrapperParityTest(repoRoot) {
  const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
  if (!files.includes(RECEIPT_MIGRATION) || !files.includes(CORE_DISPATCH_MIGRATION) ||
    !files.includes(PRIOR_COMPLETION_MIGRATION) || !files.includes(COMPLETION_MIGRATION) ||
    COMPLETION_MIGRATION <= RECEIPT_MIGRATION || RECEIPT_MIGRATION <= CORE_DISPATCH_MIGRATION) throw new Error('Receipt must follow the current core dispatch migration');
  // A later public replacement would silently remove an outer receipt gate on
  // fresh replay even when an out-of-order production installation looked safe.
  for (const name of ['service_claim_refund_gmail_outbound_v3', 'service_mark_refund_transactional_delivery_attempt']) {
    const definingFiles = files.filter((file) => new RegExp(`^create(?: or replace)? function public\\.${name}\\(`, 'm')
      .test(fs.readFileSync(path.join(migrationsDir, file), 'utf8')));
    const expected = name === 'service_claim_refund_gmail_outbound_v3'
      ? [CORE_DISPATCH_MIGRATION, RECEIPT_MIGRATION, PRIOR_COMPLETION_MIGRATION,
        COMPLETION_MIGRATION, TERMINAL_API_MIGRATION, RECEIPT_HANDOFF_MIGRATION]
      : [CORE_DISPATCH_MIGRATION, RECEIPT_MIGRATION, PRIOR_COMPLETION_MIGRATION,
        COMPLETION_MIGRATION];
    if (!expected.every((file, index) => definingFiles.at(index - expected.length) === file)) {
      throw new Error(`Receipt delegate is not the current core: ${name}`);
    }
  }
  const checks = definitions.flatMap(([file, sourceName, runtimeName, args, serviceAllowed]) => {
    let body = extractReceiptParityBody(fs.readFileSync(path.join(migrationsDir, file), 'utf8'), sourceName);
    if (runtimeName === 'service_claim_refund_gmail_outbound_pre_receipt_v1' && files.includes(PAYOUT_REMINDER_MIGRATION)) {
      // The complete retained delegate changes only its exact-message
      // authorization call. Every thread, receipt and replay guard stays exact.
      body = applyPayoutReminderMessageBoundary(body,
        fs.readFileSync(path.join(migrationsDir, PAYOUT_REMINDER_MIGRATION), 'utf8'));
    }
    if (runtimeName === 'service_mark_refund_manual_message_provider_attempt' && files.includes(GIFT_CARD_MIGRATION)) {
      // Preserve complete-body parity: apply only the reviewed transactional
      // gift receipt exception. All original-payment and claim guards stay exact.
      const anchor = 'if not exists(select 1 from public.refund_customer_contact_settings settings';
      const replacement = 'if not public.is_refund_gift_card_message(to_jsonb(message_row))\n      and not exists(select 1 from public.refund_customer_contact_settings settings';
      const giftSource = fs.readFileSync(path.join(migrationsDir, GIFT_CARD_MIGRATION), 'utf8').replaceAll('\r\n', '\n');
      if (body.split(anchor).length !== 2 || !giftSource.includes(replacement)) {
        throw new Error('Gift-card transactional provider boundary is not exact');
      }
      body = body.replace(anchor, replacement);
    }
    const signature = `public.${runtimeName}(${args})`;
    return [
      `select is((select prosrc from pg_proc where oid='${signature}'::regprocedure), $receipt_parity$${body}$receipt_parity$, '${runtimeName} has the complete exact current source body');`,
      `select ok((select prosecdef from pg_proc where oid='${signature}'::regprocedure), '${runtimeName} preserves its reviewed security boundary');`,
      `select is(has_function_privilege('service_role','${signature}','execute'), ${serviceAllowed}, '${runtimeName} service execute boundary');`,
      ...['anon', 'authenticated'].map((role) => `select ok(not has_function_privilege('${role}','${signature}','execute'), '${runtimeName} is not directly callable by ${role}');`),
    ];
  });
  return `begin;\ncreate extension if not exists pgtap with schema extensions;\nset local search_path=public,extensions;\nselect plan(${checks.length});\n${checks.join('\n')}\nselect * from finish();\nrollback;\n`;
}

export function writeReceiptWrapperParityTest(repoRoot, tempRoot) {
  const testPath = path.join(tempRoot, 'supabase', 'tests', TEST_FILE);
  fs.writeFileSync(testPath, buildReceiptWrapperParityTest(repoRoot), { encoding: 'utf8', flag: 'wx' });
  return { testPath, testRelativePath: path.posix.join('supabase', 'tests', TEST_FILE) };
}
