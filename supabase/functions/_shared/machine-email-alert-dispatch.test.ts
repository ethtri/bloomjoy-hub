import { createMachineEmailDispatcher } from "./machine-email-alert-dispatch.ts";
import { machineEmailLinks } from "./machine-email-alert-delivery.ts";
import {
  fixtureId,
  fixtureProjection,
} from "./machine-email-alert-fixtures.ts";
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const request = (body: unknown, authorized = true) =>
  new Request("https://example.test", {
    method: "POST",
    headers: {
      Authorization: authorized ? "Bearer test-secret" : "Bearer wrong",
    },
    body: JSON.stringify(body),
  });
const snapshot = "2026-10-02T15:00:00Z";
const cursor = {
  observedAt: snapshot,
  userId: fixtureId(900),
  category: "daily",
  slotKey: "daily:2026-10-01",
};
const completePage = () => ({
  observedAt: snapshot,
  projections: [fixtureProjection()],
  deliveryEnabled: false,
  pageCount: 1,
  totalCandidates: 1,
  hasMore: false,
  complete: true,
  nextCursor: null,
});
const readyEnqueue = (extra: Record<string, unknown> = {}) => ({
  queuedCount: 0,
  legacyReviewCount: 0,
  routeBlockedCount: 0,
  scannedCount: 0,
  scanLimited: false,
  reason: "completed",
  payloadRedacted: true,
  ...extra,
});
Deno.test("authenticated dry run uses only read-only preview, returns no recipients or payloads", async () => {
  const calls: string[] = [];
  const handler = createMachineEmailDispatcher({
    secret: "test-secret",
    transportConfigured: false,
    links: machineEmailLinks(),
    now: () => new Date(snapshot),
    client: {
      rpc: (name) => {
        calls.push(name);
        return Promise.resolve({
          data: completePage(),
          error: null,
        });
      },
    },
    sendEmail: () => {
      throw new Error("must not send");
    },
    collectSignals: () => {
      throw new Error("must not poll or write");
    },
  });
  const response = await handler(request({ dryRun: true }));
  const body = await response.json();
  assert(
    response.status === 200 && body.status === "validated" &&
      body.projectionCount === 1 && body.providerCalls === 0 &&
      body.writesApplied === 0,
    "read-only validation",
  );
  assert(
    calls.join() === "service_preview_email_alerts" &&
      !JSON.stringify(body).includes("SYNTHETIC") &&
      !JSON.stringify(body).includes("recipient"),
    "no claims/reservations or personal payload",
  );
});
Deno.test("dry-run pages retain one snapshot and never imply previous pages were validated", async () => {
  let calls = 0;
  const continued = fixtureProjection();
  continued.userId = fixtureId(901);
  const handler = createMachineEmailDispatcher({
    secret: "test-secret",
    transportConfigured: false,
    links: machineEmailLinks(),
    now: () => new Date(calls ? "2026-10-02T16:00:00Z" : snapshot),
    client: {
      rpc: (name, args) => {
        assert(
          name === "service_preview_email_alerts" &&
            Date.parse(String(args.p_observed_at)) === Date.parse(snapshot) &&
            args.p_limit === 1,
          "bounded read-only RPC with fixed snapshot",
        );
        calls++;
        if (calls === 1) {
          assert(args.p_cursor === null, "first page");
          return Promise.resolve({
            data: {
              ...completePage(),
              totalCandidates: 2,
              hasMore: true,
              complete: false,
              nextCursor: cursor,
            },
            error: null,
          });
        }
        assert(
          JSON.stringify(args.p_cursor) === JSON.stringify(cursor),
          "exact continuation cursor forwarded",
        );
        return Promise.resolve({
          data: {
            ...completePage(),
            projections: [continued],
            totalCandidates: 2,
          },
          error: null,
        });
      },
    },
    sendEmail: () => {
      throw new Error("no provider send");
    },
    collectSignals: () => {
      throw new Error("no source writes");
    },
  });
  const first = await (await handler(request({ dryRun: true }))).json();
  assert(
    first.status === "page_validated" &&
      first.validationScope === "current_page" && first.hasMore === true &&
      first.complete === false && first.providerCalls === 0 &&
      first.writesApplied === 0,
    "partial page remains explicit",
  );
  const last = await (await handler(
    request({ dryRun: true, previewCursor: first.nextCursor }),
  )).json();
  assert(
    last.status === "page_validated" &&
      last.validationScope === "current_page" && last.hasMore === false &&
      last.complete === true && last.nextCursor === null &&
      last.totalCandidates === 2 && calls === 2,
    "last-page traversal does not assert prior-page success",
  );
});
Deno.test("invalid preview metadata or nonadvancing cursors cannot report successful validation", async () => {
  for (
    const invalid of [
      { ...completePage(), hasMore: true },
      { ...completePage(), complete: false },
      { ...completePage(), pageCount: 2 },
      { ...completePage(), totalCandidates: 0 },
      { ...completePage(), observedAt: "2026-10-02T16:00:00Z" },
      {
        ...completePage(),
        totalCandidates: 2,
        hasMore: true,
        complete: false,
        nextCursor: cursor,
      },
    ]
  ) {
    const handler = createMachineEmailDispatcher({
      secret: "test-secret",
      transportConfigured: false,
      links: machineEmailLinks(),
      client: { rpc: () => Promise.resolve({ data: invalid, error: null }) },
      sendEmail: () => {
        throw new Error("no send");
      },
      collectSignals: () => {
        throw new Error("no writes");
      },
    });
    const response = await handler(
      request({ dryRun: true, previewCursor: cursor }),
    );
    const body = await response.json();
    assert(
      response.status === 503 && body.status === "validation_failed" &&
        body.providerCalls === 0 && body.writesApplied === 0,
      "bad metadata is not a completed validation",
    );
  }
});
Deno.test("observe-only can record evidence without transport or claims", async () => {
  let observations = 0;
  const handler = createMachineEmailDispatcher({
    secret: "test-secret",
    transportConfigured: false,
    links: machineEmailLinks(),
    client: {
      rpc: () => {
        throw new Error("no ledger calls");
      },
    },
    sendEmail: () => {
      throw new Error("no mail");
    },
    collectSignals: async () => {
      observations++;
      return { checkedDevices: 1 };
    },
  });
  const response = await handler(request({ observeOnly: true }));
  const body = await response.json();
  assert(
    response.status === 200 && body.emailsSent === 0 &&
      body.claimsReserved === 0 && observations === 1,
    "observations only",
  );
});
Deno.test("unauthorized, malformed and ambiguous requests fail without work", async () => {
  let work = 0;
  const handler = createMachineEmailDispatcher({
    secret: "test-secret",
    transportConfigured: true,
    links: machineEmailLinks(),
    client: {
      rpc: () => {
        work++;
        throw new Error("no work");
      },
    },
    sendEmail: () => {
      work++;
      throw new Error("no work");
    },
    collectSignals: () => {
      work++;
      throw new Error("no work");
    },
  });
  assert((await handler(request({}, false))).status === 401, "auth required");
  assert(
    (await handler(request({ dryRun: "true" }))).status === 400,
    "boolean must be actual boolean",
  );
  assert(
    (await handler(request({ dryRun: true, observeOnly: true }))).status ===
      400,
    "no ambiguous mode",
  );
  assert(
    (await handler(request({ recipient: "arbitrary@example.test" }))).status ===
      400,
    "no ad-hoc routes",
  );
  assert(work === 0, "no work before validation");
  for (
    const invalid of [
      { previewCursor: cursor },
      { observeOnly: true, previewObservedAt: snapshot },
      { dryRun: true, previewCursor: { ...cursor, userId: "invalid" } },
      {
        dryRun: true,
        previewCursor: cursor,
        previewObservedAt: "2026-10-02T16:00:00Z",
      },
    ]
  ) {
    assert(
      (await handler(request(invalid))).status === 400,
      "pagination is only valid in dry-run with matching snapshot",
    );
  }
  assert(work === 0, "invalid pagination never reaches any RPC or provider");
});
Deno.test("normal tick protects generic daily work before sharing the mature ready ledger", async () => {
  const calls: string[] = [];
  const handler = createMachineEmailDispatcher({
    secret: "test-secret",
    transportConfigured: true,
    links: machineEmailLinks(),
    client: {
      rpc: (name) => {
        calls.push(name);
        return Promise.resolve({
          data: name === "service_email_alert_delivery_status"
            ? { deliveryEnabled: true }
            : name === "service_enqueue_refund_manager_ready_notices"
            ? readyEnqueue()
            : { claimed: false },
          error: null,
        });
      },
    },
    sendEmail: () => {
      throw new Error("no pending jobs");
    },
    collectSignals: async () => {
      calls.push("collectSignals");
      return { checkedDevices: 0 };
    },
  });
  const response = await handler(request({}));
  assert(
    response.status === 200 &&
      calls.join() ===
        "service_email_alert_delivery_status,service_claim_next_email_alert,service_enqueue_refund_manager_ready_notices,service_claim_next_refund_manager_ready_notice,collectSignals",
    "activation then daily work before optional preparation and source polling",
  );
});

Deno.test("zero current ready subscriptions skip all legacy claims without hiding other work", async () => {
  for (const reason of ["no_current_subscriptions", "delivery_disabled"]) {
    const calls: string[] = [];
    const handler = createMachineEmailDispatcher({
      secret: "test-secret",
      transportConfigured: true,
      links: machineEmailLinks(),
      client: {
        rpc: (name) => {
          calls.push(name);
          return Promise.resolve({
            data: name === "service_email_alert_delivery_status"
              ? { deliveryEnabled: true }
              : name === "service_enqueue_refund_manager_ready_notices"
              ? readyEnqueue({ reason })
              : { claimed: false },
            error: null,
          });
        },
      },
      sendEmail: () => {
        throw new Error("no jobs or subscribers");
      },
      collectSignals: async () => ({}),
    });
    const body = await (await handler(request({}))).json();
    assert(
      body.status === "completed" && body.ready.status === "completed" &&
        body.ready.reason === reason && body.ready.scannedCount === 0 &&
        calls.join() ===
          "service_email_alert_delivery_status,service_claim_next_email_alert,service_enqueue_refund_manager_ready_notices",
      "explicit zero-scope fastpath, daily still checked and no ready claims",
    );
  }
});

Deno.test("optional enqueue timeouts remain visible after daily delivery and expose only a safe diagnosis", async () => {
  for (const rejects of [false, true]) {
    let claimed = false;
    let sends = 0;
    const calls: string[] = [];
    const error = {
      code: "57014",
      message: "private@example.test refund case details",
      details: "SQL context containing private data",
    };
    const handler = createMachineEmailDispatcher({
      secret: "test-secret",
      transportConfigured: true,
      links: machineEmailLinks(),
      client: {
        rpc: (name) => {
          calls.push(name);
          if (name === "service_enqueue_refund_manager_ready_notices") {
            assert(sends === 1, "daily delivered before optional preparation");
            return rejects
              ? Promise.reject(error)
              : Promise.resolve({ data: null, error });
          }
          let data: unknown = true;
          if (name === "service_email_alert_delivery_status") {
            data = { deliveryEnabled: true };
          } else if (name === "service_claim_next_email_alert") {
            data = claimed ? { claimed: false } : {
              claimed: true,
              jobId: fixtureId(700),
              claimToken: fixtureId(701),
              recipient: "manager@example.test",
              routeFingerprint: "a".repeat(64),
              idempotencyKey: `machine_email_${fixtureId(700)}`,
              category: "daily",
              projection: fixtureProjection(),
              payloadRedacted: true,
            };
            claimed = true;
          }
          return Promise.resolve({ data, error: null });
        },
      },
      sendEmail: async () => {
        sends++;
        return { providerMessageId: "synthetic_receipt_123" };
      },
      collectSignals: async () => ({}),
    });
    const body = await (await handler(request({}))).json();
    assert(
      body.status === "attention" && body.sent === 1 && sends === 1 &&
        body.ready.status === "unavailable" &&
        body.ready.stage === "enqueue" &&
        body.ready.errorCode === "statement_timeout" &&
        !calls.includes("service_claim_next_refund_manager_ready_notice") &&
        !JSON.stringify(body).includes("private") &&
        !JSON.stringify(body).includes("@"),
      "error/throw both produce safe actionable timeout diagnosis, no claim retry",
    );
  }
});

Deno.test("ready claim failures and malformed enqueue responses cannot masquerade as no subscribers", async () => {
  for (const invalidEnqueue of [false, true]) {
    let readyClaims = 0;
    const handler = createMachineEmailDispatcher({
      secret: "test-secret",
      transportConfigured: true,
      links: machineEmailLinks(),
      client: {
        rpc: (name) => {
          if (name === "service_claim_next_refund_manager_ready_notice") {
            readyClaims++;
            return Promise.resolve({
              data: null,
              error: { code: "sensitive@example.test", message: "private" },
            });
          }
          return Promise.resolve({
            data: name === "service_email_alert_delivery_status"
              ? { deliveryEnabled: true }
              : name === "service_enqueue_refund_manager_ready_notices"
              ? invalidEnqueue
                ? { reason: "no_current_subscriptions" }
                : readyEnqueue({ scannedCount: 5, scanLimited: true })
              : { claimed: false },
            error: null,
          });
        },
      },
      sendEmail: () => {
        throw new Error("no claimed work");
      },
      collectSignals: async () => ({}),
    });
    const body = await (await handler(request({}))).json();
    assert(
      body.status === "attention" && body.ready.status === "unavailable" &&
        body.ready.stage === (invalidEnqueue ? "enqueue" : "claim") &&
        body.ready.errorCode ===
          (invalidEnqueue ? "invalid_response" : "rpc_failed") &&
        readyClaims === (invalidEnqueue ? 0 : 1) &&
        !JSON.stringify(body).includes("private") &&
        !JSON.stringify(body).includes("@"),
      "malformed fastpaths and unknown error codes remain bounded failures",
    );
  }
});

Deno.test("exhausted execution windows defer optional work without claiming or reporting completion", async () => {
  for (const budgetStage of ["generic", "enqueue"]) {
    let elapsed = 0;
    const calls: string[] = [];
    const handler = createMachineEmailDispatcher({
      secret: "test-secret",
      transportConfigured: true,
      links: machineEmailLinks(),
      monotonicNow: () => elapsed,
      client: {
        rpc: (name) => {
          calls.push(name);
          if (
            name === "service_claim_next_email_alert" &&
            budgetStage === "generic"
          ) elapsed = 36_000;
          if (name === "service_enqueue_refund_manager_ready_notices") {
            elapsed += 11_000;
          }
          return Promise.resolve({
            data: name === "service_email_alert_delivery_status"
              ? { deliveryEnabled: true }
              : name === "service_enqueue_refund_manager_ready_notices"
              ? readyEnqueue({ scannedCount: 5, scanLimited: true })
              : { claimed: false },
            error: null,
          });
        },
      },
      sendEmail: () => {
        throw new Error("no claims");
      },
      collectSignals: async () => ({}),
    });
    const body = await (await handler(request({}))).json();
    assert(
      body.status === "attention" && body.ready.status === "deferred" &&
        body.ready.reason === "execution_budget" &&
        !calls.includes("service_claim_next_refund_manager_ready_notice") &&
        calls.includes("service_enqueue_refund_manager_ready_notices") ===
          (budgetStage === "enqueue"),
      "generic can finish its claim; optional admission respects independent remaining budget",
    );
  }
});

Deno.test("source collection receives a remaining admission budget and reports deferred work", async () => {
  for (const noHeadroom of [false, true]) {
    let elapsed = 0;
    let collections = 0;
    const handler = createMachineEmailDispatcher({
      secret: "test-secret",
      transportConfigured: true,
      links: machineEmailLinks(),
      monotonicNow: () => elapsed,
      client: {
        rpc: (name) => {
          if (
            noHeadroom &&
            name === "service_enqueue_refund_manager_ready_notices"
          ) elapsed = 41_000;
          return Promise.resolve({
            data: name === "service_email_alert_delivery_status"
              ? { deliveryEnabled: true }
              : name === "service_enqueue_refund_manager_ready_notices"
              ? readyEnqueue({ reason: "no_current_subscriptions" })
              : { claimed: false },
            error: null,
          });
        },
      },
      sendEmail: () => {
        throw new Error("no work");
      },
      collectSignals: async (_observedAt, options) => {
        collections++;
        assert(options?.shouldContinue(), "source work may start");
        elapsed += 10_001;
        assert(!options?.shouldContinue(), "new source admission now stops");
        return { budgetExhausted: true, deferredDevices: 2 };
      },
    });
    const body = await (await handler(request({}))).json();
    assert(
      body.status === "attention" && body.signalStatus === "deferred" &&
        collections === (noHeadroom ? 0 : 1) &&
        (noHeadroom
          ? body.signals === null
          : body.signals.deferredDevices === 2),
      "bounded admission and honest deferred response with no abandoned work",
    );
  }
});

Deno.test("disabled normal tick never polls, enqueues, reserves or calls provider", async () => {
  const calls: string[] = [];
  let signals = 0;
  let sends = 0;
  const handler = createMachineEmailDispatcher({
    secret: "test-secret",
    transportConfigured: true,
    links: machineEmailLinks(),
    client: {
      rpc: (name) => {
        calls.push(name);
        return Promise.resolve({
          data: { deliveryEnabled: false },
          error: null,
        });
      },
    },
    sendEmail: () => {
      sends++;
      throw new Error("no send");
    },
    collectSignals: async () => {
      signals++;
      return {};
    },
  });
  const response = await handler(request({}));
  const body = await response.json();
  assert(
    body.status === "disabled" && body.writesApplied === 0 &&
      body.providerCalls === 0 &&
      calls.join() === "service_email_alert_delivery_status" && signals === 0 &&
      sends === 0,
    "disabled has zero effects",
  );
});
