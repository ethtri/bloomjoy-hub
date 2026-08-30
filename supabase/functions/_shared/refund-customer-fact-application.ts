export type RefundCustomerFactApplicationResult = {
  outcome?: "applied" | "conflict" | "already_applied";
  factVersion?: number;
  reason?: string;
};

export type RefundCustomerFactApplicationDecision =
  | "accepted"
  | "retryable_conflict"
  | "invalid_response";

export const classifyRefundCustomerFactApplication = (
  result: RefundCustomerFactApplicationResult | null | undefined,
): RefundCustomerFactApplicationDecision => {
  if (
    (result?.outcome === "applied" ||
      result?.outcome === "already_applied") &&
    Number.isSafeInteger(result.factVersion) &&
    Number(result.factVersion) >= 1
  ) {
    return "accepted";
  }
  if (result?.outcome === "conflict") return "retryable_conflict";
  return "invalid_response";
};
