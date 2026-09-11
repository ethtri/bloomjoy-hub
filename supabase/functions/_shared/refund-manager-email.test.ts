import {
  buildRefundManagerActionEmail,
  parseRefundManagerActionEmailContext,
  REFUND_MANAGER_ACTION_EMAIL_TEMPLATE_VERSION,
  type RefundManagerActionEmailContext,
} from "./refund-manager-email.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
};

const context: RefundManagerActionEmailContext = {
  schemaVersion: "refund_manager_action_email_v1",
  publicReference: "RF-SAFE-1280",
  amountCents: 725,
  currencyCode: "USD",
  machineLabel: "Lobby treats",
  locationName: "Sample venue",
  ageMinutes: 3_120,
  paymentMethodCategory: "card",
  queueLabel: "Ready to refund",
  actionCode: "refund",
  actionOwner: "Machine Manager",
  lifecycleActor: "system",
  whatChanged:
    "The server recorded one high-confidence transaction match after corrected wallet details.",
  payloadRedacted: true,
};

Deno.test("manager action email is deterministic, action-led, and navigation-only", () => {
  const input = {
    context,
    noticeReason: "wallet_match_ready" as const,
    caseUrl: "https://app.example.test/refunds?case=case-1280",
    queueUrl: "https://app.example.test/refunds",
    routingNote:
      "This action notice was routed only to the currently assigned Machine Managers.",
  };
  const first = buildRefundManagerActionEmail(input);
  const second = buildRefundManagerActionEmail(input);
  assertEquals(first, second, "rendered email");
  assertEquals(
    first.templateVersion,
    REFUND_MANAGER_ACTION_EMAIL_TEMPLATE_VERSION,
    "template version",
  );
  assert(
    first.subject.startsWith("[Decision required] Refund $7.25"),
    "decision-led subject",
  );
  assertEquals(first.variant, "new_decision", "new decision variant");
  assert(
    first.text.indexOf("Action needed:") < first.text.indexOf("Why now:") &&
      first.text.indexOf("Why now:") < first.text.indexOf("What changed:") &&
      first.text.indexOf("What changed:") < first.text.indexOf("Reference:"),
    "screen-reader content order",
  );
  assert(first.text.includes("Current action: refund"), "canonical action");
  assert(first.text.includes("Last changed by: System"), "canonical actor");
  assert(
    first.text.includes("Opening these links is navigation only"),
    "navigation reassurance",
  );
  assert(
    first.html.includes('meta name="color-scheme" content="light dark"'),
    "dark-mode hint",
  );
  assert(
    first.html.includes("Open refund case RF-SAFE-1280"),
    "descriptive case link",
  );
  assert(
    first.html.includes("Open the refund manager queue"),
    "descriptive queue link",
  );
});

Deno.test("manager action email labels unknown amount and context honestly", () => {
  const rendered = buildRefundManagerActionEmail({
    context: {
      ...context,
      amountCents: null,
      currencyCode: null,
      machineLabel: "Machine not recorded",
      locationName: "Location not recorded",
      paymentMethodCategory: "not_recorded",
      queueLabel: "State not recorded",
      actionCode: "future_server_action",
      actionOwner: "Refund Operations",
    },
    noticeReason: "provider_unknown",
    caseUrl: "https://app.example.test/refunds?case=unknown",
    queueUrl: "https://app.example.test/refunds",
    routingNote: "Routing exception: operations review is required.",
  });
  assert(
    rendered.subject.includes("Amount not recorded"),
    "unknown amount subject",
  );
  assert(
    rendered.text.includes("Payment type: Not recorded"),
    "unknown payment type",
  );
  assert(
    rendered.text.includes("Portal state: State not recorded"),
    "unknown state",
  );
  assert(
    rendered.text.includes("follow the current server-owned action"),
    "unknown action fallback",
  );
});

Deno.test("manager email context rejects additional fields and unsafe values", () => {
  for (
    const unsafe of [
      { ...context, customerEmail: "customer@example.test" },
      { ...context, issueSummary: "private complaint" },
      { ...context, providerTransactionId: "provider-123" },
      { ...context, cardLast4: "4242" },
      { ...context, actionCode: "refund now!" },
    ]
  ) {
    let rejected = false;
    try {
      parseRefundManagerActionEmailContext(unsafe);
    } catch {
      rejected = true;
    }
    assert(
      rejected,
      `unsafe context should be rejected: ${JSON.stringify(unsafe)}`,
    );
  }
});

Deno.test("manager action email escapes every approved text field", () => {
  const rendered = buildRefundManagerActionEmail({
    context: {
      ...context,
      locationName: '<script data-private="x">unsafe</script>',
      whatChanged: "A & B < C",
    },
    noticeReason: "manager_escalation",
    caseUrl: "https://app.example.test/refunds?case=case-1280&view=detail",
    queueUrl: "https://app.example.test/refunds",
    routingNote: "Safe route.",
  });
  assert(!rendered.html.includes("<script"), "raw tag");
  assert(
    rendered.html.includes("&lt;script data-private=&quot;x&quot;&gt;"),
    "escaped field",
  );
  assert(rendered.html.includes("case-1280&amp;view=detail"), "escaped link");
});

Deno.test("all immediate manager reasons render without private fixture values", () => {
  const forbidden = [
    "customer@example.test",
    "customer name",
    "4242",
    "private complaint",
    "provider-transaction-123",
  ];
  for (
    const noticeReason of [
      "wallet_match_ready",
      "hard_bounce",
      "provider_setup",
      "provider_outage",
      "provider_rejection",
      "provider_timeout",
      "provider_unknown",
      "follow_up_manual_review",
      "manager_escalation",
    ] as const
  ) {
    const rendered = buildRefundManagerActionEmail({
      context,
      noticeReason,
      caseUrl: "https://app.example.test/refunds?case=case-1280",
      queueUrl: "https://app.example.test/refunds",
      routingNote: "Safe route.",
    });
    const output = `${rendered.subject}\n${rendered.text}\n${rendered.html}`
      .toLowerCase();
    assert(
      forbidden.every((value) => !output.includes(value)),
      `${noticeReason} leaked fixture data`,
    );
  }
});

Deno.test("shared renderer covers action, exception, escalation, and digest-item variants", () => {
  const variants = new Map(
    [
      ["wallet_match_ready", "new_decision"],
      ["follow_up_manual_review", "changed_action"],
      ["hard_bounce", "urgent_exception"],
      ["manager_escalation", "escalation"],
      ["manager_reminder", "digest_item"],
    ] as const,
  );
  for (const [noticeReason, expectedVariant] of variants) {
    const rendered = buildRefundManagerActionEmail({
      context,
      noticeReason,
      caseUrl: "https://app.example.test/refunds?case=case-1280",
      queueUrl: "https://app.example.test/refunds",
      routingNote: "Safe route.",
    });
    assertEquals(rendered.variant, expectedVariant, `${noticeReason} variant`);
  }
});
