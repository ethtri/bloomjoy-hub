import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  buildNayaxRecommendation,
  toPublicNayaxCandidate,
} from "../../supabase/functions/_shared/nayax-recommendation.mjs";
import { resolveLocalDateTimeInZone } from "../../supabase/functions/_shared/timezone-resolution.mjs";

const incidentAt = "2026-07-21T19:00:00.000Z";
const expectedMachineId = "machine-101";

const sale = ({
  id,
  at = incidentAt,
  amount = 7,
  machineId = expectedMachineId,
  last4 = "4242",
  currency = "USD",
  status = "Approved",
  recognitionMethod = "Chip",
  siteId = 501,
  extra = {},
}) => ({
  TransactionID: id,
  MachineID: machineId,
  SiteID: siteId,
  AuthorizationDateTimeGMT: at,
  AuthorizationValue: amount,
  CurrencyCode: currency,
  CardNumber: last4 ? `************${last4}` : "",
  PaymentStatus: status,
  RecognitionMethod: recognitionMethod,
  ...extra,
});

const recommend = (records, overrides = {}) =>
  buildNayaxRecommendation({
    payload: records,
    incidentAt,
    incidentTimeResolution: "exact",
    expectedMachineId,
    locationTimezone: "America/Los_Angeles",
    requestAmountCents: 700,
    requestCardLast4: "4242",
    cardWalletUsed: false,
    ...overrides,
  });

const exact = recommend([
  sale({ id: "exact" }),
  sale({ id: "exact-distractor", at: "2026-07-21T19:02:00.000Z", amount: 8.5 }),
]);
assert.equal(exact.recommendationState, "high_confidence");
assert.equal(exact.confidenceClass, "strong_card");
assert.equal(exact.candidates[0].transactionId, "exact");
assert.equal(exact.candidates[0].oneClickEligible, true);

const nearTime = recommend([sale({ id: "near", at: "2026-07-21T19:45:00.000Z" })]);
assert.equal(nearTime.recommendationState, "high_confidence");
assert.equal(nearTime.candidates[0].timeDeltaMinutes, 45);
assert.equal(nearTime.candidates[0].oneClickEligible, true);

const customerTimeWithin15Minutes = recommend([sale({ id: "time-within-15" })], {
  incidentTimeConfidence: "within_15_minutes",
});
assert.equal(customerTimeWithin15Minutes.recommendationState, "high_confidence");
assert.ok(customerTimeWithin15Minutes.reasonCodes.includes("customer_time_within_15_minutes"));

const customerTimeWithinHour = recommend([sale({ id: "time-within-hour" })], {
  incidentTimeConfidence: "within_1_hour",
});
assert.equal(customerTimeWithinHour.recommendationState, "manual_exception");
assert.equal(customerTimeWithinHour.oneClickEligible, false);
assert.ok(customerTimeWithinHour.reasonCodes.includes("customer_time_within_1_hour"));

const customerTimeRough = recommend([sale({ id: "time-rough" })], {
  incidentTimeConfidence: "rough",
});
assert.equal(customerTimeRough.recommendationState, "manual_exception");
assert.equal(customerTimeRough.oneClickEligible, false);
assert.ok(customerTimeRough.reasonCodes.includes("customer_time_rough"));

const wrongAmount = recommend([sale({ id: "wrong-amount", amount: 9.5 })]);
assert.equal(wrongAmount.recommendationState, "manual_exception");
assert.equal(wrongAmount.oneClickEligible, false);

const wrongMachine = recommend([sale({ id: "wrong-machine", machineId: "machine-999" })]);
assert.equal(wrongMachine.recommendationState, "manual_exception");
assert.equal(wrongMachine.candidates[0].selectionAllowed, false);

const collision = recommend([
  sale({ id: "collision-a", at: "2026-07-21T18:55:00.000Z" }),
  sale({ id: "collision-b", at: "2026-07-21T19:05:00.000Z" }),
]);
assert.equal(collision.recommendationState, "ambiguous");
assert.equal(collision.candidates.some((candidate) => candidate.oneClickEligible), false);
assert.equal(collision.candidates.some((candidate) => candidate.isRecommended), false);

const walletMismatch = recommend(
  [sale({ id: "wallet", last4: "9999", recognitionMethod: "Apple Pay" })],
  { cardWalletUsed: true },
);
assert.equal(walletMismatch.recommendationState, "manual_exception");
assert.equal(walletMismatch.oneClickEligible, false);

const exactWallet = recommend(
  [sale({ id: "exact-wallet", recognitionMethod: "Apple Pay" })],
  { cardWalletUsed: true },
);
assert.equal(exactWallet.recommendationState, "high_confidence");
assert.equal(exactWallet.confidenceClass, "strong_card");
assert.equal(exactWallet.oneClickEligible, false);

const uniqueQrWallet = recommend(
  [sale({
    id: "unique-qr-wallet",
    at: "2026-07-21T19:03:00.000Z",
    last4: "9999",
    recognitionMethod: "Apple Pay",
  })],
  {
    cardWalletUsed: true,
    qrClaimOpenedAt: "2026-07-21T19:08:00.000Z",
    qrClaimEvidenceStatus: "verified",
  },
);
assert.equal(uniqueQrWallet.recommendationState, "high_confidence");
assert.equal(uniqueQrWallet.confidenceClass, "unique_qr_time");
assert.equal(uniqueQrWallet.oneClickEligible, false);
assert.equal(uniqueQrWallet.candidates[0].qrTimeDeltaMinutes, 5);
assert.ok(uniqueQrWallet.reasonCodes.includes("unique_qr_time_candidate"));

const uniqueQrContactlessCard = recommend(
  [sale({
    id: "unique-qr-contactless-card",
    at: "2026-07-21T19:03:00.000Z",
    last4: "9999",
    recognitionMethod: "Contactless",
  })],
  {
    cardWalletUsed: false,
    qrClaimOpenedAt: "2026-07-21T19:08:00.000Z",
    qrClaimEvidenceStatus: "verified",
  },
);
assert.equal(uniqueQrContactlessCard.recommendationState, "high_confidence");
assert.equal(uniqueQrContactlessCard.confidenceClass, "unique_qr_time");
assert.equal(uniqueQrContactlessCard.oneClickEligible, false);
assert.ok(uniqueQrContactlessCard.reasonCodes.includes("tokenized_last4_noncorrelating"));

const uniqueQrWithoutLast4 = recommend(
  [sale({ id: "unique-qr-no-last4", at: "2026-07-21T19:04:00.000Z", last4: "" })],
  {
    requestCardLast4: "",
    qrClaimOpenedAt: "2026-07-21T19:09:00.000Z",
    qrClaimEvidenceStatus: "verified",
  },
);
assert.equal(uniqueQrWithoutLast4.recommendationState, "high_confidence");
assert.equal(uniqueQrWithoutLast4.confidenceClass, "unique_qr_time");
assert.equal(uniqueQrWithoutLast4.oneClickEligible, false);

const closeQrTransactions = recommend(
  [
    sale({
      id: "close-qr-a",
      at: "2026-07-21T19:03:00.000Z",
      last4: "9999",
      recognitionMethod: "Apple Pay",
    }),
    sale({
      id: "close-qr-b",
      at: "2026-07-21T19:05:00.000Z",
      last4: "8888",
      recognitionMethod: "Apple Pay",
    }),
  ],
  {
    cardWalletUsed: true,
    qrClaimOpenedAt: "2026-07-21T19:08:00.000Z",
    qrClaimEvidenceStatus: "verified",
  },
);
assert.equal(closeQrTransactions.recommendationState, "ambiguous");
assert.equal(closeQrTransactions.confidenceClass, "ambiguous_manual");
assert.equal(closeQrTransactions.candidates.some((candidate) => candidate.isRecommended), false);
assert.ok(closeQrTransactions.reasonCodes.includes("plausible_runner_up"));

const lateQrScan = recommend(
  [sale({
    id: "late-qr",
    last4: "9999",
    recognitionMethod: "Apple Pay",
  })],
  {
    cardWalletUsed: true,
    qrClaimOpenedAt: "2026-07-21T20:00:00.000Z",
    qrClaimEvidenceStatus: "verified",
  },
);
assert.equal(lateQrScan.recommendationState, "manual_exception");
assert.ok(lateQrScan.reasonCodes.includes("qr_claim_late"));
assert.equal(lateQrScan.oneClickEligible, false);

const justOutsideQrWindow = recommend(
  [sale({
    id: "outside-qr-window",
    last4: "9999",
    recognitionMethod: "Apple Pay",
  })],
  {
    cardWalletUsed: true,
    qrClaimOpenedAt: "2026-07-21T19:30:01.000Z",
    qrClaimEvidenceStatus: "verified",
  },
);
assert.equal(justOutsideQrWindow.candidates[0].qrTimeDeltaMinutes, 31);
assert.equal(justOutsideQrWindow.recommendationState, "manual_exception");
assert.equal(justOutsideQrWindow.oneClickEligible, false);

const replayedQrClaim = recommend(
  [sale({
    id: "replayed-qr",
    last4: "9999",
    recognitionMethod: "Apple Pay",
  })],
  {
    cardWalletUsed: true,
    qrClaimOpenedAt: "2026-07-21T19:05:00.000Z",
    qrClaimEvidenceStatus: "replayed",
  },
);
assert.equal(replayedQrClaim.recommendationState, "manual_exception");
assert.ok(replayedQrClaim.reasonCodes.includes("qr_claim_replayed"));
assert.equal(replayedQrClaim.oneClickEligible, false);

const missingMachineEvidence = recommend([sale({ id: "missing-machine", machineId: "" })]);
assert.equal(missingMachineEvidence.recommendationState, "manual_exception");
assert.equal(missingMachineEvidence.candidates[0].oneClickEligible, false);

const justOutsideOneClickWindow = recommend([
  sale({ id: "outside-one-click", at: "2026-07-21T20:00:01.000Z" }),
]);
assert.equal(justOutsideOneClickWindow.candidates[0].timeDeltaMinutes, 61);
assert.equal(justOutsideOneClickWindow.oneClickEligible, false);

const missingProviderLast4 = recommend([sale({ id: "missing-last4", last4: "" })]);
assert.equal(missingProviderLast4.recommendationState, "manual_exception");

const failedProviderStatus = recommend([sale({ id: "failed", status: "Declined" })]);
assert.equal(failedProviderStatus.recommendationState, "manual_exception");
assert.equal(failedProviderStatus.candidates[0].selectionAllowed, false);

const negatedApprovedProviderStatus = recommend([sale({ id: "not-approved", status: "Not Approved" })]);
assert.equal(negatedApprovedProviderStatus.recommendationState, "manual_exception");
assert.equal(negatedApprovedProviderStatus.candidates[0].selectionAllowed, false);

const mixedReversalProviderStatus = recommend([
  sale({ id: "successful-reversal", status: "Successful Reversal" }),
]);
assert.equal(mixedReversalProviderStatus.recommendationState, "manual_exception");
assert.equal(mixedReversalProviderStatus.candidates[0].selectionAllowed, false);

const unsuccessfulProviderStatus = recommend([sale({ id: "unsuccessful", status: "Unsuccessful" })]);
assert.equal(unsuccessfulProviderStatus.recommendationState, "manual_exception");
assert.equal(unsuccessfulProviderStatus.candidates[0].selectionAllowed, false);

const unconfirmedProviderStatus = recommend([sale({ id: "unconfirmed", status: "" })]);
assert.equal(unconfirmedProviderStatus.recommendationState, "manual_exception");
assert.equal(unconfirmedProviderStatus.oneClickEligible, false);

const missingProviderSite = recommend([sale({ id: "missing-site", siteId: null })]);
assert.equal(missingProviderSite.recommendationState, "manual_exception");
assert.equal(missingProviderSite.oneClickEligible, false);

const duplicateProviderRecord = recommend([
  sale({ id: "provider-duplicate" }),
  sale({ id: "provider-duplicate" }),
]);
assert.equal(duplicateProviderRecord.recommendationState, "manual_exception");
assert.equal(duplicateProviderRecord.oneClickEligible, false);

const duplicate = recommend([sale({ id: "duplicate" })], {
  transactionStates: { duplicate: "duplicate" },
});
assert.equal(duplicate.recommendationState, "manual_exception");
assert.equal(duplicate.candidates[0].oneClickEligible, false);
assert.equal(duplicate.candidates[0].selectionAllowed, false);

const alreadyRefunded = recommend([sale({ id: "already-refunded" })], {
  transactionStates: { "already-refunded": "already_refunded" },
});
assert.equal(alreadyRefunded.recommendationState, "manual_exception");
assert.equal(alreadyRefunded.candidates[0].oneClickEligible, false);

const noMatch = recommend([sale({ id: "outside", at: "2026-07-22T08:00:00.000Z" })]);
assert.equal(noMatch.recommendationState, "no_safe_match");
assert.equal(noMatch.candidates.length, 0);

const exactLocal = resolveLocalDateTimeInZone({
  localDate: "2026-07-21",
  localTime: "12:00",
  timeZone: "America/Los_Angeles",
});
assert.deepEqual(exactLocal, {
  instant: incidentAt,
  resolution: "exact",
  possibleInstantCount: 1,
});

const timezoneHelperUrl = new URL(
  "../../supabase/functions/_shared/timezone-resolution.mjs",
  import.meta.url,
).href;
const resolveFromHostTimezone = (hostTimezone) =>
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { resolveLocalDateTimeInZone } from ${JSON.stringify(timezoneHelperUrl)}; console.log(JSON.stringify(resolveLocalDateTimeInZone({ localDate: "2026-07-21", localTime: "12:00", timeZone: "America/Los_Angeles" })));`,
    ],
    { env: { ...process.env, TZ: hostTimezone }, encoding: "utf8" },
  ).trim();
assert.equal(
  resolveFromHostTimezone("Pacific/Honolulu"),
  resolveFromHostTimezone("Europe/London"),
  "canonical location-time resolution must not depend on the customer's browser/host timezone",
);

const springGap = resolveLocalDateTimeInZone({
  localDate: "2026-03-08",
  localTime: "02:30",
  timeZone: "America/Los_Angeles",
});
assert.equal(springGap.resolution, "nonexistent");

const fallFold = resolveLocalDateTimeInZone({
  localDate: "2026-11-01",
  localTime: "01:30",
  timeZone: "America/Los_Angeles",
});
assert.equal(fallFold.resolution, "ambiguous");
assert.equal(fallFold.possibleInstantCount, 2);

const providerLocalDst = recommend(
  [
    sale({
      id: "local-dst",
      at: undefined,
      extra: {
        AuthorizationDateTimeGMT: undefined,
        MachineAuthorizationTime: "2026-07-21 12:00:00",
      },
    }),
  ],
);
assert.equal(providerLocalDst.recommendationState, "high_confidence");
assert.equal(providerLocalDst.candidates[0].authorizedAt, incidentAt);

const ambiguousIncident = recommend([sale({ id: "ambiguous-incident" })], {
  incidentTimeResolution: "ambiguous",
});
assert.equal(ambiguousIncident.recommendationState, "manual_exception");
assert.equal(ambiguousIncident.oneClickEligible, false);

const publicCandidate = toPublicNayaxCandidate(exact.candidates[0], "opaque-token");
const publicJson = JSON.stringify(publicCandidate);
assert.equal("transactionId" in publicCandidate, false, "raw transaction ID must not reach the browser");
assert.equal(publicJson.includes("rankingPoints"), false, "internal points must not look like probability");
assert.equal(publicJson.includes("providerMachineId"), false);
assert.equal(publicCandidate.matchStrength, "strong");
assert.equal(publicCandidate.confidenceClass, "strong_card");
assert.equal(publicCandidate.candidateToken, "opaque-token");

console.log("Nayax deterministic recommendation fixtures passed (33 safety scenarios).");
