import { buildRefundManagerReadyEmail, parseRefundManagerReadyNotice } from "./refund-manager-ready-email.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const notice = {
  schemaVersion: "refund_manager_ready_notice_v2",
  caseId: "12810000-0000-4000-8000-000000000001",
  managerUserId: "12810000-0000-4000-8000-000000000002",
  decisionFingerprint: "a".repeat(64),
  proofId: "12810000-0000-4000-8000-000000000003",
  officialActionVersion: 1,
  deterministicFactVersion: 1,
  actionCode: "approve_or_deny_request",
  recommendationKind: null,
  recommendationReasonCode: null,
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

Deno.test("reviewed candidate set permits one final decision without exposing tokens", () => {
  const parsed = parseRefundManagerReadyNotice({ ...notice,
    proofId: "ffffffff-ffff-ffff-0000-ffffffffffff",
    evidenceBasis: "card_reviewed_candidate_set",
    preparationSummary: "Several Nayax purchases were reviewed. Choose the correct purchase only if approving this request." });
  const email = buildRefundManagerReadyEmail({ notice: parsed,
    caseUrl: `https://portal.example/refunds?case=${parsed.caseId}` });
  assert(email.text.includes("approve or deny"), "one final manager decision remains available");
  assert(email.text.includes("Several Nayax purchases were reviewed"), "safe prepared summary is included");
  assert(!email.text.includes("candidateToken") && !email.html.includes("candidateToken"),
    "candidate choices remain in the scoped portal only");
  for (const mismatched of [
    { ...notice, evidenceBasis: "cash_sale_found" },
    { ...notice, actionCode: "send_cash_refund_and_confirm",
      evidenceBasis: "card_reviewed_candidate_set" },
  ]) {
    let rejected = false;
    try { parseRefundManagerReadyNotice(mismatched); } catch { rejected = true; }
    assert(rejected, "preparation basis cannot cross the payment-method decision boundary");
  }
});

Deno.test("unapproved cash research cannot render a payout instruction", () => {
  for (const evidenceBasis of ["cash_sale_found", "cash_multiple_reviewed",
    "cash_researched_unmatched", "cash_coverage_unavailable_researched"]) {
    let rejected = false;
    try {
      parseRefundManagerReadyNotice({ ...notice,
        actionCode: "send_cash_refund_and_confirm", evidenceBasis,
        preparationSummary: "Cash research is incomplete or still needs a decision." });
    } catch { rejected = true; }
    assert(rejected, `${evidenceBasis} cannot borrow approved payout authority`);
  }
});

Deno.test("existing approved cash payout uses saved authority without invented preparation", () => {
  const parsed = parseRefundManagerReadyNotice({ ...notice,
    actionCode: "send_cash_refund_and_confirm", evidenceBasis: "cash_approved_payout",
    proofId: null,
    preparationSummary: "This cash refund was already approved. Send the saved amount to the verified Zelle destination, then confirm it was sent." });
  const email = buildRefundManagerReadyEmail({ notice: parsed,
    caseUrl: `https://portal.example/refunds?case=${parsed.caseId}` });
  assert(email.text.includes("Saved approval: This cash refund was already approved"),
    "saved approval is named as the authority");
  assert(email.text.includes("Send Zelle, then confirm"), "one existing payout action remains");
  assert(!email.text.includes("approve or deny"), "there is no second approval");
  assert(!email.text.includes("contact@") && !email.html.includes("contact@"),
    "destination value is omitted");
  for (const unsafe of [
    { ...notice, proofId: null },
    { ...notice, actionCode: "send_cash_refund_and_confirm",
      evidenceBasis: "cash_approved_payout" },
  ]) {
    let rejected = false;
    try { parseRefundManagerReadyNotice(unsafe); } catch { rejected = true; }
    assert(rejected, "new decisions cannot borrow the saved-approval exception");
  }
});

Deno.test("refund and decline recommendations render distinct truthful actions", () => {
  const cashRefund = parseRefundManagerReadyNotice({ ...notice,
    recommendationKind: "refund", recommendationReasonCode: "clear_purchase_match",
    evidenceBasis: "cash_sale_found",
    preparationSummary: "A matching cash purchase was found. We recommend refunding this purchase." });
  const cashEmail = buildRefundManagerReadyEmail({ notice: cashRefund,
    caseUrl: `https://portal.example/refunds?case=${cashRefund.caseId}` });
  assert(cashEmail.text.includes("approve or deny"), "cash match remains a decision");
  assert(!cashEmail.text.includes("Send Zelle"), "unapproved cash match is not a payout request");

  const reject = parseRefundManagerReadyNotice({ ...notice,
    actionCode: "reject_request", proofId: null,
    recommendationKind: "reject", recommendationReasonCode: "no_match_after_30_days",
    evidenceBasis: "decision_recommendation_reject",
    amountCents: null, currencyCode: null,
    preparationSummary: "No clear purchase match was found, and 30 days passed without new details." });
  const rejectEmail = buildRefundManagerReadyEmail({ notice: reject,
    caseUrl: `https://portal.example/refunds?case=${reject.caseId}` });
  assert(rejectEmail.subject.startsWith("Decline recommendation ready"), "decline subject is explicit");
  assert(rejectEmail.text.includes("final decision remains yours"), "decline remains advisory");
  assert(rejectEmail.text.includes("No matched purchase amount"), "decline does not invent a purchase amount");
  assert(rejectEmail.html.includes(">Decline recommendation ready</h1>"), "decline heading matches the advisory subject");
  assert(!rejectEmail.text.includes("refund was declined"), "email does not claim a final decision");
  for (const unsafe of [
    { ...reject, amountCents: 725, currencyCode: "USD" },
    { ...cashRefund, amountCents: null },
  ]) {
    let rejected = false;
    try { parseRefundManagerReadyNotice(unsafe); } catch { rejected = true; }
    assert(rejected, "only a no-match decline recommendation may omit the amount");
  }
});

Deno.test("reviewed cash purchase renders advisory decision without payout authority", () => {
  const reviewed = { ...notice, recommendationKind: "refund",
    recommendationReasonCode: "clear_purchase_match", evidenceBasis: "cash_multiple_reviewed",
    preparationSummary: "A reviewed cash purchase is selected. We recommend refunding this purchase." };
  const parsed = parseRefundManagerReadyNotice(reviewed);
  const email = buildRefundManagerReadyEmail({ notice: parsed,
    caseUrl: `https://portal.example/refunds?case=${parsed.caseId}` });
  assert(email.text.includes("approve or deny"), "reviewed purchase remains a Manager decision");
  assert(!email.text.includes("Send Zelle"), "reviewed purchase does not imply payment");
  assert(parsed.proofId === notice.proofId, "existing exact current proof identity is retained");
  for (const unsafe of [
    { ...reviewed, proofId: null },
    { ...reviewed, recommendationKind: null, recommendationReasonCode: null },
    { ...reviewed, actionCode: "send_cash_refund_and_confirm" },
  ]) {
    let rejected = false;
    try { parseRefundManagerReadyNotice(unsafe); } catch { rejected = true; }
    assert(rejected, "reviewed cash cannot bypass current recommendation/proof or become payout authority");
  }
});
