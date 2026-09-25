import { buildRefundManagerReadyEmail, parseRefundManagerReadyNotice } from
  "../../supabase/functions/_shared/refund-manager-ready-email.ts";

const directory = "Docs/screenshots/refund-ready-1425";
const caseId = "14250000-0000-4000-8000-000000000001";
const base = {
  schemaVersion: "refund_manager_ready_notice_v1",
  caseId,
  managerUserId: "14250000-0000-4000-8000-000000000002",
  decisionFingerprint: "a".repeat(64),
  proofId: "14250000-0000-4000-8000-000000000003",
  officialActionVersion: 1,
  deterministicFactVersion: 1,
  publicReference: "RF-SYNTHETIC-1425",
  amountCents: 725,
  currencyCode: "USD",
  machineLabel: "Public lobby treats",
  locationName: "Synthetic Mall",
  payloadRedacted: true,
};

await Deno.mkdir(directory, { recursive: true });
for (const [name, actionCode, evidenceBasis, preparationSummary] of [
  ["card", "approve_or_deny_request", "card_exact_selected",
    "A specific Nayax card purchase is verified for the Manager's final decision."],
  ["cash", "send_cash_refund_and_confirm", "cash_coverage_unavailable_researched",
    "Sunze cash sales coverage is unavailable for this window; the gap is recorded for review."],
] as const) {
  const notice = parseRefundManagerReadyNotice({
    ...base, actionCode, evidenceBasis, preparationSummary,
  });
  const email = buildRefundManagerReadyEmail({
    notice,
    caseUrl: `https://portal.example.invalid/refunds?case=${caseId}`,
  });
  await Deno.writeTextFile(`${directory}/${name}.html`, email.html);
  await Deno.writeTextFile(`${directory}/${name}.txt`,
    `Subject: ${email.subject}\n\n${email.text}\n`);
}
console.log("Synthetic ready-email HTML and text evidence rendered.");
