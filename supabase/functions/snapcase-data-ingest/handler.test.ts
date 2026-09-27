import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSnapcaseIngestHandler } from "./handler.ts";

const envelope = (): Record<string, unknown> => ({
  contractVersion: "snapcase.ingest.v1",
  sourceAccountKey: "synthetic-account",
  runKey: "1".repeat(64),
  batchKey: "2".repeat(64),
  batchDigest: "3".repeat(64),
  machines: [],
  orders: [],
  payments: [],
  evidence: [],
});

Deno.test("SnapCase ingest rejects a tampered authorization token before RPC", async () => {
  let calls = 0;
  const handler = createSnapcaseIngestHandler({
    ingestToken: "fixture-token",
    ingest: () => {
      calls += 1;
      return Promise.resolve({ data: {}, error: null });
    },
    finalize: () => Promise.resolve({ data: {}, error: null }),
  });
  const response = await handler(new Request("http://local.test", {
    method: "POST",
    headers: { Authorization: "Bearer tampered-token" },
    body: JSON.stringify(envelope()),
  }));
  assertEquals(response.status, 401);
  assertEquals(calls, 0);
});

Deno.test("SnapCase ingest returns only acknowledged counts", async () => {
  const handler = createSnapcaseIngestHandler({
    ingestToken: "fixture-token",
    ingest: () => Promise.resolve({
      data: {
        recorded: true,
        duplicate: false,
        batchId: "private-id-must-not-leave-function",
        machineCount: 1,
        orderCount: 2,
        paymentCount: 3,
        evidenceCount: 4,
      },
      error: null,
    }),
    finalize: () => Promise.resolve({ data: {}, error: null }),
  });
  const response = await handler(new Request("http://local.test", {
    method: "POST",
    headers: { Authorization: "Bearer fixture-token" },
    body: JSON.stringify(envelope()),
  }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    ok: true,
    duplicate: false,
    machineCount: 1,
    orderCount: 2,
    paymentCount: 3,
    evidenceCount: 4,
  });
});

Deno.test("SnapCase payment evidence finalizes its acknowledged import run", async () => {
  const payload = envelope();
  payload.evidence = [{ resource: "payments" }];
  let finalizedWith: unknown;
  const handler = createSnapcaseIngestHandler({
    ingestToken: "fixture-token",
    ingest: () => Promise.resolve({
      data: { recorded: true, evidenceCount: 1 },
      error: null,
    }),
    finalize: (sourceAccountKey, runKey) => {
      finalizedWith = { sourceAccountKey, runKey };
      return Promise.resolve({
        data: {
          completedWindowCount: 1,
          changedWindowCount: 1,
          publishedCashFactCount: 2,
        },
        error: null,
      });
    },
  });
  const response = await handler(new Request("http://local.test", {
    method: "POST",
    headers: { Authorization: "Bearer fixture-token" },
    body: JSON.stringify(payload),
  }));
  assertEquals(response.status, 200);
  assertEquals(finalizedWith, {
    sourceAccountKey: "synthetic-account",
    runKey: "1".repeat(64),
  });
  assertEquals(await response.json(), {
    ok: true,
    duplicate: false,
    machineCount: 0,
    orderCount: 0,
    paymentCount: 0,
    evidenceCount: 1,
    completedWindowCount: 1,
    changedWindowCount: 1,
    publishedCashFactCount: 2,
  });
});

Deno.test("SnapCase optional order evidence does not finalize payment coverage", async () => {
  const payload = envelope();
  payload.evidence = [{ resource: "orders" }];
  let finalizeCalls = 0;
  const handler = createSnapcaseIngestHandler({
    ingestToken: "fixture-token",
    ingest: () => Promise.resolve({ data: { recorded: true }, error: null }),
    finalize: () => {
      finalizeCalls += 1;
      return Promise.resolve({ data: {}, error: null });
    },
  });
  const response = await handler(new Request("http://local.test", {
    method: "POST",
    headers: { Authorization: "Bearer fixture-token" },
    body: JSON.stringify(payload),
  }));
  assertEquals(response.status, 200);
  assertEquals(finalizeCalls, 0);
});

Deno.test("SnapCase payment finalization failures are redacted and retryable", async () => {
  const payload = envelope();
  payload.evidence = [{ resource: "payments" }];
  const handler = createSnapcaseIngestHandler({
    ingestToken: "fixture-token",
    ingest: () => Promise.resolve({ data: { recorded: true }, error: null }),
    finalize: () => Promise.resolve({
      data: null,
      error: { message: "private financial detail" },
    }),
  });
  const response = await handler(new Request("http://local.test", {
    method: "POST",
    headers: { Authorization: "Bearer fixture-token" },
    body: JSON.stringify(payload),
  }));
  assertEquals(response.status, 502);
  assertEquals(await response.json(), {
    error: "SnapCase payment import was not finalized.",
  });
});

Deno.test("SnapCase ingest redacts RPC failures", async () => {
  const handler = createSnapcaseIngestHandler({
    ingestToken: "fixture-token",
    ingest: () => Promise.resolve({
      data: null,
      error: { message: "private provider row leaked here" },
    }),
    finalize: () => Promise.resolve({ data: {}, error: null }),
  });
  const response = await handler(new Request("http://local.test", {
    method: "POST",
    headers: { Authorization: "Bearer fixture-token" },
    body: JSON.stringify(envelope()),
  }));
  assertEquals(response.status, 502);
  assertEquals(await response.json(), { error: "SnapCase batch was not recorded." });
});

Deno.test("SnapCase ingest redacts thrown RPC failures", async () => {
  const handler = createSnapcaseIngestHandler({
    ingestToken: "fixture-token",
    ingest: async () => {
      throw new Error("database details");
    },
    finalize: () => Promise.resolve({ data: {}, error: null }),
  });
  const response = await handler(new Request("http://local.test", {
    method: "POST",
    headers: { Authorization: "Bearer fixture-token" },
    body: JSON.stringify(envelope()),
  }));
  assertEquals(response.status, 502);
  assertEquals(await response.json(), { error: "SnapCase batch was not recorded." });
});
