import fs from 'node:fs';
import path from 'node:path';

export const RECEIPT_MIGRATION = '20260902191832_refund_authoritative_reconciliation_receipt.sql';
export const CORE_DISPATCH_MIGRATION = '20260902182311_refund_all_message_delivery_bookkeeping.sql';
export const COMPLETION_MIGRATION = '20260903154800_refund_receipt_customer_completion.sql';
export const OWNER_RESOLUTION_MIGRATION = '20260904182000_refund_owner_nonrefund_adoption.sql';
const TEST_FILE = 'refund_receipt_wrapper_parity.sql';
const gmailArgs = 'uuid,uuid,text,text,text,text,text[],text,uuid';
const definitions = [
  [COMPLETION_MIGRATION, 'service_claim_refund_gmail_outbound_v3', 'service_claim_refund_gmail_outbound_v3', gmailArgs, true],
  [CORE_DISPATCH_MIGRATION, 'service_claim_refund_gmail_outbound_v3', 'service_claim_refund_gmail_outbound_pre_receipt_v1', gmailArgs, false],
  [COMPLETION_MIGRATION, 'service_mark_refund_transactional_delivery_attempt', 'service_mark_refund_transactional_delivery_attempt', 'uuid', true],
  [CORE_DISPATCH_MIGRATION, 'service_mark_refund_transactional_delivery_attempt', 'service_mark_refund_delivery_pre_receipt_v1', 'uuid', false],
];
const guardByRuntimeName = new Map([
  ['service_claim_refund_gmail_outbound_v3', ['  select official_action_version into case_version from public.refund_cases where id=p_refund_case_id for update;', '  perform public.assert_no_active_refund_owner_resolution(p_refund_case_id);']],
  ['service_mark_refund_transactional_delivery_attempt', ['  select official_action_version into case_version from public.refund_cases where id=case_id for update;', '  perform public.assert_no_active_refund_owner_resolution(case_id);']],
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

export function buildReceiptWrapperParityTest(repoRoot) {
  const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
  if (!files.includes(RECEIPT_MIGRATION) || !files.includes(CORE_DISPATCH_MIGRATION) || !files.includes(COMPLETION_MIGRATION) ||
    COMPLETION_MIGRATION <= RECEIPT_MIGRATION || RECEIPT_MIGRATION <= CORE_DISPATCH_MIGRATION) throw new Error('Receipt must follow the current core dispatch migration');
  // A later public replacement would silently remove the outer receipt gate on
  // fresh replay even when an out-of-order production installation looked safe.
  for (const name of ['service_claim_refund_gmail_outbound_v3', 'service_mark_refund_transactional_delivery_attempt']) {
    const definingFiles = files.filter((file) => new RegExp(`^create(?: or replace)? function public\\.${name}\\(`, 'm')
      .test(fs.readFileSync(path.join(migrationsDir, file), 'utf8')));
    if (definingFiles.at(-1) !== COMPLETION_MIGRATION) throw new Error(`Receipt wrapper overwritten later: ${name}`);
    if (definingFiles.at(-2) !== RECEIPT_MIGRATION || definingFiles.at(-3) !== CORE_DISPATCH_MIGRATION) throw new Error(`Receipt delegate is not the current core: ${name}`);
  }
  const ownerResolutionSource = fs.readFileSync(path.join(migrationsDir, OWNER_RESOLUTION_MIGRATION), 'utf8').replaceAll('\r\n', '\n');
  const checks = definitions.flatMap(([file, sourceName, runtimeName, args, serviceAllowed]) => {
    let body = extractReceiptParityBody(fs.readFileSync(path.join(migrationsDir, file), 'utf8'), sourceName);
    body = applyOwnerResolutionBoundary(body, runtimeName, ownerResolutionSource);
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
