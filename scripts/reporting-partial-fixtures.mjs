import { companyRpcResponse } from './company-reporting-fixtures.mjs';
import { operatorDimensions } from './validate-reporting-uat.mjs';

// Synthetic contributors reproduce incident totals, without production identities.
// This is UI coverage, not a representative database performance benchmark.
export function partialReportingRows() {
  return Array.from({ length: 225 }, (_, index) => {
    const unknown = index >= 135; const unresolvedIndex = index - 135;
    const source = operatorDimensions[index % operatorDimensions.length];
    const stamp = new Date('2026-09-30T00:00:00Z'); stamp.setUTCDate(stamp.getUTCDate() + index % 7);
    const net = unknown ? null : index === 134 ? 10347 : 4500;
    const unresolvedSales = unknown ? unresolvedIndex < 58 ? 6 : 5 : 0;
    return { ...source, period_start: stamp.toISOString().slice(0, 10), calculation_version: 'shared-sales-basis-v1',
      payment_method: unknown || index % 2 ? 'credit' : 'cash', net_sales_cents: net, gross_sales_cents: net,
      refund_amount_cents: unknown && unresolvedIndex < 5 ? null : 0, tax_cents: unknown ? null : 0,
      transaction_count: unknown ? unresolvedSales : index < 133 ? 4 : 0,
      refund_request_deduction_cents: 0, refund_reversal_cents: 0, refund_legacy_paid_deduction_cents: 0,
      refund_paid_context_cents: 0, refund_outstanding_context_cents: 0,
      unresolved_sales_count: unresolvedSales, unresolved_sales_cents: unresolvedSales * 1000,
      unresolved_refund_count: unknown && unresolvedIndex < 5 ? 1 : 0,
      unresolved_refund_cents: unknown && unresolvedIndex < 5 ? 1000 : 0,
      unresolved_paid_context_count: 0, unresolved_paid_context_cents: 0 };
  });
}
export function partialReportingRpcResponse(name, persona, body = {}, freshness) {
  if (name === 'get_sales_report' || name === 'get_company_sales_report' || name === 'get_sales_report_complete') {
    if (!persona.hasReportingAccess) return [];
    return partialReportingRows().filter(row => row.period_start >= body.p_date_from && row.period_start <= body.p_date_to
      && (!body.p_machine_ids?.length || body.p_machine_ids.includes(row.machine_id))
      && (!body.p_location_ids?.length || body.p_location_ids.includes(row.location_id))
      && (!body.p_payment_methods?.length || body.p_payment_methods.includes(row.payment_method)));
  }
  return companyRpcResponse(name, persona, body, freshness);
}
