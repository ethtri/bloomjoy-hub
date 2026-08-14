import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type GmailMessage,
  type RefundGmailConfig,
  sha256Hex,
} from "../_shared/refund-gmail.ts";
import {
  isRefundGmailIntakeShadowRunKey,
  preflightRefundGmailIntakeShadowLabel,
  REFUND_GMAIL_INTAKE_SHADOW_LIST_LIMIT,
  RefundGmailIntakeShadowError,
  resolveRefundGmailIntakeShadowConfig,
  validateRefundGmailIntakeShadowRuntime,
  validateRefundGmailIntakeShadowThread,
} from "./intake-shadow.ts";

const BASE_ENV: Record<string, string> = {
  REFUND_GMAIL_INTAKE_ENABLED: "true",
  REFUND_GMAIL_ENABLED: "false",
  REFUND_GMAIL_FIRST_CONTACT_MODE: "shadow",
  GMAIL_REFUND_START_AT: "2026-08-14T12:00:00.000Z",
  GMAIL_REFUND_MAX_THREADS_PER_RUN: "1",
  GMAIL_REFUND_LABEL_ID: "Label_production",
  GMAIL_REFUND_INTAKE_SHADOW_LABEL_ID: "Label_owner_shadow",
  REFUND_GMAIL_INTAKE_SHADOW_OWNER_SENDER_SHA256: "a".repeat(64),
  REFUND_GMAIL_INTAKE_SHADOW_RUN_KEY_SHA256: "b".repeat(64),
  REFUND_GMAIL_RETENTION_ENABLED: "false",
  REFUND_GMAIL_RETENTION_POLICY_VERSION: "refund_gmail_retention_v1",
  REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED: "false",
  REFUND_AUTOMATION_ENABLED: "false",
  REFUND_MANAGER_AGING_NOTICES_ENABLED: "false",
  REFUND_GMAIL_ATTACHMENT_SCANNER_ENABLED: "false",
  REFUND_GPT_TRIAGE_ENABLED: "false",
  NAYAX_REFUND_EXECUTION_ENABLED: "false",
  NAYAX_REFUND_EXECUTION_DRY_RUN: "true",
  NAYAX_REFUND_EXECUTION_KILL_SWITCH: "true",
  NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED: "false",
  NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO: "false",
};

const resolve = (overrides: Record<string, string | undefined> = {}) =>
  resolveRefundGmailIntakeShadowConfig({
    trigger: "intake_shadow",
    readEnv: (name) => ({ ...BASE_ENV, ...overrides })[name],
    nowMs: Date.parse("2026-08-14T12:05:00.000Z"),
  });

Deno.test("intake shadow requires the exact owner run key", () => {
  assert(isRefundGmailIntakeShadowRunKey(
    `owner-intake-shadow:${"a".repeat(64)}`,
    "intake_shadow",
  ));
  assertEquals(
    isRefundGmailIntakeShadowRunKey("owner-intake-shadow:abc", "intake_shadow"),
    false,
  );
  assertEquals(
    isRefundGmailIntakeShadowRunKey(
      `owner-intake-shadow:${"a".repeat(64)}`,
      "manual",
    ),
    false,
  );
});

Deno.test("intake shadow accepts only the isolated exact configuration", () => {
  const config = resolve();
  assert(config?.active);
  assertEquals(config.shadowLabelId, "Label_owner_shadow");
  assertEquals(config.maxThreads, 1);
  assertEquals(config.ownerSenderDigest, "a".repeat(64));
  assertEquals(config.runKeyDigest, "b".repeat(64));
  assertEquals(config.startAt.toISOString(), BASE_ENV.GMAIL_REFUND_START_AT);
});

for (
  const [name, overrides, code] of [
    [
      "gate off",
      { REFUND_GMAIL_INTAKE_ENABLED: "false" },
      "gmail_intake_shadow_disabled",
    ],
    [
      "delivery on",
      { REFUND_GMAIL_ENABLED: "true" },
      "gmail_delivery_gate_must_remain_disabled",
    ],
    [
      "mode active",
      { REFUND_GMAIL_FIRST_CONTACT_MODE: "active" },
      "gmail_intake_shadow_mode_required",
    ],
    [
      "start missing",
      { GMAIL_REFUND_START_AT: undefined },
      "gmail_intake_shadow_start_required",
    ],
    [
      "start invalid",
      { GMAIL_REFUND_START_AT: "tomorrow" },
      "gmail_intake_shadow_start_required",
    ],
    [
      "start stale",
      { GMAIL_REFUND_START_AT: "2026-08-14T11:49:59.999Z" },
      "gmail_intake_shadow_start_required",
    ],
    [
      "start too far ahead",
      { GMAIL_REFUND_START_AT: "2026-08-14T12:05:30.001Z" },
      "gmail_intake_shadow_start_required",
    ],
    [
      "max missing",
      { GMAIL_REFUND_MAX_THREADS_PER_RUN: undefined },
      "gmail_intake_shadow_max_threads_invalid",
    ],
    [
      "max two",
      { GMAIL_REFUND_MAX_THREADS_PER_RUN: "2" },
      "gmail_intake_shadow_max_threads_invalid",
    ],
    [
      "same label",
      { GMAIL_REFUND_INTAKE_SHADOW_LABEL_ID: "Label_production" },
      "gmail_intake_shadow_label_invalid",
    ],
    [
      "shadow label missing",
      { GMAIL_REFUND_INTAKE_SHADOW_LABEL_ID: undefined },
      "gmail_intake_shadow_label_invalid",
    ],
    [
      "retention worker on",
      { REFUND_GMAIL_RETENTION_ENABLED: "true" },
      "gmail_intake_shadow_hard_off_invalid",
    ],
    [
      "retention policy mismatch",
      { REFUND_GMAIL_RETENTION_POLICY_VERSION: "refund-gmail-retention-v1" },
      "gmail_intake_shadow_retention_policy_invalid",
    ],
    [
      "automatic contact on",
      { REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED: "true" },
      "gmail_intake_shadow_hard_off_invalid",
    ],
    [
      "sender authorization reset",
      { REFUND_GMAIL_INTAKE_SHADOW_OWNER_SENDER_SHA256: "0".repeat(64) },
      "gmail_intake_shadow_authorization_digest_invalid",
    ],
    [
      "run authorization missing",
      { REFUND_GMAIL_INTAKE_SHADOW_RUN_KEY_SHA256: undefined },
      "gmail_intake_shadow_authorization_digest_invalid",
    ],
  ] as const
) {
  Deno.test(`intake shadow fails before OAuth when ${name}`, () => {
    const error = assertThrows(
      () => resolve(overrides),
      RefundGmailIntakeShadowError,
    );
    assertEquals(error.code, code);
  });
}

Deno.test("intake gate cannot remain on for another trigger", () => {
  const error = assertThrows(
    () =>
      resolveRefundGmailIntakeShadowConfig({
        trigger: "manual",
        readEnv: (name) => BASE_ENV[name],
      }),
    RefundGmailIntakeShadowError,
  );
  assertEquals(error.code, "gmail_intake_shadow_trigger_required");
});

Deno.test("ordinary trigger remains unchanged while intake gate is off", () => {
  assertEquals(
    resolveRefundGmailIntakeShadowConfig({
      trigger: "manual",
      readEnv: (name) =>
        name === "REFUND_GMAIL_INTAKE_ENABLED" ? "false" : BASE_ENV[name],
    }),
    null,
  );
});

const firstContactShadow = () => ({
  mode: "shadow" as const,
  shouldClaim: true,
  shouldSend: false,
  cutoverAt: null,
  errorCode: null,
  isolatedSenderEmails: [],
  refundRequestUrl: "https://www.bloomjoyusa.com/refunds/request",
  supportUrl: "https://www.bloomjoyusa.com/resources#support-boundaries",
});

Deno.test("pure runtime authorization binds the exact armed run key", async () => {
  const runKey = `owner-intake-shadow:${"c".repeat(64)}`;
  const intake = resolve({
    REFUND_GMAIL_INTAKE_SHADOW_RUN_KEY_SHA256: await sha256Hex(runKey),
  });
  assert(intake);
  await validateRefundGmailIntakeShadowRuntime({
    intake,
    config: gmailConfig(),
    firstContact: firstContactShadow(),
    runKey,
  });
  const error = await assertRejects(
    () =>
      validateRefundGmailIntakeShadowRuntime({
        intake,
        config: gmailConfig(),
        firstContact: firstContactShadow(),
        runKey: `owner-intake-shadow:${"d".repeat(64)}`,
      }),
    RefundGmailIntakeShadowError,
  );
  assertEquals(error.code, "gmail_intake_shadow_pure_preflight_failed");
});

Deno.test("pure runtime rejects incomplete base config and blocked first-contact before provider work", async () => {
  const runKey = `owner-intake-shadow:${"e".repeat(64)}`;
  const intake = resolve({
    REFUND_GMAIL_INTAKE_SHADOW_RUN_KEY_SHA256: await sha256Hex(runKey),
  });
  assert(intake);
  await assertRejects(
    () =>
      validateRefundGmailIntakeShadowRuntime({
        intake,
        config: null,
        firstContact: firstContactShadow(),
        runKey,
      }),
    RefundGmailIntakeShadowError,
  );
  await assertRejects(
    () =>
      validateRefundGmailIntakeShadowRuntime({
        intake,
        config: gmailConfig(),
        firstContact: {
          ...firstContactShadow(),
          mode: "blocked",
          shouldClaim: false,
          errorCode: "refund_url_invalid",
        },
        runKey,
      }),
    RefundGmailIntakeShadowError,
  );
});

const gmailConfig = (): RefundGmailConfig => ({
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "refresh",
  mailbox: "info@example.test",
  mailboxIdentities: ["info@example.test"],
  labelId: "Label_owner_shadow",
  startAt: new Date(BASE_ENV.GMAIL_REFUND_START_AT),
});

const message = ({
  from,
  internalDate,
  labels = [],
  to = from === "info@example.test"
    ? "owner.synthetic@example.test"
    : "info@example.test",
  cc,
  bcc,
}: {
  from: string;
  internalDate: string;
  labels?: string[];
  to?: string;
  cc?: string;
  bcc?: string;
}): GmailMessage => ({
  id: `message-${internalDate}`,
  internalDate,
  labelIds: labels,
  payload: {
    headers: [
      { name: "From", value: from },
      { name: "To", value: to },
      ...(cc ? [{ name: "Cc", value: cc }] : []),
      ...(bcc ? [{ name: "Bcc", value: bcc }] : []),
      { name: "Subject", value: "Synthetic intake shadow" },
    ],
  },
});

Deno.test("thread shape requires one fresh owner inbound and one Gmail-SENT mailbox message", async () => {
  const owner = "owner.synthetic@example.test";
  const intake = resolve({
    REFUND_GMAIL_INTAKE_SHADOW_OWNER_SENDER_SHA256: await sha256Hex(owner),
  });
  assert(intake);
  const result = await validateRefundGmailIntakeShadowThread({
    intake,
    config: gmailConfig(),
    nowMs: Date.parse("2026-08-14T12:05:00.000Z"),
    messages: [
      message({
        from: owner,
        internalDate: String(Date.parse("2026-08-14T12:01:00.000Z")),
      }),
      message({
        from: "info@example.test",
        internalDate: String(Date.parse("2026-08-14T12:02:00.000Z")),
        labels: ["SENT"],
      }),
    ],
  });
  assertEquals(result, {
    customerInboundMessages: 1,
    providerSentMailboxMessages: 1,
    mailboxAcknowledgementObserved: true,
  });
});

for (
  const [name, messages] of [
    ["one message", [
      message({
        from: "owner.synthetic@example.test",
        internalDate: String(Date.parse("2026-08-14T12:01:00.000Z")),
      }),
    ]],
    ["stale owner inbound plus a later acknowledgement", [
      message({
        from: "owner.synthetic@example.test",
        internalDate: String(Date.parse("2026-08-14T11:59:59.999Z")),
      }),
      message({
        from: "info@example.test",
        internalDate: String(Date.parse("2026-08-14T12:02:00.000Z")),
        labels: ["SENT"],
      }),
    ]],
    ["a mailbox message without Gmail SENT evidence", [
      message({
        from: "owner.synthetic@example.test",
        internalDate: String(Date.parse("2026-08-14T12:01:00.000Z")),
      }),
      message({
        from: "info@example.test",
        internalDate: String(Date.parse("2026-08-14T12:02:00.000Z")),
      }),
    ]],
    ["an inbound message addressed outside the support mailbox", [
      message({
        from: "owner.synthetic@example.test",
        to: "other@example.test",
        internalDate: String(Date.parse("2026-08-14T12:01:00.000Z")),
      }),
      message({
        from: "info@example.test",
        internalDate: String(Date.parse("2026-08-14T12:02:00.000Z")),
        labels: ["SENT"],
      }),
    ]],
    ["an inbound message with an unexpected participant", [
      message({
        from: "owner.synthetic@example.test",
        cc: "other@example.test",
        internalDate: String(Date.parse("2026-08-14T12:01:00.000Z")),
      }),
      message({
        from: "info@example.test",
        internalDate: String(Date.parse("2026-08-14T12:02:00.000Z")),
        labels: ["SENT"],
      }),
    ]],
    ["a mailbox acknowledgement before the owner inbound", [
      message({
        from: "owner.synthetic@example.test",
        internalDate: String(Date.parse("2026-08-14T12:02:00.000Z")),
      }),
      message({
        from: "info@example.test",
        internalDate: String(Date.parse("2026-08-14T12:01:00.000Z")),
        labels: ["SENT"],
      }),
    ]],
    ["a mailbox acknowledgement at the same time as the owner inbound", [
      message({
        from: "owner.synthetic@example.test",
        internalDate: String(Date.parse("2026-08-14T12:01:00.000Z")),
      }),
      message({
        from: "info@example.test",
        internalDate: String(Date.parse("2026-08-14T12:01:00.000Z")),
        labels: ["SENT"],
      }),
    ]],
    ["a mailbox acknowledgement to the wrong recipient", [
      message({
        from: "owner.synthetic@example.test",
        internalDate: String(Date.parse("2026-08-14T12:01:00.000Z")),
      }),
      message({
        from: "info@example.test",
        to: "other@example.test",
        internalDate: String(Date.parse("2026-08-14T12:02:00.000Z")),
        labels: ["SENT"],
      }),
    ]],
    ["a mailbox acknowledgement with an unexpected participant", [
      message({
        from: "owner.synthetic@example.test",
        internalDate: String(Date.parse("2026-08-14T12:01:00.000Z")),
      }),
      message({
        from: "info@example.test",
        bcc: "other@example.test",
        internalDate: String(Date.parse("2026-08-14T12:02:00.000Z")),
        labels: ["SENT"],
      }),
    ]],
    ["a future mailbox acknowledgement", [
      message({
        from: "owner.synthetic@example.test",
        internalDate: String(Date.parse("2026-08-14T12:01:00.000Z")),
      }),
      message({
        from: "info@example.test",
        internalDate: String(Date.parse("2026-08-14T12:05:30.001Z")),
        labels: ["SENT"],
      }),
    ]],
    ["an unrelated Gmail-SENT record", [
      message({
        from: "owner.synthetic@example.test",
        internalDate: String(Date.parse("2026-08-14T12:01:00.000Z")),
      }),
      message({
        from: "other@example.test",
        internalDate: String(Date.parse("2026-08-14T12:02:00.000Z")),
        labels: ["SENT"],
      }),
    ]],
  ] as const
) {
  Deno.test(`thread shape fails closed for ${name}`, async () => {
    const intake = resolve({
      REFUND_GMAIL_INTAKE_SHADOW_OWNER_SENDER_SHA256: await sha256Hex(
        "owner.synthetic@example.test",
      ),
    });
    assert(intake);
    await assertRejects(
      () =>
        validateRefundGmailIntakeShadowThread({
          intake,
          config: gmailConfig(),
          nowMs: Date.parse("2026-08-14T12:05:00.000Z"),
          messages: [...messages],
        }),
      RefundGmailIntakeShadowError,
    );
  });
}

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const providerHarness = ({
  threads = [{ id: "thread-owner" }],
  nextPageToken,
  mailbox = "info@example.test",
  statuses = [200, 200, 200],
}: {
  threads?: readonly unknown[];
  nextPageToken?: string;
  mailbox?: string;
  statuses?: readonly number[];
} = {}) => {
  const requests: Array<{ url: string; method: string; body: string }> = [];
  const payloads = [
    { access_token: "private-provider-token", expires_in: 3600 },
    { emailAddress: mailbox, historyId: "history-owner" },
    { threads, ...(nextPageToken ? { nextPageToken } : {}) },
  ];
  const fetchImpl =
    (async (input: string | URL | Request, init?: RequestInit) => {
      const index = requests.length;
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: String(init?.body ?? ""),
      });
      return response(payloads[index], statuses[index]);
    }) as typeof fetch;
  return { requests, fetchImpl };
};

Deno.test("provider preflight proves mailbox and exactly one capped shadow thread", async () => {
  const harness = providerHarness();
  const result = await preflightRefundGmailIntakeShadowLabel({
    config: gmailConfig(),
    fetchImpl: harness.fetchImpl,
  });
  assertEquals(result, {
    profileHistoryId: "history-owner",
    thread: { id: "thread-owner" },
  });
  assertEquals(harness.requests.length, 3);
  assertEquals(harness.requests[0].method, "POST");
  assertEquals(harness.requests[1].method, "GET");
  assertEquals(harness.requests[2].method, "GET");
  const listUrl = new URL(harness.requests[2].url);
  assertEquals(listUrl.searchParams.get("labelIds"), "Label_owner_shadow");
  assertEquals(
    listUrl.searchParams.get("maxResults"),
    String(REFUND_GMAIL_INTAKE_SHADOW_LIST_LIMIT),
  );
  assertEquals(
    listUrl.searchParams.get("q"),
    `after:${Date.parse(BASE_ENV.GMAIL_REFUND_START_AT) / 1000}`,
  );
});

for (
  const [name, options, code] of [
    [
      "zero threads",
      { threads: [] },
      "gmail_intake_shadow_label_cardinality_invalid",
    ],
    [
      "two threads",
      { threads: [{ id: "one" }, { id: "two" }] },
      "gmail_intake_shadow_label_cardinality_invalid",
    ],
    [
      "a continuation",
      { nextPageToken: "more" },
      "gmail_intake_shadow_label_cardinality_invalid",
    ],
    [
      "a mailbox mismatch",
      { mailbox: "other@example.test" },
      "gmail_intake_shadow_mailbox_mismatch",
    ],
    [
      "OAuth rejection",
      { statuses: [401, 200, 200] },
      "gmail_intake_shadow_oauth_failed",
    ],
    [
      "profile rejection",
      { statuses: [200, 500, 200] },
      "gmail_intake_shadow_profile_failed",
    ],
    [
      "label rejection",
      { statuses: [200, 200, 429] },
      "gmail_intake_shadow_label_list_failed",
    ],
  ] as const
) {
  Deno.test(`provider preflight fails closed on ${name}`, async () => {
    const harness = providerHarness(options);
    const error = await assertRejects(
      () =>
        preflightRefundGmailIntakeShadowLabel({
          config: gmailConfig(),
          fetchImpl: harness.fetchImpl,
        }),
      RefundGmailIntakeShadowError,
    );
    assertEquals(error.code, code);
  });
}
