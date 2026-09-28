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

export type AuditedPriorCompletionDelivery = {
  deliveredAt: string;
  managerCcCount: number;
};

const auditedPriorDeliveryMetadataKeys = [
  "deliveryTransport",
  "managerCcCount",
  "originalGmailThreadPreserved",
  "paymentOperationPerformed",
  "providerLastEvent",
  "providerMessageIdDigest",
  "sourceMessageId",
];

export const auditedPriorCompletionDelivery = ({
  event,
  completionMessageId,
}: {
  event: unknown;
  completionMessageId: string;
}): AuditedPriorCompletionDelivery | null => {
  if (!event || typeof event !== "object") return null;
  const row = event as Record<string, unknown>;
  const metadata = row.metadata && typeof row.metadata === "object"
    ? row.metadata as Record<string, unknown>
    : null;
  const deliveredAt = typeof row.created_at === "string" ? row.created_at : "";
  const metadataKeys = metadata ? Object.keys(metadata).sort() : [];
  if (
    row.event_type !== "refund_customer_completion_recovery_sent" ||
    !metadata || metadata.sourceMessageId !== completionMessageId ||
    metadataKeys.length !== auditedPriorDeliveryMetadataKeys.length ||
    metadataKeys.some((key, index) =>
      key !== auditedPriorDeliveryMetadataKeys[index]
    ) ||
    metadata.deliveryTransport !== "resend" ||
    metadata.providerLastEvent !== "delivered" ||
    metadata.originalGmailThreadPreserved !== true ||
    metadata.paymentOperationPerformed !== false ||
    typeof metadata.managerCcCount !== "number" ||
    !Number.isInteger(metadata.managerCcCount) ||
    metadata.managerCcCount < 1 || metadata.managerCcCount > 4 ||
    typeof metadata.providerMessageIdDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(metadata.providerMessageIdDigest) ||
    !Number.isFinite(Date.parse(deliveredAt))
  ) return null;
  return {
    deliveredAt,
    managerCcCount: metadata.managerCcCount as number,
  };
};

export const auditedPriorCompletionDeliverySet = ({
  events,
  completionMessageId,
}: {
  events: unknown[];
  completionMessageId: string;
}): AuditedPriorCompletionDelivery[] | null => {
  if (events.length > 1) return null;
  const audited = events.map((event) =>
    auditedPriorCompletionDelivery({ event, completionMessageId })
  );
  return audited.every((delivery) => delivery !== null)
    ? audited as AuditedPriorCompletionDelivery[]
    : null;
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
    !/\bNayax confirmed your \$\d+\.\d{2} refund on [A-Z][a-z]+ (?:[1-9]|[12]\d|3[01])\./
      .test(body) ||
    /\b(?:not confirmed|no refund|not processed|did not process|refund failed|failed refund)\b/i
      .test(body) ||
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
  auditedPriorDelivery = null,
  mailboxEmail = null,
  senderIdentities = [],
}: {
  thread: GmailThread;
  providerThreadId: string;
  reviewedHistoryId: string;
  recipientEmail: string;
  completionCreatedAt: string;
  completionMessageId: string;
  auditedPriorDelivery?: AuditedPriorCompletionDelivery | null;
  mailboxEmail?: string | null;
  senderIdentities?: string[];
}): string | null => {
  const createdMs = Date.parse(completionCreatedAt);
  const auditedPriorMs = auditedPriorDelivery === null
    ? null
    : Date.parse(auditedPriorDelivery.deliveredAt);
  const recipient = recipientEmail.trim().toLowerCase();
  const mailbox = mailboxEmail?.trim().toLowerCase() ?? "";
  const senders = new Set(senderIdentities.map((value) =>
    value.trim().toLowerCase()
  ).filter(Boolean));
  if (
    thread.id !== providerThreadId ||
    !/^[0-9]{3,30}$/.test(reviewedHistoryId) ||
    thread.historyId !== reviewedHistoryId ||
    !Array.isArray(thread.messages) || thread.messages.length === 0 ||
    !Number.isFinite(createdMs) ||
    (auditedPriorMs !== null && !Number.isFinite(auditedPriorMs)) ||
    (auditedPriorMs !== null && auditedPriorMs < createdMs) ||
    (auditedPriorDelivery !== null &&
      (!mailbox || senders.size === 0 ||
        !Number.isInteger(auditedPriorDelivery.managerCcCount) ||
        auditedPriorDelivery.managerCcCount < 1 ||
        auditedPriorDelivery.managerCcCount > 4)) ||
    !recipient
  ) return null;

  const operationMarker = refundGmailOperationMarker(
    `refund-case-message:${completionMessageId}`,
  );
  let auditedPriorDeliveryCount = 0;
  for (const message of thread.messages) {
    if (message.threadId !== providerThreadId) return null;
    const headers = message.payload?.headers;
    if (!headers) return null;
    if (
      getGmailHeader(headers, REFUND_GMAIL_OPERATION_HEADER) === operationMarker
    ) {
      return null;
    }
    const labels = message.labelIds ?? [];
    if (labels.includes("DRAFT")) return null;
    const toRecipients = parseEmailAddressList(getGmailHeader(headers, "To"));
    const ccRecipients = parseEmailAddressList(getGmailHeader(headers, "Cc"));
    const recipients = [...toRecipients, ...ccRecipients,
      ...parseEmailAddressList(getGmailHeader(headers, "Bcc"))];
    if (auditedPriorMs === null && !labels.includes("SENT")) continue;
    if (!recipients.includes(recipient)) continue;
    const sentMs = Number(message.internalDate);
    if (!Number.isFinite(sentMs)) return null;
    if (sentMs < createdMs) continue;
    if (
      auditedPriorMs !== null &&
      Math.abs(sentMs - auditedPriorMs) <= 60 * 1000 &&
      labels.includes("INBOX") && !labels.includes("SENT") &&
      toRecipients.length === 1 && toRecipients[0] === recipient &&
      ccRecipients.length === auditedPriorDelivery!.managerCcCount &&
      ccRecipients.includes(mailbox) &&
      parseEmailAddressList(getGmailHeader(headers, "From"))
        .some((from) => senders.has(from))
    ) {
      auditedPriorDeliveryCount += 1;
      if (auditedPriorDeliveryCount > 1) return null;
      continue;
    }
    return null;
  }
  if (auditedPriorMs !== null && auditedPriorDeliveryCount !== 1) return null;
  return reviewedHistoryId;
};
