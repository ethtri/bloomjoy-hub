/// <reference lib="deno.ns" />

import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { buildPublicIntakeSubmissionDedupeKey } from "./public-intake-abuse-controls.ts";

Deno.test("submission dedupe identity is stable across delayed retries", async () => {
  const input = {
    salt: "synthetic-test-salt",
    submissionType: "refund_case",
    submissionId: "00000000-0000-4000-8000-000000000001",
    email: "customer@example.invalid",
    sourcePage: "/refunds/request",
  };
  const first = await buildPublicIntakeSubmissionDedupeKey(input);
  const delayedRetry = await buildPublicIntakeSubmissionDedupeKey(input);
  const separatePurchase = await buildPublicIntakeSubmissionDedupeKey({
    ...input,
    submissionId: "00000000-0000-4000-8000-000000000002",
  });

  assertEquals(delayedRetry, first);
  assertNotEquals(separatePurchase, first);
  assertNotEquals(await buildPublicIntakeSubmissionDedupeKey({
    ...input,
    email: "different@example.invalid",
  }), first);
});
