export type ManualExternalCashCompletionContext = {
  refundAmountCents: number;
  manualRefundReference: null;
  cashPayoutSentAt: null;
  cashPaymentConfirmed: true;
};

export type ManualExternalCashCompletionResult =
  | { ok: true; context: ManualExternalCashCompletionContext }
  | {
      ok: false;
      status: 400 | 409;
      errorCode: "cash_confirmation_required" | "cash_payment_amount_required";
      error: string;
    };

export const deriveManualExternalCashCompletionContext = ({
  paymentAmountCents,
  managerConfirmed,
}: {
  paymentAmountCents: unknown;
  managerConfirmed: unknown;
}): ManualExternalCashCompletionResult => {
  if (managerConfirmed !== true) {
    return {
      ok: false,
      status: 400,
      errorCode: "cash_confirmation_required",
      error: "Confirm that the customer was already refunded outside Bloomjoy Hub.",
    };
  }

  const amount = Number(paymentAmountCents);
  if (!Number.isInteger(amount) || amount <= 0) {
    return {
      ok: false,
      status: 409,
      errorCode: "cash_payment_amount_required",
      error: "Confirm the customer payment amount before marking this case refunded.",
    };
  }

  return {
    ok: true,
    context: {
      refundAmountCents: amount,
      manualRefundReference: null,
      cashPayoutSentAt: null,
      cashPaymentConfirmed: true,
    },
  };
};
