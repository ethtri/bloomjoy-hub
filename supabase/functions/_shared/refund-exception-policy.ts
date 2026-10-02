// Currency boundaries are integer cents; the customer's purchase stays separate
// from a Manager's affected portion or courtesy offer.
export const refundExceptionCategories = ["partial_items", "expected_cash_change"] as const;

export function refundGiftCardFaceValue(amountCents: number): number {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("A positive amount is required.");
  return Math.ceil(amountCents / 500) * 500;
}

export function refundExceptionReviewReasons(category: string, faceValueCents: number, repeat: boolean): string[] {
  return [
    ...(category === "partial_items" ? ["partial_items"] : []),
    ...(category === "expected_cash_change" ? ["expected_cash_change"] : []),
    ...(faceValueCents > 2500 ? ["gift_value_over_25"] : []),
    ...(repeat ? ["repeat_within_12_months"] : []),
  ];
}

export function parseApprovedRefundAmount(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("Enter a positive refund amount in cents.");
  return value;
}
