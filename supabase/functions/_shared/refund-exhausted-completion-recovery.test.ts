import {
  auditedPriorCompletionDelivery,
  auditedPriorCompletionDeliverySet,
  reviewedCurrentCompletionCopy,
  verifiedUnsentCompletionThreadHistory,
} from "./refund-exhausted-completion-recovery.ts";
import {
  type GmailThread,
  REFUND_GMAIL_OPERATION_HEADER,
  refundGmailOperationMarker,
} from "./refund-gmail.ts";

const messageId = "ceb8121d-e419-419c-bb44-60c8c70b2ac4";
const original: GmailThread = {
  id: "provider-thread-1",
  historyId: "673955",
  messages: [
    {
      id: "original-inbound",
      threadId: "provider-thread-1",
      internalDate: String(Date.parse("2026-09-07T01:00:00Z")),
      labelIds: ["INBOX"],
      payload: { headers: [{ name: "From", value: "customer@example.test" }] },
    },
    {
      id: "prior-ack",
      threadId: "provider-thread-1",
      internalDate: String(Date.parse("2026-09-07T02:00:00Z")),
      labelIds: ["SENT"],
      payload: { headers: [{ name: "To", value: "customer@example.test" }] },
    },
  ],
};
const input = {
  thread: original,
  providerThreadId: "provider-thread-1",
  reviewedHistoryId: "673955",
  recipientEmail: "customer@example.test",
  completionCreatedAt: "2026-09-19T14:30:00Z",
  completionMessageId: messageId,
};

const priorDeliveryAt = "2026-09-19T14:47:22.399191Z";
const auditedEvent = {
  event_type: "refund_customer_completion_recovery_sent",
  created_at: priorDeliveryAt,
  metadata: {
    managerCcCount: 2,
    sourceMessageId: messageId,
    deliveryTransport: "resend",
    providerLastEvent: "delivered",
    providerMessageIdDigest: "a".repeat(64),
    paymentOperationPerformed: false,
    originalGmailThreadPreserved: true,
  },
};

Deno.test("reviewed current completion copy keeps exact confirmed wording", () => {
  const copy = reviewedCurrentCompletionCopy({
    subject: "Re: Order failure",
    body:
      "Nayax confirmed your $27.00 refund on September 19.\n\nReference: RF-TEST",
  });
  if (
    !copy || copy.subject !== "Re: Order failure" ||
    !copy.body.includes("confirmed your $27.00 refund")
  ) {
    throw new Error("Expected exact reviewed current copy");
  }
});

Deno.test("stale timing promises and silently trimmed copy are rejected", () => {
  for (
    const body of [
      "Your refund is on its way. Reference: RF-TEST",
      "Your refund was confirmed and may take four business days. Reference: RF-TEST",
      "Your refund was confirmed. Reference: RF-TEST\n",
    ]
  ) {
    if (reviewedCurrentCompletionCopy({ subject: "Re: Order failure", body })) {
      throw new Error("Unsafe or changed copy was accepted");
    }
  }
});

Deno.test("negated or ambiguous completion claims are rejected", () => {
  for (
    const body of [
      "Your refund is not confirmed. Reference: RF-TEST",
      "We confirmed no refund. Reference: RF-TEST",
      "Nayax confirmed your $27.00 refund was not processed. Reference: RF-TEST",
      "Nayax confirmed your $27.00 refund on September 19. It was not processed. Reference: RF-TEST",
    ]
  ) {
    if (reviewedCurrentCompletionCopy({ subject: "Re: Order failure", body })) {
      throw new Error(
        "A noncanonical or negated completion claim was accepted",
      );
    }
  }
});

Deno.test("current original-thread history with no later send is accepted", () => {
  if (verifiedUnsentCompletionThreadHistory(input) !== "673955") {
    throw new Error("Expected original-thread evidence");
  }
});

Deno.test("an exact audited prior stale completion delivery is accepted once", () => {
  const audited = auditedPriorCompletionDelivery({
    event: auditedEvent,
    completionMessageId: messageId,
  });
  if (audited?.deliveredAt !== priorDeliveryAt) {
    throw new Error("Expected exact audited prior delivery");
  }
  const staleSent = {
    id: "stale-completion",
    threadId: original.id,
    internalDate: String(Date.parse("2026-09-19T14:47:20Z")),
    labelIds: ["SENT"],
    payload: { headers: [{ name: "To", value: "customer@example.test" }] },
  };
  if (
    verifiedUnsentCompletionThreadHistory({
      ...input,
      auditedPriorDeliveryAt: audited.deliveredAt,
      thread: { ...original, messages: [...original.messages!, staleSent] },
    }) !== "673955"
  ) throw new Error("Exact audited prior delivery was rejected");
});

Deno.test("malformed prior delivery audit evidence is rejected", () => {
  for (
    const event of [
      { ...auditedEvent, created_at: "not-a-time" },
      {
        ...auditedEvent,
        metadata: {
          ...auditedEvent.metadata,
          sourceMessageId: crypto.randomUUID(),
        },
      },
      {
        ...auditedEvent,
        metadata: { ...auditedEvent.metadata, providerLastEvent: "sent" },
      },
      {
        ...auditedEvent,
        metadata: { ...auditedEvent.metadata, paymentOperationPerformed: true },
      },
      {
        ...auditedEvent,
        metadata: { ...auditedEvent.metadata, providerMessageIdDigest: "bad" },
      },
      {
        ...auditedEvent,
        metadata: { ...auditedEvent.metadata, unexpectedPayload: "blocked" },
      },
    ]
  ) {
    if (
      auditedPriorCompletionDelivery({ event, completionMessageId: messageId })
    ) {
      throw new Error("Malformed prior delivery audit evidence was accepted");
    }
  }
});

Deno.test("the prior delivery audit set fails closed on any ambiguity", () => {
  const unrelatedEvent = {
    ...auditedEvent,
    metadata: {
      ...auditedEvent.metadata,
      sourceMessageId: crypto.randomUUID(),
    },
  };
  const malformedEvent = {
    ...auditedEvent,
    metadata: { ...auditedEvent.metadata, unexpectedPayload: "blocked" },
  };
  for (
    const events of [
      [unrelatedEvent],
      [malformedEvent],
      [auditedEvent, unrelatedEvent],
      [auditedEvent, malformedEvent],
      [auditedEvent, { ...auditedEvent }],
    ]
  ) {
    if (
      auditedPriorCompletionDeliverySet({
        events,
        completionMessageId: messageId,
      }) !== null
    ) {
      throw new Error("Ambiguous prior delivery audit evidence was accepted");
    }
  }
  const legacy = auditedPriorCompletionDeliverySet({
    events: [],
    completionMessageId: messageId,
  });
  if (!legacy || legacy.length !== 0) {
    throw new Error("Legacy no-event path was rejected");
  }
  const exact = auditedPriorCompletionDeliverySet({
    events: [auditedEvent],
    completionMessageId: messageId,
  });
  if (
    !exact || exact.length !== 1 || exact[0].deliveredAt !== priorDeliveryAt
  ) {
    throw new Error("Exact single audited delivery was rejected");
  }
});

Deno.test("audited delivery requires one matching sent message and no draft or later send", () => {
  const staleSent = {
    id: "stale-completion",
    threadId: original.id,
    internalDate: String(Date.parse("2026-09-19T14:47:20Z")),
    labelIds: ["SENT"],
    payload: { headers: [{ name: "To", value: "customer@example.test" }] },
  };
  const base = {
    ...input,
    auditedPriorDeliveryAt: priorDeliveryAt,
  };
  if (verifiedUnsentCompletionThreadHistory(base) !== null) {
    throw new Error("Missing audited sent message was accepted");
  }
  if (
    verifiedUnsentCompletionThreadHistory({
      ...base,
      auditedPriorDeliveryAt: "2026-09-19T14:29:30Z",
      thread: {
        ...original,
        messages: [
          ...original.messages!,
          {
            ...staleSent,
            internalDate: String(Date.parse("2026-09-19T14:30:10Z")),
          },
        ],
      },
    }) !== null
  ) throw new Error("A pre-completion audit timestamp was accepted");
  if (
    verifiedUnsentCompletionThreadHistory({
      ...base,
      thread: {
        ...original,
        messages: [...original.messages!, staleSent, {
          ...staleSent,
          id: "duplicate",
        }],
      },
    }) !== null
  ) throw new Error("Duplicate audited sent messages were accepted");
  if (
    verifiedUnsentCompletionThreadHistory({
      ...base,
      thread: {
        ...original,
        messages: [...original.messages!, staleSent, {
          ...staleSent,
          id: "newer",
          internalDate: String(Date.parse("2026-09-19T15:00:00Z")),
        }],
      },
    }) !== null
  ) {
    throw new Error(
      "A later sent message after the audited delivery was accepted",
    );
  }
  if (
    verifiedUnsentCompletionThreadHistory({
      ...base,
      thread: {
        ...original,
        messages: [...original.messages!, staleSent, {
          id: "draft",
          threadId: original.id,
          internalDate: String(Date.parse("2026-09-19T15:00:00Z")),
          labelIds: ["DRAFT"],
          payload: {
            headers: [{ name: "To", value: "customer@example.test" }],
          },
        }],
      },
    }) !== null
  ) throw new Error("A current draft was accepted");
});

Deno.test("wrong numeric history or a different linked thread is rejected", () => {
  if (
    verifiedUnsentCompletionThreadHistory({
      ...input,
      reviewedHistoryId: "673956",
    }) !== null
  ) {
    throw new Error("Wrong history was accepted");
  }
  if (
    verifiedUnsentCompletionThreadHistory({
      ...input,
      providerThreadId: "other-thread",
    }) !== null
  ) {
    throw new Error("Wrong thread was accepted");
  }
});

Deno.test("sent completion or any later sent mail to the customer blocks recovery", () => {
  const laterSent = {
    id: "later-sent",
    threadId: original.id,
    internalDate: String(Date.parse("2026-09-19T14:31:00Z")),
    labelIds: ["SENT"],
    payload: { headers: [{ name: "To", value: "customer@example.test" }] },
  };
  if (
    verifiedUnsentCompletionThreadHistory({
      ...input,
      thread: { ...original, messages: [...original.messages!, laterSent] },
    }) !== null
  ) throw new Error("Later sent mail was accepted");

  const markedSent = {
    ...original.messages![1],
    payload: {
      headers: [
        { name: "To", value: "customer@example.test" },
        {
          name: REFUND_GMAIL_OPERATION_HEADER,
          value: refundGmailOperationMarker(`refund-case-message:${messageId}`),
        },
      ],
    },
  };
  if (
    verifiedUnsentCompletionThreadHistory({
      ...input,
      thread: { ...original, messages: [original.messages![0], markedSent] },
    }) !== null
  ) throw new Error("Exact operation marker was accepted");
});
