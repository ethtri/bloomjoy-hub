import {
  extractPlainTextBody,
  getGmailHeader,
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

const INFO_RECIPIENTS = new Set([
  "info@bloomjoysweets.com",
  "support@bloomjoysweets.com",
]);

const currentMessageText = (value: string) => value
  .split(/(?:^|\n)(?:On .{4,160} wrote:|-----Original Message-----|From:\s*.+@.+)/i, 1)[0]
  .split("\n")
  .filter((line) => !/^\s*>/.test(line))
  .join("\n")
  .slice(0, 8000)
  .toLowerCase();

const personalExperience = /\b(?:i|me|my|we|our)\b/i;
const directRefundAsk = /\b(?:refund\s+(?:me|my|us|our)|(?:i|we)\s+(?:want|need|would\s+like|request|asked\s+for)\s+(?:a\s+)?refund|would\s+like\s+(?:a\s+)?refund|(?:can|could|will)\s+(?:i|we)\s+(?:get|have|request)\s+(?:a\s+)?refund|(?:give|send)\s+(?:me|us)\s+(?:a\s+)?refund|money\s+back|charged\s+(?:me|us)\s+twice)\b/i;
const purchaseExperience = /\b(?:bought|purchased|paid|was\s+charged|got\s+charged|tried\s+(?:to\s+)?(?:buy|use)|used\s+(?:your|the)\s+machine|my\s+(?:order|purchase))\b/i;
const productContext = /\b(?:bloomjoy|cotton\s+candy|vending\s+machine|your\s+machine|your\s+product|candy\s+machine)\b/i;
const productFailure = /\b(?:did\s+not|didn't|never|failed|broken|stale|bad|wrong|missing|damaged|empty|not\s+working|did\s+not\s+dispense|didn't\s+dispense|no\s+candy|double\s+charg(?:e|ed))\b/i;
const statusQuestion = /\b(?:where\s+is\s+my\s+refund|status\s+of\s+my\s+(?:refund|case|request)|already\s+(?:submitted|filled\s+out|completed)\s+(?:the\s+)?(?:refund\s+)?form|following\s+up\s+on\s+my\s+(?:refund|case|request))\b/i;
const publicReference = /\bRF-[A-Z0-9]{6,20}\b/i;
const businessContext = /\b(?:invoice|wholesale|partnership|sponsorship|advertising|marketing|seo|payroll|technician|service\s+ticket|vendor|supplier)\b/i;

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
    if (signals.mailboxOrigin || signals.participantTrust !== "direct_human") {
      untrusted = true;
      continue;
    }
    const subject = getGmailHeader(message.payload?.headers, "Subject");
    const text = currentMessageText(`${subject}\n${extractPlainTextBody(message.payload)}`);
    if (businessContext.test(text)) {
      // A later vendor/business message also supersedes any older customer
      // inquiry in this thread; it must never inherit a pending form reply.
      latestApplicable = { route: "non_refund", sourceMessageId: null };
      continue;
    }
    if (publicReference.test(text) || statusQuestion.test(text)) {
      latestApplicable = { route: "existing_case_question", sourceMessageId: message.id ?? null };
      continue;
    }
    const personal = personalExperience.test(text);
    if (personal && directRefundAsk.test(text)) {
      latestApplicable = { route: "new_refund_inquiry", sourceMessageId: message.id ?? null };
      continue;
    }
    if (personal && purchaseExperience.test(text) && productContext.test(text) &&
      productFailure.test(text)) {
      latestApplicable = { route: "new_refund_inquiry", sourceMessageId: message.id ?? null };
      continue;
    }
    if (personal && productContext.test(text) && productFailure.test(text)) {
      latestApplicable = { route: "needs_review", sourceMessageId: message.id ?? null };
    }
  }
  if (latestApplicable) return latestApplicable;
  return { route: !infoAddressed ? "not_info" : untrusted ? "untrusted" : "non_refund",
    sourceMessageId: null };
}
