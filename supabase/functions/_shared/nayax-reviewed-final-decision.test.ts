import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseReviewedFinalDecisionReceipt,
  parseReviewedFinalDecisionRequest,
} from "./nayax-reviewed-final-decision.ts";

const caseId = "c1480000-0000-4000-8000-000000000001";
const proofId = "c1480000-0000-4000-8000-000000000002";
const candidateToken = "c1480000-0000-4000-8000-000000000003";
const authorizationId = "c1480000-0000-4000-8000-000000000004";
const attemptId = "c1480000-0000-4000-8000-000000000005";

Deno.test("reviewed final decision needs an exact numeric version and two UUIDs", () => {
  const valid = {
    expectedOfficialActionVersion: 7,
    preparationProofId: proofId,
    candidateToken,
  };
  assertEquals(parseReviewedFinalDecisionRequest(valid), valid);
  // SQL's md5(completed event UUID : candidate-set digest) is cast to UUID
  // without overwriting the version/variant nibbles. This real proof shape
  // must pass the Edge parser before the protected RPC can revalidate it.
  const deterministicProof =
    'ffaae1b2-de39-8798-0e47-b24277e0b3af';
  assertEquals(parseReviewedFinalDecisionRequest({
    ...valid,
    preparationProofId: deterministicProof,
  })?.preparationProofId, deterministicProof);
  for (const invalid of [
    { ...valid, expectedOfficialActionVersion: "7" },
    { ...valid, expectedOfficialActionVersion: 0 },
    { ...valid, preparationProofId: "" },
    { ...valid, candidateToken: "another-case" },
    null,
  ]) assertEquals(parseReviewedFinalDecisionRequest(invalid), null);
});

Deno.test("only a protected provider-free attempt receipt acknowledges approval", () => {
  const valid = {
    approved: true,
    status: "system_finishing",
    refundCaseId: caseId,
    authorizationId,
    attemptId,
    caseVersion: 9,
    replayed: false,
    providerCallMade: false,
    customerMessageCreated: false,
    payloadRedacted: true,
  };
  assertEquals(parseReviewedFinalDecisionReceipt(valid, caseId), {
    status: "system_finishing",
    replayed: false,
  });
  assertEquals(parseReviewedFinalDecisionReceipt({
    ...valid,
    status: "provider_hold",
    replayed: true,
  }, caseId), { status: "provider_hold", replayed: true });
  assertEquals(parseReviewedFinalDecisionReceipt({
    ...valid,
    status: "completed",
    replayed: true,
  }, caseId), { status: "completed", replayed: true });
  for (const invalid of [
    { ...valid, refundCaseId: proofId },
    { ...valid, attemptId: null },
    { ...valid, providerCallMade: true },
    { ...valid, customerMessageCreated: true },
    { ...valid, status: "reapprove" },
    { ...valid, replayed: "false" },
  ]) assertEquals(parseReviewedFinalDecisionReceipt(invalid, caseId), null);
});
