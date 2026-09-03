import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../../supabase/functions/refund-case-automation-sweep/index.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const functionSource = (name, next) => {
  const start = compiled.indexOf(`const ${name} =`);
  const end = compiled.indexOf(`const ${next} =`);
  assert(start >= 0 && end > start, `Missing function boundary for ${name}`);
  return compiled.slice(start, end);
};

test('actual persisted-result sweep routes an empty no-match internally without claiming customer contact', async () => {
  const calls = [];
  const fixture = { id: 'case-fixture', payment_method: 'card', card_wallet_used: false, status: 'needs_review', nayax_recommendation_state: 'no_safe_match', deterministic_fact_version: 1 };
  const query = (table) => {
    const chain = { then: (resolve) => resolve({ data: table === 'refund_cases' ? [fixture] : null, error: null }) };
    for (const key of ['select', 'eq', 'in', 'limit', 'update']) chain[key] = (...args) => { calls.push([table, key, ...args]); return chain; };
    return chain;
  };
  const run = new Function('supabase', 'normalizeRefundSweepCase', 'getPersistedNayaxCorrectionEvidence', 'deriveNayaxCustomerCorrectionFields', 'routeFollowUpManualReview', 'claimAction', 'claimFollowUpCycle', 'sendDeterministicFollowUpMessage', `
    const caseSelect = 'fixture-columns';
    ${functionSource('runPersistedNayaxCustomerCorrectionSweep', 'runWalletCorrectionExpirySweep')}
    return runPersistedNayaxCustomerCorrectionSweep;
  `)(
    { from: query }, (value) => value, async () => [], () => [],
    async (input) => { calls.push(['internal-review', input.actionKeySuffix]); },
    async () => { throw new Error('must not claim a customer action'); },
    async () => { throw new Error('must not create a follow-up cycle'); },
    async () => { throw new Error('must not send a customer message'); },
  );
  await run('run-fixture', {}, 'window-fixture');
  assert(calls.some(([table, op, value]) => table === 'refund_follow_up_cycles' && op === 'update' && value.status === 'manual_review'));
  assert.deepEqual(calls.filter(([kind]) => kind === 'internal-review'), [['internal-review', 'no-customer-correction:v1']]);
});

test('actual shared send boundary rejects empty card requests and reminders before any effect', async () => {
  const send = new Function('supabase', 'automaticCustomerContactAllowed', 'messageTypeForFollowUp', 'refundCorrectionLinksEnabled',
    `${functionSource('sendDeterministicFollowUpMessage', 'sendCustomerStatusUpdate')} return sendDeterministicFollowUpMessage;`
  )({}, async () => true, () => 'no_safe_match', async () => false);
  for (const messageClass of ['request', 'reminder']) {
    await assert.rejects(send({ payment_method: 'card' }, { reasonCode: 'no_safe_match' }, messageClass, []), /specific customer-correctable fact/);
  }
});

test('persisted correction evidence is restricted to current unexpired lookup generation', async () => {
  const calls = [];
  const chain = { then: (resolve) => resolve({ data: [], error: null }) };
  for (const key of ['select', 'eq', 'gt', 'order', 'limit']) chain[key] = (...args) => { calls.push([key, ...args]); return chain; };
  const read = new Function('supabase', `${functionSource('getPersistedNayaxCorrectionEvidence', 'runCardNayaxLookupSweep')} return getPersistedNayaxCorrectionEvidence;`)({ from: () => chain });
  const fixture = { id: 'case-fixture', nayax_lookup_generation: 3, nayax_lookup_status: 'no_match', nayax_recommendation_evaluated_at: '2026-09-03T19:24:00Z', deterministic_facts_updated_at: '2026-09-03T19:00:00Z' };
  await read(fixture);
  assert(calls.some(([op, field, value]) => op === 'eq' && field === 'lookup_generation' && value === 3));
  assert(calls.some(([op, field]) => op === 'gt' && field === 'expires_at'));
  calls.length = 0;
  await read({ ...fixture, deterministic_facts_updated_at: '2026-09-03T19:30:00Z' });
  await read({ ...fixture, nayax_lookup_status: 'checking' });
  assert.equal(calls.length, 0, 'stale facts or a running newer lookup cannot reuse old conflict evidence');
});

test('actual due-reminder sweep stops empty correction and returns waiting case to internal review', async () => {
  const calls = [];
  const cycle = { id: 'cycle-fixture', reasonCode: 'no_safe_match' };
  const fixture = { id: 'case-fixture', payment_method: 'card', status: 'waiting_on_customer', deterministic_fact_version: 1 };
  const query = (table) => {
    const chain = { then: (resolve) => resolve({ error: null }) };
    for (const key of ['eq', 'in', 'update', 'insert']) chain[key] = (...args) => { calls.push([table, key, ...args]); return chain; };
    return chain;
  };
  const supabase = { from: query, rpc: async () => ({ data: { enabled: true, reminders: [{ cycleId: cycle.id, refundCaseId: fixture.id }] }, error: null }) };
  const claimAction = async () => ({ claimed: true });
  const finishAction = async (...args) => { calls.push(['finish', ...args]); };
  const route = new Function('supabase', 'claimAction', 'sendFollowUpManagerNotice', 'finishAction', `${functionSource('routeFollowUpManualReview', 'getPortalBaseUrl')} return routeFollowUpManualReview;`)(supabase, claimAction, async () => {}, finishAction);
  const run = new Function('supabase', 'normalizeFollowUpCycle', 'getSweepCase', 'claimAction', 'deriveNayaxCustomerCorrectionFields', 'getPersistedNayaxCorrectionEvidence', 'routeFollowUpManualReview', 'finishAction', `
    const automaticCustomerContactEnabled = true;
    const textValue = value => typeof value === 'string' ? value : '';
    ${functionSource('runReminderSweep', 'sendPayoutDestinationReminder')}
    return runReminderSweep;
  `)(supabase, () => cycle, async () => fixture, claimAction, () => [], async () => [], route, finishAction);
  await run('run-fixture', { evaluatedCaseIds: new Set() }, 'window-fixture');
  assert(calls.some(([table, op, value]) => table === 'refund_follow_up_cycles' && op === 'update' && value.status === 'manual_review'));
  assert(calls.some(([table, op, value]) => table === 'refund_cases' && op === 'update' && value.status === 'needs_review' && value.automation_follow_up_due_at === null));
  assert(calls.some(([kind, , status, reason]) => kind === 'finish' && status === 'suppressed' && reason === 'no_customer_correctable_fact'));
});
