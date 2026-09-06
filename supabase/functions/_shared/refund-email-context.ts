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
