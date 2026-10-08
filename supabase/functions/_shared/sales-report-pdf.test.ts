import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMachineRollups,
  formatMachineRollupCurrency,
  formatKnownSalesReportSubtotal,
  summarizeSalesReportPdfRows,
} from "./sales-report-pdf.ts";

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
