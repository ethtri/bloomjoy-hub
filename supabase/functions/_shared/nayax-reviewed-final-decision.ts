// The preparation proof is a deterministic UUID assembled from a SHA/MD5
// digest, not a versioned random UUID. PostgreSQL accepts all canonical UUID
// nibbles; reject malformed syntax without rejecting the real SQL proof.
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReviewedFinalDecisionRequest = {
  expectedOfficialActionVersion: number;
  preparationProofId: string;
  candidateToken: string;
};

export const parseReviewedFinalDecisionRequest = (
  body: unknown,
): ReviewedFinalDecisionRequest | null => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  const version = input.expectedOfficialActionVersion;
  const proof = input.preparationProofId;
  const token = input.candidateToken;
  if (typeof version !== "number" || !Number.isSafeInteger(version) ||
    version <= 0 || typeof proof !== "string" ||
    !uuidPattern.test(proof) || typeof token !== "string" ||
    !uuidPattern.test(token)) return null;
  return {
    expectedOfficialActionVersion: version,
    preparationProofId: proof,
    candidateToken: token,
  };
};

export type ReviewedFinalDecisionReceipt = {
  status: "system_finishing" | "provider_hold" | "completed";
  replayed: boolean;
};

export const parseReviewedFinalDecisionReceipt = (
  value: unknown,
  caseId: string,
): ReviewedFinalDecisionReceipt | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const receipt = value as Record<string, unknown>;
  if (receipt.approved !== true ||
    !["system_finishing", "provider_hold", "completed"].includes(String(receipt.status)) ||
    receipt.refundCaseId !== caseId ||
    typeof receipt.authorizationId !== "string" ||
    !uuidPattern.test(receipt.authorizationId) ||
    typeof receipt.attemptId !== "string" ||
    !uuidPattern.test(receipt.attemptId) ||
    typeof receipt.caseVersion !== "number" ||
    !Number.isSafeInteger(receipt.caseVersion) ||
    receipt.caseVersion <= 0 ||
    receipt.providerCallMade !== false ||
    receipt.customerMessageCreated !== false ||
    receipt.payloadRedacted !== true ||
    typeof receipt.replayed !== "boolean") return null;
  return {
    status: receipt.status as ReviewedFinalDecisionReceipt["status"],
    replayed: receipt.replayed,
  };
};
