import { classifyRefundInfoInquiry, infoInquiryEnabled, infoInquiryMissingSource, infoInquirySourceMissingSender, infoRecoveryScanOutcome } from "./refund-info-inquiry.ts";
import { infoRefundInquiryThreadQuery, type GmailMessage } from "./refund-gmail.ts";

Deno.test("Info inquiry activation is explicitly true only", () => {
  for (const disabled of [undefined, "", "false", "1", "yes", "active"]) {
    if (infoInquiryEnabled(disabled)) throw new Error("Info inquiry activation must default off");
  }
  if (!infoInquiryEnabled(" true ") || !infoInquiryEnabled("TRUE")) {
    throw new Error("Explicit true must activate Info discovery");
  }
});

Deno.test("Info mailbox search is independent of the refund label and preserves pagination", () => {
  const params = infoRefundInquiryThreadQuery(new Date("2026-09-19T15:00:00Z"), "synthetic-page");
  if (!params.get("q")?.includes("to:info@bloomjoysweets.com") ||
    !params.get("q")?.includes("cc:info@bloomjoysweets.com") ||
    !params.get("q")?.includes("to:support@bloomjoysweets.com") ||
    !params.get("q")?.includes("cc:support@bloomjoysweets.com") ||
    params.get("pageToken") !== "synthetic-page" || params.has("labelIds")) {
    throw new Error("Info/Support recovery must search the connected mailbox, not the refund label");
  }
});

const assertRoute = (message: GmailMessage, expected: string) => {
  const result = classifyRefundInfoInquiry({
    messages: [message],
    mailboxIdentities: ["info@bloomjoysweets.com", "support@bloomjoysweets.com", "refunds@bloomjoysweets.com"],
  });
  if (result.route !== expected) {
    throw new Error(`Expected ${expected}, received ${result.route}`);
  }
};

const message = ({
  from = "customer@example.test",
  to = "info@bloomjoysweets.com",
  subject = "Question",
  body = "",
  extraHeaders = [],
}: {
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  extraHeaders?: Array<{ name: string; value: string }>;
}): GmailMessage => ({
  id: "synthetic-message",
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: from },
      { name: "To", value: to },
      { name: "Subject", value: subject },
      ...extraHeaders,
    ],
    body: { data: btoa(body).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") },
  },
});

Deno.test("direct Info refund request is eligible for the form-link path", () => {
  assertRoute(message({ subject: "Refund please", body: "I was charged and would like a refund." }),
    "new_refund_inquiry");
});

Deno.test("an unrelated sync failure does not pin a completed Info recovery page", () => {
  // The overall run may fail on labeled mail; Info cursor settlement uses only
  // the independently observed Info page outcome.
  const result = infoRecoveryScanOutcome({
    initialCursor: "old-info-page", nextCursor: "next-info-page",
    pagesFetched: true, allThreadsProcessed: true, scanFailed: false,
  });
  if (result.cursor !== "next-info-page" || result.fullScanCompleted) {
    throw new Error("The Info cursor must reflect its own completed page");
  }
});

Deno.test("failed or unprocessed Info pages retain the exact recovery cursor", () => {
  for (const state of [
    { pagesFetched: false, allThreadsProcessed: false, scanFailed: true },
    { pagesFetched: true, allThreadsProcessed: false, scanFailed: false },
    { pagesFetched: true, allThreadsProcessed: true, scanFailed: true },
  ]) {
    const result = infoRecoveryScanOutcome({
      initialCursor: "old-info-page", nextCursor: null, ...state,
    });
    if (result.cursor !== "old-info-page" || result.fullScanCompleted) {
      throw new Error("An incomplete Info page cannot advance the recovery cursor");
    }
  }
  const complete = infoRecoveryScanOutcome({
    initialCursor: "old-info-page", nextCursor: null,
    pagesFetched: true, allThreadsProcessed: true, scanFailed: false,
  });
  if (complete.cursor !== null || !complete.fullScanCompleted) {
    throw new Error("A completed final Info page must record the full scan");
  }
});

Deno.test("an applicable Info inquiry without a provider message ID keeps recovery due", () => {
  for (const providerId of [undefined, "", "   ", " provider-id ", "x".repeat(256)]) {
    const missingId = message({ body: "I need a refund for my Bloomjoy purchase." });
    missingId.id = providerId;
    const classified = classifyRefundInfoInquiry({
      messages: [missingId], mailboxIdentities: ["info@bloomjoysweets.com"],
    });
    if (classified.route !== "new_refund_inquiry" ||
      !infoInquiryMissingSource(classified)) {
      throw new Error("The missing exact source must be an Info scan failure");
    }
    const scan = infoRecoveryScanOutcome({
      initialCursor: "unread-page", nextCursor: "later-page",
      pagesFetched: true, allThreadsProcessed: true,
      scanFailed: infoInquiryMissingSource(classified),
    });
    if (scan.cursor !== "unread-page" || scan.fullScanCompleted) {
      throw new Error("Missing source evidence must not advance the Info cursor");
    }
  }
});

Deno.test("an applicable Info inquiry without a verified sender keeps recovery due", () => {
  const missingSender = message({ from: "", body: "I need a refund for my Bloomjoy purchase." });
  const classified = classifyRefundInfoInquiry({
    messages: [missingSender], mailboxIdentities: ["info@bloomjoysweets.com"],
  });
  if (!infoInquirySourceMissingSender(classified, missingSender.id ?? null, "")) {
    throw new Error("An exact classified source without a sender cannot be ingested");
  }
  const scan = infoRecoveryScanOutcome({
    initialCursor: "unread-page", nextCursor: "later-page",
    pagesFetched: true, allThreadsProcessed: true,
    scanFailed: infoInquirySourceMissingSender(classified, missingSender.id ?? null, ""),
  });
  if (scan.cursor !== "unread-page") {
    throw new Error("Missing sender evidence must not advance the Info cursor");
  }
});

Deno.test("Info in a secondary To or Cc recipient still routes through the verified mailbox", () => {
  assertRoute(message({ to: "helper@example.test, info@bloomjoysweets.com",
    body: "I need a refund. I was charged by your machine." }), "new_refund_inquiry");
  const ccOnly = message({ to: "helper@example.test",
    body: "I need a refund. I was charged by your machine.",
    extraHeaders: [{ name: "Cc", value: "info@bloomjoysweets.com" }] });
  assertRoute(ccOnly, "new_refund_inquiry");
});

Deno.test("direct Support product failure is eligible through the shared mailbox", () => {
  assertRoute(message({ to: "support@bloomjoysweets.com", subject: "Machine issue",
    body: "I bought cotton candy from your machine, but it did not dispense." }),
  "new_refund_inquiry");
});

Deno.test("Support is not admitted unless it is a configured identity of this mailbox", () => {
  const result = classifyRefundInfoInquiry({
    messages: [message({ to: "support@bloomjoysweets.com", body: "I need a refund." })],
    mailboxIdentities: ["info@bloomjoysweets.com", "refunds@bloomjoysweets.com"],
  });
  if (result.route !== "not_info") throw new Error("Unconfigured Support must not trigger mail");
});

Deno.test("existing reference and submitted-form status questions never request a new form", () => {
  assertRoute(message({ subject: "RF-ABC123 status", body: "Where is my refund?" }),
    "existing_case_question");
  assertRoute(message({ body: "I already submitted the refund form. Can I get an update?" }),
    "existing_case_question");
});

Deno.test("a later same-thread case-status question supersedes an earlier form inquiry", () => {
  const first = { ...message({ body: "I was charged and would like a refund." }), id: "first" };
  const latest = { ...message({ body: "I already submitted the refund form. What is its status?" }), id: "latest" };
  const result = classifyRefundInfoInquiry({
    messages: [first, latest],
    mailboxIdentities: ["info@bloomjoysweets.com", "support@bloomjoysweets.com", "refunds@bloomjoysweets.com"],
  });
  if (result.route !== "existing_case_question" || result.sourceMessageId !== "latest") {
    throw new Error("The latest case-status question must never receive a new-form reply");
  }
});

Deno.test("a later new purchase issue is not hidden by an older case-status message", () => {
  const oldStatus = { ...message({ body: "Where is my refund for RF-OLD123?" }), id: "old-status" };
  const newIssue = { ...message({ body: "I bought cotton candy from your machine today. It did not dispense." }), id: "new-issue" };
  const result = classifyRefundInfoInquiry({
    messages: [oldStatus, newIssue],
    mailboxIdentities: ["info@bloomjoysweets.com", "refunds@bloomjoysweets.com"],
  });
  if (result.route !== "new_refund_inquiry" || result.sourceMessageId !== "new-issue") {
    throw new Error("A historical status request must not suppress the new purchase issue");
  }
});

Deno.test("vendor, technician and marketing messages are not refund inquiries", () => {
  for (const body of [
    "I am a supplier; please send the invoice for our vendor account.",
    "I am a technician and the service ticket is ready for your machine.",
    "We offer marketing help for your cotton candy business.",
    "Our vendor refund policy changed; please review the attached terms.",
    "I paid your vendor invoice and need a refund for our service ticket.",
  ]) assertRoute(message({ body }), "non_refund");
});

Deno.test("a later vendor request cannot inherit an older refund inquiry in one thread", () => {
  const earlier = message({ body: "I need a refund for my Bloomjoy purchase." });
  earlier.id = "older-customer-inquiry";
  const later = message({ body: "I paid your vendor invoice and need a refund for our service ticket." });
  later.id = "newer-business-request";
  const result = classifyRefundInfoInquiry({
    messages: [earlier, later],
    mailboxIdentities: ["info@bloomjoysweets.com"],
  });
  if (result.route !== "needs_review" || result.sourceMessageId !== "older-customer-inquiry") {
    throw new Error("The old customer inquiry needs review without an automatic form reply");
  }
});

Deno.test("quoted customer refund text cannot turn unrelated current mail into an inquiry", () => {
  assertRoute(message({ body:
    "I am a vendor with a partnership proposal.\nOn Tuesday, Customer wrote:\n> I need a refund for cotton candy." }),
  "non_refund");
});

Deno.test("ambiguous personal product issue remains reviewable, not silently eligible", () => {
  assertRoute(message({ body: "My cotton candy was bad." }), "needs_review");
});

Deno.test("automated or spoof-suspected Info messages cannot trigger a customer reply", () => {
  assertRoute(message({ body: "I need a refund", extraHeaders: [
    { name: "Auto-Submitted", value: "auto-generated" },
  ] }), "untrusted");
  assertRoute(message({ body: "I need a refund", extraHeaders: [
    { name: "Authentication-Results", value: "mx.google.com; spf=fail" },
  ] }), "untrusted");
});

Deno.test("refund-alias and unrelated recipient mail stay outside the Info route", () => {
  assertRoute(message({ to: "refunds@bloomjoysweets.com", body: "I need a refund" }), "not_info");
  assertRoute(message({ to: "vendor@example.test", body: "I need a refund" }), "not_info");
});
