import {
  buildRefundManagerDigestEmail,
  parseRefundManagerWorkProjection,
  type RefundManagerWorkProjection,
} from "./refund-manager-digest.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const projection = (items = 1): RefundManagerWorkProjection => ({
  schemaVersion: "refund_manager_work_v1",
  observedAt: "2026-09-10T15:00:00.000Z",
  bucketCounts: {
    needs_action: items,
    ready_to_pay: 0,
    in_progress: 0,
    provider_hold: 0,
    waiting_on_customer: 0,
    completed: 0,
  },
  digestCounts: {
    needsDecision: items,
    newInformation: items,
    aging: 0,
    exceptionsBeingHandled: 0,
  },
  oldestActionableAgeMinutes: items ? 180 : null,
  recentMaterialChangeCount: items,
  items: Array.from({ length: items }, (_, index) => ({
    caseId: `12810000-0000-4000-8000-00000000000${index + 1}`,
    publicReference: `RF-${index + 1}<safe>`,
    amountCents: 700,
    currencyCode: "USD",
    machineLabel: "A very long public machine label & safe",
    locationName: "Public location",
    ageMinutes: 180,
    queueBucket: "needs_action" as const,
    queueLabel: "Action needed",
    actionCode: "refund",
    actionOwner: "manager",
    lifecycleActor: "system",
    whatChanged: "The server recorded a verified customer reply.",
    noticeReason: "customer_reply" as const,
    attentionVersion: 2,
    digestEligible: true,
    urgentNoticeState: "none" as const,
    payloadRedacted: true as const,
  })),
  metrics: {
    emailsSentToday: 0,
    digestEligibleCount: items,
    duplicatesSuppressedToday: 0,
    oldestActionableAgeMinutes: items ? 180 : null,
    oldestDecisionAgeMinutes: items ? 180 : null,
    payloadRedacted: true,
  },
  payloadRedacted: true,
});

Deno.test("manager digest parser rejects unsafe extra fields", () => {
  const raw = {
    ...projection(),
    customerEmail: "must-not-appear@example.test",
  };
  let rejected = false;
  try {
    parseRefundManagerWorkProjection(raw);
  } catch {
    rejected = true;
  }
  assert(rejected, "extra root fields must be rejected");
});

Deno.test("manager digest renders one and many items deterministically with exact links", () => {
  for (const count of [1, 5]) {
    const input = projection(count);
    const first = buildRefundManagerDigestEmail({
      projection: input,
      caseUrl: (id) => `https://portal.example/refunds?case=${id}`,
      queueUrl: "https://portal.example/refunds",
      localDate: "2026-09-10",
    });
    const second = buildRefundManagerDigestEmail({
      projection: input,
      caseUrl: (id) => `https://portal.example/refunds?case=${id}`,
      queueUrl: "https://portal.example/refunds",
      localDate: "2026-09-10",
    });
    assert(
      JSON.stringify(first) === JSON.stringify(second),
      "render must be deterministic",
    );
    assert(first.itemCount === count, "item count parity");
    assert(
      first.html.includes("&lt;safe&gt;") && !first.html.includes("<safe>"),
      "long labels are escaped",
    );
    assert(
      first.text.includes("?case=12810000-0000-4000-8000-000000000001"),
      "exact case link",
    );
    assert(first.text.includes("navigation only"), "non-action reassurance");
    assert(
      !/customerEmail|diagnostic|stack/i.test(first.text + first.html),
      "no internal or customer fields",
    );
  }
});

Deno.test("manager digest refuses zero items and uses no re-decision copy for waiting work", () => {
  let rejected = false;
  try {
    buildRefundManagerDigestEmail({
      projection: projection(0),
      caseUrl: () => "",
      queueUrl: "https://portal.example/refunds",
      localDate: "2026-09-10",
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "empty digest must not render");
  const waiting = projection(1);
  waiting.items[0].queueBucket = "waiting_on_customer";
  waiting.items[0].actionCode = "wait_for_customer_reply";
  const rendered = buildRefundManagerDigestEmail({
    projection: waiting,
    caseUrl: () => "https://portal.example/refunds?case=x",
    queueUrl: "https://portal.example/refunds",
    localDate: "2026-09-10",
  });
  assert(
    rendered.text.includes("No manager action is due now"),
    "waiting case must not be relabeled as a decision",
  );
});
