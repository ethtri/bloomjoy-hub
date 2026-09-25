import { deliverRefundManagerReadyClaim } from "./refund-manager-ready-delivery.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const projection = {
  schemaVersion: "refund_manager_ready_notice_v1",
  caseId: "12810000-0000-4000-8000-000000000001",
  managerUserId: "12810000-0000-4000-8000-000000000002",
  decisionFingerprint: "a".repeat(64),
  proofId: "12810000-0000-4000-8000-000000000005",
  officialActionVersion: 1,
  deterministicFactVersion: 1,
  actionCode: "approve_or_deny_request",
  evidenceBasis: "card_exact_selected",
  preparationSummary: "Purchase research was completed; review the saved evidence before deciding.",
  publicReference: "RF-SYNTHETIC-1",
  amountCents: 725,
  currencyCode: "USD",
  machineLabel: "Public lobby machine",
  locationName: "Synthetic Mall",
  payloadRedacted: true,
};
const claim = {
  claimed: true, payloadRedacted: true,
  intentId: "12810000-0000-4000-8000-000000000003",
  claimToken: "12810000-0000-4000-8000-000000000004",
  recipient: "manager@example.test",
  routeFingerprint: "b".repeat(64), projection,
};
const caseUrl = (caseId: string) => `https://portal.example/refunds?case=${caseId}`;

Deno.test("ready notice sends one current manager a prepared decision with a durable idempotency key", async () => {
  const calls: string[] = [];
  const messages: Array<{ to: string[]; idempotencyKey: string; text: string }> = [];
  const result = await deliverRefundManagerReadyClaim({ claim, caseUrl,
    client: { rpc: async (name, args) => {
      calls.push(name);
      if (name.includes("provider_started")) {
        assert(args.p_recipient === "manager@example.test", "exact current route");
        return { data: true, error: null };
      }
      assert(args.p_outcome === "sent", "provider acceptance settles sent");
      return { data: true, error: null };
    } },
    sendEmail: async (value) => {
      messages.push(value);
      return { providerMessageId: "synthetic-provider-id" };
    },
  });
  assert(result === "sent", "sent result");
  assert(calls.join(",") ===
    "service_mark_refund_manager_ready_notice_provider_started,service_complete_refund_manager_ready_notice",
    "provider marker precedes settlement");
  assert(messages.length === 1 && messages[0].to.length === 1 &&
    messages[0].to[0] === "manager@example.test", "single scoped recipient");
  assert(messages[0].idempotencyKey === "refund_manager_ready_12810000000040008000000000000003",
    "stable provider key per intent");
  assert(messages[0].text.includes("Purchase research was completed"), "prepared summary travels to email");
});

Deno.test("revoked or changed scope at provider boundary sends nothing", async () => {
  let sends = 0;
  const result = await deliverRefundManagerReadyClaim({ claim, caseUrl,
    client: { rpc: async () => ({ data: false, error: null }) },
    sendEmail: async () => { sends += 1; throw new Error("must not send"); },
  });
  assert(result === "stale" && sends === 0, "revalidation wins before provider access");
});

Deno.test("unsafe projection settles known-not-sent before provider access", async () => {
  const outcomes: string[] = [];
  let sends = 0;
  try {
    await deliverRefundManagerReadyClaim({ claim: { ...claim,
      projection: { ...projection, customerEmail: "private@example.test" } }, caseUrl,
      client: { rpc: async (_name, args) => {
        outcomes.push(String(args.p_outcome));
        return { data: true, error: null };
      } },
      sendEmail: async () => { sends += 1; throw new Error("must not send"); },
    });
    throw new Error("unsafe projection was accepted");
  } catch (error) {
    assert(error instanceof Error && error.message.includes("projection"), "unsafe payload rejected");
  }
  assert(outcomes.join() === "known_not_sent" && sends === 0, "safe retry evidence");
});

Deno.test("ambiguous provider outcome remains held, never blindly retried", async () => {
  const outcomes: string[] = [];
  try {
    await deliverRefundManagerReadyClaim({ claim, caseUrl,
      client: { rpc: async (name, args) => {
        if (name.includes("provider_started")) return { data: true, error: null };
        outcomes.push(String(args.p_outcome));
        return { data: true, error: null };
      } },
      sendEmail: async () => { throw new Error("provider timeout after attempt"); },
    });
    throw new Error("provider uncertainty was ignored");
  } catch (error) {
    assert(error instanceof Error && error.message.includes("provider timeout"), "timeout surfaced");
  }
  assert(outcomes.join() === "delivery_unknown", "unknown send is held");
});
