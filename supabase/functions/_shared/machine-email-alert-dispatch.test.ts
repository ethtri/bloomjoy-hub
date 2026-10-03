import { createMachineEmailDispatcher } from "./machine-email-alert-dispatch.ts";
import { machineEmailLinks } from "./machine-email-alert-delivery.ts";
import { fixtureProjection } from "./machine-email-alert-fixtures.ts";
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
Deno.test("authenticated dry run uses only read-only preview, returns no recipients or payloads", async () => {
  const calls: string[] = [];
  const handler = createMachineEmailDispatcher({
    secret: "test-secret",
    transportConfigured: false,
    links: machineEmailLinks(),
    client: {
      rpc: (name) => {
        calls.push(name);
        return Promise.resolve({
          data: { projections: [fixtureProjection()], deliveryEnabled: false },
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
});
Deno.test("normal tick shares mature ready ledger before generic claims", async () => {
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
            : { claimed: false },
          error: null,
        });
      },
    },
    sendEmail: () => {
      throw new Error("no pending jobs");
    },
    collectSignals: async () => ({ checkedDevices: 0 }),
  });
  const response = await handler(request({}));
  assert(
    response.status === 200 &&
      calls.join() ===
        "service_email_alert_delivery_status,service_enqueue_refund_manager_ready_notices,service_claim_next_refund_manager_ready_notice,service_claim_next_email_alert",
    "activation then shared decision lane",
  );
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
