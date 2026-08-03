import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRefundFirstContactEmail,
  isRefundFirstContactSenderAllowed,
  REFUND_FIRST_CONTACT_TEMPLATE_KEY,
  resolveRefundFirstContactConfig,
} from "./refund-first-contact.ts";
import {
  buildReplyMime,
  classifyRefundGmailReplyEvidence,
  isRefundGmailAutomatedMessage,
  isRefundGmailBounceMessage,
  isRefundGmailMailboxIdentity,
  parseRefundGmailSuccessResponse,
  RefundGmailError,
  refundGmailMessageIdSearchPath,
  selectRefundGmailReplyEvidence,
} from "./refund-gmail.ts";
import { ingestRefundGmailThreadBeforeFirstContact } from "./refund-gmail-orchestration.ts";

Deno.test("first-contact mode defaults to disabled", () => {
  const config = resolveRefundFirstContactConfig({});
  assertEquals(config.mode, "disabled");
  assertEquals(config.shouldClaim, false);
  assertEquals(config.shouldSend, false);
});

Deno.test("shadow mode records eligibility without sending", () => {
  const config = resolveRefundFirstContactConfig({
    REFUND_GMAIL_FIRST_CONTACT_MODE: "shadow",
  });
  assertEquals(config.mode, "shadow");
  assertEquals(config.shouldClaim, true);
  assertEquals(config.shouldSend, false);
  assertEquals(config.cutoverAt, null);
});

Deno.test("active mode fails closed until legacy cutover is approved", () => {
  const withoutLegacyDisable = resolveRefundFirstContactConfig({
    REFUND_GMAIL_FIRST_CONTACT_MODE: "active",
    REFUND_GMAIL_FIRST_CONTACT_CUTOVER_AT: "2026-08-03T18:00:00Z",
    GMAIL_REFUND_LABEL_ID: "Label_Production",
    REFUND_GMAIL_FIRST_CONTACT_PRODUCTION_LABEL_ID: "Label_Production",
  });
  assertEquals(withoutLegacyDisable.mode, "blocked");
  assertEquals(
    withoutLegacyDisable.errorCode,
    "first_contact_legacy_responder_not_disabled",
  );

  const withoutApproval = resolveRefundFirstContactConfig({
    REFUND_GMAIL_FIRST_CONTACT_MODE: "active",
    REFUND_GMAIL_FIRST_CONTACT_CUTOVER_AT: "2026-08-03T18:00:00Z",
    GMAIL_REFUND_LABEL_ID: "Label_Production",
    REFUND_GMAIL_FIRST_CONTACT_PRODUCTION_LABEL_ID: "Label_Production",
    REFUND_GMAIL_LEGACY_RESPONDER_DISABLED: "true",
  });
  assertEquals(withoutApproval.mode, "blocked");
  assertEquals(withoutApproval.errorCode, "first_contact_cutover_not_approved");
});

Deno.test("active and isolated modes require explicit bounded gates", () => {
  const active = resolveRefundFirstContactConfig({
    REFUND_GMAIL_FIRST_CONTACT_MODE: "active",
    REFUND_GMAIL_FIRST_CONTACT_CUTOVER_AT: "2026-08-03T18:00:00Z",
    GMAIL_REFUND_LABEL_ID: "Label_Production",
    REFUND_GMAIL_FIRST_CONTACT_PRODUCTION_LABEL_ID: "Label_Production",
    REFUND_GMAIL_LEGACY_RESPONDER_DISABLED: "true",
    REFUND_GMAIL_FIRST_CONTACT_CUTOVER_APPROVED: "true",
  });
  assertEquals(active.mode, "blocked");
  assertEquals(active.shouldSend, false);
  assertEquals(active.errorCode, "first_contact_active_dependencies_pending");

  const isolated = resolveRefundFirstContactConfig({
    REFUND_GMAIL_FIRST_CONTACT_MODE: "isolated_test",
    REFUND_GMAIL_FIRST_CONTACT_CUTOVER_AT: "2026-08-03T18:00:00Z",
    REFUND_GMAIL_FIRST_CONTACT_ISOLATED_CONFIRMED: "true",
    GMAIL_REFUND_LABEL_ID: "Label_Isolated",
    REFUND_GMAIL_FIRST_CONTACT_ISOLATED_LABEL_ID: "Label_Isolated",
    REFUND_GMAIL_FIRST_CONTACT_PRODUCTION_LABEL_ID: "Label_Production",
    REFUND_GMAIL_FIRST_CONTACT_ISOLATED_SENDERS:
      "synthetic-one@example.test,synthetic-two@example.test",
  });
  assertEquals(isolated.mode, "isolated_test");
  assertEquals(isolated.shouldSend, true);
  assert(
    isRefundFirstContactSenderAllowed(isolated, "synthetic-one@example.test"),
  );
  assert(
    !isRefundFirstContactSenderAllowed(isolated, "real-customer@example.test"),
  );
});

Deno.test("isolated mode fails closed without a distinct label and sender allowlist", () => {
  const sharedLabel = resolveRefundFirstContactConfig({
    REFUND_GMAIL_FIRST_CONTACT_MODE: "isolated_test",
    REFUND_GMAIL_FIRST_CONTACT_CUTOVER_AT: "2026-08-03T18:00:00Z",
    REFUND_GMAIL_FIRST_CONTACT_ISOLATED_CONFIRMED: "true",
    GMAIL_REFUND_LABEL_ID: "Label_Production",
    REFUND_GMAIL_FIRST_CONTACT_ISOLATED_LABEL_ID: "Label_Production",
    REFUND_GMAIL_FIRST_CONTACT_PRODUCTION_LABEL_ID: "Label_Production",
    REFUND_GMAIL_FIRST_CONTACT_ISOLATED_SENDERS: "synthetic@example.test",
  });
  assertEquals(sharedLabel.mode, "blocked");
  assertEquals(sharedLabel.errorCode, "first_contact_isolated_label_invalid");

  const missingSenders = resolveRefundFirstContactConfig({
    REFUND_GMAIL_FIRST_CONTACT_MODE: "isolated_test",
    REFUND_GMAIL_FIRST_CONTACT_CUTOVER_AT: "2026-08-03T18:00:00Z",
    REFUND_GMAIL_FIRST_CONTACT_ISOLATED_CONFIRMED: "true",
    GMAIL_REFUND_LABEL_ID: "Label_Isolated",
    REFUND_GMAIL_FIRST_CONTACT_ISOLATED_LABEL_ID: "Label_Isolated",
    REFUND_GMAIL_FIRST_CONTACT_PRODUCTION_LABEL_ID: "Label_Production",
  });
  assertEquals(missingSenders.mode, "blocked");
  assertEquals(
    missingSenders.errorCode,
    "first_contact_isolated_senders_invalid",
  );
});

Deno.test("invalid modes, timestamps, and public links fail closed", () => {
  assertEquals(
    resolveRefundFirstContactConfig({ REFUND_GMAIL_FIRST_CONTACT_MODE: "send" })
      .errorCode,
    "first_contact_mode_invalid",
  );
  assertEquals(
    resolveRefundFirstContactConfig({
      REFUND_GMAIL_FIRST_CONTACT_MODE: "active",
      REFUND_GMAIL_FIRST_CONTACT_CUTOVER_AT: "tomorrowish",
    }).errorCode,
    "first_contact_cutover_time_missing",
  );
  assertEquals(
    resolveRefundFirstContactConfig({
      REFUND_GMAIL_FIRST_CONTACT_MODE: "shadow",
      REFUND_GMAIL_FIRST_CONTACT_REFUND_URL:
        "http://unsafe.example.test/refunds",
    }).errorCode,
    "first_contact_public_url_invalid",
  );
});

Deno.test("first-contact copy is versioned, customer-first, and contains only public links", () => {
  const email = buildRefundFirstContactEmail({
    publicReference: "RF-SYNTH01",
    customerName: "Synthetic <Customer>",
    refundRequestUrl: "https://www.bloomjoyusa.com/refunds/request",
    legacyRefundUrl: "https://forms.gle/synthetic-test",
    supportUrl: "https://www.bloomjoyusa.com/resources#support-boundaries",
  });
  assertEquals(email.templateKey, REFUND_FIRST_CONTACT_TEMPLATE_KEY);
  assertStringIncludes(email.text, "We are sorry something went wrong");
  assertStringIncludes(email.text, "If you already submitted a form");
  assertStringIncludes(email.text, "RF-SYNTH01");
  assertStringIncludes(
    email.text,
    "https://www.bloomjoyusa.com/refunds/request",
  );
  assertStringIncludes(email.text, "https://forms.gle/synthetic-test");
  assertStringIncludes(
    email.text,
    "https://www.bloomjoyusa.com/resources#support-boundaries",
  );
  assert(!email.text.includes("/refunds?case="));
  assert(!email.text.toLowerCase().includes("nayax"));
  assertStringIncludes(email.html, "Synthetic &lt;Customer&gt;");
});

Deno.test("first-contact copy safely omits an unavailable public reference", () => {
  const email = buildRefundFirstContactEmail({
    publicReference: "not-a-reference",
    customerName: null,
    refundRequestUrl: "https://www.bloomjoyusa.com/refunds/request",
    legacyRefundUrl: "https://forms.gle/synthetic-test",
    supportUrl: "https://www.bloomjoyusa.com/resources#support-boundaries",
  });
  assertEquals(email.subject, "We received your Bloomjoy message");
  assert(!email.text.includes("Reference:"));
});

Deno.test("automatic Gmail replies carry loop-suppression headers", () => {
  const mime = buildReplyMime({
    from: "support@example.test",
    to: "customer@example.test",
    subject: "Synthetic first contact",
    text: "Synthetic safe text",
    html: "<p>Synthetic safe text</p>",
    inReplyTo: "<source@example.test>",
    references: "<source@example.test>",
    operationKey: "refund-first-contact:synthetic",
    automatic: true,
  });
  const decoded = new TextDecoder().decode(
    Uint8Array.from(
      atob(mime.raw.replaceAll("-", "+").replaceAll("_", "/")),
      (char) => char.charCodeAt(0),
    ),
  );
  assertMatch(decoded, /Auto-Submitted: auto-replied/);
  assertMatch(decoded, /X-Auto-Response-Suppress: All/);
});

Deno.test("Gmail headers exclude automated, list, and bounce messages", () => {
  const message = (headers: Array<{ name: string; value: string }>) => ({
    payload: { headers },
  });
  assert(isRefundGmailAutomatedMessage(message([
    { name: "Auto-Submitted", value: "auto-replied" },
  ])));
  assert(isRefundGmailAutomatedMessage(message([
    { name: "List-Id", value: "synthetic-list.example.test" },
  ])));
  assert(isRefundGmailAutomatedMessage(message([
    { name: "List-Unsubscribe", value: "<mailto:unsubscribe@example.test>" },
  ])));
  assert(isRefundGmailBounceMessage(message([
    { name: "From", value: "mailer-daemon@example.test" },
    { name: "Subject", value: "Delivery Status Notification" },
  ])));
  assert(
    !isRefundGmailAutomatedMessage(message([
      { name: "From", value: "synthetic-customer@example.test" },
      { name: "Auto-Submitted", value: "no" },
    ])),
  );
});

Deno.test("configured Gmail send-as aliases are classified as mailbox-origin", () => {
  const identities = {
    mailboxIdentities: [
      "info@bloomjoysweets.com",
      "support@bloomjoysweets.com",
      "refunds@bloomjoysweets.com",
    ],
  };
  assert(
    isRefundGmailMailboxIdentity(identities, "Support@BloomjoySweets.com"),
  );
  assert(
    isRefundGmailMailboxIdentity(identities, "refunds@bloomjoysweets.com"),
  );
  assertEquals(
    isRefundGmailMailboxIdentity(identities, "customer@example.test"),
    false,
  );
});

Deno.test("invalid Gmail POST success JSON is delivery-uncertain", async () => {
  let caught: unknown = null;
  try {
    await parseRefundGmailSuccessResponse(
      { json: () => Promise.reject(new SyntaxError("synthetic invalid JSON")) },
      true,
    );
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof RefundGmailError);
  assertEquals(caught.code, "gmail_response_invalid");
  assertEquals(caught.deliveryUncertain, true);
});

Deno.test("Gmail reconciliation searches the deterministic Message-ID", () => {
  const header = "<refund-refund-first-contact.synthetic@bloomjoyusa.com>";
  const path = refundGmailMessageIdSearchPath(header);
  const params = new URL(`https://gmail.googleapis.test${path}`).searchParams;
  assertEquals(params.get("q"), `rfc822msgid:${header}`);
  assertEquals(params.get("maxResults"), "5");
  assertEquals(params.get("includeSpamTrash"), "true");
});

Deno.test("Gmail reconciliation requires exactly one message in the original thread", () => {
  const header = "<refund-synthetic@bloomjoyusa.com>";
  const exact = selectRefundGmailReplyEvidence(
    [{ id: "exact-message", threadId: "thread-original" }],
    "thread-original",
    header,
  );
  assertEquals(exact, {
    providerMessageId: "exact-message",
    providerMessageHeader: header,
  });
  assertEquals(
    selectRefundGmailReplyEvidence([], "thread-original", header),
    null,
  );
  assertEquals(
    classifyRefundGmailReplyEvidence([], "thread-original", header),
    { status: "no_match" },
  );
  assertEquals(
    classifyRefundGmailReplyEvidence(
      [
        { id: "wrong-thread", threadId: "thread-other" },
        { id: "exact-message", threadId: "thread-original" },
      ],
      "thread-original",
      header,
    ),
    { status: "ambiguous" },
  );
  assertEquals(
    selectRefundGmailReplyEvidence(
      [
        { id: "duplicate-one", threadId: "thread-original" },
        { id: "duplicate-two", threadId: "thread-original" },
      ],
      "thread-original",
      header,
    ),
    null,
  );
});

Deno.test("complete Gmail thread ingestion finishes before first-contact processing", async () => {
  const sequence: string[] = [];
  const result = await ingestRefundGmailThreadBeforeFirstContact({
    messages: ["first", "reply", "outbound"],
    ingestMessage: async (message) => {
      sequence.push(`ingest:${message}`);
      return message === "first" ? { source: message } : null;
    },
    processFirstContact: async (candidate) => {
      sequence.push(`first-contact:${candidate.source}`);
    },
  });
  assertEquals(result.candidateCount, 1);
  assertEquals(sequence, [
    "ingest:first",
    "ingest:reply",
    "ingest:outbound",
    "first-contact:first",
  ]);
});
