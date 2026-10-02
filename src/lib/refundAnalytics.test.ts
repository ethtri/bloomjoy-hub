import { refundAnalyticsCsv, validateRefundAnalyticsScope, type RefundAnalytics } from './refundAnalytics.ts';

const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const report: RefundAnalytics = {
  calculationVersion: 'refund-analytics-v1', generatedAt: '2026-10-01T12:00:00Z',
  dateFrom: '2026-09-01', dateTo: '2026-09-30', dateBasis: 'Machine-local inclusive dates', machineCount: 1,
  cohort: { requestCount: 2, requestedCents: 2100, unknownAmountCount: 1, resolvedCashCents: 1000, resolvedGiftPurchaseCents: 1100, outstandingCents: 0 },
  period: { cashPaidCents: 1000, giftPurchaseCents: 1100, giftFaceCents: 1500, goodwillCents: 400, requestDeductionExTaxCents: 2100, reversalExTaxCents: 0, legacyPaidDeductionExTaxCents: 0, unresolvedAccountingCount: 1 },
  asOf: { outstandingCents: 0, openRequestCount: 0, unknownBalanceCount: 1 },
  coverage: { unknownRequestDateCount: 1, unknownPaymentDateCount: 1 },
  machines: [{ machineId: 'authorized-machine', machineLabel: '=HYPERLINK("evil")', locationId: 'authorized-location', locationName: 'Venue, A', requestCount: 2, requestedCents: 2100, unknownAmountCount: 1, outstandingCents: 0, unknownBalanceCount: 1 }],
  categories: [{ category: 'other', requestCount: 2, requestedCents: 2100, unknownAmountCount: 1 }],
  aging: [{ band: 'Unknown request date', requestCount: 1, outstandingCents: 0, unknownBalanceCount: 1 }],
};

Deno.test('refund CSV matches visible cents, retains unknowns and separate time bases', () => {
  const csv = refundAnalyticsCsv(report, { dateFrom: report.dateFrom, dateTo: report.dateTo, machineIds: ['authorized-machine'] });
  assert(csv.includes('"Request cohort","requestedCents","2100","USD cents"'), 'Cohort cents changed');
  assert(csv.includes('"Period activity","giftFaceCents","1500","USD cents"'), 'Gift face lost');
  assert(csv.includes('"Period activity","goodwillCents","400","USD cents"'), 'Goodwill lost');
  assert(csv.includes('"As of period end","unknownBalanceCount","1","count"'), 'Unknown balance hidden');
  assert(csv.includes('authorized-machine'), 'Scope filters missing');
  assert(csv.includes('refund-analytics-v1') && csv.includes(report.generatedAt), 'Calculation metadata missing');
});

Deno.test('refund CSV selects safe columns and escapes spreadsheet formula labels', () => {
  const payload = structuredClone(report);
  Object.assign(payload.cohort, { customerEmail: 'private@example.invalid', cardLast4: '1234' });
  Object.assign(payload.machines[0], { issueSummary: 'Private free text', customerEmail: 'private@example.invalid' });
  const csv = refundAnalyticsCsv(payload, { dateFrom: report.dateFrom, dateTo: report.dateTo });
  assert(!csv.includes('private@example.invalid') && !csv.includes('Private free text') && !csv.includes('1234'), 'Private unexpected fields leaked');
  assert(csv.includes('"\'=HYPERLINK(""evil"")"'), 'Spreadsheet formula not neutralized');
  assert(csv.includes('"Venue, A"'), 'Comma not quoted');
});

Deno.test('inclusive refund period accepts leap dates and rejects invalid or unbounded dates', () => {
  validateRefundAnalyticsScope({ dateFrom: '2024-02-29', dateTo: '2024-02-29' });
  for (const [dateFrom, dateTo] of [['2026-02-29', '2026-03-01'], ['2026-09-30', '2026-09-01'], ['2025-01-01', '2026-03-01']]) {
    let rejected = false;
    try { validateRefundAnalyticsScope({ dateFrom, dateTo }); } catch { rejected = true; }
    assert(rejected, `Invalid period accepted: ${dateFrom} / ${dateTo}`);
  }
});
/// <reference lib="deno.ns" />
