import {
  buildRefundManagerDigestEmail,
  parseRefundManagerDailyDigestProjection,
  type RefundManagerDailyDigestItem,
  type RefundManagerDailyDigestProjection,
} from "./refund-manager-digest.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const item = (index: number, actor: RefundManagerDailyDigestItem["actor"] = "system"):
  RefundManagerDailyDigestItem => ({
    caseId: `12810000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    publicReference: `RF-${index}<safe>`,
    amountCents: actor === "manager" ? 700 : null,
    currencyCode: actor === "manager" ? "USD" : null,
    machineLabel: "A very long public machine label & safe",
    locationName: "Public location",
    ageMinutes: index * 60,
    actor,
    actionCode: actor === "manager" ? "approve_or_deny_request"
      : actor === "customer" ? "answer_question" : "research_purchase",
    actionLabel: actor === "customer" ? "We asked one question and are waiting for a reply."
      : "Check the purchase records.",
    paymentComplete: false,
    payloadRedacted: true,
  });

const projection = (items: RefundManagerDailyDigestItem[]): RefundManagerDailyDigestProjection => ({
  schemaVersion: "refund_manager_daily_digest_v2",
  observedAt: "2026-09-10T15:00:00.000Z",
  actionCount: items.filter((entry) => entry.actor === "manager").length,
  openCount: items.length,
  items,
  payloadRedacted: true,
});

const render = (input: RefundManagerDailyDigestProjection) => buildRefundManagerDigestEmail({
  projection: parseRefundManagerDailyDigestProjection(input),
  caseUrl: (id) => `https://portal.example/refunds?case=${id}`,
  queueUrl: "https://portal.example/refunds",
  localDate: "2026-09-10",
});

Deno.test("daily digest rejects extra private fields, duplicate cases, stale totals and paid action", () => {
  const base = projection([item(1)]);
  for (const unsafe of [
    { ...base, customerEmail: "private@example.invalid" },
    { ...base, items: [item(1), item(1)], openCount: 2 },
    { ...base, actionCount: 1 },
    projection([{ ...item(1, "manager"), paymentComplete: true }]),
  ]) {
    let rejected = false;
    try { parseRefundManagerDailyDigestProjection(unsafe); } catch { rejected = true; }
    assert(rejected, "unsafe or inconsistent projection must be rejected");
  }
});

Deno.test("daily digest includes all 15 cases with decisions first and an exact link for each", () => {
  const entries = Array.from({ length: 15 }, (_, index) =>
    item(index + 1, index === 5 || index === 8 ? "manager" : index === 3 ? "customer" : "system"));
  const message = render(projection(entries));
  assert(message.itemCount === 15, "no eight-case cap");
  assert(message.subject === "Bloomjoy refunds: 2 need your action, 15 open", "subject counts");
  assert(message.text.indexOf("RF-9") < message.text.indexOf("RF-6") &&
    message.text.indexOf("RF-6") < message.text.indexOf("RF-15"),
    "oldest decisions first, before other work");
  for (const entry of entries) {
    assert(message.text.includes(`?case=${entry.caseId}`), "each case has an exact text link");
    assert(message.html.includes(`?case=${entry.caseId}`), "each case has an exact HTML link");
  }
  assert(message.html.includes("&lt;safe&gt;") && !message.html.includes("<safe>"), "labels escaped");
  assert(!/customerEmail|private@example|diagnostic/i.test(message.text + message.html), "private fields absent");
  assert(message.html.includes('<html lang="en" dir="ltr">') &&
    message.html.includes('<main lang="en" dir="ltr"') &&
    message.html.includes("<title>"), "accessible document structure");
});

Deno.test("informational work names the actual next actor without asking manager to investigate", () => {
  const paid = { ...item(1), paymentComplete: true, actionCode: "recover_customer_delivery",
    actionLabel: "We are sending the customer the outcome." };
  const message = render(projection([paid, item(2, "customer"), item(3, "manager"), item(4)]));
  assert(message.text.includes("refund was already sent"), "paid case has no second payment request");
  assert(message.text.includes("Awaiting Bloomjoy follow-up") &&
    message.text.includes("Waiting for Bloomjoy follow-up. Next step: Check the purchase records."),
    "internal next step is pending, not described as actively running");
  assert(!message.text.includes("Bloomjoy is working"), "no unsupported active-work claim");
  assert(message.text.includes("Waiting for the customer"), "customer wait section");
  assert(message.text.includes("No action needed from you"), "internal and customer steps are FYI");
  assert(message.text.includes("approve or deny"), "prepared case asks for final decision");
});

Deno.test("empty personal queue produces no email", () => {
  let rejected = false;
  try { render(projection([])); } catch { rejected = true; }
  assert(rejected, "empty digest cannot render");
});
