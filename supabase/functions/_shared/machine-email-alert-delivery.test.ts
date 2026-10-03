import {
  type AlertRpcClient,
  deliverMachineEmailClaim,
  machineEmailLinks,
} from "./machine-email-alert-delivery.ts";
import {
  fixtureId,
  fixtureProjection,
} from "./machine-email-alert-fixtures.ts";
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const claim = () => ({
  claimed: true,
  jobId: fixtureId(700),
  claimToken: fixtureId(701),
  recipient: "manager@example.test",
  routeFingerprint: "a".repeat(64),
  idempotencyKey: `machine_email_${fixtureId(700)}`,
  category: "daily",
  projection: fixtureProjection(),
  payloadRedacted: true,
});

Deno.test("delivery revalidates exact route before one isolated recipient send", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let sends = 0;
  const client: AlertRpcClient = {
    rpc: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve({ data: true, error: null });
    },
  };
  const result = await deliverMachineEmailClaim({
    client,
    claim: claim(),
    links: machineEmailLinks(),
    sendEmail: async (message) => {
      sends++;
      assert(
        calls[0].name === "service_mark_email_alert_provider_started",
        "durable start first",
      );
      assert(
        message.to.length === 1 && message.to[0] === "manager@example.test",
        "no owner fallback recipient",
      );
      assert(
        message.idempotencyKey === claim().idempotencyKey &&
          /^[A-Za-z0-9_-]{1,200}$/.test(message.idempotencyKey),
        "real transport compatible stable key",
      );
      return { providerMessageId: "provider_receipt_123" };
    },
  });
  assert(
    result === "sent" && sends === 1 &&
      calls[0].args.p_route_fingerprint === "a".repeat(64) &&
      calls[1].args.p_outcome === "sent",
    "sent and settled",
  );
});
Deno.test("stale recipient/preferences are never sent", async () => {
  let sends = 0;
  const outcome = await deliverMachineEmailClaim({
    client: { rpc: () => Promise.resolve({ data: false, error: null }) },
    claim: claim(),
    links: machineEmailLinks(),
    sendEmail: () => {
      sends++;
      throw new Error("unexpected");
    },
  });
  assert(outcome === "stale" && sends === 0, "stale held before provider");
});
Deno.test("uncertain provider result is held after exactly one attempt", async () => {
  let sends = 0;
  const outcomes: unknown[] = [];
  let failed = false;
  try {
    await deliverMachineEmailClaim({
      client: {
        rpc: (name, args) => {
          if (name === "service_complete_email_alert") {
            outcomes.push(args.p_outcome);
          }
          return Promise.resolve({ data: true, error: null });
        },
      },
      claim: claim(),
      links: machineEmailLinks(),
      sendEmail: () => {
        sends++;
        throw new Error("network failed with private payload");
      },
    });
  } catch (error) {
    failed = true;
    assert(
      (error as Error).message === "email_alert_delivery_held",
      "no provider PII in error",
    );
  }
  assert(
    failed && sends === 1 && outcomes.join() === "delivery_unknown",
    "no blind retry",
  );
});
Deno.test("settlement failure preserves known provider receipt without resending", async () => {
  let sends = 0;
  const receipts: unknown[] = [];
  try {
    await deliverMachineEmailClaim({
      client: {
        rpc: (name, args) => {
          if (name === "service_complete_email_alert") {
            receipts.push([args.p_outcome, args.p_provider_id]);
            return Promise.resolve({ data: false, error: null });
          }
          return Promise.resolve({ data: true, error: null });
        },
      },
      claim: claim(),
      links: machineEmailLinks(),
      sendEmail: async () => {
        sends++;
        return { providerMessageId: "provider_receipt_123" };
      },
    });
  } catch { /* expected hold */ }
  assert(
    sends === 1 && receipts.length === 2 &&
      receipts.every((r) =>
        JSON.stringify(r) === '["sent","provider_receipt_123"]'
      ),
    "durable receipt recovery, no provider retry",
  );
});
Deno.test("colon idempotency key and unsafe projection fail before provider start", async () => {
  let starts = 0;
  let sends = 0;
  for (
    const invalid of [{ ...claim(), idempotencyKey: "machine-email:uuid" }, {
      ...claim(),
      projection: {
        ...fixtureProjection(),
        customerEmail: "private@example.test",
      },
    }]
  ) {
    let failed = false;
    try {
      await deliverMachineEmailClaim({
        client: {
          rpc: (name) => {
            if (name.includes("provider_started")) starts++;
            return Promise.resolve({ data: true, error: null });
          },
        },
        claim: invalid,
        links: machineEmailLinks(),
        sendEmail: () => {
          sends++;
          throw new Error("unexpected");
        },
      });
    } catch {
      failed = true;
    }
    assert(failed, "rejected");
  }
  assert(
    starts === 0 && sends === 0,
    "safe render/key before durable boundary",
  );
});
