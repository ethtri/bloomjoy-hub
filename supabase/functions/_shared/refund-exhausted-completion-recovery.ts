import {
  getGmailHeader,
  type GmailThread,
  parseEmailAddressList,
  REFUND_GMAIL_OPERATION_HEADER,
  refundGmailOperationMarker,
} from "./refund-gmail.ts";

export type ReviewedCurrentCompletionCopy = {
  subject: string;
  body: string;
};

// Exhausted completion recovery is exceptional and must not replay the old
// timing promise after its display window has elapsed. Preserve the reviewed
// copy byte-for-byte after trimming checks so the database can bind the same
// text to the original ledger message.
export const reviewedCurrentCompletionCopy = ({
  subject,
  body,
}: {
  subject: unknown;
  body: unknown;
}): ReviewedCurrentCompletionCopy | null => {
  if (typeof subject !== "string" || typeof body !== "string") return null;
  if (
    subject !== subject.trim() || body !== body.trim() ||
    subject.length === 0 || subject.length > 180 ||
    body.length === 0 || body.length > 4000 ||
    !/^re:\s+/i.test(subject) ||
    !/\bconfirmed\b/i.test(body) || !/\brefund\b/i.test(body) ||
    /\bon its way\b/i.test(body) || /\bbusiness\s+days?\b/i.test(body)
  ) return null;
  return { subject, body };
};

// A missing database delivery row alone is insufficient after a provider call.
// The operator's reviewed history must still be current, and the original
// conversation must have no later sent mail to this customer.
export const verifiedUnsentCompletionThreadHistory = ({
  thread,
  providerThreadId,
  reviewedHistoryId,
  recipientEmail,
  completionCreatedAt,
  completionMessageId,
}: {
  thread: GmailThread;
  providerThreadId: string;
  reviewedHistoryId: string;
  recipientEmail: string;
  completionCreatedAt: string;
  completionMessageId: string;
}): string | null => {
  const createdMs = Date.parse(completionCreatedAt);
  const recipient = recipientEmail.trim().toLowerCase();
  if (
    thread.id !== providerThreadId ||
    !/^[0-9]{3,30}$/.test(reviewedHistoryId) ||
    thread.historyId !== reviewedHistoryId ||
    !Array.isArray(thread.messages) || thread.messages.length === 0 ||
    !Number.isFinite(createdMs) || !recipient
  ) return null;

  const operationMarker = refundGmailOperationMarker(
    `refund-case-message:${completionMessageId}`,
  );
  for (const message of thread.messages) {
    if (message.threadId !== providerThreadId) return null;
    const headers = message.payload?.headers;
    if (!headers) return null;
    if (
      getGmailHeader(headers, REFUND_GMAIL_OPERATION_HEADER) === operationMarker
    ) {
      return null;
    }
    if (!(message.labelIds ?? []).includes("SENT")) continue;
    const recipients = ["To", "Cc", "Bcc"].flatMap((header) =>
      parseEmailAddressList(getGmailHeader(headers, header))
    );
    if (!recipients.includes(recipient)) continue;
    const sentMs = Number(message.internalDate);
    if (!Number.isFinite(sentMs) || sentMs >= createdMs) return null;
  }
  return reviewedHistoryId;
};
