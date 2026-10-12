type Outcome = { requestId: string; status: string; [key: string]: unknown };

/** Claim one at a time; a failed contractor never abandons the next contractor. */
export async function drainPayStubQueue(options: {
  claim: () => Promise<Array<{ requestId: string }>>;
  process: (requestId: string) => Promise<unknown>;
  fail: (requestId: string, error: string) => Promise<void>;
  now?: () => number;
  timeBudgetMs?: number;
}): Promise<Outcome[]> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeBudgetMs ?? 50_000);
  const results: Outcome[] = [];
  while (now() < deadline) {
    const claimed = await options.claim();
    const request = claimed[0];
    if (!request) break;
    try {
      const result = await options.process(request.requestId);
      results.push(result as Outcome);
    } catch (error) {
      await options.fail(request.requestId, error instanceof Error ? error.message : 'Pay Stub generation failed');
      results.push({ requestId: request.requestId, status: 'failed' });
    }
  }
  return results;
}
