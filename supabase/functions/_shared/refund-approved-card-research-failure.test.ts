import { reconcileApprovedCardResearchFailure } from "./refund-approved-card-research-failure.ts";

const assertEquals = (actual: unknown, expected: unknown) => {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
};

Deno.test("lost commit response reconciles only an authoritative completed generation", async () => {
  assertEquals(await reconcileApprovedCardResearchFailure(async () => ({
    data: { applied: false, stale: true, alreadyCompleted: true, payloadRedacted: true },
    error: null,
  })), "completed");
  for (const data of [
    { applied: false, stale: true, alreadyCompleted: false, payloadRedacted: true },
    { applied: false, stale: true, payloadRedacted: true },
    { applied: false, stale: true, alreadyCompleted: true, payloadRedacted: false },
  ]) assertEquals(await reconcileApprovedCardResearchFailure(async () => ({ data, error: null })), "unresolved");
  assertEquals(await reconcileApprovedCardResearchFailure(async () => ({
    data: null, error: new Error("failure writer unavailable"),
  })), "unresolved");
  assertEquals(await reconcileApprovedCardResearchFailure(async () => ({
    data: { applied: true, payloadRedacted: true }, error: null,
  })), "failed");
});
