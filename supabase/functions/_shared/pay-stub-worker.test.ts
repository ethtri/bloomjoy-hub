import { drainPayStubQueue } from './pay-stub-worker.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

Deno.test('PDF failure is recorded and the next contractor still publishes', async () => {
  const queue = ['failed-contractor', 'good-contractor'];
  const failures: string[] = [];
  const results = await drainPayStubQueue({
    claim: async () => queue.length ? [{ requestId: queue.shift()! }] : [],
    process: async (requestId) => {
      if (requestId === 'failed-contractor') throw new Error('Temporary upload failure');
      return { requestId, status: 'completed' };
    },
    fail: async (requestId) => { failures.push(requestId); },
  });
  equal(results.map((r) => r.status), ['failed', 'completed']);
  equal(failures, ['failed-contractor']);
});

Deno.test('Calculation exception remains blocked while other contractors continue', async () => {
  const queue = ['blocked', 'complete'];
  const results = await drainPayStubQueue({
    claim: async () => queue.length ? [{ requestId: queue.shift()! }] : [],
    process: async (requestId) => ({ requestId, status: requestId === 'blocked' ? 'blocked' : 'completed' }),
    fail: async () => { throw new Error('A blocker must not become a transient failure'); },
  });
  equal(results.map((r) => r.status), ['blocked', 'completed']);
});

Deno.test('Runtime budget never reserves work the invocation cannot start', async () => {
  let clock = 0;
  let claims = 0;
  const results = await drainPayStubQueue({
    now: () => clock, timeBudgetMs: 100,
    claim: async () => { claims++; return [{ requestId: 'one' }]; },
    process: async (requestId) => { clock = 101; return { requestId, status: 'completed' }; },
    fail: async () => {},
  });
  equal(claims, 1);
  equal(results.length, 1);
});

Deno.test('A lost failure write stops draining and leaves the lease recoverable', async () => {
  let claims = 0;
  let failed = false;
  try {
    await drainPayStubQueue({
      claim: async () => { claims++; return [{ requestId: 'one' }]; },
      process: async () => { throw new Error('Upload failed'); },
      fail: async () => { throw new Error('Database unavailable'); },
    });
  } catch { failed = true; }
  equal(failed, true);
  equal(claims, 1);
});
