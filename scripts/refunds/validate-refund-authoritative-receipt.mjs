import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');
const migration = read('supabase/migrations/20260902161318_refund_authoritative_reconciliation_receipt.sql');
const handler = read('supabase/functions/_shared/refund-authoritative-receipt.ts');
const edge = read('supabase/functions/refund-case-admin-update/index.ts');
const tests = read('supabase/tests/refund_authoritative_reconciliation_receipt.sql');
assert.match(migration, /settled_at timestamptz check \(settled_at is null\)/);
assert.match(migration, /observed_at timestamptz not null default statement_timestamp\(\)/);
assert.match(migration, /unique \(account_scope, original_transaction_id\)/);
assert.match(migration, /refunded_amount_cents = original_amount_cents/);
assert.match(migration, /g\.refund_case_id is distinct from c\.id/);
assert.match(migration, /p_completion_original_transaction_id is distinct from r\.original_transaction_id/);
assert.match(migration, /manager_cc_verified/);
assert.match(migration, /from auth\.sessions/);
assert.match(migration, /service_claim_refund_gmail_outbound_pre_receipt_v1/);
assert.match(migration, /service_mark_refund_delivery_pre_receipt_v1/);
assert.doesNotMatch(migration, /insert into public\.(sales_adjustment_facts|refund_case_nayax_refund_attempts|refund_case_messages)\s*\(/i);
assert.doesNotMatch(migration, /\b(net\.http|http_post|fetch\s*\()/i);
assert.doesNotMatch(handler, /\b(fetch|sendRefund|dispatchRefund|createClient)\s*\(/);
assert.match(edge, /handleAuthoritativeReceipt\(body, \(name, args\) => receiptClient\.rpc\(name, args\)\)/);
assert.ok(edge.indexOf('handleAuthoritativeReceipt(body') < edge.indexOf('const beforeRow = await getRefundCase(caseId)'));
for (const phrase of ['No attempt is fabricated', 'Unknown settlement creates no dated accounting adjustment',
  'Same-thread notice cannot apply to another original', 'Revoked or nonexistent session is rejected',
  'Missing CC remains missing rather than fabricated', 'Prior sent notice is adopted without dispatch']) assert.ok(tests.includes(phrase), phrase);
const identifiers = [...migration.matchAll(/(?:function|rename to)\s+(?:public\.)?([a-z_0-9]+)/gi)];
for (const [, name] of identifiers) assert.ok(name.length <= 63, `Postgres identifier truncates: ${name}`);
console.log('PASS: authoritative receipt keeps time, accounting, attempts and adopted-notice evidence separate');
