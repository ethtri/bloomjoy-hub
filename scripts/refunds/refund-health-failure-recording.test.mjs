import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Execute the actual handler's failure-recording block with synthetic RPCs.
// This covers ordering and errors without importing the serving entrypoint.
const source = await readFile(new URL('../../supabase/functions/refund-case-automation-sweep/index.ts', import.meta.url), 'utf8');
const start = source.lastIndexOf('    if (supabase && runId) {');
const end = source.indexOf('    return jsonResponse({', start);
assert.ok(start > 0 && end > start);
const executable = ts.transpileModule(
  `async function recordFailure() { ${source.slice(start, end)} }`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

async function exercise({ healthError, routeError, finalizationError, shouldAlert = false } = {}) {
  const calls = [];
  const counters = { attempted: 3, succeeded: 2, failed: 1 };
  const dependencies = {
    supabase: {}, runId: 'synthetic-run', counters, failureCategory: 'database_failure',
    getAutomationHealth: async () => {
      calls.push(['health']);
      if (healthError) throw healthError;
      return { consecutiveFailures: shouldAlert ? 1 : 0 };
    },
    claimAutomationHealthNotification: async () => ({ actionKey: 'incident-key', alertKind: 'repeated_failure' }),
    claimAction: async () => ({ claimed: true }),
    schedulerWindowStart: (date) => date,
    finishAction: async () => {
      calls.push(['route']);
      if (routeError) throw routeError;
    },
    finishRun: async (...args) => {
      calls.push(['finish', ...args]);
      if (finalizationError) throw finalizationError;
    },
    console: { error: (...args) => calls.push(['log', ...args]) },
  };
  const execute = new Function(...Object.keys(dependencies), `${executable}; return recordFailure();`);
  await execute(...Object.values(dependencies));
  return { calls, counters };
}

test('a repeated malformed health snapshot still durably finalizes the original failure', async () => {
  const { calls, counters } = await exercise({ healthError: { code: 'P4652' } });
  assert.deepEqual(calls.filter(([kind]) => kind === 'finish'), [
    ['finish', 'synthetic-run', 'failed', counters, 'database_failure', 'failed'],
  ]);
  assert.equal(calls.filter(([kind]) => kind === 'route').length, 0);
  assert.equal(calls.filter(([kind]) => kind === 'health').length, 1);
});

test('incident routing failure does not prevent run finalization', async () => {
  const { calls } = await exercise({ shouldAlert: true, routeError: new Error('route unavailable') });
  assert.equal(calls.filter(([kind]) => kind === 'finish').length, 1);
  assert.equal(calls.find(([kind]) => kind === 'finish').at(-1), 'failed');
});

test('successful incident routing preserves pending incident status', async () => {
  const { calls } = await exercise({ shouldAlert: true });
  assert.equal(calls.find(([kind]) => kind === 'finish').at(-1), 'pending');
  assert.equal(calls.filter(([kind]) => kind === 'route').length, 1);
});

test('no repeated failure keeps the existing not-needed incident status', async () => {
  const { calls } = await exercise();
  assert.equal(calls.find(([kind]) => kind === 'finish').at(-1), 'not_needed');
});

test('a failed finalization is logged once and never blindly retried', async () => {
  const { calls } = await exercise({ healthError: { code: '57014' }, finalizationError: new Error('database unavailable') });
  assert.equal(calls.filter(([kind]) => kind === 'finish').length, 1);
  assert.ok(calls.some(([kind, message]) => kind === 'log' && message.endsWith('failure recording failed')));
});
