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

export type CompletionThreadHistoryDiagnostic = {
  valid: boolean;
  threadIdMatch: boolean;
  reviewedHistoryIdFormat: boolean;
  historyIdMatch: boolean;
  messageCount: number;
  messageSetPresent: boolean;
  completionTimeValid: boolean;
  auditTimeValid: boolean;
  auditNotBeforeCompletion: boolean;
  auditEnvelopeConfigured: boolean;
  recipientConfigured: boolean;
  allMessageThreadIdsMatch: boolean;
  allHeadersPresent: boolean;
  allInternalDatesValid: boolean;
  hasDraft: boolean;
  hasOperationMarker: boolean;
  customerDirectedAfterCompletionCount: number;
  timingMatchCount: number;
  labelMatchCount: number;
  toMatchCount: number;
  ccCountMatchCount: number;
  mailboxCcMatchCount: number;
  senderMatchCount: number;
  auditedMatchCount: number;
  unexpectedCustomerDirectedCount: number;
  safeCurrentHistoryId: string | null;
  payloadRedacted: true;
};

// This diagnostic intentionally exposes only bounded counts and booleans. It is
// safe for an authorized operator to refresh an opaque Gmail history token only
// after every semantic delivery predicate succeeds.
export const diagnoseUnsentCompletionThreadHistory = ({
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
}): CompletionThreadHistoryDiagnostic => {
  const createdMs = Date.parse(completionCreatedAt);
  const auditedPriorMs = auditedPriorDelivery === null
    ? null
    : Date.parse(auditedPriorDelivery.deliveredAt);
  const recipient = recipientEmail.trim().toLowerCase();
  const mailbox = mailboxEmail?.trim().toLowerCase() ?? "";
  const currentHistoryId = thread.historyId ?? "";
  const senders = new Set(senderIdentities.map((value) =>
    value.trim().toLowerCase()
  ).filter(Boolean));
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const operationMarker = refundGmailOperationMarker(
    `refund-case-message:${completionMessageId}`,
  );
  const diagnostic: CompletionThreadHistoryDiagnostic = {
    valid: false,
    threadIdMatch: thread.id === providerThreadId,
    reviewedHistoryIdFormat: /^[0-9]{3,30}$/.test(reviewedHistoryId),
    historyIdMatch: currentHistoryId === reviewedHistoryId,
    messageCount: messages.length,
    messageSetPresent: messages.length > 0,
    completionTimeValid: Number.isFinite(createdMs),
    auditTimeValid: auditedPriorMs === null || Number.isFinite(auditedPriorMs),
    auditNotBeforeCompletion: auditedPriorMs === null ||
      (Number.isFinite(createdMs) && auditedPriorMs >= createdMs),
    auditEnvelopeConfigured: auditedPriorDelivery === null ||
      (Boolean(mailbox) && senders.size > 0 &&
        Number.isInteger(auditedPriorDelivery.managerCcCount) &&
        auditedPriorDelivery.managerCcCount >= 1 &&
        auditedPriorDelivery.managerCcCount <= 4),
    recipientConfigured: Boolean(recipient),
    allMessageThreadIdsMatch: true,
    allHeadersPresent: true,
    allInternalDatesValid: true,
    hasDraft: false,
    hasOperationMarker: false,
    customerDirectedAfterCompletionCount: 0,
    timingMatchCount: 0,
    labelMatchCount: 0,
    toMatchCount: 0,
    ccCountMatchCount: 0,
    mailboxCcMatchCount: 0,
    senderMatchCount: 0,
    auditedMatchCount: 0,
    unexpectedCustomerDirectedCount: 0,
    safeCurrentHistoryId: null,
    payloadRedacted: true,
  };

  for (const message of messages) {
    if (message.threadId !== providerThreadId) {
      diagnostic.allMessageThreadIdsMatch = false;
    }
    const headers = message.payload?.headers;
    if (!headers) {
      diagnostic.allHeadersPresent = false;
      continue;
    }
    if (
      getGmailHeader(headers, REFUND_GMAIL_OPERATION_HEADER) === operationMarker
    ) diagnostic.hasOperationMarker = true;
    const labels = message.labelIds ?? [];
    if (labels.includes("DRAFT")) diagnostic.hasDraft = true;
    const toRecipients = parseEmailAddressList(getGmailHeader(headers, "To"));
    const ccRecipients = parseEmailAddressList(getGmailHeader(headers, "Cc"));
    const recipients = [...toRecipients, ...ccRecipients,
      ...parseEmailAddressList(getGmailHeader(headers, "Bcc"))];
    if (auditedPriorMs === null && !labels.includes("SENT")) continue;
    if (!recipients.includes(recipient)) continue;
    const sentMs = Number(message.internalDate);
    if (!Number.isFinite(sentMs)) {
      diagnostic.allInternalDatesValid = false;
      continue;
    }
    if (sentMs < createdMs) continue;
    diagnostic.customerDirectedAfterCompletionCount += 1;
    if (auditedPriorMs === null) {
      diagnostic.unexpectedCustomerDirectedCount += 1;
      continue;
    }
    const timingMatch = Math.abs(sentMs - auditedPriorMs) <= 60 * 1000;
    const labelMatch = labels.includes("INBOX") && !labels.includes("SENT");
    const toMatch = toRecipients.length === 1 && toRecipients[0] === recipient;
    const ccCountMatch = ccRecipients.length === auditedPriorDelivery!.managerCcCount;
    const mailboxCcMatch = ccRecipients.includes(mailbox);
    const senderMatch = parseEmailAddressList(getGmailHeader(headers, "From"))
      .some((from) => senders.has(from));
    if (timingMatch) diagnostic.timingMatchCount += 1;
    if (labelMatch) diagnostic.labelMatchCount += 1;
    if (toMatch) diagnostic.toMatchCount += 1;
    if (ccCountMatch) diagnostic.ccCountMatchCount += 1;
    if (mailboxCcMatch) diagnostic.mailboxCcMatchCount += 1;
    if (senderMatch) diagnostic.senderMatchCount += 1;
    if (
      timingMatch && labelMatch && toMatch && ccCountMatch &&
      mailboxCcMatch && senderMatch
    ) diagnostic.auditedMatchCount += 1;
    else diagnostic.unexpectedCustomerDirectedCount += 1;
  }

  const semanticValid = diagnostic.threadIdMatch &&
    diagnostic.reviewedHistoryIdFormat && diagnostic.messageSetPresent &&
    diagnostic.completionTimeValid && diagnostic.auditTimeValid &&
    diagnostic.auditNotBeforeCompletion && diagnostic.auditEnvelopeConfigured &&
    diagnostic.recipientConfigured && diagnostic.allMessageThreadIdsMatch &&
    diagnostic.allHeadersPresent && diagnostic.allInternalDatesValid &&
    !diagnostic.hasDraft && !diagnostic.hasOperationMarker &&
    diagnostic.unexpectedCustomerDirectedCount === 0 &&
    (auditedPriorMs === null
      ? diagnostic.customerDirectedAfterCompletionCount === 0
      : diagnostic.auditedMatchCount === 1);
  diagnostic.valid = semanticValid && diagnostic.historyIdMatch;
  diagnostic.safeCurrentHistoryId = semanticValid &&
      /^[0-9]{3,30}$/.test(currentHistoryId)
    ? currentHistoryId
    : null;
  return diagnostic;
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
