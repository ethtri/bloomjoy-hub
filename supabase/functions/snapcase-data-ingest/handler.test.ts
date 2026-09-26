import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSnapcaseIngestHandler } from "./handler.ts";

const envelope = () => ({
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
    businessCoverageStatus: "unverified",
    published: false,
  });
});

Deno.test("SnapCase ingest redacts RPC failures", async () => {
  const handler = createSnapcaseIngestHandler({
    ingestToken: "fixture-token",
    ingest: () => Promise.resolve({
      data: null,
      error: { message: "private provider row leaked here" },
    }),
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
  });
  const response = await handler(new Request("http://local.test", {
    method: "POST",
    headers: { Authorization: "Bearer fixture-token" },
    body: JSON.stringify(envelope()),
  }));
  assertEquals(response.status, 502);
  assertEquals(await response.json(), { error: "SnapCase batch was not recorded." });
});
