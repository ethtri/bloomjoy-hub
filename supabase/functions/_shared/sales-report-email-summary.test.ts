import { assertStringIncludes, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { summarizeSalesReportPdfRows } from "./sales-report-pdf.ts";
import { buildSalesReportEmailSummary } from "./sales-report-email-summary.ts";

Deno.test("scheduled summary preserves known money and separates partial estimates from remaining gaps", () => {
  const summary = summarizeSalesReportPdfRows([{gross_sales_cents:null, gross_sales_known_cents:1000, refund_amount_cents:null, refund_amount_known_cents:-100, net_sales_cents:null, net_sales_known_cents:1100, gross_sales_unknown_count:2, refund_amount_unknown_count:2, net_sales_unknown_count:3, unresolved_sales_count:2, unresolved_refund_count:2, tax_policy_evidence:{status:"provisional",estimatedSalesExTaxCents:0,estimatedRefundExTaxCents:-40,estimatedNetExTaxCents:40,provisionalSalesComponents:1,provisionalRefundComponents:1,provisionalNetComponents:1}}]);
  const lines = buildSalesReportEmailSummary(summary,"shared-sales-basis-v1").join("\n");
  assertStringIncludes(lines,"Confirmed $10.00 | Estimated $0.00 | Known + estimated subtotal $10.00");
  assertStringIncludes(lines,"Confirmed +$1.00 | Estimated +$0.40 | Known + estimated subtotal +$1.40");
  assertStringIncludes(lines,"Still unestimated components: sales 1; refunds 1; net 2.");
  assertStringIncludes(lines,"do not authorize payouts");
});

Deno.test("scheduled known-only summary distinguishes recorded zero from unavailable", () => {
  const summary=summarizeSalesReportPdfRows([{gross_sales_cents:0,net_sales_cents:null,net_sales_known_cents:3500,net_sales_unknown_count:1,unresolved_refund_count:1}]);
  const lines=buildSalesReportEmailSummary(summary,"shared-sales-basis-v1");
  assertEquals(lines[0],"Sales before refunds: $0.00");
  assertStringIncludes(lines[2],"Known subtotal $35.00");
  assertStringIncludes(lines.join("\n"),"Unresolved source records");
  assertEquals(lines.some(line=>line.includes("Estimated")),false);
});
