/// <reference lib="deno.ns" />

import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { RequestTimeoutError, withRequestTimeout } from './requestTimeout.ts';

Deno.test('bounded request returns a successful response and clears its timer', async () => {
  const result = await withRequestTimeout(async (signal) => {
    assertEquals(signal.aborted, false);
    return 'ready';
  }, 100);

  assertEquals(result, 'ready');
});

Deno.test('bounded request rejects on time even when the operation never settles', async () => {
  let signal: AbortSignal | undefined;
  const startedAt = Date.now();

  const error = await assertRejects(
    () => withRequestTimeout((requestSignal) => {
      signal = requestSignal;
      return new Promise<string>(() => undefined);
    }, 20),
    RequestTimeoutError,
  );

  assert(error.timeoutMs === 20);
  assert(signal?.aborted);
  assert(Date.now() - startedAt < 1_000);
});

Deno.test('a transient failure stays retryable and a later explicit attempt can succeed', async () => {
  let attempts = 0;
  const inspect = () => withRequestTimeout(async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError('temporary network failure');
    return { state: 'ready' } as const;
  }, 100);

  await assertRejects(inspect, TypeError, 'temporary network failure');
  assertEquals(await inspect(), { state: 'ready' });
  assertEquals(attempts, 2);
});

Deno.test('non-timeout responses remain available for unavailable-link handling', async () => {
  const unavailable = new Error('correction_unavailable');
  const error = await assertRejects(
    () => withRequestTimeout(async () => { throw unavailable; }, 100),
    Error,
    'correction_unavailable',
  );

  assert(error === unavailable);
});
