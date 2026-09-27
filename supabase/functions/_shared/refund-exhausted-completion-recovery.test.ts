import {
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
    ]
  ) {
    if (reviewedCurrentCompletionCopy({ subject: "Re: Order failure", body })) {
      throw new Error("A noncanonical or negated completion claim was accepted");
    }
  }
});

Deno.test("current original-thread history with no later send is accepted", () => {
  if (verifiedUnsentCompletionThreadHistory(input) !== "673955") {
    throw new Error("Expected original-thread evidence");
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
