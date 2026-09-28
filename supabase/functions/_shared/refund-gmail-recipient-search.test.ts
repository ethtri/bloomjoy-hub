import {
  listRefundGmailMessagesDirectedToRecipient,
  type RefundGmailConfig,
  type RefundGmailReadRequest,
} from "./refund-gmail.ts";

const config: RefundGmailConfig = {
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "refresh",
  mailbox: "operator@example.test",
  senderEmail: "info@example.test",
  mailboxIdentities: ["operator@example.test", "info@example.test"],
  labelId: "refunds",
  startAt: new Date("2026-09-01T00:00:00Z"),
};

const input = {
  config,
  recipientEmail: "customer+refund@example.test",
  completionCreatedAt: "2026-09-19T14:30:00Z",
  through: new Date("2026-09-28T08:00:00Z"),
};

const expectReject = async (
  request: RefundGmailReadRequest,
  label: string,
) => {
  try {
    await listRefundGmailMessagesDirectedToRecipient(input, request);
  } catch {
    return;
  }
  throw new Error(`${label} did not fail closed`);
};

Deno.test("recipient message search quotes plus-addresses and completes every page before full fetch", async () => {
  const paths: string[] = [];
  const request: RefundGmailReadRequest = async <T>(
    _config: RefundGmailConfig,
    path: string,
  ) => {
    paths.push(path);
    if (path.startsWith("/messages?")) {
      const url = new URL(`https://example.test${path}`);
      const query = url.searchParams.get("q") ?? "";
      for (const atom of [
        'to:"customer+refund@example.test"',
        'cc:"customer+refund@example.test"',
        'bcc:"customer+refund@example.test"',
      ]) {
        if (!query.includes(atom)) throw new Error(`Missing ${atom}`);
      }
      if (url.searchParams.get("pageToken") === "page-2") {
        return {
          messages: [{ id: "message-2", threadId: "thread-2" }],
          resultSizeEstimate: 1,
        } as T;
      }
      return {
        messages: [{ id: "message-1", threadId: "thread-1" }],
        nextPageToken: "page-2",
        resultSizeEstimate: 2,
      } as T;
    }
    const id = path.includes("message-1") ? "message-1" : "message-2";
    const threadId = id === "message-1" ? "thread-1" : "thread-2";
    return { id, threadId, payload: { headers: [] } } as T;
  };
  const result = await listRefundGmailMessagesDirectedToRecipient(
    input,
    request,
  );
  if (!result.complete || result.pageCount !== 2 ||
    result.candidateCount !== 2 || result.messages.length !== 2 ||
    !paths[0].startsWith("/messages?") ||
    !paths[1].startsWith("/messages?") ||
    !paths[2].includes("message-1") || !paths[3].includes("message-2")) {
    throw new Error("Recipient search did not finish before full-message reads");
  }
});

Deno.test("recipient message search rejects query-significant address syntax", async () => {
  try {
    await listRefundGmailMessagesDirectedToRecipient({
      ...input,
      recipientEmail: 'customer"@example.test',
    }, async <T>() => ({ messages: [], resultSizeEstimate: 0 }) as T);
  } catch {
    return;
  }
  throw new Error("Query-significant address did not fail closed");
});

Deno.test("recipient message search rejects repeated and excessive pagination", async () => {
  let repeatedCalls = 0;
  await expectReject(async <T>() => {
    repeatedCalls += 1;
    return {
      messages: [],
      nextPageToken: "repeat",
      resultSizeEstimate: 0,
    } as T;
  }, "Repeated page token");
  if (repeatedCalls !== 2) throw new Error("Repeated token was not detected");

  let pageCalls = 0;
  await expectReject(async <T>() => {
    pageCalls += 1;
    return {
      messages: [],
      nextPageToken: `page-${pageCalls}`,
      resultSizeEstimate: 0,
    } as T;
  }, "Page bound");
  if (pageCalls !== 10) throw new Error("Page bound was not exact");
});

Deno.test("recipient message search rejects excessive or malformed result sets", async () => {
  let page = 0;
  await expectReject(async <T>() => {
    page += 1;
    return {
      messages: Array.from({ length: 100 }, (_, index) => ({
        id: `message-${page}-${index}`,
        threadId: `thread-${page}-${index}`,
      })),
      nextPageToken: `page-${page + 1}`,
      resultSizeEstimate: 600,
    } as T;
  }, "Message bound");

  for (const malformed of [
    {},
    { messages: "invalid", resultSizeEstimate: 0 },
    { messages: [], resultSizeEstimate: -1 },
    { messages: [], resultSizeEstimate: 0, nextPageToken: 7 },
    { messages: [{ threadId: "thread" }], resultSizeEstimate: 1 },
    { messages: [
      { id: "same", threadId: "thread" },
      { id: "same", threadId: "thread" },
    ], resultSizeEstimate: 2 },
  ]) {
    await expectReject(async <T>() => malformed as T, "Malformed page");
  }
});

Deno.test("recipient message search rejects failed or mismatched full-message reads", async () => {
  const page = {
    messages: [{ id: "message-1", threadId: "thread-1" }],
    resultSizeEstimate: 1,
  };
  await expectReject(async <T>(_config: RefundGmailConfig, path: string) => {
    if (path.startsWith("/messages?")) return page as T;
    throw new Error("full fetch failed");
  }, "Full fetch failure");
  await expectReject(async <T>(_config: RefundGmailConfig, path: string) => {
    if (path.startsWith("/messages?")) return page as T;
    return { id: "other", threadId: "thread-1" } as T;
  }, "Mismatched full message id");
  await expectReject(async <T>(_config: RefundGmailConfig, path: string) => {
    if (path.startsWith("/messages?")) return page as T;
    return { id: "message-1", threadId: "other" } as T;
  }, "Mismatched full message thread");
});
