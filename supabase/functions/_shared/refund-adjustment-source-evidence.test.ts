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

Deno.test("exact existing financial owner takes metadata update; financial changes retain insertion guards", async () => {
  const { isUnchangedRefundFinancialOwner } = await import("./refund-adjustment-source-evidence.ts");
  const old = { source:"google_sheets",source_reference:"sheet",source_row_reference:"request",source_row_hash:"hash",
    reporting_machine_id:"machine",reporting_location_id:"location",adjustment_date:"2026-09-30",adjustment_type:"refund",
    amount_cents:1080,complaint_count:0,match_status:"applied",raw_payload:{original_order_date:"2026-09-15",amount_source:"refund_amount"} };
  const incoming = { ...old, raw_payload:{...old.raw_payload,payment_method:"cash",source_evidence_parser:"original_refund_payment.v1"} };
  if (!isUnchangedRefundFinancialOwner(old,incoming)) throw new Error("unchanged owner must update, including contradictory new tender");
  for (const key of ["source","source_reference","source_row_reference","source_row_hash","reporting_machine_id","reporting_location_id",
    "adjustment_date","adjustment_type","amount_cents","complaint_count"]) {
    if (isUnchangedRefundFinancialOwner(old,{...incoming,[key]:"changed"})) throw new Error(`changed ${key} must retain original guard`);
  }
  if (isUnchangedRefundFinancialOwner(null,incoming)) throw new Error("new row must insert");
  if (isUnchangedRefundFinancialOwner(old,{...incoming,raw_payload:{...incoming.raw_payload,original_order_date:"2026-09-14"}})) throw new Error("changed purchase date must re-adjudicate");
});

Deno.test("same-owner sync overlays checked evidence without changing retained payload or keeping omitted tender", async () => {
  const { overlayRefundSourceEvidence } = await import("./refund-adjustment-source-evidence.ts");
  const old = {source_location:"Original Case",match_reason:"old audit",amount_source:"refund_amount",original_order_date:"2026-09-15",
    payment_method:"credit",source_evidence_reconciliation:{review:"old"}};
  const incoming = {source_location:"original case",match_reason:"new audit",source_evidence_parser:"original_refund_payment.v1"};
  const result = overlayRefundSourceEvidence(old,incoming);
  if (result.source_location!==old.source_location || result.match_reason!==old.match_reason) throw new Error("retained metadata changed");
  if (Object.hasOwn(result,"payment_method") || Object.hasOwn(result,"source_evidence_reconciliation")) throw new Error("new missing evidence must be cleared");
  if (result.source_evidence_parser!==incoming.source_evidence_parser) throw new Error("new parser marker missing");
});

Deno.test("unchanged owner supports a missing original date without inventing one", async () => {
  const { isUnchangedRefundFinancialOwner } = await import("./refund-adjustment-source-evidence.ts");
  const row = { source:"google_sheets",match_status:"applied",raw_payload:{amount_source:"refund_amount"} };
  if (!isUnchangedRefundFinancialOwner(row,{...row,raw_payload:{amount_source:"refund_amount",source_evidence_parser:"original_refund_payment.v1"}})) throw new Error("absent date must remain absent");
});
