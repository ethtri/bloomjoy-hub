import type { CompanyDimension } from './companyReporting.ts';
import { validateRefundAnalyticsScope } from './refundAnalytics.ts';

export type FinanceReportingScope = {
  companyId?: string; companyName?: string;
  dateFrom: string; dateTo: string; machineIds?: string[]; locationIds?: string[];
};
export type FinanceReportingAccess = {
  hasAccess: boolean;
  dimensions: { machineId: string; machineLabel: string; locationId: string; locationName: string; accountId?: string | null; accountName?: string | null }[];
};
export type FinanceReportingRow = {
  machineId: string; machineLabel: string; locationId: string; locationName: string;
  recordedSalesCents: number; cardRecordedSalesCents: number; cashRecordedSalesCents: number; otherRecordedSalesCents: number;
  salesExTaxCents: number | null; reportingTaxRemovedCents: number | null;
  requestedDeductionExTaxCents: number | null; reversalExTaxCents: number | null;
  legacyPaidDeductionExTaxCents: number | null; netSalesExTaxCents: number | null;
  grossSalesIncludingTaxCents?: number | null; refundDeductionIncludingTaxCents?: number | null;
  remainingTaxCents?: number | null; completedRefundExTaxCents?: number | null;
  completedRefundIncludingTaxCents?: number | null; reconciliationNetSalesExTaxCents?: number | null;
  moneyPaidCents: number; giftPurchaseCents: number; giftFaceCents: number; goodwillCents: number;
  requestedCents: number; requestCount: number; asOfOutstandingCents: number; openRequestCount: number;
  coverage: {
    unknownAmountCount: number; unknownBalanceCount: number; unknownRequestDateCount: number;
    unknownPaymentDateCount: number; unresolvedSalesCount: number; unresolvedRefundCount: number;
    estimatedComponentCount: number;
  };
};
export type FinanceReporting = {
  calculationVersion: 'finance-reporting-v1'; generatedAt: string; companyId?: string; companyName?: string;
  calculationPolicyVersion?: string;
  dateFrom: string; dateTo: string;
  dateBasis: string; rows: FinanceReportingRow[];
};

const moneyKeys = [
  'recordedSalesCents', 'cardRecordedSalesCents', 'cashRecordedSalesCents', 'otherRecordedSalesCents',
  'moneyPaidCents', 'giftPurchaseCents', 'giftFaceCents', 'goodwillCents', 'requestedCents', 'asOfOutstandingCents',
] as const;
const accountingKeys = [
  'salesExTaxCents', 'reportingTaxRemovedCents', 'requestedDeductionExTaxCents', 'reversalExTaxCents',
  'legacyPaidDeductionExTaxCents', 'netSalesExTaxCents',
] as const;
const coverageKeys = [
  'unknownAmountCount', 'unknownBalanceCount', 'unknownRequestDateCount', 'unknownPaymentDateCount',
  'unresolvedSalesCount', 'unresolvedRefundCount', 'estimatedComponentCount',
] as const;
const waterfallKeys = ['grossSalesIncludingTaxCents', 'refundDeductionIncludingTaxCents', 'remainingTaxCents',
  'completedRefundExTaxCents', 'completedRefundIncludingTaxCents', 'reconciliationNetSalesExTaxCents'] as const;
const columnLabels: Record<string, string> = {
  recordedSalesCents: 'Recorded sales (cents)', cardRecordedSalesCents: 'Recorded card sales (cents)',
  cashRecordedSalesCents: 'Recorded cash sales (cents)', otherRecordedSalesCents: 'Recorded other or unknown tender sales (cents)',
  salesExTaxCents: 'Sales excluding reporting tax (cents)', reportingTaxRemovedCents: 'Reporting tax removed (cents)',
  requestedDeductionExTaxCents: 'Requested deductions excluding reporting tax (cents)',
  reversalExTaxCents: 'Reversals excluding reporting tax (cents)',
  legacyPaidDeductionExTaxCents: 'Legacy paid deductions excluding reporting tax (cents)',
  netSalesExTaxCents: 'Net sales excluding reporting tax (cents)', moneyPaidCents: 'Recorded money refunds paid (cents)',
  giftPurchaseCents: 'Gift affected purchase value (cents)', giftFaceCents: 'Gift face value (cents)', goodwillCents: 'Bloomjoy goodwill (cents)',
  requestedCents: 'Request cohort value (cents)', asOfOutstandingCents: 'Known outstanding at period end (cents)',
  unknownAmountCount: 'Unknown cohort amount count', unknownBalanceCount: 'Unknown balance count',
  unknownRequestDateCount: 'Unknown request date count', unknownPaymentDateCount: 'Unknown payment date count',
  unresolvedSalesCount: 'Unresolved sale count', unresolvedRefundCount: 'Unresolved refund accounting count',
  estimatedComponentCount: 'Estimated calculation group count',
  grossSalesIncludingTaxCents: 'Sales including tax (cents)',
  refundDeductionIncludingTaxCents: 'Refund deductions including tax (cents)',
  remainingTaxCents: 'Remaining tax after refund deductions (cents)',
  completedRefundExTaxCents: 'Completed refunds excluding tax (cents)',
  completedRefundIncludingTaxCents: 'Completed refunds including tax (cents)',
  reconciliationNetSalesExTaxCents: 'Sales less completed refunds excluding tax (cents)',
};

// Reject missing/unsafe values instead of converting unavailable money to zero.
// Explicit selection also keeps accidental future private fields out of exports.
export function normalizeFinanceReporting(payload: unknown): FinanceReporting {
  const fail = (): never => { throw new Error('Finance reporting returned an unsupported or incomplete calculation.'); };
  const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail();
  const text = (value: unknown): string => typeof value === 'string' ? value : fail();
  const integer = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) ? value : fail();
  const root = object(payload);
  if (root.calculationVersion !== 'finance-reporting-v1' || !Array.isArray(root.rows)) fail();
  const rows = (root.rows as unknown[]).map(value => {
    const row = object(value);
    const coverage = object(row.coverage);
    return {
      machineId: text(row.machineId), machineLabel: text(row.machineLabel), locationId: text(row.locationId), locationName: text(row.locationName),
      ...Object.fromEntries(moneyKeys.map(key => [key, integer(row[key])])),
      ...Object.fromEntries(accountingKeys.map(key => [key, row[key] === null ? null : integer(row[key])])),
      ...Object.fromEntries(waterfallKeys.map(key => [key, row[key] == null ? null : integer(row[key])])),
      requestCount: integer(row.requestCount), openRequestCount: integer(row.openRequestCount),
      coverage: Object.fromEntries(coverageKeys.map(key => [key, integer(coverage[key])])),
    } as FinanceReportingRow;
  });
  return {
    calculationVersion: 'finance-reporting-v1', generatedAt: text(root.generatedAt),
    calculationPolicyVersion: root.calculationPolicyVersion == null ? 'legacy-unspecified' : text(root.calculationPolicyVersion),
    dateFrom: text(root.dateFrom), dateTo: text(root.dateTo), dateBasis: text(root.dateBasis), rows,
  };
}

export async function fetchFinanceReportingAccess(): Promise<FinanceReportingAccess> {
  const { supabaseClient } = await import('@/lib/supabaseClient');
  const { data, error } = await supabaseClient.rpc('get_finance_reporting_access');
  if (error) throw error;
  return { hasAccess: data?.hasAccess === true, dimensions: Array.isArray(data?.dimensions) ? data.dimensions : [] };
}

export async function fetchFinanceReporting(scope: FinanceReportingScope): Promise<FinanceReporting> {
  validateRefundAnalyticsScope(scope);
  const { supabaseClient } = await import('@/lib/supabaseClient');
  const { data, error } = await supabaseClient.rpc(scope.companyId && scope.companyId !== 'all' ? 'get_company_finance_reporting' : 'get_finance_reporting', {
    ...(scope.companyId && scope.companyId !== 'all' ? { p_company_id: scope.companyId } : {}),
    p_date_from: scope.dateFrom, p_date_to: scope.dateTo,
    p_machine_ids: scope.machineIds ?? null, p_location_ids: scope.locationIds ?? null,
  });
  if (error) throw error;
  return normalizeFinanceReporting(data);
}

function csvCell(value: string | number | null): string {
  const raw = value === null ? 'Unavailable' : String(value);
  const safe = typeof value === 'string' && /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function financeReportingCsv(report: FinanceReporting, scope: FinanceReportingScope, dimensions: CompanyDimension[] = []): string {
  const rows: (string | number | null)[][] = [
    ['Finance reporting', report.calculationVersion], ['Generated at', report.generatedAt],
    ['Calculation policy', report.calculationPolicyVersion ?? 'legacy-unspecified'],
    ['Company', scope.companyName ?? 'All companies'], ['Company ID', scope.companyId ?? 'all'], ['Company basis', 'Current reporting company; historical locations and dates preserved'],
    ['Date from', report.dateFrom], ['Date through', report.dateTo], ['Date basis', report.dateBasis],
    ['Machine filters', (scope.machineIds ?? []).join(' | ') || 'All authorized'],
    ['Location filters', (scope.locationIds ?? []).join(' | ') || 'All authorized'],
    ['Currency', 'USD; all money columns are integer cents'],
    ['Coverage', 'Known partial money, gift and outstanding totals; consult coverage counts. Unavailable accounting stays unavailable.'],
    ['Reporting tax removed', 'Calculation adjustment; not proof of tax collected or legally owed.'],
    ['Money paid', 'Recorded refund payment activity; not bank settlement. Gift issuance is not gift redemption.'],
    ['Net formula', 'Sales excluding reporting tax - requested deduction + reversal - legacy paid deduction; later payment or gift does not deduct again.'],
    [], ['Company ID', 'Current company', 'Machine ID', 'Machine', 'Location ID', 'Location', ...moneyKeys.map(key => columnLabels[key]),
      ...accountingKeys.map(key => columnLabels[key]), ...waterfallKeys.map(key => columnLabels[key]), 'Request cohort count', 'Known open request count', ...coverageKeys.map(key => columnLabels[key])],
    ...report.rows.map(row => [dimensions.find(machine => machine.machineId === row.machineId)?.accountId ?? '', dimensions.find(machine => machine.machineId === row.machineId)?.accountName ?? 'Unassigned company',
      row.machineId, row.machineLabel, row.locationId, row.locationName,
      ...moneyKeys.map(key => row[key]), ...accountingKeys.map(key => row[key]), ...waterfallKeys.map(key => row[key] ?? null), row.requestCount, row.openRequestCount,
      ...coverageKeys.map(key => row.coverage[key]),
    ]),
  ];
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
