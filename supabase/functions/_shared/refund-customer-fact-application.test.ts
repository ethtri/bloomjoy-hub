import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyRefundCustomerFactApplication } from "./refund-customer-fact-application.ts";

Deno.test("fresh and idempotently replayed fact applications are accepted", () => {
  assertEquals(
    classifyRefundCustomerFactApplication({ outcome: "applied", factVersion: 2 }),
    "accepted",
  );
  assertEquals(
    classifyRefundCustomerFactApplication({
      outcome: "already_applied",
      factVersion: 2,
    }),
    "accepted",
  );
});

Deno.test("fact-version conflicts remain retryable instead of silently succeeding", () => {
  assertEquals(
    classifyRefundCustomerFactApplication({
      outcome: "conflict",
      factVersion: 3,
      reason: "fact_version_changed",
    }),
    "retryable_conflict",
  );
});

Deno.test("malformed or unversioned RPC responses fail closed", () => {
  assertEquals(classifyRefundCustomerFactApplication(null), "invalid_response");
  assertEquals(
    classifyRefundCustomerFactApplication({ outcome: "applied" }),
    "invalid_response",
  );
  assertEquals(
    classifyRefundCustomerFactApplication({
      outcome: "already_applied",
      factVersion: 0,
    }),
    "invalid_response",
  );
});
