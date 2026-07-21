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
  extra = {},
}) => ({
  TransactionID: id,
  MachineID: machineId,
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
assert.equal(exact.candidates[0].transactionId, "exact");
assert.equal(exact.candidates[0].oneClickEligible, true);

const nearTime = recommend([sale({ id: "near", at: "2026-07-21T19:45:00.000Z" })]);
assert.equal(nearTime.recommendationState, "high_confidence");
assert.equal(nearTime.candidates[0].timeDeltaMinutes, 45);
assert.equal(nearTime.candidates[0].oneClickEligible, true);

const wrongAmount = recommend([sale({ id: "wrong-amount", amount: 9.5 })]);
assert.equal(wrongAmount.recommendationState, "no_safe_match");
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
assert.equal(exactWallet.recommendationState, "manual_exception");
assert.equal(exactWallet.oneClickEligible, false);

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
assert.equal(publicCandidate.candidateToken, "opaque-token");

console.log("Nayax deterministic recommendation fixtures passed (17 safety scenarios).");
