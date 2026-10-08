import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildRefundFinancialHashPayload, buildRefundSourceEvidence, extractOriginalRefundTender } from "./refund-adjustment-source-evidence.ts";

Deno.test("original sheet tender preserves card, wallet and cash", () => {
  for (const value of ["Card", "Apple/Google Pay", "Credit card"]) {
    assertEquals(extractOriginalRefundTender({ PaymentMethod: value }), "credit");
  }
  assertEquals(extractOriginalRefundTender({ payment_method: "Cash" }), "cash");
});

Deno.test("evidence and repeated sync preserve exact legacy financial hash bytes", () => {
  const input = {
    sourceRowReference: "synthetic-1", normalizedLocation: "synthetic site",
    refundDate: "2026-09-30", originalOrderDate: "2026-09-15", amountCents: 1080,
    normalizedSourceStatus: "closed", normalizedSourceDecision: "approve", adjustmentType: "refund",
    hasSourceReportingMachineId: false, sourceReportingMachineId: "",
  };
  const oldBytes = '{"sourceRowReference":"synthetic-1","sourceLocation":"synthetic site","refundDate":"2026-09-30","originalOrderDate":"2026-09-15","amountCents":1080,"sourceStatus":"closed","sourceDecision":"approve","adjustmentType":"refund"}';
  for (const originalTender of ["credit", "cash", null]) {
    const enriched = { ...input, originalTender, source_evidence_parser: "original_refund_payment.v1" };
    assertEquals(JSON.stringify(buildRefundFinancialHashPayload(enriched)), oldBytes);
    assertEquals(JSON.stringify(buildRefundFinancialHashPayload(enriched)), JSON.stringify(buildRefundFinancialHashPayload(input)));
  }
  assertEquals(JSON.stringify(buildRefundFinancialHashPayload({ ...input, hasSourceReportingMachineId: true, sourceReportingMachineId: "synthetic-machine" })),
    oldBytes.slice(0, -1) + ',"sourceReportingMachineId":"synthetic-machine"}');
  assertEquals(JSON.stringify(buildRefundFinancialHashPayload({ ...input, amountCents: 1081 })) === oldBytes, false);
});

Deno.test("payout preferences never become original payment evidence", () => {
  assertEquals(extractOriginalRefundTender({ refund_method: "Cash", preferred_refund_method: "Card" }), null);
  assertEquals(extractOriginalRefundTender({ payment_method: "Card", refund_method: "Cash" }), "credit");
});

Deno.test("contradictory or unsupported original tender remains unknown", () => {
  assertEquals(extractOriginalRefundTender({ payment_method: "Card", original_payment_method: "Cash" }), null);
  assertEquals(extractOriginalRefundTender({ payment_method: "Card", original_payment_method: "Unknown" }), null);
  assertEquals(extractOriginalRefundTender({ payment_method: "Zelle" }), null);
  assertEquals(extractOriginalRefundTender({ payment_method: "" }), null);
});

Deno.test("proven refund and existing approved fallback amounts retain customer basis", () => {
  for (const amountSource of ["refund_amount", "refund_amount_cents", "request_amount", "request_amount_cents"]) {
    const evidence = buildRefundSourceEvidence("credit", amountSource, true);
    assertEquals(evidence.payment_method, "credit");
    assertEquals(evidence.amountBasis, "gross_customer_charge_minor");
    assertEquals(evidence.source_evidence?.amount_source, amountSource);
    assertEquals(buildRefundSourceEvidence("credit", amountSource, true), evidence);
  }
  assertEquals(buildRefundSourceEvidence(null, "refund_amount"), {});
  assertEquals(buildRefundSourceEvidence("cash", null), {});
  assertEquals(buildRefundSourceEvidence("credit", "payout_amount"), {});
  assertEquals(buildRefundSourceEvidence("credit", "request_amount"), {});
});
