export type RefundAnalyticsScope = {
  dateFrom: string;
  dateTo: string;
  machineIds?: string[];
  locationIds?: string[];
};

export type RefundAnalytics = {
  calculationVersion: 'refund-analytics-v1';
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  dateBasis: string;
  machineCount: number;
  cohort: {
    requestCount: number; requestedCents: number; unknownAmountCount: number;
    resolvedCashCents: number; resolvedGiftPurchaseCents: number; outstandingCents: number;
  };
  period: {
    cashPaidCents: number; giftPurchaseCents: number; giftFaceCents: number; goodwillCents: number;
    requestDeductionExTaxCents: number | null; reversalExTaxCents: number | null;
    legacyPaidDeductionExTaxCents: number | null; unresolvedAccountingCount: number;
  };
  asOf: { outstandingCents: number; openRequestCount: number; unknownBalanceCount: number };
  coverage: { unknownRequestDateCount: number; unknownPaymentDateCount: number };
  machines: {
    machineId: string; machineLabel: string; locationId: string; locationName: string; requestCount: number;
    requestedCents: number; unknownAmountCount: number; outstandingCents: number; unknownBalanceCount: number;
  }[];
  categories: { category: string; requestCount: number; requestedCents: number; unknownAmountCount: number }[];
  aging: { band: string; requestCount: number; outstandingCents: number; unknownBalanceCount: number }[];
};

export function validateRefundAnalyticsScope(scope: RefundAnalyticsScope): void {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(scope.dateFrom) || !validDate(scope.dateTo)
    || scope.dateFrom > scope.dateTo
    || (Date.parse(scope.dateTo) - Date.parse(scope.dateFrom)) / 86400000 > 366) {
    throw new Error('Choose a valid reporting period of up to 367 days.');
  }
}

export type RefundAnalyticsAccess = {
  hasAccess: boolean;
  dimensions: { machineId: string; machineLabel: string; locationId: string; locationName: string }[];
};

export async function fetchRefundAnalyticsAccess(): Promise<RefundAnalyticsAccess> {
  const { supabaseClient } = await import('@/lib/supabaseClient');
  const { data, error } = await supabaseClient.rpc('get_refund_analytics_access');
  if (error) throw error;
  return { hasAccess: data?.hasAccess === true, dimensions: Array.isArray(data?.dimensions) ? data.dimensions : [] };
}

export async function fetchRefundAnalytics(scope: RefundAnalyticsScope): Promise<RefundAnalytics> {
  validateRefundAnalyticsScope(scope);
  const { supabaseClient } = await import('@/lib/supabaseClient');
  const { data, error } = await supabaseClient.rpc('get_refund_analytics', {
    p_date_from: scope.dateFrom, p_date_to: scope.dateTo,
    p_machine_ids: scope.machineIds ?? null, p_location_ids: scope.locationIds ?? null,
  });
  if (error) throw error;
  if (data?.calculationVersion !== 'refund-analytics-v1') {
    throw new Error('Refund analytics returned an unsupported calculation version.');
  }
  return data as RefundAnalytics;
}

// Explicit column selection prevents future payload additions leaking into exports.
// Neutralize spreadsheet formulas in machine/location labels, including leading whitespace.
function csvCell(value: string | number | null): string {
  const text = value === null ? 'Unavailable' : String(value);
  const safe = /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function refundAnalyticsCsv(report: RefundAnalytics, scope: RefundAnalyticsScope): string {
  const metrics = (basis: string, values: Record<string, number | null>, keys: string[]) =>
    keys.map(key => [basis, key, values[key], key.endsWith('Cents') ? 'USD cents' : 'count']);
  const rows: (string | number | null)[][] = [
    ['Refund analytics', report.calculationVersion], ['Generated at', report.generatedAt],
    ['Date from', report.dateFrom], ['Date through', report.dateTo], ['Date basis', report.dateBasis],
    ['Machine filters', (scope.machineIds ?? []).join(' | ') || 'All authorized'],
    ['Location filters', (scope.locationIds ?? []).join(' | ') || 'All authorized'],
    ['Coverage', 'Known partial totals; missing amounts/history are omitted, not zero. Cash dates are recorded accounting dates, not bank settlement.'],
    ['Basis', 'Metric', 'Value', 'Unit'],
    ...metrics('Request cohort', report.cohort, ['requestCount', 'requestedCents', 'unknownAmountCount', 'resolvedCashCents', 'resolvedGiftPurchaseCents', 'outstandingCents']),
    ...metrics('Period activity', report.period, ['cashPaidCents', 'giftPurchaseCents', 'giftFaceCents', 'goodwillCents', 'requestDeductionExTaxCents', 'reversalExTaxCents', 'legacyPaidDeductionExTaxCents', 'unresolvedAccountingCount']),
    ...metrics('As of period end', report.asOf, ['outstandingCents', 'openRequestCount', 'unknownBalanceCount']),
    ...metrics('Coverage', report.coverage, ['unknownRequestDateCount', 'unknownPaymentDateCount']),
    [], ['Machine', 'Location', 'Cohort requests', 'Requested cents', 'Unknown cohort amounts', 'As-of outstanding cents', 'Unknown balances'],
    ...report.machines.map(m => [m.machineLabel, m.locationName, m.requestCount, m.requestedCents, m.unknownAmountCount, m.outstandingCents, m.unknownBalanceCount]),
    [], ['Category', 'Cohort requests', 'Requested cents', 'Unknown amounts'],
    ...report.categories.map(c => [c.category, c.requestCount, c.requestedCents, c.unknownAmountCount]),
    [], ['Age at period end', 'Requests', 'Outstanding cents', 'Unknown balances'],
    ...report.aging.map(a => [a.band, a.requestCount, a.outstandingCents, a.unknownBalanceCount]),
  ];
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
