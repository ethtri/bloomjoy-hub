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
  const send = new Function(`${functionSource('sendDeterministicFollowUpMessage', 'sendCustomerStatusUpdate')} return sendDeterministicFollowUpMessage;`)();
  for (const messageClass of ['request', 'reminder']) {
    await assert.rejects(send({ payment_method: 'card' }, { reasonCode: 'no_safe_match' }, messageClass, []), /specific customer-correctable fact/);
  }
});
