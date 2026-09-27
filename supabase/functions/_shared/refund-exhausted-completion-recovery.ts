import {
  getGmailHeader,
  parseEmailAddressList,
  REFUND_GMAIL_OPERATION_HEADER,
  refundGmailOperationMarker,
  type GmailThread,
} from "./refund-gmail.ts";

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
    if (getGmailHeader(headers, REFUND_GMAIL_OPERATION_HEADER) === operationMarker) {
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
