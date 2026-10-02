import { personas, operatorDimensions, rpcResponse, fixedNowIso } from './validate-reporting-uat.mjs';

export const workspacePersonas = {
  ...personas,
  timeOnly: { ...personas.baseline, id: '00000000-0000-4000-9000-000000001698', email: 'time-only@example.invalid', capabilities: ['timekeeping.review'] },
  refundOnly: { ...personas.baseline, id: '00000000-0000-4000-9000-000000001576', email: 'refund-only@example.invalid', capabilities: ['refunds.manage'] },
};
export const domainDimensions = operatorDimensions.map(row => ({ machineId: row.machine_id, machineLabel: row.machine_label, locationId: row.location_id, locationName: row.location_name }));

export function workspaceRpcResponse(name, persona, body = {}, freshness = 'fresh') {
  const canLabor = persona.isSuperAdmin || persona.id === workspacePersonas.timeOnly.id;
  const canRefunds = persona.isSuperAdmin || persona.id === workspacePersonas.refundOnly.id;
  const selected = domainDimensions.filter(row => (!body.p_machine_ids || body.p_machine_ids.includes(row.machineId)) && (!body.p_location_ids || body.p_location_ids.includes(row.locationId)));
  if (name === 'get_my_time_report_access') return canLabor;
  if (name === 'get_labor_analytics_access') return { hasAccess: canLabor, canViewPay: persona.isSuperAdmin, dimensions: canLabor ? domainDimensions : [] };
  if (name === 'get_refund_analytics_access') return { hasAccess: canRefunds, dimensions: canRefunds ? domainDimensions : [] };
  if (name === 'get_labor_analytics_report') return {
    access: { hasAccess: canLabor, canViewPay: persona.isSuperAdmin }, dateFrom: body.p_date_from, dateTo: body.p_date_to,
    generatedAt: fixedNowIso, calculationVersion: 'labor-analytics-v1',
    dateBasis: 'Persisted location-local work date; inclusive bounds. Pacific statement cutoff is separate.',
    rows: canLabor ? selected.map((row, index) => ({ ...row, week: '2026-07-20', entryCount: index ? 2 : 3, actualMinutes: index ? 125 : 60, paidShifts: index ? 3 : 3 })) : [],
    pay: persona.isSuperAdmin ? { shiftEarningsCents: 12000, commissionEarningsCents: 750, unallocatedOtherEarningsCents: body.p_machine_ids || body.p_location_ids ? null : 0,
      missingShiftRateEntries: 0, calculationIssueCount: 0, readyCalculationCount: 0, revisionRequiredCount: 0, publishedStatementCount: 0, partialMonthCalculationCount: 2,
      coverage: 'Canonical estimates for selected dates. Other earnings are unallocated. Fleet sales are not derived from technician sales.',
      statementBasis: 'Calculation readiness for selected dates. Publication is not payment.' } : null,
  };
  if (name === 'get_refund_analytics') return {
    calculationVersion: 'refund-analytics-v1', generatedAt: fixedNowIso, dateFrom: body.p_date_from, dateTo: body.p_date_to,
    dateBasis: 'Request cohorts use local received dates. Cash activity uses recorded accounting dates. Balances are as of the selected end date.',
    machineCount: canRefunds ? selected.length : 0,
    cohort: { requestCount: 4, requestedCents: 6000, unknownAmountCount: 1, resolvedCashCents: 1000, resolvedGiftPurchaseCents: 1500, outstandingCents: 3500 },
    period: { cashPaidCents: 2000, giftPurchaseCents: 1500, giftFaceCents: 2000, goodwillCents: 500, requestDeductionExTaxCents: 5500, reversalExTaxCents: 500, legacyPaidDeductionExTaxCents: 0, unresolvedAccountingCount: 1 },
    asOf: { outstandingCents: 3500, openRequestCount: 2, unknownBalanceCount: 1 },
    coverage: { unknownRequestDateCount: 0, unknownPaymentDateCount: 1 },
    machines: canRefunds ? selected.map(row => ({ ...row, requestCount: 2, requestedCents: 3000, unknownAmountCount: 0, outstandingCents: 1750, unknownBalanceCount: 0 })) : [],
    categories: [{ category: 'product_issue', requestCount: 3, requestedCents: 4500, unknownAmountCount: 0 }, { category: 'unclassified', requestCount: 1, requestedCents: 1500, unknownAmountCount: 1 }],
    aging: [{ band: '0–7 days', requestCount: 1, outstandingCents: 1500, unknownBalanceCount: 0 }, { band: '8–30 days', requestCount: 1, outstandingCents: 2000, unknownBalanceCount: 0 }],
  };
  if (name === 'get_sales_report') {
    const records = rpcResponse(name, persona, body, freshness);
    return records.map(row => ({ ...row, calculation_version: 'shared-sales-basis-v1', tax_cents: 0,
      refund_request_deduction_cents: row.refund_amount_cents, refund_reversal_cents: 0 }));
  }
  return rpcResponse(name, persona, body, freshness);
}
