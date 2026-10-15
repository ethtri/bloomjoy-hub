export class RefundEmailContextUnavailableError extends Error {
  readonly code = "refund_email_context_unavailable";

  constructor() {
    super(
      "This private email form link is no longer available. Please reply in the same email conversation so our team can continue safely.",
    );
    this.name = "RefundEmailContextUnavailableError";
  }
}

export class RefundPurchaseTimeAfterRequestError extends Error {
  readonly code = "refund_purchase_time_after_request";

  constructor() {
    super(
      "The purchase date and time are later than your original email request. Check the purchase date and approximate local time. If they are correct, reply in the same email conversation so we can help.",
    );
    this.name = "RefundPurchaseTimeAfterRequestError";
  }
}

// P4625 also protects immutable receipts and other evidence. Match this exact
// validation condition, never the SQLSTATE alone, and never expose raw DB text.
export const refundEmailCaseCreationError = (
  error: { code?: unknown; message?: unknown },
): Error => {
  if (
    error.code === "P4625" &&
    error.message === "The reported purchase time cannot be after Bloomjoy received the request"
  ) {
    return new RefundPurchaseTimeAfterRequestError();
  }
  return new Error("Unable to create the email-linked refund request.");
};

export const requireLinkedRefundEmailCase = <T>(
  emailContextToken: string,
  linkedRefundCase: T | null | undefined,
): T | null => {
  if (!emailContextToken) return linkedRefundCase ?? null;
  if (!linkedRefundCase) throw new RefundEmailContextUnavailableError();
  return linkedRefundCase;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const requireLinkedRefundEmailThreadId = (
  emailContextToken: string,
  linkedRefundCase: { gmail_thread_id?: unknown } | null | undefined,
): string | null => {
  if (!emailContextToken) return null;
  const gmailThreadId = linkedRefundCase?.gmail_thread_id;
  if (typeof gmailThreadId !== "string" || !UUID_PATTERN.test(gmailThreadId)) {
    throw new RefundEmailContextUnavailableError();
  }
  return gmailThreadId;
};
