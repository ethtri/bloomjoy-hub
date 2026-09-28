import {
  auditedPriorCompletionDelivery,
  auditedPriorCompletionDeliverySet,
  diagnoseCleanOriginalCompletionThread,
  diagnoseExternalCompletionCopy,
  diagnoseUnsentCompletionThreadHistory,
  governedCompletionThreadEvidence,
  reviewedCurrentCompletionCopy,
  verifiedUnsentCompletionThreadHistory,
} from "./refund-exhausted-completion-recovery.ts";
import {
  type GmailThread,
  REFUND_GMAIL_OPERATION_HEADER,
  refundGmailRecipientMessageQuery,
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
const mailboxEmail = "operator@example.test";
const senderIdentities = ["info@example.test"];
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

const encodeBody = (value: string) =>
  btoa(unescape(encodeURIComponent(value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const exactExternalCopy = {
  id: "external-copy",
  threadId: "external-thread",
  internalDate: String(Date.parse("2026-09-19T14:47:20Z")),
  labelIds: ["INBOX"],
  payload: {
    mimeType: "text/plain",
    body: { data: encodeBody("Stored completion") },
    headers: [
      { name: "From", value: "Bloomjoy <info@example.test>" },
      { name: "To", value: "customer@example.test" },
      { name: "Cc", value: "manager@example.test, operator@example.test" },
      { name: "Subject", value: "Re: Order failure" },
    ],
  },
};

const caseId = "4649e28d-38a3-418b-9452-e3d62254b044";
const gmailThreadId = "aa49e28d-38a3-418b-9452-e3d62254b044";
const governedEnvelope = {
  message: {
    id: messageId,
    refundCaseId: caseId,
    recipientEmail: "customer@example.test",
    subject: "Re: Order failure",
    body: "Stored completion",
  },
  gmailThreadId,
  transport: "gmail_thread",
  payloadRedacted: true,
};

Deno.test("governed completion loader evidence binds the exact message, case, recipient, and Gmail thread", () => {
  const exact = governedCompletionThreadEvidence({
    loaded: governedEnvelope,
    loadError: null,
    caseId,
    completionMessageId: messageId,
    recipientEmail: "CUSTOMER@example.test ",
  });
  if (exact?.gmailThreadId !== gmailThreadId) {
    throw new Error("Exact governed completion envelope was rejected");
  }

  const mismatches = [
    { ...governedEnvelope, message: { ...governedEnvelope.message, id: crypto.randomUUID() } },
    { ...governedEnvelope, message: { ...governedEnvelope.message, refundCaseId: crypto.randomUUID() } },
    { ...governedEnvelope, message: { ...governedEnvelope.message, recipientEmail: "other@example.test" } },
    { ...governedEnvelope, gmailThreadId: "not-a-uuid" },
    { ...governedEnvelope, transport: "transactional_email" },
    { ...governedEnvelope, payloadRedacted: false },
  ];
  for (const loaded of mismatches) {
    if (governedCompletionThreadEvidence({
      loaded,
      loadError: null,
      caseId,
      completionMessageId: messageId,
      recipientEmail: "customer@example.test",
    }) !== null) throw new Error("Mismatched governed envelope was accepted");
  }
  if (governedCompletionThreadEvidence({
    loaded: governedEnvelope,
    loadError: { code: "42501" },
    caseId,
    completionMessageId: messageId,
    recipientEmail: "customer@example.test",
  }) !== null) throw new Error("RPC error was accepted");
});

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

Deno.test("mailbox-wide recipient search quotes the address and fixes both time bounds", () => {
  const params = refundGmailRecipientMessageQuery({
    recipientEmail: "customer+refund@example.test",
    completionCreatedAt: "2026-09-19T14:30:00Z",
    through: new Date("2026-09-28T08:00:00Z"),
    pageToken: "next-page",
  });
  const query = params.get("q") ?? "";
  for (const atom of [
    'to:"customer+refund@example.test"',
    'cc:"customer+refund@example.test"',
    'bcc:"customer+refund@example.test"',
    "in:anywhere",
    "after:1789828199",
    "before:1790582402",
  ]) {
    if (!query.includes(atom)) throw new Error(`Missing query atom ${atom}`);
  }
  if (params.get("includeSpamTrash") !== "true" ||
    params.get("maxResults") !== "100" ||
    params.get("pageToken") !== "next-page") {
    throw new Error("Recipient search bounds were not preserved");
  }
});

Deno.test("the immutable original thread is independently clean and current", () => {
  const exact = diagnoseCleanOriginalCompletionThread({
    ...input,
  });
  if (!exact.valid || exact.customerDirectedAfterCompletionCount !== 0) {
    throw new Error("Clean original completion thread was rejected");
  }
  const later = {
    ...exactExternalCopy,
    id: "later-in-original",
    threadId: original.id,
  };
  const changed = diagnoseCleanOriginalCompletionThread({
    ...input,
    thread: { ...original, messages: [...original.messages!, later] },
  });
  if (changed.valid || changed.customerDirectedAfterCompletionCount !== 1) {
    throw new Error("Later original-thread customer mail was accepted");
  }
});

Deno.test("one exact different-thread external completion copy is diagnosed", () => {
  const audited = auditedPriorCompletionDelivery({
    event: auditedEvent,
    completionMessageId: messageId,
  })!;
  const exact = diagnoseExternalCompletionCopy({
    messages: [exactExternalCopy],
    searchComplete: true,
    pageCount: 1,
    candidateCount: 1,
    throughAt: "2026-09-28T08:00:00Z",
    originalProviderThreadId: original.id!,
    recipientEmail: "customer@example.test",
    completionCreatedAt: input.completionCreatedAt,
    completionSubject: "Re: Order failure",
    completionBody: "Stored completion",
    auditedPriorDelivery: audited,
    mailboxEmail,
    senderEmail: "info@example.test",
  });
  if (!exact.valid || exact.auditedMatchCount !== 1 ||
    exact.blockingMessageCount !== 0 || exact.payloadRedacted !== true) {
    throw new Error("Exact external completion copy was rejected");
  }
});

Deno.test("external completion copy diagnosis fails closed on any mismatch or incomplete scan", () => {
  const audited = auditedPriorCompletionDelivery({
    event: auditedEvent,
    completionMessageId: messageId,
  })!;
  const base = {
    messages: [exactExternalCopy],
    searchComplete: true,
    pageCount: 1,
    candidateCount: 1,
    throughAt: "2026-09-28T08:00:00Z",
    originalProviderThreadId: original.id!,
    recipientEmail: "customer@example.test",
    completionCreatedAt: input.completionCreatedAt,
    completionSubject: "Re: Order failure",
    completionBody: "Stored completion",
    auditedPriorDelivery: audited,
    mailboxEmail,
    senderEmail: "info@example.test",
  };
  const changedMessage = (changes: Record<string, unknown>) => ({
    ...exactExternalCopy,
    ...changes,
  });
  const changedHeaders = (headers: Array<{ name: string; value: string }>) =>
    changedMessage({
      payload: { ...exactExternalCopy.payload, headers },
    });
  const exactHeaders = exactExternalCopy.payload.headers;
  const unsafe = [
    { ...base, searchComplete: false },
    { ...base, pageCount: 0 },
    { ...base, candidateCount: 2 },
    { ...base, throughAt: "2026-09-19T14:40:00Z" },
    { ...base, messages: [changedMessage({ threadId: original.id })] },
    { ...base, messages: [changedMessage({
      internalDate: String(Date.parse("2026-09-19T14:49:00Z")),
    })] },
    { ...base, messages: [changedMessage({ labelIds: [] })] },
    { ...base, messages: [changedMessage({ labelIds: ["INBOX", "DRAFT"] })] },
    { ...base, messages: [changedMessage({ labelIds: ["INBOX", "SENT"] })] },
    { ...base, messages: [changedMessage({ internalDate: "not-a-time" })] },
    { ...base, messages: [{
      ...exactExternalCopy,
      payload: undefined,
    }] },
    { ...base, messages: [changedHeaders(exactHeaders.map((header) =>
      header.name === "To" ? { ...header, value: "other@example.test" } : header
    ))] },
    { ...base, messages: [changedHeaders(exactHeaders.map((header) =>
      header.name === "Cc" ? { ...header, value: "manager@example.test" } : header
    ))] },
    { ...base, messages: [changedHeaders(exactHeaders.map((header) =>
      header.name === "Cc"
        ? { ...header, value: "manager@example.test, other@example.test" }
        : header
    ))] },
    { ...base, messages: [changedHeaders(exactHeaders.map((header) =>
      header.name === "From" ? { ...header, value: "other@example.test" } : header
    ))] },
    { ...base, messages: [changedHeaders(exactHeaders.map((header) =>
      header.name === "Subject" ? { ...header, value: "Other" } : header
    ))] },
    { ...base, messages: [changedMessage({
      payload: {
        ...exactExternalCopy.payload,
        body: { data: encodeBody("Different body") },
      },
    })] },
    { ...base, messages: [changedHeaders([
      ...exactHeaders,
      { name: REFUND_GMAIL_OPERATION_HEADER, value: "unexpected" },
    ])] },
    { ...base, messages: [exactExternalCopy, {
      ...exactExternalCopy,
      id: "unrelated-later-message",
      internalDate: String(Date.parse("2026-09-20T14:47:20Z")),
      payload: {
        ...exactExternalCopy.payload,
        body: { data: encodeBody("Another message") },
      },
    }], candidateCount: 2 },
  ];
  for (const input of unsafe) {
    if (diagnoseExternalCompletionCopy(input).valid) {
      throw new Error("Unsafe external completion copy evidence was accepted");
    }
  }

  const paddedBeforeCompletion = {
    ...exactExternalCopy,
    id: "padding-only",
    internalDate: String(Date.parse("2026-09-19T14:29:59.500Z")),
  };
  const padded = diagnoseExternalCompletionCopy({
    ...base,
    messages: [paddedBeforeCompletion, exactExternalCopy],
    candidateCount: 2,
  });
  if (!padded.valid || padded.blockingMessageCount !== 0 ||
    padded.customerDirectedAfterCompletionCount !== 1) {
    throw new Error("Retrieval-padding message created a false block");
  }
});

Deno.test("an exact audited prior stale completion delivery is accepted once", () => {
  const audited = auditedPriorCompletionDelivery({
    event: auditedEvent,
    completionMessageId: messageId,
  });
  if (audited?.deliveredAt !== priorDeliveryAt || audited.managerCcCount !== 2) {
    throw new Error("Expected exact audited prior delivery");
  }
  const staleSent = {
    id: "stale-completion",
    threadId: original.id,
    internalDate: String(Date.parse("2026-09-19T14:47:20Z")),
    labelIds: ["INBOX"],
    payload: { headers: [
      { name: "From", value: "Bloomjoy <info@example.test>" },
      { name: "To", value: "customer@example.test" },
      { name: "Cc", value: "manager@example.test, operator@example.test" },
    ] },
  };
  if (
    verifiedUnsentCompletionThreadHistory({
      ...input,
      auditedPriorDelivery: audited,
      mailboxEmail,
      senderIdentities,
      thread: { ...original, messages: [...original.messages!, staleSent] },
    }) !== "673955"
  ) throw new Error("Exact audited prior delivery was rejected");
});

Deno.test("bounded diagnostic exposes a safe fresh history token only for the exact audited envelope", () => {
  const audited = auditedPriorCompletionDelivery({
    event: auditedEvent,
    completionMessageId: messageId,
  })!;
  const staleSent = {
    id: "stale-completion",
    threadId: original.id,
    internalDate: String(Date.parse("2026-09-19T14:47:20Z")),
    labelIds: ["INBOX"],
    payload: { headers: [
      { name: "From", value: "Bloomjoy <info@example.test>" },
      { name: "To", value: "customer@example.test" },
      { name: "Cc", value: "manager@example.test, operator@example.test" },
    ] },
  };
  const exact = diagnoseUnsentCompletionThreadHistory({
    ...input,
    auditedPriorDelivery: audited,
    mailboxEmail,
    senderIdentities,
    thread: { ...original, messages: [...original.messages!, staleSent] },
  });
  if (!exact.valid || exact.safeCurrentHistoryId !== "673955" ||
    exact.auditedMatchCount !== 1 || exact.payloadRedacted !== true) {
    throw new Error("Exact audited envelope diagnostic was not valid");
  }
  const staleHistory = diagnoseUnsentCompletionThreadHistory({
    ...input,
    auditedPriorDelivery: audited,
    mailboxEmail,
    senderIdentities,
    thread: {
      ...original,
      historyId: "673956",
      messages: [...original.messages!, staleSent],
    },
  });
  if (staleHistory.valid || staleHistory.historyIdMatch ||
    staleHistory.safeCurrentHistoryId !== "673956" ||
    staleHistory.auditedMatchCount !== 1 ||
    staleHistory.unexpectedCustomerDirectedCount !== 0) {
    throw new Error("Safe history-only mismatch was not isolated");
  }
  const wrongLabel = diagnoseUnsentCompletionThreadHistory({
    ...input,
    auditedPriorDelivery: audited,
    mailboxEmail,
    senderIdentities,
    thread: {
      ...original,
      historyId: "673956",
      messages: [...original.messages!, { ...staleSent, labelIds: [] }],
    },
  });
  if (wrongLabel.safeCurrentHistoryId !== null ||
    wrongLabel.unexpectedCustomerDirectedCount !== 1) {
    throw new Error("Unsafe envelope exposed a fresh history token");
  }
  const unsafeMessageSets = [
    [...original.messages!, staleSent, {
      ...staleSent,
      id: "draft",
      labelIds: ["DRAFT"],
    }],
    [...original.messages!, {
      ...staleSent,
      payload: { headers: [
        ...staleSent.payload.headers,
        {
          name: REFUND_GMAIL_OPERATION_HEADER,
          value: refundGmailOperationMarker(`refund-case-message:${messageId}`),
        },
      ] },
    }],
    [...original.messages!, staleSent, { ...staleSent, id: "duplicate" }],
  ];
  for (const messages of unsafeMessageSets) {
    const unsafe = diagnoseUnsentCompletionThreadHistory({
      ...input,
      auditedPriorDelivery: audited,
      mailboxEmail,
      senderIdentities,
      thread: { ...original, historyId: "673956", messages },
    });
    if (unsafe.safeCurrentHistoryId !== null || unsafe.valid) {
      throw new Error("Draft, marker, or duplicate exposed a history token");
    }
  }
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
    labelIds: ["INBOX"],
    payload: { headers: [
      { name: "From", value: "Bloomjoy <info@example.test>" },
      { name: "To", value: "customer@example.test" },
      { name: "Cc", value: "manager@example.test, operator@example.test" },
    ] },
  };
  const audited = auditedPriorCompletionDelivery({
    event: auditedEvent,
    completionMessageId: messageId,
  })!;
  const base = {
    ...input,
    auditedPriorDelivery: audited,
    mailboxEmail,
    senderIdentities,
  };
  if (verifiedUnsentCompletionThreadHistory(base) !== null) {
    throw new Error("Missing audited sent message was accepted");
  }
  if (
    verifiedUnsentCompletionThreadHistory({
      ...base,
      auditedPriorDelivery: {
        ...audited,
        deliveredAt: "2026-09-19T14:29:30Z",
      },
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
  if (
    verifiedUnsentCompletionThreadHistory({
      ...base,
      thread: {
        ...original,
        messages: [...original.messages!, {
          ...staleSent,
          payload: { headers: [
            { name: "From", value: "attacker@example.test" },
            { name: "To", value: "customer@example.test" },
            { name: "Cc", value: "manager@example.test, operator@example.test" },
          ] },
        }],
      },
    }) !== null
  ) throw new Error("An untrusted external sender was accepted");
  for (const unsafe of [
    { ...staleSent, labelIds: [] },
    { ...staleSent, labelIds: ["SENT"] },
    {
      ...staleSent,
      payload: { headers: [
        { name: "From", value: "Bloomjoy <info@example.test>" },
        { name: "To", value: "customer@example.test" },
        { name: "Cc", value: "manager@example.test, other@example.test" },
      ] },
    },
    {
      ...staleSent,
      payload: { headers: [
        { name: "From", value: "Bloomjoy <info@example.test>" },
        { name: "To", value: "customer@example.test" },
        { name: "Cc", value: "operator@example.test" },
      ] },
    },
  ]) {
    if (
      verifiedUnsentCompletionThreadHistory({
        ...base,
        thread: { ...original, messages: [...original.messages!, unsafe] },
      }) !== null
    ) throw new Error("A mismatched audited inbox envelope was accepted");
  }
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
