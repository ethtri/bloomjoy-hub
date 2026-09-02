import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { buildReceiptWrapperParityTest } from './refund-receipt-wrapper-parity.mjs';

const read = (p) => fs.readFileSync(p, 'utf8');
const load = (file, dependencies = {}, globals = {}) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, {
    exports, ...globals, require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected capability ${name}`); return dependencies[name]; },
  });
  return exports;
};
const helpers = load('src/lib/refundHistoricalOwnerNotice.ts');
const overview = () => ({ schemaVersion: 'refund_receipt_overview_v1', visible: true,
  caseId: 'bd400000-0000-4000-8000-000000000001', caseReference: 'RF-HISTORICAL-1', expectedCaseVersion: 2,
  canRecord: false, attemptId: null, attemptBindingKind: 'no_attempt_integrity_hold', accountScope: 'SYNTHETIC',
  providerMachineId: 'SYNTHETIC-MACHINE', originalTransactionId: '123456781', originalAmountCents: 700, currencyCode: 'USD',
  receipt: { id: 'bd500000-0000-4000-8000-000000000001', observedAt: '2026-09-02T19:00:00Z', settlementTimePrecision: 'unknown',
    noticeAdopted: false, noticeSentAt: null, managerCcVerified: null }, noticeChoices: [],
  historicalOwnerNoticeAvailable: true, historicalOwnerNoticeCutoff: '2026-09-02T19:51:58Z', historicalOwnerReviewBinding: 'f'.repeat(64) });
const fields = { providerMessageId: 'abcdef0123456789', providerThreadId: 'abcdef0123456790',
  originalSentAt: '2026-09-02T16:07:00Z', recipientEmail: 'synthetic-customer@example.invalid', reviewedMessageDigest: 'a'.repeat(64) };
const flatten = (value) => !value || typeof value !== 'object' ? [] : Array.isArray(value)
  ? value.flatMap(flatten) : [value, ...flatten(value.children)];
const reactTree = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), Fragment: 'fragment' };
function actualForm() {
  let current = overview(), fresh = current, cursor = 0, calls = [], saved = 0, failSave = false;
  const state = [];
  let refresh = async () => {};
  const hooks = { useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial;
    return [state[i], (value) => { state[i] = value; }]; } };
  const module = load('src/components/refunds/RefundHistoricalOwnerNoticeReview.tsx', {
    react: hooks, '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    '@/components/ui/button': { Button: 'button' }, '@/components/ui/input': { Input: 'input' }, '@/components/ui/label': { Label: 'label' },
    '@/lib/refundHistoricalOwnerNotice': helpers,
    '@/lib/refundAuthoritativeReceipt': { refreshRefundReceiptViews: () => refresh() },
    '@/lib/refundAuthoritativeReceiptApi': {
      fetchRefundReceiptOverview: async (id) => { calls.push(['read', id]); return fresh; },
      saveRefundReceiptEvidence: async (input) => { calls.push(['write', input]); if (failSave) throw new Error('Synthetic revoked access'); },
    },
  }, { React: reactTree });
  const render = () => { cursor = 0; return flatten(module.RefundHistoricalOwnerNoticeReview({ overview: current,
    onBusyChange: () => {}, onSaved: () => saved++ })); };
  const fillAndReview = () => {
    for (const [key, value] of Object.entries(fields)) render().find((n) => n.props.id === `historical-notice-${key}`).props.onChange({ target: { value } });
    for (let i = 0; i < 3; i++) render().filter((n) => n.props.type === 'checkbox')[i].props.onChange({ target: { checked: true } });
  };
  const button = () => render().find((n) => n.type === 'button');
  return { render, fillAndReview, button, calls, state, saved: () => saved,
    setCurrent: (v) => { current = v; }, setFresh: (v) => { fresh = v; },
    failSave: () => { failSave = true; }, setRefresh: (fn) => { refresh = fn; } };
}

test('actual authenticated API wrapper rejects delivery/source upgrades and never selects an actor client', async () => {
  const calls = [];
  const good = { status: 'adopted', noticeSource: 'historical_owner_mailbox', noticeVerification: 'operator_observed',
    supportThread: false, managerCcVerified: false, customerMessageSent: false, payloadRedacted: true };
  let result = good;
  const api = load('src/lib/refundAuthoritativeReceiptApi.ts', {
    '@/lib/supabaseClient': { supabaseClient: {} }, './refundAuthoritativeReceipt': {},
    '@/lib/edgeFunctions': { invokeEdgeFunction: async (...args) => { calls.push(args); return result; } },
  });
  const input = helpers.buildHistoricalOwnerNoticeRequest(overview(), fields, true);
  await api.saveRefundReceiptEvidence(input);
  assert.equal(calls[0][0], 'refund-case-admin-update');
  assert.equal(calls[0][1], input);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2])), { requireUserAuth: true });
  for (const change of [{ status: 'recorded' }, { noticeSource: 'support_gmail' }, { noticeVerification: 'provider_verified' },
    { supportThread: true }, { managerCcVerified: true }, { customerMessageSent: true }, { payloadRedacted: false }]) {
    result = { ...good, ...change };
    await assert.rejects(() => api.saveRefundReceiptEvidence(input));
  }
});
test('actual component clears reviewed checks when case or evidence changes, with no write', () => {
  for (const changed of [{ expectedCaseVersion: 3 }, { accountScope: 'CHANGED' }, { providerMachineId: 'CHANGED' },
    { historicalOwnerReviewBinding: 'e'.repeat(64) },
    { historicalOwnerNoticeAvailable: false }, { receipt: { ...overview().receipt, noticeAdopted: true } }]) {
    const form = actualForm(); form.fillAndReview(); assert.equal(form.button().props.disabled, false);
    form.setCurrent({ ...overview(), ...changed });
    assert(form.render().filter((n) => n.props.type === 'checkbox').every((n) => !n.props.checked));
    assert.equal(form.button().props.disabled, true); assert.equal(form.calls.length, 0);
  }
  const form = actualForm(); form.fillAndReview();
  form.render().find((n) => n.props.id === 'historical-notice-providerMessageId').props.onChange({ target: { value: 'abcdef0123456788' } });
  assert(form.render().filter((n) => n.props.type === 'checkbox').every((n) => !n.props.checked));
});
test('actual save rereads current case and rejects stale evidence before any write', async () => {
  for (const changed of [{ expectedCaseVersion: 3 }, { historicalOwnerReviewBinding: 'e'.repeat(64) }]) {
  const form = actualForm(); form.fillAndReview(); form.setFresh({ ...overview(), ...changed });
  await form.button().props.onClick();
  assert.deepEqual(form.calls.map((c) => c[0]), ['read']); assert.equal(form.saved(), 0);
  assert(form.render().filter((n) => n.props.type === 'checkbox').every((n) => !n.props.checked));
  }
});
test('actual authority failure clears review and creates no saved latch', async () => {
  const form = actualForm(); form.fillAndReview(); form.failSave(); await form.button().props.onClick();
  assert.deepEqual(form.calls.map((c) => c[0]), ['read', 'write']); assert.equal(form.saved(), 0);
  assert(form.render().filter((n) => n.props.type === 'checkbox').every((n) => !n.props.checked));
  assert.equal(form.button().props.disabled, true);
});
test('actual save latches before delayed/failed parent refresh and never offers another write', async () => {
  const form = actualForm(); form.fillAndReview();
  let release, entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  form.setRefresh(() => { entered(); return new Promise((_, reject) => { release = reject; }); });
  const saving = form.button().props.onClick(); await enteredPromise;
  assert.equal(form.saved(), 1); assert.equal(form.button(), undefined);
  release(new Error('Synthetic parent refresh failure')); await saving;
  assert.equal(form.button(), undefined);
  assert.deepEqual(form.calls.map((c) => c[0]), ['read', 'write']);
});
test('actual parent render retains owner-source saved latch before overview refresh and on reopen', () => {
  const source = read('src/components/refunds/RefundAuthoritativeReceiptPanel.tsx');
  const ast = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), names = [];
  function visit(node) { if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && ts.isCallExpression(node.initializer) &&
    node.initializer.expression.getText(ast) === 'useState') names.push(node.name.elements[0].getText(ast)); ts.forEachChild(node, visit); }
  visit(ast);
  for (const reopened of [false, true]) {
    const v = overview(); if (reopened) v.receipt = { ...v.receipt, noticeAdopted: true, noticeSource: 'historical_owner_mailbox' };
    let i = 0;
    const panel = load('src/components/refunds/RefundAuthoritativeReceiptPanel.tsx', {
      react: { useEffect: () => {}, useState: (initial) => [names[i++] === 'historicalSavedCaseId' && !reopened ? v.caseId : initial, () => {}] },
      '@tanstack/react-query': { useQuery: () => ({ data: v }), useQueryClient: () => ({}) },
      '@/components/ui/button': { Button: 'button' }, '@/components/ui/input': { Input: 'input' }, '@/components/ui/label': { Label: 'label' },
      '@/lib/refundAuthoritativeReceiptApi': {}, '@/lib/refundAuthoritativeReceipt': { refundReceiptReviewSnapshot: JSON.stringify },
      './RefundMachineCorrectionReview': {}, './RefundHistoricalOwnerNoticeReview': {
        historicalOwnerNoticeRecordedLabel: 'Historical owner-mailbox notice recorded — operator reviewed; no manager CC' },
    }, { React: reactTree });
    const tree = panel.RefundAuthoritativeReceiptPanel({ caseId: v.caseId });
    assert.match(JSON.stringify(tree), /Historical owner-mailbox notice recorded — operator reviewed; no manager CC/);
    assert.equal(flatten(tree).filter((n) => n.type === 'select' || n.type === 'input').length, 0);
    assert.doesNotMatch(JSON.stringify(tree), /Use existing notice|Record historical notice only|Customer already updated · existing notice verified/);
  }
});
test('forward owner slice preserves support adopter, lifecycle and complete receipt delivery wrappers', () => {
  const sql = read('supabase/migrations/20260902195401_refund_historical_owner_notice.sql');
  assert.doesNotMatch(sql, /(?:create|alter)(?: or replace)? function public\.(?:admin_adopt_refund_completion_notice|refund_lifecycle_contract|service_claim_refund_gmail|service_mark_refund_transactional)/i);
  assert.doesNotMatch(sql, /insert into public\.(?:refund_case_messages|refund_gmail_messages|refund_gmail_threads|sales_adjustment_facts|refund_case_nayax_refund_attempts)/i);
  assert.match(sql, /email_confirmed_at is not null/); assert.match(sql, /mailbox_digest\|\|'\|'\|\|p_provider_message_id/);
  assert.match(sql, /gmail_message_id is null and gmail_thread_id is null and manager_cc_verified is false/);
  assert.match(sql, /p_original_sent_at>'2026-09-02T19:51:58Z'/);
  assert.match(buildReceiptWrapperParityTest(process.cwd()), /select plan\(20\)/);
});
test('actual manager summary records customer-notice evidence without claiming provider verification', () => {
  const manager = load('src/lib/refundManagerState.ts');
  const result = manager.getRefundManagerState({ status: 'card_refund_pending', paymentMethod: 'card',
    correlationStatus: 'matched', providerHold: true, lifecycle: { schemaVersion: 'refund_lifecycle_v2',
      stage: 'customer_notified', reasonCode: 'settlement_time_unknown', paymentState: 'confirmed' } });
  assert.equal(result.label, 'Refund confirmed · customer updated');
  assert.match(result.explanation, /existing customer notice is recorded for this claim/);
  assert.doesNotMatch(result.explanation, /verified/);
  assert.match(result.nextStep, /Do not retry payment or resend/);
});
