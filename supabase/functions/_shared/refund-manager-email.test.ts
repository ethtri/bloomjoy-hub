import {
  buildRefundManagerActionEmail,
  parseRefundManagerActionEmailContext,
  REFUND_MANAGER_ACTION_EMAIL_TEMPLATE_VERSION,
  type RefundManagerActionEmailContext,
} from "./refund-manager-email.ts";
import type { RefundManagerNotificationReason } from "./refund-manager-notification.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const context: RefundManagerActionEmailContext = {
  schemaVersion: "refund_manager_action_email_v1",
  publicReference: "RF-SAMPLE-1280",
  amountCents: 1090,
  currencyCode: "USD",
  machineLabel: "Lobby treats",
  locationName: "Retired venue label",
  ageMinutes: 3120,
  paymentMethodCategory: "card",
  queueLabel: "Ready to refund",
  actionCode: "refund",
  actionOwner: "Machine Manager",
  lifecycleActor: "system",
  whatChanged: "The server recorded a change.",
  payloadRedacted: true,
};
const enriched: RefundManagerActionEmailContext = {
  ...context,
  requestedAmountCents: 1000,
  requestedCurrencyCode: "USD",
  issueLabel: "No product received",
  customerCommentExcerpt: "The machine charged me but no candy came out.",
};
const render = (
  value = enriched,
  noticeReason: RefundManagerNotificationReason = "wallet_match_ready",
  audience: "manager" | "operations" = "manager",
) =>
  buildRefundManagerActionEmail({
    context: value,
    noticeReason,
    audience,
    caseUrl: "https://app.example.test/refunds?case=synthetic&view=detail",
    queueUrl: "https://app.example.test/refunds",
    routingNote: "Internal routing diagnostics.",
  });

Deno.test("case-first email shows original request and complaint with one navigation CTA", () => {
  const email = render();
  assert(
    JSON.stringify(email) === JSON.stringify(render()),
    "deterministic output",
  );
  assert(
    email.templateVersion === REFUND_MANAGER_ACTION_EMAIL_TEMPLATE_VERSION,
    "version",
  );
  assert(
    email.subject === "Refund ready for review: Lobby treats · RF-SAMPLE-1280",
    "meaningful subject",
  );
  for (const output of [email.html, email.text]) {
    for (
      const useful of [
        "Lobby treats",
        "$10.00",
        "No product received",
        enriched.customerCommentExcerpt!,
      ]
    ) assert(output.includes(useful), useful);
    for (
      const stale of [
        "$10.90",
        "Retired venue",
        "Why now",
        "What changed",
        "Action owner",
        "Current action",
        "Internal routing",
        "navigation only",
        "intentionally omitted",
      ]
    ) assert(!output.includes(stale), stale);
  }
  assert((email.html.match(/<a /g) || []).length === 1, "one link");
  assert(
    email.html.includes("case=synthetic&amp;view=detail"),
    "exact case link escaped",
  );
  assert(email.html.includes(">View case</a>"), "clear CTA");
  assert(
    email.text.indexOf("Requested amount") <
      email.text.indexOf("Review the selected purchase"),
    "case first",
  );
});

Deno.test("historical context remains valid without inventing original amount or complaint", () => {
  const parsed = parseRefundManagerActionEmailContext({
    ...context,
    actionOwner: ["Refund", "Operations"].join(" "),
  });
  assert(parsed.actionOwner === "Machine Manager", "legacy owner accepted");
  const email = render(parsed);
  assert(
    email.text.includes("Requested amount: Not available"),
    "unknown original amount",
  );
  assert(
    !email.text.includes("10.90"),
    "selected amount not presented as requested",
  );
  assert(!email.text.includes("Customer comment"), "no invented quote");
});

Deno.test("operations fallback never discloses the expanded case summary", () => {
  const email = render(enriched, "provider_setup", "operations");
  for (
    const value of [
      enriched.machineLabel,
      "10.00",
      enriched.issueLabel!,
      enriched.customerCommentExcerpt!,
    ]
  ) {
    assert(!JSON.stringify(email).includes(value), `fallback leaked ${value}`);
  }
  assert(email.text.includes("RF-SAMPLE-1280"), "reference for routing review");
  assert(email.text.includes("machine manager"), "routing purpose");
});

Deno.test("lookup failures never assign manager research, payment retry, or invented recovery", () => {
  for (
    const reason of [
      "provider_setup",
      "provider_outage",
      "provider_rejection",
      "provider_timeout",
    ] as const
  ) {
    const email = render(
      { ...enriched, actionCode: "refund_operations" },
      reason,
    );
    assert(
      email.text.includes("No refund decision") ||
        email.text.includes("no refund decision"),
      reason,
    );
    for (
      const word of [
        "check the Nayax",
        "retry payment",
        "are fixing",
        "will retry",
        "being fixed",
      ]
    ) assert(!email.text.includes(word), word);
  }
});

Deno.test("parser accepts additive context and rejects unknown, partial, unbounded and unsafe fields", () => {
  assert(
    parseRefundManagerActionEmailContext(enriched).requestedAmountCents ===
      1000,
    "new context",
  );
  const invalid = [
    { ...context, customerEmail: "synthetic@example.test" },
    { ...context, cardLast4: "4242" },
    { ...context, requestedAmountCents: 1000 },
    { ...enriched, requestedAmountCents: -1 },
    { ...enriched, requestedCurrencyCode: "usd" },
    { ...enriched, customerCommentExcerpt: "x".repeat(321) },
    { ...enriched, customerCommentExcerpt: "line\nbreak" },
    { ...enriched, issueLabel: "" },
    { ...context, actionCode: "refund now!" },
  ];
  for (const value of invalid) {
    let threw = false;
    try {
      parseRefundManagerActionEmailContext(value);
    } catch {
      threw = true;
    }
    assert(threw, "unsafe context rejected");
  }
});

Deno.test("HTML escapes useful customer text without translating or inventing quotes", () => {
  const value = parseRefundManagerActionEmailContext({
    ...enriched,
    machineLabel: "Candy <test> & friends",
    issueLabel: "No product <img src=x>",
    customerCommentExcerpt:
      'La máquina cobró, pero no salió algodón. <script>alert("x")</script> & gracias.',
  });
  const email = render(value);
  assert(!email.html.includes("<script>"), "no raw script");
  assert(!email.html.includes("<img src=x>"), "no injected image");
  assert(
    email.html.includes(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; gracias.",
    ),
    "escaped comment",
  );
  assert(
    email.text.includes(value.customerCommentExcerpt!),
    "plain text preserved",
  );
  assert(
    email.html.includes('lang="und" dir="auto"'),
    "unknown customer language handled",
  );
});

Deno.test("all notice reasons render a specific heading and accessible responsive shell", () => {
  const reasons: RefundManagerNotificationReason[] = [
    "intake_created",
    "wallet_match_ready",
    "customer_reply",
    "hard_bounce",
    "provider_setup",
    "provider_outage",
    "provider_rejection",
    "provider_timeout",
    "provider_unknown",
    "follow_up_manual_review",
    "manager_reminder",
    "manager_escalation",
    "routine_customer_message",
    "manager_authored_conversation",
    "customer_completion_copy",
  ];
  for (const reason of reasons) {
    const email = render(enriched, reason);
    assert((email.html.match(/<h1 /g) || []).length === 1, reason);
    assert(email.html.includes('<html lang="en" dir="ltr">'), "language");
    assert(email.html.includes("<title>"), "title");
    assert(email.html.includes('role="presentation"'), "layout tables");
    assert(email.html.includes("prefers-color-scheme:dark"), "dark support");
    assert(
      !email.subject.includes("Exception") &&
        !email.subject.includes("Digest item"),
      "specific heading",
    );
  }
});

Deno.test("unknown currency and missing context remain explicit", () => {
  const email = render({
    ...enriched,
    requestedCurrencyCode: null,
    issueLabel: null,
    customerCommentExcerpt: null,
    actionCode: "future_action",
  }, "manager_reminder");
  assert(
    email.text.includes("10.00 (currency not recorded)"),
    "currency not guessed",
  );
  assert(
    email.text.includes("View the case for its current status"),
    "safe future action fallback",
  );
});

Deno.test("payment caution is grounded in canonical payment status, not a lookup reason", () => {
  const lookup = render(enriched, "provider_unknown");
  assert(
    !lookup.text.includes("Do not issue another refund"),
    "lookup ambiguity is not payment uncertainty",
  );
  const unknown = render(
    { ...enriched, paymentOutcomeUnknown: true },
    "manager_reminder",
  );
  assert(
    unknown.text.includes("Refund status needs verification"),
    "payment truth overrides generic reason",
  );
  assert(
    unknown.text.includes(
      "Do not issue another refund until its status is confirmed.",
    ),
    "no-repeat caution",
  );
  assert(
    !unknown.text.includes("Approve") &&
      !unknown.text.includes("approve or decline"),
    "no contradictory decision request",
  );
  assert(
    parseRefundManagerActionEmailContext({
      ...enriched,
      paymentOutcomeUnknown: false,
    }).paymentOutcomeUnknown === false,
    "false preserved",
  );
  let threw = false;
  try {
    parseRefundManagerActionEmailContext({
      ...enriched,
      paymentOutcomeUnknown: "false",
    });
  } catch {
    threw = true;
  }
  assert(threw, "boolean only");
});

Deno.test("stale review reason cannot contradict the current action", () => {
  const email = render(
    { ...enriched, actionCode: "refund_operations" },
    "wallet_match_ready",
  );
  assert(
    email.subject.startsWith("Refund needs system review"),
    "current action governs headline",
  );
  assert(
    !email.html.includes("Refund ready for review"),
    "no stale decision request",
  );
  const waiting = render(
    { ...enriched, actionCode: "wait_for_customer_reply" },
    "manager_escalation",
  );
  assert(
    waiting.subject.startsWith("Waiting for customer reply"),
    "waiting state stays waiting",
  );
});
