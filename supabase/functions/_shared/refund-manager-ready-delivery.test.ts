import { deliverRefundManagerReadyClaim } from "./refund-manager-ready-delivery.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const projection = {
  schemaVersion: "refund_manager_ready_notice_v2",
  caseId: "12810000-0000-4000-8000-000000000001",
  managerUserId: "12810000-0000-4000-8000-000000000002",
  decisionFingerprint: "a".repeat(64),
  proofId: "12810000-0000-4000-8000-000000000005",
  officialActionVersion: 1,
  deterministicFactVersion: 1,
  actionCode: "approve_or_deny_request",
  recommendationKind: null,
  recommendationReasonCode: null,
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

Deno.test('required ready deferral preserves the existing notice budget without sending new outcomes to an old database', async () => {
  for (const version of [undefined, 1, 2]) {
    const outcomes: unknown[] = []; let sends = 0;
    const result = await deliverRefundManagerReadyClaim({ claim: { ...claim, requiredRefundActionsVersion: version }, caseUrl,
      client: { rpc: async (name, args) => {
        if (name === 'service_mark_refund_manager_ready_notice_provider_started') return { data: false, error: null };
        outcomes.push(args.p_outcome); return { data: true, error: null };
      } }, sendEmail: async () => { sends++; return { providerMessageId: 'must-not-send' }; } });
    assert(result === 'stale' && sends === 0, 'No provider access after rejected boundary');
    assert(outcomes.join() === (version === 1 ? 'operational_deferred' : ''), 'Only exact new policy claims use the budget-preserving outcome');
  }
});

Deno.test("required reminder preserves the same final route check and durable attempt key", async () => {
  let starts = 0;
  const result = await deliverRefundManagerReadyClaim({ claim: { ...claim, noticeStage: "reminder" }, caseUrl,
    client: { rpc: async name => { if (name.includes("provider_started")) starts++; return { data: true, error: null }; } },
    sendEmail: async message => {
      assert(starts === 1, "current route checked before reminder transport");
      assert(message.subject.startsWith("Reminder: "), "reminder is clearly named");
      assert(message.idempotencyKey === `refund_manager_ready_${claim.intentId.replaceAll("-", "")}`, "existing outbox identity is the provider key");
      return { providerMessageId: "synthetic-required-reminder" };
    } });
  assert(result === "sent", "required reminder settles through the existing ledger");
});

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

Deno.test("optional gift ready delivery revalidates before its only mocked send", async () => {
  const giftClaim = { ...claim, projection: { ...projection, proofId: null,
    evidenceBasis: "gift_card_manager_review", amountCents: 1500,
    preparationSummary: "Partial order." } };
  for (const current of [false, true]) {
    const calls: string[] = [];
    const result = await deliverRefundManagerReadyClaim({ claim: giftClaim, caseUrl,
      client: { rpc: async (name) => { calls.push(name); return { data: current, error: null }; } },
      sendEmail: async (message) => {
        assert(calls.length === 1 && calls[0].includes("provider_started"), "currentness checked before sending");
        assert(message.text.includes("Gift-card value: $15.00"), "gift value survives delivery");
        assert(!/Zelle|purchase evidence/.test(message.text), "no false payment instruction");
        calls.push("mock_send");
        return { providerMessageId: "synthetic-gift-ready-id" };
      },
    });
    assert(result === (current ? "sent" : "stale"), "stale gift preparation cannot reach provider");
    assert(calls.filter((name) => name === "mock_send").length === (current ? 1 : 0), "exactly one send only while current");
  }
});
