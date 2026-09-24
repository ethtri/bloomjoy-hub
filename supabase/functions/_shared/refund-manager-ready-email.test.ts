import { buildRefundManagerReadyEmail, parseRefundManagerReadyNotice } from "./refund-manager-ready-email.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const notice = {
  schemaVersion: "refund_manager_ready_notice_v1",
  caseId: "12810000-0000-4000-8000-000000000001",
  managerUserId: "12810000-0000-4000-8000-000000000002",
  decisionFingerprint: "a".repeat(64),
  proofId: "12810000-0000-4000-8000-000000000003",
  officialActionVersion: 1,
  deterministicFactVersion: 1,
  actionCode: "approve_or_deny_request",
  evidenceBasis: "card_exact_selected",
  preparationSummary: "Saved purchase evidence supports a final decision.",
  publicReference: "RF-SYNTHETIC-1",
  amountCents: 725,
  currencyCode: "USD",
  machineLabel: "Public lobby & treats",
  locationName: "Synthetic Mall",
  payloadRedacted: true,
} as const;

Deno.test("ready email requires a complete safe final-decision projection", () => {
  for (const unsafe of [
    { ...notice, customerEmail: "private@example.test" },
    { ...notice, actionCode: "retry_payment" },
    { ...notice, amountCents: null },
    { ...notice, decisionFingerprint: "wrong" },
    { ...notice, payloadRedacted: false },
    { ...notice, evidenceBasis: "invented_match" },
    { ...notice, preparationSummary: "" },
  ]) {
    let rejected = false;
    try { parseRefundManagerReadyNotice(unsafe); } catch { rejected = true; }
    assert(rejected, "unsafe or mismatched projection must fail closed");
  }
});

Deno.test("prepared card decision gives one exact portal action and safe evidence reason", () => {
  const parsed = parseRefundManagerReadyNotice(notice);
  const email = buildRefundManagerReadyEmail({ notice: parsed,
    caseUrl: `https://portal.example/refunds?case=${parsed.caseId}` });
  assert(email.text.startsWith("Review the prepared refund and approve or deny"), "decision first");
  assert(email.text.includes("Saved purchase evidence supports a final decision."), "saved preparation summary");
  assert(email.text.includes("$7.25"), "exact prepared amount");
  assert(email.text.includes(`?case=${parsed.caseId}`), "exact case link");
  assert(email.html.includes("Public lobby &amp; treats"), "HTML is escaped");
  assert(!email.text.includes("private@example"), "customer identity not projected");
});

Deno.test("cash message requires sending Zelle before confirmation and never requests another approval", () => {
  const parsed = parseRefundManagerReadyNotice({ ...notice,
    actionCode: "send_cash_refund_and_confirm", evidenceBasis: "cash_coverage_unavailable_researched",
    preparationSummary: "Cash coverage was unavailable; the reviewed case is ready for a decision." });
  const email = buildRefundManagerReadyEmail({ notice: parsed,
    caseUrl: `https://portal.example/refunds?case=${parsed.caseId}` });
  assert(email.text.startsWith("Review the saved cash evidence and payout destination. Send Zelle, then confirm"),
    "cash action sequence");
  assert(!email.text.includes("approve or deny"), "cash has no second approval");
  assert(email.text.includes("Cash coverage was unavailable"), "unmatched research can be prepared");
  assert(!email.text.includes("contact@") && !email.html.includes("contact@"),
    "destination value is omitted");
});
