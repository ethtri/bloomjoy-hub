/// <reference lib="deno.ns" />
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- Deno needs Vite's global ImportMeta declarations when checking the RPC client graph.
/// <reference path="../vite-env.d.ts" />
import { financeReportingCsv, normalizeFinanceReporting, type FinanceReporting, type FinanceReportingRow } from './financeReporting.ts';

const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const row: FinanceReportingRow = {
  machineId: 'machine-1', machineLabel: '=HYPERLINK("private")', locationId: 'location-1', locationName: 'Venue, A',
  recordedSalesCents: 10900, cardRecordedSalesCents: 10900, cashRecordedSalesCents: 0, otherRecordedSalesCents: 0,
  salesExTaxCents: 10000, reportingTaxRemovedCents: 900, requestedDeductionExTaxCents: 1000, reversalExTaxCents: 400,
  legacyPaidDeductionExTaxCents: 100, netSalesExTaxCents: 9300,
  moneyPaidCents: 500, giftPurchaseCents: 1100, giftFaceCents: 1500, goodwillCents: 400,
  requestedCents: 1000, requestCount: 2, asOfOutstandingCents: 0, openRequestCount: 0,
  coverage: { unknownAmountCount: 1, unknownBalanceCount: 1, unknownRequestDateCount: 1,
    unknownPaymentDateCount: 1, unresolvedSalesCount: 0, unresolvedRefundCount: 0, estimatedComponentCount: 1 },
};
const report: FinanceReporting = {
  calculationVersion: 'finance-reporting-v1', generatedAt: '2026-10-02T12:00:00Z', dateFrom: '2026-09-01',
  dateTo: '2026-09-30', dateBasis: 'Machine-local inclusive business dates', rows: [row],
};

Deno.test('Finance normalization preserves negative net, nullable accounting, known zero and coverage', () => {
  const payload = structuredClone(report);
  payload.rows[0].salesExTaxCents = null;
  payload.rows[0].netSalesExTaxCents = -100;
  const parsed = normalizeFinanceReporting(payload);
  assert(parsed.rows[0].salesExTaxCents === null, 'Unknown sales became zero');
  assert(parsed.rows[0].cashRecordedSalesCents === 0, 'Known zero became unavailable');
  assert(parsed.rows[0].netSalesExTaxCents === -100, 'Negative report net lost');
  assert(parsed.rows[0].coverage.unknownBalanceCount === 1, 'Partial outstanding coverage lost');
});

Deno.test('Finance source waterfall preserves unknown gross and separates request accounting from completed payments', () => {
  const payload = structuredClone(report);
  payload.calculationPolicyVersion = 'nayax-source-tax-untaxed-cash-v1';
  Object.assign(payload.rows[0], { grossSalesIncludingTaxCents: null, refundDeductionIncludingTaxCents: 1100,
    remainingTaxCents: null, completedRefundIncludingTaxCents: 0, completedRefundExTaxCents: 0,
    reconciliationNetSalesExTaxCents: 10000 });
  const parsed = normalizeFinanceReporting(payload);
  assert(parsed.rows[0].grossSalesIncludingTaxCents === null, 'Unknown gross was invented from exclusive source totals');
  assert(parsed.rows[0].completedRefundExTaxCents === 0, 'Unpaid request became a completed refund');
  assert(parsed.rows[0].reconciliationNetSalesExTaxCents === 10000 && parsed.rows[0].netSalesExTaxCents === 9300,
    'Completed payment reconciliation overwrote request accounting');
  const csv = financeReportingCsv(parsed, { dateFrom: report.dateFrom, dateTo: report.dateTo });
  assert(csv.includes('Sales including tax (cents)') && csv.includes('Completed refunds excluding tax (cents)'), 'Waterfall is absent from CSV');
  assert(parsed.calculationPolicyVersion === 'nayax-source-tax-untaxed-cash-v1' && csv.includes('nayax-source-tax-untaxed-cash-v1'), 'Corrected export policy is not traceable');
  assert(normalizeFinanceReporting(report).calculationPolicyVersion === 'legacy-unspecified', 'Legacy payload was falsely labeled with the new tax policy');
});

Deno.test('Finance rejects missing, fractional, numeric-string and unsafe cents without silently filling zeros', () => {
  for (const value of [undefined, 1.5, '100', Number.MAX_SAFE_INTEGER + 1]) {
    const payload = structuredClone(report);
    Object.assign(payload.rows[0], { moneyPaidCents: value });
    let rejected = false;
    try { normalizeFinanceReporting(payload); } catch { rejected = true; }
    assert(rejected, `Invalid money accepted: ${value}`);
  }
});

Deno.test('Finance export preserves equation, request/paid/gift distinctions and unavailable accounting', () => {
  const payload = structuredClone(report);
  payload.rows[0].reportingTaxRemovedCents = null;
  const csv = financeReportingCsv(payload, { dateFrom: report.dateFrom, dateTo: report.dateTo, machineIds: ['machine-1'], locationIds: ['location-1'] });
  assert(csv.includes('"Unavailable"'), 'Null accounting was exported as zero');
  assert(csv.includes('"500","1100","1500","400"'), 'Payment, purchase, gift face and goodwill not retained independently');
  assert(csv.includes('"9300"') && csv.includes('later payment or gift does not deduct again'), 'Canonical net semantics lost');
  assert(csv.includes('not proof of tax collected or legally owed'), 'Tax field overclaims evidence');
  assert(csv.includes('not bank settlement') && csv.includes('not gift redemption'), 'Paid or gift provenance overclaimed');
  assert(csv.includes('"Machine filters","machine-1"') && csv.includes('"Location filters","location-1"'), 'Scope metadata missing');
  assert(csv.includes('Recorded card sales (cents)') && csv.includes('Unknown balance count'), 'Headers must use readable finance labels');
});

Deno.test('Finance normalization and explicit export omit added private fields and neutralize formula labels', () => {
  const payload = structuredClone(report);
  Object.assign(payload.rows[0], { customerEmail: 'private@example.invalid', giftCode: 'SECRET-GIFT', issueSummary: 'Private free text' });
  const parsed = normalizeFinanceReporting(payload);
  const csv = financeReportingCsv(parsed, { dateFrom: report.dateFrom, dateTo: report.dateTo });
  assert(!JSON.stringify(parsed).includes('SECRET-GIFT'), 'Unexpected field retained in normalized API');
  assert(!csv.includes('private@example.invalid') && !csv.includes('Private free text'), 'Private fields leaked');
  assert(csv.includes('"\'=HYPERLINK(""private"")"') && csv.includes('"Venue, A"'), 'Formula or quoting protection lost');
});
