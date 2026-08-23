export const REFUND_CUSTOMER_SAFE_DENIAL_REASONS = [
  "We’re sorry, but we could not verify a matching purchase for the details provided.",
  "We’re sorry, but the purchase details do not match the transaction record for this machine.",
  "We’re sorry, but our records show this transaction has already been refunded.",
  "We’re sorry, but this request is not eligible under Bloomjoy’s refund policy.",
] as const;

const reasonSet = new Set<string>(REFUND_CUSTOMER_SAFE_DENIAL_REASONS);

export const isRefundCustomerSafeDenialReason = (
  value: string | null | undefined,
) => typeof value === "string" && reasonSet.has(value.trim());
