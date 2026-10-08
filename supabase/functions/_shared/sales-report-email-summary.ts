import { formatKnownSalesReportSubtotal, formatSalesReportEstimateSplit, type SalesReportPdfSummary } from "./sales-report-pdf.ts";

/** The email uses the same confirmed subtotals and incremental estimates as its PDF. */
export const buildSalesReportEmailSummary = (summary: SalesReportPdfSummary, calculationVersion: string): string[] => {
  const hasEstimates = (summary.provisionalSalesComponents ?? 0) + (summary.provisionalRefundComponents ?? 0) + (summary.provisionalNetComponents ?? 0) > 0;
  const metric = (complete: number | null, known: number, contributors: number, estimated: number | null | undefined, remaining: number, refund = false) => {
    if (hasEstimates) return formatSalesReportEstimateSplit(complete ?? (contributors > 0 ? known : null), estimated ?? null, refund, remaining);
    return `${complete === null ? "Known subtotal " : ""}${formatKnownSalesReportSubtotal(complete ?? known, complete === null ? contributors : 1, refund)}`;
  };
  const lines = [
    `${calculationVersion === "shared-sales-basis-v1" ? "Sales before refunds" : "Gross sales"}: ${metric(summary.grossSalesCents, summary.knownGrossSalesCents, summary.knownGrossContributorRowCount ?? summary.knownGrossRowCount, summary.estimatedSalesExTaxCents, summary.unestimatedSalesComponents ?? 0)}`,
    `Refund impact: ${metric(summary.refundAmountCents, summary.knownRefundAmountCents, summary.knownRefundContributorRowCount ?? summary.knownRefundRowCount, summary.estimatedRefundExTaxCents, summary.unestimatedRefundComponents ?? 0, true)}`,
    `Net sales: ${metric(summary.netSalesCents, summary.knownNetSalesCents, summary.knownNetContributorRowCount ?? summary.knownNetRowCount, summary.estimatedNetExTaxCents, summary.unestimatedNetComponents ?? 0)}`,
  ];
  if (calculationVersion === "shared-sales-basis-v1") lines.push(
    `Tax deducted from sales: ${summary.taxCents === null ? "Known subtotal " : ""}${formatKnownSalesReportSubtotal(summary.taxCents ?? summary.knownTaxCents, summary.taxCents === null ? summary.knownTaxRowCount : 1)}`,
    `Paid in period: ${formatKnownSalesReportSubtotal(summary.refundPaidContextCents, 1)}`,
    `Outstanding requested: ${formatKnownSalesReportSubtotal(summary.refundOutstandingContextCents, 1)}`,
  );
  if (hasEstimates) lines.push("Provisional estimates are separate from confirmed amounts and do not authorize payouts.", `Still unestimated components: sales ${summary.unestimatedSalesComponents ?? 0}; refunds ${summary.unestimatedRefundComponents ?? 0}; net ${summary.unestimatedNetComponents ?? 0}.`);
  if (summary.unresolvedSalesCount + summary.unresolvedRefundCount > 0) lines.push(`Unresolved source records: sales ${summary.unresolvedSalesCount}; refunds ${summary.unresolvedRefundCount}. See the PDF for details.`);
  return lines;
};
