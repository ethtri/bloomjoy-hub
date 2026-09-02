import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { buildReceiptWrapperParityTest } from './refund-receipt-wrapper-parity.mjs';

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');
const migration = read('supabase/migrations/20260902191832_refund_authoritative_reconciliation_receipt.sql');
const handler = read('supabase/functions/_shared/refund-authoritative-receipt.ts');
const edge = read('supabase/functions/refund-case-admin-update/index.ts');
const tests = read('supabase/tests/refund_authoritative_reconciliation_receipt.sql');
const panel = read('src/components/refunds/RefundAuthoritativeReceiptPanel.tsx');
const client = read('src/lib/refundAuthoritativeReceiptApi.ts');
assert.match(buildReceiptWrapperParityTest(path.resolve('.')), /select plan\(20\)/);
assert.match(panel, /buildReceiptRecordRequest\(v, reference, reviewedPayment\)/);
assert.match(panel, /buildReceiptAdoptionRequest\(v, messageId, reviewedNotice\)/);
assert.match(panel, /Refresh saved evidence/);
assert.match(client, /admin_get_refund_authoritative_receipt_overview/);
assert.match(client, /requireUserAuth: true/);
assert.doesNotMatch(panel, /localStorage|sessionStorage|dangerouslySetInnerHTML/);
assert.match(migration, /settled_at timestamptz check \(settled_at is null\)/);
assert.match(migration, /observed_at timestamptz not null default statement_timestamp\(\)/);
assert.match(migration, /unique \(account_scope, original_transaction_id\)/);
assert.match(migration, /refunded_amount_cents = original_amount_cents/);
assert.match(migration, /refund_receipt_notice_matches_case\(c.id,g.id\)/);
assert.match(migration, /association.relationship='related'/);
assert.match(migration, /c.correlation_source is distinct from 'nayax'/);
assert.match(migration, /coalesce\(a.provider_outcome,''\) not in/);
assert.match(migration, /a.idempotency_key is distinct from 'manual-nayax-'/);
assert.match(migration, /p_reviewed_current_provider_observation is distinct from true/);
assert.match(migration, /c.lifecycle_integrity_code is distinct from 'card_payment_state_without_attempt'/);
assert.match(migration, /msg\.status is distinct from 'sent' or msg\.sent_at is null\s+or msg\.provider_message_id is not null\s+or msg\.delivery_state_updated_at is distinct from msg\.sent_at/);
assert.match(tests, /Historical SENT notice has the exact real 0700 unknown-only backfill shape/);
assert.match(tests, /Manual '\|\|state\|\|' remains blocked despite historical-shaped metadata/);
assert.match(migration, /historical_provenance_event_id uuid references public.refund_case_events/);
assert.match(migration, /manual-nayax-portal-20260901-/);
assert.match(migration, /event.actor_user_id=a.actor_user_id/);
assert.match(migration, /event.created_at<=a.created_at\+interval '1 minute'/);
assert.match(panel, /refreshRefundReceiptViews/);
const receiptClient = read('src/lib/refundAuthoritativeReceipt.ts');
const workbench = read('src/pages/admin/Refunds.tsx');
const extract = (source, names) => {
  const ast = ts.createSourceFile('fixture.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const chunks = [];
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && names.includes(declaration.name.text)) chunks.push(`const ${declaration.getText(ast)};`);
    }
  }
  assert.equal(chunks.length, names.length, 'Extract actual production helper declarations');
  return ts.transpileModule(chunks.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
};
const actualHelpers = extract(receiptClient, ['hasConfirmedRefundReceipt']) + extract(workbench, ['primaryActionConfig', 'getSuggestedNextAction']);
for (const stage of ['refund_confirmed', 'customer_notified']) {
  const fixture = { status: 'card_refund_pending', paymentMethod: 'card', providerHold: true, providerOutcome: 'unconfirmed',
    lifecycle: { stage, reasonCode: 'settlement_time_unknown', paymentState: 'confirmed' } };
  const result = vm.runInNewContext(`${actualHelpers}\n({ action: primaryActionConfig(fixture, {}, [], null), next: getSuggestedNextAction(fixture, []) })`, { fixture });
  assert.equal(result.action.disabled, true);
  assert.match(result.action.label, /Refund confirmed/);
  assert.match(result.next, /Refund confirmed/);
  assert.equal(result.action.mode, undefined, 'No financial or messaging action is exposed');
  assert.doesNotMatch(result.action.helper + result.next, /result is unclear|not confirmed|No refund is recorded/);
}
assert.match(workbench, /hasConfirmedRefundReceipt\(selectedCase\) \|\| selectedCase.customerDeliveryException/);
assert.match(workbench, /!hasConfirmedRefundReceipt\(selectedCase\) && refundOperationsBlockedCaseIds.has/);
assert.match(workbench, /hasConfirmedRefundReceipt\(selectedCase\) \? \(\s*<p data-testid="refund-receipt-accounting-only"/);
assert.match(receiptClient, /\['admin-refund-operations-overview'\]/);
assert.match(receiptClient, /\['nayax-card-refund-availability'\]/);
assert.match(migration, /when n.receipt_id is null then 70 else 80/);
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
