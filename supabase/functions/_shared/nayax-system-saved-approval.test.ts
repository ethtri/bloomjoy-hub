import {
  drainNayaxSystemSavedApprovals,
  parseNayaxSystemSavedApprovalClaim,
} from "./nayax-system-saved-approval.ts";
import { createNayaxRefundProviderAdapter } from "./nayax-refund-provider.mjs";

const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};

const rawClaim = (caseId: string, attemptId: string) => ({
  systemSavedApproval: {
    systemSavedApprovalReceiptId: "11111111-1111-4111-8111-111111111111",
    sourceApprovalAuthorizationId: "22222222-2222-4222-8222-222222222222",
    caseId,
    authorityType: "system_saved_approval",
    originalAuthorityKind: "machine_manager",
  },
  attempt: { attemptId, shouldExecute: true },
  providerClaimToken: "x".repeat(64),
  providerWireContext: {
    caseId,
    caseVersion: 2,
    attemptGeneration: 0,
    idempotencyKey: `nayax-refund-${"a".repeat(64)}`,
    providerContractVersion: "nayax-production-account-contract-v2",
    journalContractVersion: "nayax-provider-journal-v3",
    executionContextHash: "b".repeat(64),
    accountScopeDigest: "c".repeat(64),
    providerMachineId: "M-1",
    transactionId: "123456789",
    siteId: 1,
    machineAuthorizationTime: "2026-09-01T12:00:00.000",
    machineAuthorizationTimeInstant: "2026-09-01T12:00:00.000Z",
    machineAuthorizationTimeWire: "2026-09-01T12:00:00.000",
    machineAuthorizationTimeSerializationMode: "exact_source",
    refundEmailListMode: "omit",
    originalAmountCents: 800,
    currencyCode: "USD",
  },
  payloadRedacted: true,
});

Deno.test("System saved-approval parser requires the complete frozen, redacted context", () => {
  const valid = rawClaim(
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  );
  assert(parseNayaxSystemSavedApprovalClaim(valid), "valid claim rejected");
  assert(
    !parseNayaxSystemSavedApprovalClaim({ ...valid, accountKey: "SECRET" }),
    "unexpected root fields must not be trusted",
  );
  const invalid = structuredClone(valid);
  invalid.providerWireContext.executionContextHash = "short";
  assert(
    !parseNayaxSystemSavedApprovalClaim(invalid),
    "invalid digest accepted",
  );

  const offset = structuredClone(valid);
  offset.providerWireContext.machineAuthorizationTime =
    "2026-09-01T12:00:00.000";
  offset.providerWireContext.machineAuthorizationTimeInstant =
    "2026-09-01T16:00:00.000Z";
  offset.providerWireContext.machineAuthorizationTimeWire =
    "2026-09-01T12:00:00.000-04:00";
  offset.providerWireContext.machineAuthorizationTimeSerializationMode =
    "source_with_bound_offset";
  assert(
    parseNayaxSystemSavedApprovalClaim(offset),
    "bound-offset frozen time rejected",
  );
  offset.providerWireContext.machineAuthorizationTimeWire =
    "2026-09-01T12:00:00.000-05:00";
  assert(
    !parseNayaxSystemSavedApprovalClaim(offset),
    "reserialized bound-offset time accepted",
  );
});

Deno.test("exact and bound-offset frozen times construct the provider without reserialization", () => {
  const contract = {
    schemaVersion: 2,
    contractVersion: "nayax-production-account-contract-v2",
    baseUrl: "https://qa-lynx.nayax.com/operational/v1",
    authorizationMode: "bearer",
    amountUnit: "major",
    amountRoundingMode: "exact_cent",
    refundEmailListMode: "omit",
    writeCredentialMode: "separate",
    sameWriteTokenContractConfirmed: false,
    reconciliationMode: "dtm_then_structured_resolution",
    requestResponses: [
      { result: "True", status: "Pending Approval", outcome: "accepted" },
      { result: "False", status: "Rejected", outcome: "rejected" },
      { result: "False", status: "Duplicate", outcome: "duplicate" },
      {
        result: "False",
        status: "Already Refunded",
        outcome: "already_refunded",
      },
    ],
    approveResponses: [
      { result: "True", status: "Approved", outcome: "succeeded" },
      { result: "False", status: "Rejected", outcome: "rejected" },
      { result: "False", status: "Duplicate", outcome: "duplicate" },
      {
        result: "False",
        status: "Already Refunded",
        outcome: "already_refunded",
      },
      { result: "True", status: "Pending", outcome: "pending" },
    ],
  };
  for (
    const raw of [
      rawClaim(
        "33333333-3333-4333-8333-333333333337",
        "44444444-4444-4444-8444-444444444447",
      ),
      (() => {
        const offset = rawClaim(
          "33333333-3333-4333-8333-333333333338",
          "44444444-4444-4444-8444-444444444448",
        );
        offset.providerWireContext.machineAuthorizationTimeInstant =
          "2026-09-01T16:00:00.000Z";
        offset.providerWireContext.machineAuthorizationTimeWire =
          "2026-09-01T12:00:00.000-04:00";
        offset.providerWireContext.machineAuthorizationTimeSerializationMode =
          "source_with_bound_offset";
        return offset;
      })(),
    ]
  ) {
    const claim = parseNayaxSystemSavedApprovalClaim(raw);
    assert(claim, "frozen claim did not parse");
    const provider = createNayaxRefundProviderAdapter({
      contract: {
        ...contract,
        machineAuthorizationTimeMode:
          claim!.wire.machineAuthorizationTimeSerializationMode,
      },
      requestToken: "request-token",
      approveToken: "approve-token",
      evidence: {
        caseId: claim!.caseId,
        amountCents: claim!.wire.originalAmountCents,
        currencyCode: "USD",
        transactionId: claim!.wire.transactionId,
        siteId: claim!.wire.siteId,
        machineAuthorizationTime: claim!.wire.machineAuthorizationTime,
        machineAuthorizationTimeInstant:
          claim!.wire.machineAuthorizationTimeInstant,
        machineAuthorizationTimeWire: claim!.wire.machineAuthorizationTimeWire,
        refundEmailListMode: claim!.wire.refundEmailListMode,
      },
    });
    assert(
      provider.mode === "live",
      "provider construction rejected frozen time context",
    );
  }
});

Deno.test("completion failure never changes settled payment truth", async () => {
  const claim = rawClaim(
    "33333333-3333-4333-8333-333333333339",
    "44444444-4444-4444-8444-444444444449",
  );
  const output = await drainNayaxSystemSavedApprovals({
    limit: 1,
    claimOne: async () => claim,
    executeProvider: async () => ({
      kind: "success",
      providerReference: "provider-123",
    }),
    settle: async () => ({ succeeded: true }),
    deliverCompletion: async () => {
      throw new Error("completion_delivery_failed");
    },
  });
  assert(
    output.results[0].executed === true,
    "completion failure misreported payment failure",
  );
  assert(
    output.results[0].errorCode === null,
    "completion failure became provider failure",
  );
  assert(
    output.results[0].completionErrorCode === "completion_delivery_failed",
    "completion failure was not recorded separately",
  );
});

Deno.test("System drain claims sequentially and isolates one case failure", async () => {
  const claims = [
    rawClaim(
      "33333333-3333-4333-8333-333333333331",
      "44444444-4444-4444-8444-444444444441",
    ),
    rawClaim(
      "33333333-3333-4333-8333-333333333332",
      "44444444-4444-4444-8444-444444444442",
    ),
  ];
  let activeClaims = 0;
  let maxActiveClaims = 0;
  const output = await drainNayaxSystemSavedApprovals({
    limit: 2,
    claimOne: async () => {
      activeClaims += 1;
      maxActiveClaims = Math.max(maxActiveClaims, activeClaims);
      const value = claims.shift() ?? null;
      activeClaims -= 1;
      return value;
    },
    executeProvider: async (claim) => {
      if (claim.caseId.endsWith("1")) throw new Error("first_case_held");
      return { kind: "success", providerReference: "provider-123" };
    },
    settle: async () => ({ succeeded: true }),
    deliverCompletion: async () => {},
  });
  assert(maxActiveClaims === 1, "claims were not one-at-a-time");
  assert(output.results.length === 2, "one failure starved the next case");
  assert(
    output.results[0].executed === false && output.results[1].executed === true,
    "per-case isolation failed",
  );
});
