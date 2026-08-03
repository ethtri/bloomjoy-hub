import {
  buildRefundGmailReplyMime,
  type GmailMessage,
  inspectRefundGmailParticipantSignals,
  parseEmailAddressList,
  type RefundGmailConfig,
  sendRefundGmailReply,
} from "./refund-gmail.ts";
import { resolveRefundOpsFallbackRecipients } from "./refund-manager-notification.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
};

const assertIncludes = (actual: string, expected: string, message: string) => {
  if (!actual.includes(expected)) {
    throw new Error(`${message}: missing ${expected}`);
  }
};

const assertNotIncludes = (
  actual: string,
  expected: string,
  message: string,
) => {
  if (actual.includes(expected)) {
    throw new Error(`${message}: unexpectedly included ${expected}`);
  }
};

const decodeBase64Url = (value: string) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
};

const messageWithHeaders = (headers: Record<string, string>): GmailMessage => ({
  id: "synthetic-message",
  threadId: "synthetic-thread",
  payload: {
    headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
  },
});

const encodeBody = (value: string) =>
  btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

const buildDsnMessage = ({
  from = "mailer-daemon@googlemail.com",
  authenticationResults =
    "mx.google.com; spf=pass smtp.mailfrom=mailer-daemon@googlemail.com",
  deliveryStatus,
  includeDeliveryStatusPart = true,
  subject = "Delivery Status Notification (Failure)",
  xFailedRecipients,
}: {
  from?: string;
  authenticationResults?: string;
  deliveryStatus: string;
  includeDeliveryStatusPart?: boolean;
  subject?: string;
  xFailedRecipients?: string;
}): GmailMessage => ({
  id: "synthetic-dsn",
  threadId: "synthetic-thread",
  payload: {
    mimeType: "multipart/report",
    headers: [
      { name: "From", value: from },
      { name: "Subject", value: subject },
      {
        name: "Content-Type",
        value: "multipart/report; report-type=delivery-status",
      },
      { name: "Authentication-Results", value: authenticationResults },
      ...(xFailedRecipients
        ? [{ name: "X-Failed-Recipients", value: xFailedRecipients }]
        : []),
    ],
    parts: includeDeliveryStatusPart
      ? [{
        mimeType: "message/delivery-status",
        body: { data: encodeBody(deliveryStatus) },
      }]
      : [],
  },
});

Deno.test("Gmail address lists are normalized and deduplicated", () => {
  assertEquals(
    parseEmailAddressList(
      'Customer <CUSTOMER@example.test>, "Manager, One" <manager@example.test>, manager@example.test',
    ),
    ["customer@example.test", "manager@example.test"],
    "normalized address list",
  );
});

Deno.test("ops action-notice fallback excludes the customer and mailbox identities", () => {
  assertEquals(
    resolveRefundOpsFallbackRecipients({
      recipients: [
        "customer@example.test",
        "info@bloomjoysweets.com",
        "ops-one@example.test",
        "OPS-ONE@example.test",
        "ops-two@example.test",
      ],
      customerEmail: "customer@example.test",
      mailboxIdentities: [
        "info@bloomjoysweets.com",
        "support@bloomjoysweets.com",
      ],
    }),
    ["ops-one@example.test", "ops-two@example.test"],
    "safe ops fallback recipients",
  );
});

Deno.test("ops action-notice fallback fails closed above its explicit recipient cap", () => {
  assertEquals(
    resolveRefundOpsFallbackRecipients({
      recipients: Array.from(
        { length: 6 },
        (_value, index) => `ops-${index + 1}@example.test`,
      ),
      customerEmail: "customer@example.test",
      mailboxIdentities: ["info@bloomjoysweets.com"],
    }),
    [],
    "over-cap ops fallback",
  );
});

Deno.test("mailbox aliases are mailbox-origin even when automatic headers are present", () => {
  const signals = inspectRefundGmailParticipantSignals({
    message: messageWithHeaders({
      From: "Bloomjoy Support <support@bloomjoysweets.com>",
      To: "Customer <customer@example.test>",
      Cc: "Manager One <manager-one@example.test>, manager-two@example.test",
      "Auto-Submitted": "auto-replied",
    }),
    mailboxIdentities: [
      "info@bloomjoysweets.com",
      "support@bloomjoysweets.com",
    ],
  });

  assertEquals(signals.mailboxOrigin, true, "mailbox alias classification");
  assertEquals(
    signals.providerSentEvidence,
    false,
    "no provider SENT evidence",
  );
  assertEquals(signals.participantTrust, "automated", "automatic signal");
  assertEquals(signals.toEmails, ["customer@example.test"], "To recipients");
  assertEquals(
    signals.ccEmails,
    ["manager-one@example.test", "manager-two@example.test"],
    "Cc recipients",
  );
});

Deno.test("only provider SENT evidence can verify a configured mailbox alias", () => {
  const providerSentMessage = messageWithHeaders({
    From: "Bloomjoy Support <support@bloomjoysweets.com>",
    To: "customer@example.test",
  });
  providerSentMessage.labelIds = ["SENT"];
  const sentSignals = inspectRefundGmailParticipantSignals({
    message: providerSentMessage,
    mailboxIdentities: [
      "info@bloomjoysweets.com",
      "support@bloomjoysweets.com",
    ],
  });
  assertEquals(
    sentSignals.mailboxOrigin,
    true,
    "alias matches configured identity",
  );
  assertEquals(
    sentSignals.providerSentEvidence,
    true,
    "provider SENT evidence",
  );

  const spoofedAlias = inspectRefundGmailParticipantSignals({
    message: messageWithHeaders({
      From: "support@bloomjoysweets.com",
      To: "info@bloomjoysweets.com",
      "Authentication-Results":
        "mx.google.com; spf=fail; dkim=fail; dmarc=fail",
    }),
    mailboxIdentities: [
      "info@bloomjoysweets.com",
      "support@bloomjoysweets.com",
    ],
  });
  assertEquals(spoofedAlias.mailboxOrigin, true, "address match alone");
  assertEquals(
    spoofedAlias.providerSentEvidence,
    false,
    "spoof has no provider SENT evidence",
  );
  assertEquals(
    spoofedAlias.participantTrust,
    "spoof_suspected",
    "spoof remains untrusted",
  );
});

Deno.test("hard bounce accepts receiver-authenticated reporter-aligned permanent DSN evidence", () => {
  const weakBounce = inspectRefundGmailParticipantSignals({
    message: messageWithHeaders({
      From: "mailer-daemon@googlemail.com",
      Subject: "Delivery Status Notification (Failure)",
    }),
    mailboxIdentities: ["info@bloomjoysweets.com"],
  });
  assertEquals(weakBounce.isBounce, true, "weak bounce classification");
  assertEquals(
    weakBounce.isHardBounce,
    false,
    "weak bounce cannot pause contact",
  );

  const strongBounce = buildDsnMessage({
    deliveryStatus: [
      "Reporting-MTA: dns; gmail-smtp-in.l.google.com",
      "",
      "Final-Recipient: rfc822; customer@example.test",
      "Action: failed",
      "Status: 5.1.1",
    ].join("\n"),
  });
  const strongSignals = inspectRefundGmailParticipantSignals({
    message: strongBounce,
    mailboxIdentities: ["info@bloomjoysweets.com"],
  });
  assertEquals(strongSignals.isHardBounce, true, "strong DSN classification");
  assertEquals(
    strongSignals.failedRecipientEmails,
    ["customer@example.test"],
    "failed recipient",
  );

  const alignedDkimDmarc = inspectRefundGmailParticipantSignals({
    message: buildDsnMessage({
      from: "postmaster@gmail.com",
      authenticationResults:
        "mx.google.com; spf=none smtp.mailfrom=<>; dkim=pass header.i=@gmail.com; dmarc=pass header.from=gmail.com",
      deliveryStatus:
        "Original-Recipient: rfc822; customer@example.test\nAction: failed\nStatus: 5.2.0",
    }),
    mailboxIdentities: ["info@bloomjoysweets.com"],
  });
  assertEquals(
    alignedDkimDmarc.isHardBounce,
    true,
    "aligned DKIM/DMARC reporter proof",
  );
});

Deno.test("hard bounce rejects unrelated passes and contradictory Google reporter authentication", () => {
  const signals = inspectRefundGmailParticipantSignals({
    message: buildDsnMessage({
      authenticationResults:
        "mx.google.com; spf=fail smtp.mailfrom=mailer-daemon@googlemail.com; dmarc=fail header.from=googlemail.com; dkim=pass header.i=@attacker.test",
      deliveryStatus:
        "Final-Recipient: rfc822; customer@example.test\nAction: failed\nStatus: 5.1.1",
    }),
    mailboxIdentities: ["info@bloomjoysweets.com"],
  });
  assertEquals(signals.isHardBounce, false, "contradictory reporter auth");
});

Deno.test("hard bounce rejects pass evidence from a non-Google authserv-id", () => {
  const signals = inspectRefundGmailParticipantSignals({
    message: buildDsnMessage({
      authenticationResults:
        "mail.attacker.test; spf=pass smtp.mailfrom=mailer-daemon@googlemail.com; dkim=pass header.i=@googlemail.com",
      deliveryStatus:
        "Final-Recipient: rfc822; customer@example.test\nAction: failed\nStatus: 5.1.1",
    }),
    mailboxIdentities: ["info@bloomjoysweets.com"],
  });
  assertEquals(signals.isHardBounce, false, "untrusted authserv-id");
});

Deno.test("hard bounce requires failed action and permanent 5.x status in one recipient block", () => {
  const delayed = inspectRefundGmailParticipantSignals({
    message: buildDsnMessage({
      deliveryStatus:
        "Final-Recipient: rfc822; customer@example.test\nAction: delayed\nStatus: 4.2.0",
    }),
    mailboxIdentities: ["info@bloomjoysweets.com"],
  });
  assertEquals(delayed.isHardBounce, false, "delayed 4.x result");
  assertEquals(delayed.failedRecipientEmails, [], "delayed recipient exclusion");

  for (const action of ["delivered", "relayed", "expanded"]) {
    const nonterminal = inspectRefundGmailParticipantSignals({
      message: buildDsnMessage({
        deliveryStatus:
          `Final-Recipient: rfc822; customer@example.test\nAction: ${action}\nStatus: 5.1.1`,
      }),
      mailboxIdentities: ["info@bloomjoysweets.com"],
    });
    assertEquals(nonterminal.isHardBounce, false, `${action} action`);
  }

  const missingPermanentStatus = inspectRefundGmailParticipantSignals({
    message: buildDsnMessage({
      deliveryStatus:
        "Final-Recipient: rfc822; customer@example.test\nAction: failed\nDiagnostic-Code: smtp; temporary failure",
    }),
    mailboxIdentities: ["info@bloomjoysweets.com"],
  });
  assertEquals(
    missingPermanentStatus.isHardBounce,
    false,
    "failed action without 5.x status",
  );
});

Deno.test("hard bounce binds recipient action and status inside the same DSN block", () => {
  const split = inspectRefundGmailParticipantSignals({
    message: buildDsnMessage({
      deliveryStatus: [
        "Final-Recipient: rfc822; customer@example.test",
        "Action: delayed",
        "Status: 4.2.0",
        "",
        "Final-Recipient: rfc822; other@example.test",
        "Action: failed",
        "Status: 5.1.1",
      ].join("\n"),
    }),
    mailboxIdentities: ["info@bloomjoysweets.com"],
  });
  assertEquals(
    split.failedRecipientEmails,
    ["other@example.test"],
    "only the permanently failed block recipient",
  );

  const wrongRecipient = inspectRefundGmailParticipantSignals({
    message: buildDsnMessage({
      deliveryStatus:
        "Final-Recipient: rfc822; wrong@example.test\nAction: failed\nStatus: 5.1.1",
    }),
    mailboxIdentities: ["info@bloomjoysweets.com"],
  });
  assertEquals(
    wrongRecipient.failedRecipientEmails,
    ["wrong@example.test"],
    "wrong failed recipient remains distinguishable for exact-case matching",
  );
});

Deno.test("hard bounce rejects subject, X-Failed-Recipients, and report-type without a DSN body", () => {
  const signals = inspectRefundGmailParticipantSignals({
    message: buildDsnMessage({
      deliveryStatus: "",
      includeDeliveryStatusPart: false,
      xFailedRecipients: "customer@example.test",
    }),
    mailboxIdentities: ["info@bloomjoysweets.com"],
  });
  assertEquals(signals.isBounce, true, "weak delivery notice classification");
  assertEquals(signals.isHardBounce, false, "weak delivery evidence");
  assertEquals(signals.failedRecipientEmails, [], "header-only recipient exclusion");
});

Deno.test("forwarded and spoof-suspected messages never look like direct customer replies", () => {
  const forwarded = inspectRefundGmailParticipantSignals({
    message: messageWithHeaders({
      From: "customer@example.test",
      To: "info@bloomjoysweets.com",
      Subject: "Fwd: refund details",
    }),
    mailboxIdentities: ["info@bloomjoysweets.com"],
  });
  assertEquals(forwarded.participantTrust, "forwarded", "forwarded signal");

  const spoofed = inspectRefundGmailParticipantSignals({
    message: messageWithHeaders({
      From: "customer@example.test",
      To: "info@bloomjoysweets.com",
      "Authentication-Results":
        "mx.google.com; spf=fail; dkim=fail; dmarc=fail",
    }),
    mailboxIdentities: ["info@bloomjoysweets.com"],
  });
  assertEquals(spoofed.participantTrust, "spoof_suspected", "spoof signal");
});

Deno.test("Gmail reply MIME has one customer To and deduplicated visible manager Cc", () => {
  const mime = buildRefundGmailReplyMime({
    from: "info@bloomjoysweets.com",
    to: "customer@example.test",
    cc: [
      "manager-one@example.test",
      "manager-one@example.test",
      "manager-two@example.test",
    ],
    subject: "We are carefully reviewing your refund request",
    text:
      "Thank you for your patience. We are sorry for the trouble and will keep this review moving.",
    html: "<p>Thank you for your patience.</p>",
    inReplyTo: "<customer-message@example.test>",
    references: "<first-message@example.test> <customer-message@example.test>",
    operationKey: "refund-case-message:synthetic",
  });
  const decoded = decodeBase64Url(mime.raw);

  assertIncludes(
    decoded,
    "To: customer@example.test\r\n",
    "customer To header",
  );
  assertIncludes(
    decoded,
    "Cc: manager-one@example.test, manager-two@example.test\r\n",
    "manager Cc header",
  );
  assertIncludes(
    decoded,
    "In-Reply-To: <customer-message@example.test>",
    "reply header",
  );
  assertNotIncludes(decoded, "/refunds?case=", "customer-visible case link");
  assertNotIncludes(
    decoded,
    "Auto-Submitted:",
    "manual reply automatic-response header",
  );
  assertNotIncludes(
    decoded,
    "X-Auto-Response-Suppress:",
    "manual reply suppression header",
  );
});

Deno.test("automatic Gmail replies suppress responder loops without changing manual mail", () => {
  const mime = buildRefundGmailReplyMime({
    from: "info@bloomjoysweets.com",
    to: "customer@example.test",
    cc: ["manager@example.test"],
    deliveryKind: "automatic",
    subject: "We received your refund request",
    text: "Thank you for contacting us. We are reviewing your request carefully.",
    html: "<p>Thank you for contacting us.</p>",
    operationKey: "refund-case-message:synthetic-automatic",
  });
  const decoded = decodeBase64Url(mime.raw);

  assertIncludes(
    decoded,
    "Auto-Submitted: auto-generated\r\n",
    "automatic reply classification header",
  );
  assertIncludes(
    decoded,
    "X-Auto-Response-Suppress: All\r\n",
    "automatic reply suppression header",
  );
});

Deno.test("Gmail send pins the provider thread and preserves the resolved CC set", async () => {
  const originalFetch = globalThis.fetch;
  let sentPayload: { threadId?: unknown; raw?: unknown } = {};
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(
        JSON.stringify({ access_token: "synthetic-token", expires_in: 3600 }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    const requestBody = (init as { body?: BodyInit } | undefined)?.body;
    sentPayload = JSON.parse(String(requestBody ?? "{}")) as {
      threadId?: unknown;
      raw?: unknown;
    };
    return new Response(
      JSON.stringify({ id: "sent-message", threadId: "original-thread" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const config: RefundGmailConfig = {
    clientId: "synthetic-client",
    clientSecret: "synthetic-secret",
    refreshToken: "synthetic-refresh",
    mailbox: "info@bloomjoysweets.com",
    mailboxIdentities: [
      "info@bloomjoysweets.com",
      "support@bloomjoysweets.com",
    ],
    labelId: "synthetic-label",
    startAt: new Date("2026-08-03T00:00:00Z"),
  };

  try {
    const result = await sendRefundGmailReply({
      config,
      providerThreadId: "original-thread",
      operationKey: "refund-case-message:synthetic-send",
      recipientEmail: "customer@example.test",
      ccEmails: ["manager@example.test"],
      deliveryKind: "automatic",
      subject: "A quick refund update",
      text:
        "We are sorry for the inconvenience. Thank you for helping us review this carefully.",
      html: "<p>We are sorry for the inconvenience.</p>",
      inReplyTo: "<customer-message@example.test>",
    });
    assertEquals(
      sentPayload?.threadId,
      "original-thread",
      "provider thread ID",
    );
    assertEquals(result.ccCount, 1, "sent CC count");
    const decoded = decodeBase64Url(String(sentPayload?.raw ?? ""));
    assertIncludes(decoded, "Cc: manager@example.test", "sent manager CC");
    assertIncludes(
      decoded,
      "Auto-Submitted: auto-generated",
      "sent automatic-response header",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
