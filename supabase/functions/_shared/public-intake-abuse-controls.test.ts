/// <reference lib="deno.ns" />

import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import {
  buildPublicIntakeDedupeKey,
  buildPublicIntakeSubmissionDedupeKey,
  buildPublicIntakeSubmissionFingerprint,
  classifyPublicIntakeSubmissionReplay,
} from "./public-intake-abuse-controls.ts";

Deno.test("submission dedupe identity is stable across delayed retries", async () => {
  const input = {
    salt: "synthetic-test-salt",
    submissionType: "refund_case",
    submissionId: "00000000-0000-4000-8000-000000000001",
  };
  const first = await buildPublicIntakeSubmissionDedupeKey(input);
  const delayedRetry = await buildPublicIntakeSubmissionDedupeKey(input);
  const separatePurchase = await buildPublicIntakeSubmissionDedupeKey({
    ...input,
    submissionId: "00000000-0000-4000-8000-000000000002",
  });

  assertEquals(delayedRetry, first);
  assertNotEquals(separatePurchase, first);
});

Deno.test("legacy dedupe remains authoritative in both rolling deployment orders", async () => {
  const legacyInput = {
    salt: "synthetic-test-salt",
    submissionType: "refund_case",
    email: "customer@example.invalid",
    sourcePage: "/refunds/request",
    message: "machine|2026-09-10T19:15:00.000Z|card|500|1234",
    windowStartedAt: new Date("2026-09-10T19:00:00.000Z"),
  };
  const oldServerKey = await buildPublicIntakeDedupeKey(legacyInput);
  const newServerKey = await buildPublicIntakeDedupeKey(legacyInput);
  assertEquals(newServerKey, oldServerKey, "old then new must collide in the rollout window");
  assertEquals(oldServerKey, newServerKey, "new then old must collide in the rollout window");
});

Deno.test("changed payload under one UUID is a conflict before status access", async () => {
  const identityHash = await buildPublicIntakeSubmissionDedupeKey({
    salt: "synthetic-test-salt",
    submissionType: "refund_case",
    submissionId: "00000000-0000-4000-8000-000000000001",
  });
  const originalFingerprint = await buildPublicIntakeSubmissionFingerprint({
    salt: "synthetic-test-salt",
    submissionType: "refund_case",
    canonicalValues: ["machine-a", "customer@example.invalid", 500],
  });
  const changedFingerprint = await buildPublicIntakeSubmissionFingerprint({
    salt: "synthetic-test-salt",
    submissionType: "refund_case",
    canonicalValues: ["machine-a", "different@example.invalid", 500],
  });

  assertEquals(classifyPublicIntakeSubmissionReplay({
    storedIdentityHash: identityHash,
    storedFingerprint: originalFingerprint,
    identityHash,
    fingerprint: originalFingerprint,
  }), "match");
  assertEquals(classifyPublicIntakeSubmissionReplay({
    storedIdentityHash: identityHash,
    storedFingerprint: originalFingerprint,
    identityHash,
    fingerprint: changedFingerprint,
  }), "conflict");
  assertNotEquals(changedFingerprint, originalFingerprint);
});
