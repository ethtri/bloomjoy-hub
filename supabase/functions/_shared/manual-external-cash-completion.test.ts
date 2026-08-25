/// <reference lib="deno.ns" />

import { deriveManualExternalCashCompletionContext } from "./manual-external-cash-completion.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("manual external completion derives the amount and omits client payout fields", () => {
  const result = deriveManualExternalCashCompletionContext({
    paymentAmountCents: 800,
    managerConfirmed: true,
  });

  assert(result.ok, "valid server case facts should produce a completion context");
  if (!result.ok) return;
  assert(result.context.refundAmountCents === 800, "case amount must be preserved");
  assert(result.context.manualRefundReference === null, "no payment reference is accepted");
  assert(result.context.cashPayoutSentAt === null, "server completion records its own time");
  assert(result.context.cashPaymentConfirmed === true, "dialog confirmation is the attestation");
  assert(
    Object.keys(result.context).sort().join(",") ===
      "cashPaymentConfirmed,cashPayoutSentAt,manualRefundReference,refundAmountCents",
    "completion context must stay narrow",
  );
});

Deno.test("manual external completion rejects a missing manager confirmation", () => {
  const result = deriveManualExternalCashCompletionContext({
    paymentAmountCents: 800,
    managerConfirmed: false,
  });

  assert(!result.ok, "confirmation must be explicit");
  if (result.ok) return;
  assert(result.status === 400, "missing confirmation is invalid input");
  assert(result.errorCode === "cash_confirmation_required", "stable confirmation error expected");
});

Deno.test("manual external completion rejects a missing or invalid case amount", () => {
  for (const paymentAmountCents of [null, undefined, 0, -1, 7.25, "not-an-amount"]) {
    const result = deriveManualExternalCashCompletionContext({
      paymentAmountCents,
      managerConfirmed: true,
    });
    assert(!result.ok, `amount ${String(paymentAmountCents)} must fail`);
    if (result.ok) continue;
    assert(result.status === 409, "missing case facts require a refresh/follow-up response");
    assert(result.errorCode === "cash_payment_amount_required", "stable amount error expected");
  }
});
