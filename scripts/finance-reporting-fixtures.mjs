import { fixedNowIso } from './validate-reporting-uat.mjs';
import { domainDimensions, workspaceRpcResponse } from './reporting-workspace-fixtures.mjs';

export function financeFixture(body = {}, { partial = false, empty = false, dimensions = domainDimensions } = {}) {
  const selected = dimensions.filter(row => (!body.p_machine_ids || body.p_machine_ids.includes(row.machineId))
    && (!body.p_location_ids || body.p_location_ids.includes(row.locationId)));
  return {
    calculationVersion: 'finance-reporting-v1', generatedAt: fixedNowIso,
    dateFrom: body.p_date_from, dateTo: body.p_date_to,
    dateBasis: 'Local business dates; requested deductions in recognition period, recorded completions in completion period, outstanding as of period end.',
    rows: empty ? [] : selected.map(dimension => {
      const first = dimension.machineId === domainDimensions[0].machineId;
      return {
        ...dimension,
        recordedSalesCents: first ? 11000 : 5000, cardRecordedSalesCents: first ? 8800 : 3000,
        cashRecordedSalesCents: first ? 2200 : 2000, otherRecordedSalesCents: 0,
        salesExTaxCents: partial && first ? null : first ? 10000 : 5000,
        reportingTaxRemovedCents: partial && first ? null : first ? 1000 : 0,
        requestedDeductionExTaxCents: first ? 1000 : 500, reversalExTaxCents: first ? 200 : 0,
        legacyPaidDeductionExTaxCents: first ? 300 : 0, netSalesExTaxCents: partial && first ? null : first ? 8900 : 4500,
        grossSalesIncludingTaxCents: partial && first ? null : first ? 11000 : 5000,
        refundDeductionIncludingTaxCents: first ? 1210 : 500,
        remainingTaxCents: partial && first ? null : first ? 890 : 0,
        completedRefundExTaxCents: first ? 550 : 200,
        completedRefundIncludingTaxCents: first ? 600 : 200,
        reconciliationNetSalesExTaxCents: partial && first ? null : first ? 9450 : 4800,
        moneyPaidCents: first ? 600 : 200, giftPurchaseCents: first ? 500 : 0,
        giftFaceCents: first ? 1000 : 0, goodwillCents: first ? 500 : 0,
        requestedCents: first ? 1100 : 500, requestCount: 2, asOfOutstandingCents: first ? 400 : 300, openRequestCount: 1,
        coverage: { unknownAmountCount: partial && first ? 1 : 0, unknownBalanceCount: partial && first ? 1 : 0,
          unknownRequestDateCount: 0, unknownPaymentDateCount: partial && first ? 1 : 0,
          unresolvedSalesCount: partial && first ? 1 : 0, unresolvedRefundCount: 0, estimatedComponentCount: 0 },
      };
    }),
  };
}

export function financeRpcResponse(name, persona, body = {}, freshness = 'fresh', options = {}) {
  const allowed = persona.isSuperAdmin === true;
  const dimensions = options.dimensions ?? domainDimensions;
  if (name === 'get_finance_reporting_access') return { hasAccess: allowed, dimensions: allowed ? dimensions : [] };
  if (name === 'get_finance_reporting') return financeFixture(body, options);
  return workspaceRpcResponse(name, persona, body, freshness);
}
