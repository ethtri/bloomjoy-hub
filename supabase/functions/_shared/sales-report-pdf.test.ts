import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { summarizeSalesReportPdfRows } from "./sales-report-pdf.ts";

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

  assertEquals(summary, {
    grossSalesCents: 50_500,
    refundAmountCents: 2_700,
    netSalesCents: 47_800,
    transactionCount: 50,
  });
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

  assertEquals(summary, {
    grossSalesCents: 0,
    refundAmountCents: 500,
    netSalesCents: -500,
    transactionCount: 0,
  });
});
