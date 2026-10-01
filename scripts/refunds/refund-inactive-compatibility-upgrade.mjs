import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export const INACTIVE_GIFT_MIGRATIONS = [
  '20260930222531_refund_gift_card_issuance.sql',
  '20260930222948_refund_gift_card_supply.sql',
  '20260930230000_refund_gift_card_reporting.sql',
  '20260930233000_refunds_alias_inquiry.sql',
];

// Definition/privilege evidence only: never customer rows or credentials.
export const INACTIVE_BASELINE_CATALOG_QUERY = `select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,
   'definition',md5(replace(pg_get_functiondef(p.oid),E'\\r\\n',E'\\n')),
   'acl',coalesce(p.proacl::text,'default')) order by p.oid::regprocedure::text)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')
   and p.proname=any(array[
   'public_refund_selections_v2','refund_lifecycle_contract','refund_lifecycle_contract_pre_queue_integrity_v1',
   'is_refund_receipt_completion_message','is_refund_receipt_automatic_completion_message',
   'refund_claim_nayax_form_receipt_completion_internal','service_ensure_refund_receipt_automatic_completions',
   'service_claim_refund_gmail_outbound_v3','service_claim_refund_manual_message_deliveries',
   'refund_completion_outbox_postcommit_wakeup','refund_case_lifecycle_integrity_code',
   'guard_refund_case_active_nayax_attempt','assert_refund_case_reconciliation_safe',
   'guard_refund_follow_up_message','service_authorize_refund_customer_outbound',
   'service_mark_refund_manual_message_provider_attempt','admin_get_refund_operations_overview',
   'get_refund_portal_queue_projection','service_read_refund_status_capability',
   'machine_sales_calculation_candidates','machine_sales_daily_components',
   'service_mark_refund_info_inquiry','service_submit_refund_purchase_correction',
   'refund_nayax_api_terminal_evidence_proved','service_reconcile_proved_nayax_api_terminal'])),
 'constraints',(select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,
   'definition',md5(pg_get_constraintdef(c.oid))) order by c.conrelid::regclass::text,c.conname)
   from pg_constraint c where c.conrelid in ('public.refund_cases'::regclass,
   'public.refund_case_messages'::regclass,'public.refund_receipt_completion_intents'::regclass,
   'public.refund_authoritative_receipts'::regclass))
) as catalog`;

export async function verifyInactiveBaselineCatalog({ dbPort, expectedPath }) {
  // This helper is exclusively for the existing local disposable runner.
  const client = new pg.Client({ host: '127.0.0.1', port: dbPort, user: 'postgres', password: 'postgres', database: 'postgres' });
  await client.connect();
  try {
    const { rows } = await client.query(INACTIVE_BASELINE_CATALOG_QUERY);
    const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
    assert.deepEqual(rows[0].catalog, expected.catalog, 'Disposable deployed-order baseline differs from reviewed production catalog');
    return { functions: rows[0].catalog.functions.length, constraints: rows[0].catalog.constraints.length };
  } finally { await client.end(); }
}

export function stageInactiveGiftMigrations(tempRoot) {
  const directory = path.join(tempRoot, 'supabase', 'migrations');
  const heldDirectory = path.join(tempRoot, 'inactive-gift-held-migrations');
  // Keep the historical production baseline fixed when later PRs add files.
  // Later files are restored with the four backdated files before migration up.
  const heldNames = fs.readdirSync(directory).filter((name) => name.endsWith('.sql') &&
    (INACTIVE_GIFT_MIGRATIONS.includes(name) || name.split('_')[0] > '20260930234847')).sort();
  assert.ok(INACTIVE_GIFT_MIGRATIONS.every((name) => heldNames.includes(name)));
  fs.mkdirSync(heldDirectory);
  for (const name of heldNames) {
    fs.renameSync(path.join(directory, name), path.join(heldDirectory, name));
  }
  return (reviewedRoot) => {
    const receipts = [];
    for (const name of heldNames) {
      const destination = path.join(directory, name);
      fs.renameSync(path.join(heldDirectory, name), destination);
      if (reviewedRoot) {
        const reviewedPath = path.join(reviewedRoot, 'supabase/migrations', name);
        assert.equal(fs.readFileSync(destination, 'utf8').replaceAll('\r\n', '\n'), fs.readFileSync(reviewedPath, 'utf8').replaceAll('\r\n', '\n'));
        // Use reviewed checkout bytes, including the Windows CRLF shape.
        fs.copyFileSync(reviewedPath, destination);
      }
      receipts.push({ name, sha256: crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex') });
    }
    return receipts;
  };
}

export function writeInactiveGiftCompatibilityTest(repoRoot, tempRoot) {
  const original = fs.readFileSync(path.join(repoRoot, 'supabase/tests/refund_nayax_exact_source_reporting_recovery.sql'), 'utf8');
  const additional = `
select is((select count(*) from public.refund_gift_card_pools),0::bigint,'No compatibility gift pools');
select is((select count(*) from public.refund_gift_card_codes),0::bigint,'No compatibility gift codes');
select is((select count(*) from public.refund_gift_card_issuances),0::bigint,'No compatibility issuances');
select is((select count(*) from public.refund_gift_card_refill_rules),0::bigint,'No compatibility refill configuration');
select is((select count(*) from public.refund_gift_card_refill_attempts),0::bigint,'No compatibility provider preparation');
select is((select count(*) from public.refund_cases where resolution_method<>'original_payment'),0::bigint,'Original payment resolution preserved');
select is((select count(*) from public.refund_case_messages where gift_card_issuance_id is not null),0::bigint,'No gift notices');
select ok(position('original_customer_thread_unverified' in pg_get_functiondef('public.refund_claim_nayax_form_receipt_completion_internal(uuid)'::regprocedure))>0,'Original thread creator preserved');
select ok(position('refund_nayax_api_terminal_evidence_proved' in pg_get_functiondef('public.service_ensure_refund_receipt_automatic_completions(integer)'::regprocedure))>0,'API receipt scanner preserved');
select ok(position('i.gmail_thread_id is null' in pg_get_functiondef('public.service_claim_refund_gmail_outbound_v3(uuid,uuid,text,text,text,text,text[],text,uuid)'::regprocedure))>0,'Null original-thread denial preserved');
select ok(position('proved_terminal_api' in pg_get_functiondef('public.refund_lifecycle_contract_pre_queue_integrity_v1(uuid)'::regprocedure))>0,'API receipt lifecycle preserved');
select ok(position('refund_lifecycle_pre_gift_card' in pg_get_functiondef('public.refund_lifecycle_contract(uuid)'::regprocedure))>0,'Original lifecycle delegated');
`;
  assert.ok(original.includes('select plan(81);') && original.includes('select * from finish();'));
  const source = original.replace('select plan(81);', 'select plan(93);').replace('select * from finish();', additional + '\nselect * from finish();');
  const relativePath = 'supabase/tests/refund_inactive_gift_compatibility.sql';
  const testPath = path.join(tempRoot, relativePath);
  fs.writeFileSync(testPath, source);
  return { testPath, relativePath };
}
