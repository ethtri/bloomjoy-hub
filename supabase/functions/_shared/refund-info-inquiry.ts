import {
  extractPlainTextBody,
  getGmailHeader,
  hasCustomerFacingMailboxReply,
  type GmailMessage,
  inspectRefundGmailParticipantSignals,
} from "./refund-gmail.ts";

export type RefundInfoInquiryRoute =
  | "not_info"
  | "untrusted"
  | "non_refund"
  | "needs_review"
  | "existing_case_question"
  | "new_refund_inquiry";

export const infoInquiryEnabled = (value: string | undefined) =>
  value?.trim().toLowerCase() === "true";

export function infoRecoveryScanOutcome({
  initialCursor,
  nextCursor,
  pagesFetched,
  allThreadsProcessed,
  scanFailed,
}: {
  initialCursor: string | null;
  nextCursor: string | null;
  pagesFetched: boolean;
  allThreadsProcessed: boolean;
  scanFailed: boolean;
}): { cursor: string | null; fullScanCompleted: boolean } {
  const complete = pagesFetched && allThreadsProcessed && !scanFailed;
  return {
    cursor: complete ? nextCursor : initialCursor,
    fullScanCompleted: complete && nextCursor === null,
  };
}

export function infoInquiryMissingSource({
  route,
  sourceMessageId,
}: {
  route: RefundInfoInquiryRoute;
  sourceMessageId: string | null;
}): boolean {
  const normalizedId = sourceMessageId?.trim();
  return (route === "new_refund_inquiry" || route === "needs_review" ||
    route === "existing_case_question") &&
    (!normalizedId || normalizedId !== sourceMessageId || normalizedId.length > 255);
}

export function infoInquirySourceMissingSender(
  classified: { route: RefundInfoInquiryRoute; sourceMessageId: string | null } | null,
  currentMessageId: string | null,
  senderEmail: string,
): boolean {
  return classified !== null && !infoInquiryMissingSource(classified) &&
    classified.sourceMessageId !== null &&
    classified.sourceMessageId === currentMessageId &&
    !senderEmail;
}

export const infoInquiryNonCustomerSkipped = (
  ingestion: { skipped?: boolean; reason?: string } | null,
): boolean => ingestion?.skipped === true &&
  ingestion.reason === "unlinked_non_customer_message";

const INFO_RECIPIENTS = new Set([
  "info@bloomjoysweets.com",
  "support@bloomjoysweets.com",
  "refunds@bloomjoysweets.com",
]);

export const refundInquiryRecipient = (toEmails: string[], ccEmails: string[]) =>
  [...toEmails, ...ccEmails].find((email) => INFO_RECIPIENTS.has(email));

const currentMessageText = (value: string) => value
  .split(/(?:^|\n)(?:On .{4,160} wrote:|-----Original Message-----|From:\s*.+@.+)/i, 1)[0]
  .split("\n")
  .filter((line) => !/^\s*>/.test(line))
  .join("\n")
  .slice(0, 8000)
  .replace(/[’‘]/g, "'")
  .toLowerCase();

// Acknowledgment is the default for direct customer mail. Do not require
// purchase/problem vocabulary: short, attachment-only and non-English messages
// need the same receipt and conditional form link as an explicit refund ask.
const automatedSender = /(?:^|[-_.])(?:no[-_.]?reply|do[-_.]?not[-_.]?reply)(?:@|[-_.])|^(?:notifier|notifications?)@|(?:acctsreceivable|accountsreceivable)@/i;
const automatedSubject = /^(?:automatic\s+reply|auto[- ]?reply|out\s+of\s+office|receipt\s+for\s+.+\s+payment\s+to)\b/i;
const statusQuestion = /\b(?:where\s+is\s+my\s+refund|status\s+of\s+my\s+(?:refund|case|request)|already\s+(?:submitted|filled\s+out|completed)\s+(?:the\s+)?(?:refund\s+)?form|following\s+up\s+on\s+my\s+(?:refund|case|request))\b/i;
const publicReference = /\bRF-[A-Z0-9]{6,20}\b/i;
const businessContext = /\b(?:wholesale|partnership|sponsorship|advertising|marketing|seo|payroll|technician|service\s+ticket|vendor|supplier|timekeeping|timesheets?|accounts\s+receivable|shipping\s+(?:rates?|updates?|labels?)|(?:usps|ups)\s+(?:is\s+(?:raising|updating)\s+)?(?:service|holiday|rates?|surcharges)|(?:web|website)\s+(?:design|redesign|development))\b/i;

export function classifyRefundInfoInquiry({
  messages,
  mailboxIdentities,
}: {
  messages: GmailMessage[];
  mailboxIdentities: string[];
}): { route: RefundInfoInquiryRoute; sourceMessageId: string | null } {
  const connectedIdentities = new Set(mailboxIdentities.map((email) => email.toLowerCase()));
  let infoAddressed = false;
  let untrusted = false;
  let knownBusinessThread = false;
  let latestApplicable: { route: RefundInfoInquiryRoute; sourceMessageId: string | null } | null = null;
  for (const message of messages) {
    const signals = inspectRefundGmailParticipantSignals({
      message,
      mailboxIdentities,
    });
    if (![...signals.toEmails, ...signals.ccEmails].some((email) =>
      INFO_RECIPIENTS.has(email) && connectedIdentities.has(email))) {
      continue;
    }
    infoAddressed = true;
    if (signals.mailboxOrigin || signals.participantTrust !== "direct_human" ||
      automatedSender.test(signals.from.email) ||
      automatedSubject.test(getGmailHeader(message.payload?.headers, "Subject")) ||
      (message.labelIds ?? []).some((label) => ["SPAM", "TRASH"].includes(label.toUpperCase()))) {
      untrusted = true;
      continue;
    }
    const subject = getGmailHeader(message.payload?.headers, "Subject");
    const text = currentMessageText(`${subject}\n${extractPlainTextBody(message.payload)}`);
    if (businessContext.test(text)) {
      knownBusinessThread = true;
      // A later business message must not trigger an older automatic reply.
      // Retain an already observed customer inquiry for human review instead
      // of silently losing its unanswered obligation.
      const prior = latestApplicable as { route: RefundInfoInquiryRoute; sourceMessageId: string | null } | null;
      latestApplicable = prior && prior.route !== "non_refund"
        ? { route: "needs_review", sourceMessageId: prior.sourceMessageId }
        : { route: "non_refund", sourceMessageId: null };
      continue;
    }
    if (publicReference.test(text) || statusQuestion.test(text)) {
      latestApplicable = { route: "existing_case_question", sourceMessageId: message.id ?? null };
      continue;
    }
    if (knownBusinessThread && latestApplicable?.route === "non_refund") continue;
    latestApplicable = { route: "new_refund_inquiry", sourceMessageId: message.id ?? null };
  }
  if (latestApplicable?.route === "new_refund_inquiry") {
    const source = messages.find((message) => message.id === latestApplicable?.sourceMessageId);
    const customerEmail = source
      ? inspectRefundGmailParticipantSignals({ message: source, mailboxIdentities }).from.email
      : "";
    // The first-response obligation must use the same provider-Sent evidence as
    // duplicate prevention. A previously answered conversation is not a new
    // acknowledgment obligation, even when its latest customer message is short.
    if (hasCustomerFacingMailboxReply({ messages, mailboxIdentities, customerEmail })) {
      return { route: "non_refund", sourceMessageId: null };
    }
  }
  if (latestApplicable) return latestApplicable;
  return { route: !infoAddressed ? "not_info" : untrusted ? "untrusted" : "non_refund",
    sourceMessageId: null };
}
