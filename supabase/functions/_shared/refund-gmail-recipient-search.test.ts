import {
  inspectRefundGmailMessagesAroundAudit,
  inspectRefundGmailMessagesDirectedToRecipient,
  listRefundGmailMessagesDirectedToRecipient,
  refundGmailAuditWindowMessageQuery,
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

Deno.test("inspection compares grouped and separate recipient queries and binds the union once", async () => {
  const paths: string[] = [];
  const request: RefundGmailReadRequest = async <T>(
    _config: RefundGmailConfig,
    path: string,
  ) => {
    paths.push(path);
    if (!path.startsWith("/messages?")) {
      return {
        id: "message-1",
        threadId: "thread-1",
        payload: { headers: [] },
      } as T;
    }
    const query = new URL(`https://example.test${path}`).searchParams.get("q") ?? "";
    const message = [{ id: "message-1", threadId: "thread-1" }];
    if (query.includes('{to:"customer+refund@example.test"')) {
      return { messages: [], resultSizeEstimate: 0 } as T;
    }
    if (query.endsWith(' to:"customer+refund@example.test"') ||
      query.endsWith(' cc:"customer+refund@example.test"')) {
      return { messages: message, resultSizeEstimate: 1 } as T;
    }
    if (query.endsWith(' bcc:"customer+refund@example.test"')) {
      return { messages: [], resultSizeEstimate: 0 } as T;
    }
    throw new Error("Unexpected recipient query mode");
  };
  const result = await inspectRefundGmailMessagesDirectedToRecipient(input, request);
  if (result.grouped.candidateCount !== 0 || result.to.candidateCount !== 1 ||
    result.cc.candidateCount !== 1 || result.bcc.candidateCount !== 0 ||
    result.union.candidateCount !== 1 || result.union.pageCount !== 4 ||
    result.messages.length !== 1 ||
    paths.filter((path) => path.includes("/messages/message-1?")).length !== 1) {
    throw new Error("Variant inspection did not preserve redacted counts and one bound union");
  }
});

Deno.test("inspection fails closed on conflicting union references", async () => {
  try {
    await inspectRefundGmailMessagesDirectedToRecipient(
      input,
      async <T>(_config: RefundGmailConfig, path: string) => {
        const query = new URL(`https://example.test${path}`).searchParams.get("q") ?? "";
        if (query.includes('{to:"')) {
          return { messages: [{ id: "same", threadId: "thread-1" }], resultSizeEstimate: 1 } as T;
        }
        if (query.endsWith(' to:"customer+refund@example.test"')) {
          return { messages: [{ id: "same", threadId: "thread-2" }], resultSizeEstimate: 1 } as T;
        }
        return { messages: [], resultSizeEstimate: 0 } as T;
      },
    );
  } catch {
    return;
  }
  throw new Error("Conflicting union reference did not fail closed");
});

Deno.test("inspection fetches grouped-only messages into the evaluated union", async () => {
  const fetched: string[] = [];
  const result = await inspectRefundGmailMessagesDirectedToRecipient(
    input,
    async <T>(_config: RefundGmailConfig, path: string) => {
      if (!path.startsWith("/messages?")) {
        fetched.push(path);
        return {
          id: "grouped-only",
          threadId: "thread-grouped",
          payload: { headers: [] },
        } as T;
      }
      const query = new URL(`https://example.test${path}`).searchParams.get("q") ?? "";
      return (query.includes('{to:"')
        ? {
            messages: [{ id: "grouped-only", threadId: "thread-grouped" }],
            resultSizeEstimate: 1,
          }
        : { messages: [], resultSizeEstimate: 0 }) as T;
    },
  );
  if (result.grouped.candidateCount !== 1 ||
    result.union.candidateCount !== 1 || result.messages.length !== 1 ||
    fetched.length !== 1) {
    throw new Error("Grouped-only message was omitted from the evaluated union");
  }
});

Deno.test("audit-window query uses a fixed padded sixty-second envelope and page token", () => {
  const params = refundGmailAuditWindowMessageQuery({
    auditedDeliveredAt: "2026-09-19T14:47:22.400Z",
    pageToken: "page-2",
  });
  const auditedSeconds = Math.floor(
    Date.parse("2026-09-19T14:47:22.400Z") / 1000,
  );
  if (
    params.get("q") !==
      `in:anywhere after:${auditedSeconds - 61} before:${auditedSeconds + 62}` ||
    params.get("maxResults") !== "100" ||
    params.get("includeSpamTrash") !== "true" ||
    params.get("pageToken") !== "page-2"
  ) {
    throw new Error("Audit-window query did not preserve its fixed safe bounds");
  }
});

Deno.test("audit-window inspection paginates completely and full-fetches each bound message", async () => {
  const paths: string[] = [];
  const result = await inspectRefundGmailMessagesAroundAudit({
    config,
    recipientEmail: input.recipientEmail,
    completionCreatedAt: input.completionCreatedAt,
    auditedDeliveredAt: "2026-09-19T14:47:22.400Z",
  }, async <T>(_config: RefundGmailConfig, path: string) => {
    paths.push(path);
    if (path.startsWith("/messages?")) {
      const url = new URL(`https://example.test${path}`);
      const query = url.searchParams.get("q") ?? "";
      if (query.includes("to:") || query.includes("cc:") || query.includes("bcc:")) {
        throw new Error("Audit-window query unexpectedly depended on a recipient operator");
      }
      if (url.searchParams.get("pageToken") === "page-2") {
        return {
          messages: [{ id: "audit-2", threadId: "audit-thread-2" }],
          resultSizeEstimate: 1,
        } as T;
      }
      return {
        messages: [{ id: "audit-1", threadId: "audit-thread-1" }],
        nextPageToken: "page-2",
        resultSizeEstimate: 2,
      } as T;
    }
    const id = path.includes("audit-1") ? "audit-1" : "audit-2";
    return {
      id,
      threadId: id === "audit-1" ? "audit-thread-1" : "audit-thread-2",
      payload: { headers: [] },
    } as T;
  });
  if (
    result.pageCount !== 2 || result.candidateCount !== 2 ||
    result.messages.length !== 2 || !result.complete ||
    result.throughAt !== "2026-09-19T14:48:22.400Z" ||
    paths.filter((path) => path.startsWith("/messages?")).length !== 2 ||
    paths.filter((path) => path.includes("?format=full")).length !== 2
  ) {
    throw new Error("Audit-window inspection did not complete and bind its full result set");
  }
});

Deno.test("audit-window inspection fails closed on repeated pages and mismatched full messages", async () => {
  const auditInput = {
    config,
    recipientEmail: input.recipientEmail,
    completionCreatedAt: input.completionCreatedAt,
    auditedDeliveredAt: "2026-09-19T14:47:22.400Z",
  };
  for (const request of [
    async <T>(_config: RefundGmailConfig, path: string) => {
      if (!path.startsWith("/messages?")) throw new Error("unexpected full fetch");
      return {
        messages: [],
        nextPageToken: "repeat",
        resultSizeEstimate: 0,
      } as T;
    },
    async <T>(_config: RefundGmailConfig, path: string) => {
      if (path.startsWith("/messages?")) {
        return {
          messages: [{ id: "audit-1", threadId: "audit-thread-1" }],
          resultSizeEstimate: 1,
        } as T;
      }
      return { id: "audit-1", threadId: "wrong-thread" } as T;
    },
  ]) {
    try {
      await inspectRefundGmailMessagesAroundAudit(auditInput, request);
    } catch {
      continue;
    }
    throw new Error("Unsafe audit-window result did not fail closed");
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
