import {
  verifiedUnsentCompletionThreadHistory,
} from "./refund-exhausted-completion-recovery.ts";
import {
  REFUND_GMAIL_OPERATION_HEADER,
  refundGmailOperationMarker,
  type GmailThread,
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

Deno.test("current original-thread history with no later send is accepted", () => {
  if (verifiedUnsentCompletionThreadHistory(input) !== "673955") {
    throw new Error("Expected original-thread evidence");
  }
});

Deno.test("wrong numeric history or a different linked thread is rejected", () => {
  if (verifiedUnsentCompletionThreadHistory({ ...input, reviewedHistoryId: "673956" }) !== null) {
    throw new Error("Wrong history was accepted");
  }
  if (verifiedUnsentCompletionThreadHistory({ ...input, providerThreadId: "other-thread" }) !== null) {
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
  if (verifiedUnsentCompletionThreadHistory({
    ...input,
    thread: { ...original, messages: [...original.messages!, laterSent] },
  }) !== null) throw new Error("Later sent mail was accepted");

  const markedSent = {
    ...original.messages![1],
    payload: { headers: [
      { name: "To", value: "customer@example.test" },
      { name: REFUND_GMAIL_OPERATION_HEADER, value: refundGmailOperationMarker(`refund-case-message:${messageId}`) },
    ] },
  };
  if (verifiedUnsentCompletionThreadHistory({
    ...input,
    thread: { ...original, messages: [original.messages![0], markedSent] },
  }) !== null) throw new Error("Exact operation marker was accepted");
});
