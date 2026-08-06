export class RefundEmailContextUnavailableError extends Error {
  readonly code = "refund_email_context_unavailable";

  constructor() {
    super(
      "This private email form link is no longer available. Please reply in the same email conversation so our team can continue safely.",
    );
    this.name = "RefundEmailContextUnavailableError";
  }
}

export const requireLinkedRefundEmailCase = <T>(
  emailContextToken: string,
  linkedRefundCase: T | null | undefined,
): T | null => {
  if (!emailContextToken) return linkedRefundCase ?? null;
  if (!linkedRefundCase) throw new RefundEmailContextUnavailableError();
  return linkedRefundCase;
};
