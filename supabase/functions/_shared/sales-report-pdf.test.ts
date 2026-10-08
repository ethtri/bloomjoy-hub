import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "https://esm.sh/pdf-lib@1.17.1";
import rpcFixture from "./fixtures/rate-policy-rpc.json" with { type: "json" };
import { buildSalesReportEmailSummary } from "./sales-report-email-summary.ts";
import {
  buildMachineRollups,
  buildSalesReportPdf,
  formatMachineRollupCurrency,
  formatKnownSalesReportSubtotal,
  formatSalesReportRowAmount,
  summarizeSalesReportPdfRows,
  summarizeSalesReportEstimates,
  formatSalesReportEstimateSplit,
  readSalesReportTaxPolicyEvidence,
  buildSalesReportEstimateSnapshotSummary,
} from "./sales-report-pdf.ts";

Deno.test("actual rolled-back rate-policy RPC has identical PDF snapshot and scheduled-summary money", async () => {
  // Exported by the backend's real report API from synthetic rollback-only SQL fixtures.
  const rows = rpcFixture as Parameters<typeof summarizeSalesReportPdfRows>[0];
  const summary = summarizeSalesReportPdfRows(rows);
  assertEquals([summary.knownGrossSalesCents,summary.knownRefundAmountCents,summary.knownNetSalesCents],[250,0,250]);
  assertEquals([summary.grossSalesCents,summary.refundAmountCents,summary.netSalesCents],[null,null,null]);
  assertEquals(buildSalesReportEstimateSnapshotSummary(summary),{
    estimated_sales_ex_tax_cents:1000,estimated_refund_ex_tax_cents:1000,estimated_net_ex_tax_cents:0,
    provisional_sales_components:1,provisional_refund_components:1,provisional_net_components:2,
    unestimated_sales_components:1,unestimated_refund_components:0,unestimated_net_components:1,
  });
  const lines=buildSalesReportEmailSummary(summary,"shared-sales-basis-v1").join("\n");
  assert(lines.includes("Confirmed $2.50 | Estimated $0.00 | Known + estimated subtotal $2.50"));
  assert(lines.includes("Still unestimated components: sales 1; refunds 0; net 1."));
  const pdf=await PDFDocument.load(await buildSalesReportPdf({rows,summary}));
  const contents=pdf.context.enumerateIndirectObjects().filter(([,value])=>value instanceof PDFRawStream)
    .map(([,value])=>new TextDecoder().decode(decodePDFRawStream(value as PDFRawStream).decode())).join("\n").toUpperCase();
  const encoded=(value:string)=>[...new TextEncoder().encode(value)].map(byte=>byte.toString(16).padStart(2,"0")).join("").toUpperCase();
  assert(contents.includes(encoded("Net sales: Confirmed $2.50 | Estimated $0.00 | Known + estimated subtotal $2.50")));
  assert(contents.includes(encoded("Net: Confirmed Unavailable | Estimated $-10.00 | Known + estimated")));
  assert(contents.includes(encoded("$-10.00")));
});

Deno.test("provisional portions remain separate from confirmed subtotals and preserve reversals", async () => {
  const rows = [{ calculation_version: "shared-sales-basis-v1", period_start: "2026-09-01", machine_label: "Provisional machine",
    gross_sales_cents: null, gross_sales_known_cents: 1000, refund_amount_cents: null, refund_amount_known_cents: 100,
    net_sales_cents: null, net_sales_known_cents: 900, gross_sales_unknown_count:1,refund_amount_unknown_count:1,net_sales_unknown_count:2, unresolved_sales_count: 1, unresolved_refund_count: 1,
    tax_policy_evidence: {status: "provisional" as const, estimatedSalesExTaxCents: 200, estimatedRefundExTaxCents: 50,
      estimatedNetExTaxCents: 150, provisionalSalesComponents: 1, provisionalRefundComponents: 1, provisionalNetComponents: 2}},
    {calculation_version: "shared-sales-basis-v1", period_start: "2026-09-02", machine_label: "Reversal machine",
      net_sales_cents: null, refund_amount_cents: null, gross_sales_unknown_count:0,refund_amount_unknown_count:1,net_sales_unknown_count:1, unresolved_refund_count: 1,
      taxPolicyEvidence: {status: "provisional" as const, estimatedSalesExTaxCents: null, estimatedRefundExTaxCents: -40,
        estimatedNetExTaxCents: 40, provisionalSalesComponents: 0, provisionalRefundComponents: 1, provisionalNetComponents: 1}},
    {calculation_version: "shared-sales-basis-v1", net_sales_cents: null, refund_amount_unknown_count:1,net_sales_unknown_count:1, unresolved_refund_count: 1}];
  const summary = summarizeSalesReportPdfRows(rows);
  assertEquals([summary.knownGrossSalesCents, summary.knownRefundAmountCents, summary.knownNetSalesCents], [1000,100,900]);
  assertEquals([summary.grossSalesCents, summary.refundAmountCents, summary.netSalesCents], [null,null,null]);
  assertEquals([summary.unresolvedSalesCount, summary.unresolvedRefundCount], [1,3]);
  assertEquals(buildSalesReportEstimateSnapshotSummary(summary),{
    estimated_sales_ex_tax_cents:200,estimated_refund_ex_tax_cents:10,estimated_net_ex_tax_cents:190,
    provisional_sales_components:1,provisional_refund_components:2,provisional_net_components:3,
    unestimated_sales_components:0,unestimated_refund_components:1,unestimated_net_components:1,
  });
  assertEquals(summarizeSalesReportEstimates(rows), {estimatedSalesExTaxCents:200,estimatedRefundExTaxCents:10,
    estimatedNetExTaxCents:190,provisionalSalesComponents:1,provisionalRefundComponents:2,provisionalNetComponents:3,
    unestimatedSalesComponents:0,unestimatedRefundComponents:1,unestimatedNetComponents:1});
  assertEquals(formatSalesReportEstimateSplit(900,190), "Confirmed $9.00 | Estimated $1.90 | Known + estimated $10.90");
  assertEquals(formatSalesReportEstimateSplit(null,-40,true), "Confirmed Unavailable | Estimated +$0.40 | Known + estimated +$0.40");
  const bytes = await buildSalesReportPdf({rows,summary});
  const pdf = await PDFDocument.load(bytes);
  assertEquals(pdf.getSubject(), "sales-report-pdf/company-v7");
  assertEquals(pdf.getPageCount(), 3);
  const contents = pdf.context.enumerateIndirectObjects().filter(([,value]) => value instanceof PDFRawStream)
    .map(([,value]) => new TextDecoder().decode(decodePDFRawStream(value as PDFRawStream).decode())).join("\n").toUpperCase();
  const encoded = (text:string) => [...new TextEncoder().encode(text)].map(value=>value.toString(16).padStart(2,"0")).join("").toUpperCase();
  assert(contents.includes(encoded("Provisional tax estimates")));
  assert(contents.includes(encoded("Net sales: Confirmed $9.00 | Estimated $1.90 | Known + estimated subtotal $10.90")));
  assert(contents.includes(encoded("Still unestimated: 0 sales; 1 refund; 1 net components")));
  assert(contents.includes(encoded("Refund: Confirmed Unavailable | Estimated +$0.40 | Known + estimated +$0.40")));
});

Deno.test("provisional zero stays available while absent estimates add no PDF section", async () => {
  const evidence = {status:"provisional" as const,estimatedSalesExTaxCents:0,estimatedRefundExTaxCents:null,
    estimatedNetExTaxCents:0,provisionalSalesComponents:1,provisionalRefundComponents:0,provisionalNetComponents:1};
  assertEquals(summarizeSalesReportEstimates([{tax_policy_evidence:evidence,gross_sales_unknown_count:1,refund_amount_unknown_count:0,net_sales_unknown_count:1}]).estimatedNetExTaxCents,0);
  assertEquals(formatSalesReportEstimateSplit(null,0),"Confirmed Unavailable | Estimated $0.00 | Known + estimated $0.00");
  assertEquals(summarizeSalesReportEstimates([{}]).estimatedNetExTaxCents,null);
  assertEquals(formatSalesReportEstimateSplit(null,null),"Confirmed Unavailable | Estimated Unavailable | Known + estimated Unavailable");
  const pdf = await PDFDocument.load(await buildSalesReportPdf({rows:[{net_sales_cents:0}]}));
  assertEquals(pdf.getPageCount(),2);
  let rejected=false;
  try { readSalesReportTaxPolicyEvidence({tax_policy_evidence:{...evidence,estimatedNetExTaxCents:NaN}}); } catch {rejected=true;}
  assert(rejected);
});

Deno.test("remaining estimate coverage uses canonical metric components rather than event counts", () => {
  const row={gross_sales_unknown_count:2,refund_amount_unknown_count:19,net_sales_unknown_count:1,
    unresolved_sales_count:200,unresolved_refund_count:1900,
    tax_policy_evidence:{status:"provisional" as const,estimatedSalesExTaxCents:0,estimatedRefundExTaxCents:0,
      estimatedNetExTaxCents:0,provisionalSalesComponents:1,provisionalRefundComponents:1,provisionalNetComponents:1}};
  const summary=summarizeSalesReportEstimates([row]);
  assertEquals([summary.unestimatedSalesComponents,summary.unestimatedRefundComponents,summary.unestimatedNetComponents],[1,18,0]);
  assertEquals(formatSalesReportEstimateSplit(100,0,true,18),"Confirmed -$1.00 | Estimated $0.00 | Known + estimated subtotal -$1.00");
  let rejected=false;
  try {readSalesReportTaxPolicyEvidence({...row,net_sales_unknown_count:0});} catch {rejected=true;}
  assert(rejected,"Coverage beyond canonical unknown components must fail closed");
});

Deno.test("PDF rejects inconsistent provisional contributors and unsafe combined or aggregate amounts", () => {
  const row={gross_sales_unknown_count:1,refund_amount_unknown_count:0,net_sales_unknown_count:1,
    tax_policy_evidence:{status:"provisional" as const,estimatedSalesExTaxCents:0,estimatedRefundExTaxCents:null,
      estimatedNetExTaxCents:0,provisionalSalesComponents:1,provisionalRefundComponents:0,provisionalNetComponents:1}};
  for (const evidence of [
    {...row.tax_policy_evidence,estimatedSalesExTaxCents:null},
    {...row.tax_policy_evidence,provisionalSalesComponents:0},
    {...row.tax_policy_evidence,estimatedRefundExTaxCents:1},
    {...row.tax_policy_evidence,provisionalNetComponents:0},
  ]) {
    let rejected=false;
    try {readSalesReportTaxPolicyEvidence({...row,tax_policy_evidence:evidence});} catch {rejected=true;}
    assert(rejected,"Count and amount mismatches must not conceal unresolved components");
  }
  const large={...row,tax_policy_evidence:{...row.tax_policy_evidence,
    estimatedSalesExTaxCents:Number.MAX_SAFE_INTEGER,estimatedNetExTaxCents:Number.MAX_SAFE_INTEGER}};
  let aggregateRejected=false;
  try {summarizeSalesReportEstimates([large,large]);} catch {aggregateRejected=true;}
  assert(aggregateRejected);
  let combinedRejected=false;
  try {formatSalesReportEstimateSplit(Number.MAX_SAFE_INTEGER,1);} catch {combinedRejected=true;}
  assert(combinedRejected);
});

Deno.test("PDF retains known components inside unresolved rows without claiming complete money", async () => {
  const rows = [{ calculation_version: "shared-sales-basis-v1", machine_label: "Mixed components",
    gross_sales_cents: null, gross_sales_known_cents: 2300,
    refund_amount_cents: null, refund_amount_known_cents: 600,
    net_sales_cents: null, net_sales_known_cents: 1700, tax_cents: null,
    transaction_count: 4 },
    { calculationVersion: "shared-sales-basis-v1", machineLabel: "Mixed components",
      grossSalesCents: null, grossSalesKnownCents: 0,
      refundAmountCents: null, refundAmountKnownCents: -100,
      netSalesCents: null, netSalesKnownCents: 100, taxCents: null,
      transactionCount: 1 }];
  const summary = summarizeSalesReportPdfRows(rows);
  assertEquals([summary.grossSalesCents, summary.refundAmountCents, summary.netSalesCents], [null, null, null]);
  assertEquals([summary.knownGrossSalesCents, summary.knownRefundAmountCents, summary.knownNetSalesCents], [2300, 500, 1800]);
  assertEquals([summary.knownGrossRowCount, summary.knownRefundRowCount, summary.knownNetRowCount], [0, 0, 0]);
  assertEquals([summary.knownGrossContributorRowCount, summary.knownRefundContributorRowCount, summary.knownNetContributorRowCount], [2, 2, 2]);
  assertEquals(summary.transactionCount, 5);
  assertEquals(formatSalesReportRowAmount(rows[0], "net"), "$17.00*");
  assertEquals(formatSalesReportRowAmount(rows[1], "gross"), "$0.00*");
  assertEquals(formatSalesReportRowAmount(rows[1], "refund"), "+$1.00*");
  const [machine] = buildMachineRollups(rows);
  assertEquals(formatMachineRollupCurrency(machine.netSalesCents, machine.netValueCount, machine.rowCount, false, machine.netKnownCount), "$18.00*");
  const bytes = await buildSalesReportPdf({ rows, summary, dateFrom: "2026-01-01", dateTo: "2026-10-07" });
  const pdf = await PDFDocument.load(bytes);
  const contents = pdf.context.enumerateIndirectObjects().filter(([, value]) => value instanceof PDFRawStream)
    .map(([, value]) => new TextDecoder().decode(decodePDFRawStream(value as PDFRawStream).decode())).join("\n").toUpperCase();
  // Check the finished PDF's actual text operators for the independently known
  // aggregate, rather than trusting only the summary object passed to it.
  assert(contents.includes("2431382E3030")); // $18.00
  assert(contents.includes("2432332E3030")); // $23.00
  assert(contents.includes("2431372E30302A")); // $17.00* in the partial appendix row
});

Deno.test("component subtotal zero is known while an entirely unknown component stays unavailable", () => {
  const zero = summarizeSalesReportPdfRows([{net_sales_cents:null,net_sales_known_cents:0}]);
  assertEquals(zero.netSalesCents, null);
  assertEquals(formatKnownSalesReportSubtotal(zero.knownNetSalesCents, zero.knownNetContributorRowCount!), "$0.00");
  const unknown = summarizeSalesReportPdfRows([{net_sales_cents:null,net_sales_known_cents:null}]);
  assertEquals(formatKnownSalesReportSubtotal(unknown.knownNetSalesCents, unknown.knownNetContributorRowCount!), "Unavailable");
});

Deno.test("sales report export preserves recorded, refund, and after-refund totals", () => {
  const summary = summarizeSalesReportPdfRows([
    {
      period_start: "2026-09-01",
      payment_method: "credit",
      gross_sales_cents: 40_500,
      refund_amount_cents: 2_700,
      net_sales_cents: 37_800,
      transaction_count: 40,
    },
    {
      period_start: "2026-09-01",
      payment_method: "cash",
      gross_sales_cents: 10_000,
      refund_amount_cents: 0,
      net_sales_cents: 10_000,
      transaction_count: 10,
    },
  ]);

  assertEquals({
    grossSalesCents: summary.grossSalesCents,
    refundAmountCents: summary.refundAmountCents,
    netSalesCents: summary.netSalesCents,
    transactionCount: summary.transactionCount,
  }, {
    grossSalesCents: 50_500,
    refundAmountCents: 2_700,
    netSalesCents: 47_800,
    transactionCount: 50,
  });
});

Deno.test("PDF distinguishes no known contributor from independently known zero", () => {
  const unknown = {net_sales_cents:null,gross_sales_cents:null,refund_amount_cents:null,tax_cents:null};
  const allUnknown = summarizeSalesReportPdfRows([unknown]);
  assertEquals(allUnknown.netSalesCents, null);
  assertEquals(allUnknown.knownNetRowCount, 0);
  assertEquals(formatKnownSalesReportSubtotal(allUnknown.knownNetSalesCents, allUnknown.knownNetRowCount), "Unavailable");
  assertEquals(formatKnownSalesReportSubtotal(allUnknown.knownRefundAmountCents, allUnknown.knownRefundRowCount, true), "Unavailable");
  const zero = {net_sales_cents:0,gross_sales_cents:0,refund_amount_cents:0,tax_cents:0};
  const completeZero = summarizeSalesReportPdfRows([zero]);
  assertEquals(completeZero.netSalesCents, 0);
  assertEquals(formatKnownSalesReportSubtotal(completeZero.knownNetSalesCents, completeZero.knownNetRowCount), "$0.00");
  const partialZero = summarizeSalesReportPdfRows([unknown,zero]);
  assertEquals(partialZero.netSalesCents, null);
  assertEquals(partialZero.knownNetRowCount, 1);
  assertEquals(formatKnownSalesReportSubtotal(partialZero.knownNetSalesCents, partialZero.knownNetRowCount), "$0.00");
});

Deno.test("sales report export keeps refund-only unknown rows", () => {
  const summary = summarizeSalesReportPdfRows([
    {
      period_start: "2026-09-02",
      payment_method: "unknown",
      gross_sales_cents: 0,
      refund_amount_cents: 500,
      net_sales_cents: -500,
      transaction_count: 0,
    },
  ]);

  assertEquals({
    grossSalesCents: summary.grossSalesCents,
    refundAmountCents: summary.refundAmountCents,
    netSalesCents: summary.netSalesCents,
    transactionCount: summary.transactionCount,
  }, {
    grossSalesCents: 0,
    refundAmountCents: 500,
    netSalesCents: -500,
    transactionCount: 0,
  });
});

Deno.test("sales report export does not present known-only money as a complete total", () => {
  const summary = summarizeSalesReportPdfRows([
    {
      calculation_version: "shared-sales-basis-v1",
      gross_sales_cents: 10_000,
      refund_amount_cents: 1_000,
      net_sales_cents: 9_000,
      tax_cents: 1_000,
    },
    {
      calculation_version: "shared-sales-basis-v1",
      gross_sales_cents: null,
      refund_amount_cents: null,
      net_sales_cents: null,
      tax_cents: null,
      unresolved_sales_count: 1,
      unresolved_sales_cents: 1_000,
    },
  ]);

  assertEquals(summary.grossSalesCents, null);
  assertEquals(summary.refundAmountCents, null);
  assertEquals(summary.netSalesCents, null);
  assertEquals(summary.taxCents, null);
  assertEquals(summary.knownGrossSalesCents, 10_000);
  assertEquals(summary.knownRefundAmountCents, 1_000);
  assertEquals(summary.knownNetSalesCents, 9_000);
  assertEquals(summary.knownTaxCents, 1_000);

  const [machine] = buildMachineRollups([
    {
      machine_label: "Mixed basis machine",
      gross_sales_cents: 10_000,
      refund_amount_cents: 1_000,
      net_sales_cents: 9_000,
    },
    {
      machine_label: "Mixed basis machine",
      gross_sales_cents: null,
      refund_amount_cents: null,
      net_sales_cents: null,
    },
  ]);
  assertEquals(
    formatMachineRollupCurrency(
      machine.grossSalesCents,
      machine.grossValueCount,
      machine.rowCount,
    ),
    "$100.00*",
  );
});
