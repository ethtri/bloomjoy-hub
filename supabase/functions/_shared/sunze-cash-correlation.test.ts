import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { drainSunzeCashCorrelation } from "./sunze-cash-correlation.ts";

Deno.test("completed import drains bounded correlation batches until exhausted", async () => {
  const receipts = [
    { evaluated: 500, skipped: 0, remaining: 501, hasMore: true },
    { evaluated: 500, skipped: 1, remaining: 1, hasMore: true },
    { evaluated: 1, skipped: 0, remaining: 0, hasMore: false },
  ];
  const limits: number[] = [];
  const result = await drainSunzeCashCorrelation(async (limit) => ({
    data: receipts[limits.push(limit) - 1], error: null,
  }));
  assertEquals(limits, [500, 500, 500]);
  assertEquals(result, { evaluated: 1001, skipped: 1, remaining: 0, deferred: false, batches: 3 });
});

Deno.test("execution cap retains truthful deferred backlog", async () => {
  let calls = 0;
  const result = await drainSunzeCashCorrelation(async () => {
    calls += 1;
    return { data: { evaluated: 500, skipped: 0, remaining: 25, hasMore: true }, error: null };
  }, 2);
  assertEquals(calls, 2);
  assertEquals(result, { evaluated: 1000, skipped: 0, remaining: 25, deferred: true, batches: 2 });
});

Deno.test("malformed continuation receipt fails closed", async () => {
  await assertRejects(
    () => drainSunzeCashCorrelation(async () => ({
      data: { evaluated: 500, skipped: 0, remaining: 1, hasMore: false }, error: null,
    })),
    Error,
    "Invalid Sunze cash correlation continuation receipt.",
  );
});
