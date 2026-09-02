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
// Execute the actual client wrapper with capability mocks, not a rewritten caller.
// The correction must use a live-user authenticated edge request, never actor RPCs.
const apiExports = {};
const apiCalls = [];
let apiResult = { status: 'recorded', customerMessageSent: false, payloadRedacted: true,
  machineCorrected: true, correctionId: 'ad500000-0000-4000-8000-000000000001',
  receiptId: 'ad900000-0000-4000-8000-000000000001', paymentConfirmed: true,
  accountingPending: true, settlementTimePrecision: 'unknown' };
vm.runInNewContext(ts.transpileModule(client, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
  exports: apiExports,
  require(name) {
    if (name === '@/lib/supabaseClient') return { supabaseClient: { rpc: async (...args) => { apiCalls.push(args); return { data: { parsed: true }, error: null }; } } };
    if (name === '@/lib/edgeFunctions') return { invokeEdgeFunction: async (...args) => { apiCalls.push(args); return apiResult; } };
    if (name === './refundAuthoritativeReceipt') return { parseRefundReceiptOverview: (value) => value, parseRefundMachineCorrectionOptions: (value) => value };
    throw new Error(`Unexpected client capability: ${name}`);
  },
});
await apiExports.fetchRefundMachineCorrectionOptions('ad400000-0000-4000-8000-000000000001');
assert.equal(apiCalls[0][0], 'admin_get_refund_legacy_machine_correction_options');
assert.deepEqual(JSON.parse(JSON.stringify(apiCalls[0][1])), { p_case_id: 'ad400000-0000-4000-8000-000000000001' });
const correctionInput = { mode: 'correct_legacy_machine_and_record_observation' };
await apiExports.saveRefundReceiptEvidence(correctionInput);
assert.equal(apiCalls[1][0], 'refund-case-admin-update');
assert.equal(apiCalls[1][1], correctionInput);
assert.deepEqual(JSON.parse(JSON.stringify(apiCalls[1][2])), { requireUserAuth: true });
const validCorrectionResult = apiResult;
for (const invalid of [{ status: 'already_recorded' }, { machineCorrected: false }, { correctionId: null },
  { receiptId: null }, { paymentConfirmed: false }, { accountingPending: false }, { settlementTimePrecision: 'exact' },
  { customerMessageSent: true }, { payloadRedacted: false }]) {
  apiResult = { ...validCorrectionResult, ...invalid };
  await assert.rejects(() => apiExports.saveRefundReceiptEvidence(correctionInput));
}
const correctionPanel = read('src/components/refunds/RefundMachineCorrectionReview.tsx');
assert.match(correctionPanel, /freshCase, freshOptions/);
assert.match(correctionPanel, /!== approvedSnapshot/);
assert.match(correctionPanel, /buildRefundMachineCorrectionRequest/);
assert.doesNotMatch(correctionPanel, /localStorage|sessionStorage|dangerouslySetInnerHTML|executeAsActor|service_role/);
// Run the real panel's effect through receipt-first and failed-parent ordering.
// Stop before JSX because this test isolates the actual hook/state contract.
const readActualCorrectionLatch = (receipt, reviewOpen) => {
  const exports = {};
  const done = new Error('effect captured');
  let stateIndex = 0;
  let latch;
  const ast = ts.createSourceFile('panel.tsx', panel, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const stateNames = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(ast) === 'useState') stateNames.push(node.name.elements[0].getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(stateNames.includes('correctionOpen'));
  vm.runInNewContext(ts.transpileModule(panel, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React } }).outputText, { exports, require(name) {
    if (name === 'react') return {
      useState: (initial) => [stateNames[stateIndex++] === 'correctionOpen' ? reviewOpen : initial, () => {}],
      useEffect: (effect) => { effect(); throw done; },
    };
    if (name === '@tanstack/react-query') return { useQueryClient: () => ({}), useQuery: () => ({ data: { receipt } }) };
    return {};
  } });
  assert.throws(() => exports.RefundAuthoritativeReceiptPanel({ caseId: 'synthetic-case', onCorrectionReviewChange: (active) => { latch = active; } }), (error) => error === done);
  return latch;
};
let releaseParentRefresh;
const delayedParent = new Promise((resolve) => { releaseParentRefresh = resolve; });
let parentLifecycleConfirmed = false;
const parentRefresh = delayedParent.then(() => { parentLifecycleConfirmed = true; });
const freshReceipt = await Promise.resolve({ id: 'ad900000-0000-4000-8000-000000000001' });
assert.equal(parentLifecycleConfirmed, false, 'Controlled parent read remains in flight after receipt succeeds');
assert.equal(readActualCorrectionLatch(freshReceipt, true), true, 'Actual panel retains suppression during receipt-first refresh');
await Promise.reject(new Error('synthetic parent refresh failure')).catch(() => {});
assert.equal(readActualCorrectionLatch(freshReceipt, true), true, 'Parent refresh failure cannot restore stale financial/footer controls');
releaseParentRefresh();
await parentRefresh;
assert.equal(parentLifecycleConfirmed, true);
assert.equal(readActualCorrectionLatch(freshReceipt, true), true, 'Confirmed parent chooses accounting-only branch before the retained latch');
assert.equal(readActualCorrectionLatch(null, false), false, 'Cancel before recording or fresh pane has no correction latch');
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
