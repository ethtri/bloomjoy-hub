/// <reference lib="deno.ns" />
import { moneyCoverage, moneyCoverageText, refundImpactMoney, unresolvedComponents, alignedTrend, operationalReportHref, workspaceViews, comparisonRange, defaultWorkspaceState, knownMoney, parseSavedViews, periodChange, readWorkspaceState, reportingPeriods, salesGroups, writeWorkspaceState } from './reportingWorkspace.ts';
import type { SalesReportRow } from './reporting.ts';
const equal = (actual: unknown, expected: unknown) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); };
const row = (patch: Partial<SalesReportRow> = {}): SalesReportRow => ({ calculationVersion: 'shared-sales-basis-v1', periodStart: '2026-09-01', machineId: 'a', machineLabel: 'Machine A', locationId: 'north', locationName: 'North', paymentMethod: 'credit', netSalesCents: 1000, grossSalesCents: 1200, refundAmountCents: 200, taxCents: 90, refundRequestDeductionCents: 200, refundReversalCents: 0, refundLegacyPaidDeductionCents: 0, refundPaidContextCents: 0, refundOutstandingContextCents: 200, unresolvedSalesCount: 0, unresolvedSalesCents: 0, unresolvedRefundCount: 0, unresolvedRefundCents: 0, unresolvedPaidContextCount: 0, unresolvedPaidContextCents: 0, transactionCount: 2, ...patch });
Deno.test('Provisional display adds disjoint estimates once while authoritative totals stay unavailable', () => {
  const rows = [row(), row({ grossSalesCents: null, netSalesCents: null, refundAmountCents: null, grossSalesKnownCents: 500, netSalesKnownCents: 400, refundAmountKnownCents: 100, taxPolicyEvidence: { status: 'provisional', estimatedSalesExTaxCents: 1000, estimatedRefundExTaxCents: 200, estimatedNetExTaxCents: 800, provisionalSalesComponents: 1, provisionalRefundComponents: 1, provisionalNetComponents: 2 } })];
  const total = moneyCoverage(rows);
  equal([total.value, total.displayValue, total.estimatedValue, total.withEstimates], [null, 1400, 800, 2200]);
  equal(moneyCoverageText(total), '$22.00 including estimates');
  equal(knownMoney(rows, 'netSalesCents').value, null);
  equal(moneyCoverage(rows, 'customerReceiptsCents').estimatedValue, null);
});
Deno.test('A mixed estimate keeps unestimated components unavailable and zero or negative amounts do not imply completeness', () => {
  const mixed = row({ netSalesCents: null, netSalesKnownCents: 0, netSalesUnknownCount: 4, grossSalesCents: null, grossSalesKnownCents: 0, grossSalesUnknownCount: 3, refundAmountCents: null, refundAmountKnownCents: 0, refundAmountUnknownCount: 1, taxPolicyEvidence: { status: 'provisional', estimatedSalesExTaxCents: 0, estimatedRefundExTaxCents: 200, estimatedNetExTaxCents: -200, provisionalSalesComponents: 1, provisionalRefundComponents: 1, provisionalNetComponents: 2 } });
  const net = moneyCoverage([mixed]);
  equal([net.displayValue, net.estimatedValue, net.withEstimates, net.remainingUnknownComponents], [0, -200, -200, 2]);
  equal(moneyCoverageText(net), '-$2.00 subtotal including estimates');
  equal(moneyCoverage([mixed], 'grossSalesCents').remainingUnknownComponents, 2);
  equal(moneyCoverage([mixed], 'refundAmountCents').remainingUnknownComponents, 0);
});
Deno.test('complete-day and week presets cross DST without losing a business date', () => {
  const periods = reportingPeriods(new Date(2026, 2, 9, 12));
  const range = (id: string) => { const value = periods.find(item => item.id === id)!; return [value.dateFrom, value.dateTo]; };
  equal(range('last_7'), ['2026-03-02', '2026-03-08']);
  equal(range('last_week'), ['2026-03-02', '2026-03-08']);
  equal(range('this_week'), ['2026-03-09', '2026-03-09']);
});
Deno.test('new workspace defaults to seven completed local calendar days across boundaries', () => {
  for (const [now, dates] of [
    [new Date(2026, 9, 2, 12), ['2026-09-25', '2026-10-01']],
    [new Date(2026, 0, 1, 12), ['2025-12-25', '2025-12-31']],
    [new Date(2026, 2, 9, 12), ['2026-03-02', '2026-03-08']],
    [new Date(2024, 2, 1, 12), ['2024-02-23', '2024-02-29']],
  ] as const) {
    const state = defaultWorkspaceState(now);
    equal([state.dateFrom, state.dateTo], dates);
    equal(state.comparison, 'previous_period');
  }
});
Deno.test('month and year presets handle leap years and January rollover', () => {
  const march = reportingPeriods(new Date(2024, 2, 1, 12));
  const february = march.find(item => item.id === 'last_month')!;
  equal([february.dateFrom, february.dateTo], ['2024-02-01', '2024-02-29']);
  equal(march.some(item => item.id === 'month_complete'), false);
  const year = reportingPeriods(new Date(2025, 0, 1, 12)).find(item => item.id === 'last_year')!;
  equal([year.dateFrom, year.dateTo], ['2024-01-01', '2024-12-31']);
});
Deno.test('workspace filters round trip without losing unrelated URL parameters', () => {
  const state = { ...defaultWorkspaceState(new Date('2026-10-01T12:00:00Z')), view: 'locations' as const, machineId: 'a', locationId: 'north', paymentMethod: 'credit' as const };
  const params = writeWorkspaceState(state, new URLSearchParams('source=bookmark'));
  equal(readWorkspaceState(params), state); equal(params.get('source'), 'bookmark');
});
Deno.test('invalid dates and legacy routes normalize predictably', () => {
  const defaults = defaultWorkspaceState(new Date('2026-10-01T12:00:00Z'));
  equal(readWorkspaceState(new URLSearchParams('from=2026-02-30&to=2026-03-01&view=operator'), defaults).dateFrom, defaults.dateFrom);
  equal(readWorkspaceState(new URLSearchParams('view=partner'), defaults).view, 'partners');
});
Deno.test('prior equal-length windows retain inclusive duration across DST', () => {
  equal(comparisonRange({ dateFrom: '2026-03-08', dateTo: '2026-03-14', comparison: 'previous_period' }), { dateFrom: '2026-03-01', dateTo: '2026-03-07', days: 7, shortened: false });
});
Deno.test('month-to-date uses same elapsed days and marks shorter prior months', () => {
  equal(comparisonRange({ dateFrom: '2026-09-01', dateTo: '2026-09-12', comparison: 'previous_month' }), { dateFrom: '2026-08-01', dateTo: '2026-08-12', days: 12, shortened: false });
  equal(comparisonRange({ dateFrom: '2026-03-01', dateTo: '2026-03-31', comparison: 'previous_month' }), { dateFrom: '2026-02-01', dateTo: '2026-02-28', days: 28, shortened: true });
});
Deno.test('prior-year ranges preserve calendar dates across the year boundary', () => {
  equal(comparisonRange({ dateFrom: '2026-09-25', dateTo: '2026-10-01', comparison: 'previous_year' }), { dateFrom: '2025-09-25', dateTo: '2025-10-01', days: 7, shortened: false });
  equal(comparisonRange({ dateFrom: '2026-12-29', dateTo: '2027-01-04', comparison: 'previous_year' }), { dateFrom: '2025-12-29', dateTo: '2026-01-04', days: 7, shortened: false });
});
Deno.test('prior-year leap windows never establish equal-duration comparisons with missing calendar dates', () => {
  equal(comparisonRange({ dateFrom: '2024-02-28', dateTo: '2024-03-01', comparison: 'previous_year' }), { dateFrom: '2023-02-28', dateTo: '2023-03-01', days: 2, shortened: true });
  equal(comparisonRange({ dateFrom: '2025-02-28', dateTo: '2025-03-01', comparison: 'previous_year' }), { dateFrom: '2024-02-28', dateTo: '2024-03-01', days: 3, shortened: true });
  equal(comparisonRange({ dateFrom: '2024-02-29', dateTo: '2024-02-29', comparison: 'previous_year' }), { dateFrom: '2023-02-28', dateTo: '2023-02-28', days: 1, shortened: true });
  equal(comparisonRange({ dateFrom: '2024-02-29', dateTo: '2024-03-01', comparison: 'previous_year' }), { dateFrom: '2023-02-28', dateTo: '2023-03-01', days: 2, shortened: true });
});
Deno.test('explicit URL and saved periods preserve dates and prior-year comparison', () => {
  const state = { ...defaultWorkspaceState(new Date(2026, 9, 2)), dateFrom: '2024-01-01', dateTo: '2024-12-31', comparison: 'previous_year' as const };
  equal(readWorkspaceState(new URLSearchParams('from=2024-01-01&to=2024-12-31&compare=previous_year')), state);
  equal(parseSavedViews(JSON.stringify([{ id: 'historical', name: 'Historical year', state }]))[0].state, state);
});
Deno.test('no prior rows and zero/negative denominators never fabricate percent growth', () => {
  equal(periodChange(1000, null), { absolute: null, percent: null }); equal(periodChange(1000, 0), { absolute: 1000, percent: null }); equal(periodChange(1000, -200), { absolute: 1200, percent: null });
});
Deno.test('nullable totals keep known subtotal separate and empty source unknown', () => {
  equal(knownMoney([row(), row({ netSalesCents: null })], 'netSalesCents'), { value: null, knownValue: 1000, omittedRows: 1 });
  equal(knownMoney([], 'netSalesCents'), { value: null, knownValue: 0, omittedRows: 0 });
  equal(knownMoney([row({ netSalesCents: 0 })], 'netSalesCents').value, 0);
});
Deno.test('partial daily amounts keep the subtotal, complete total and independent transactions distinct', () => {
  const rows = [row({ netSalesCents: 613347, transactionCount: 532 }), row({ netSalesCents: null, taxCents: null, transactionCount: 508, unresolvedSalesCount: 508, unresolvedRefundCount: 5 })];
  const coverage = moneyCoverage(rows);
  equal([coverage.value, coverage.displayValue, coverage.omittedRows, coverage.status], [null, 613347, 1, 'partial']);
  equal(moneyCoverageText(coverage), '$6,133.47 (known subtotal)');
  const trend = alignedTrend(rows, [], '2026-09-01', '2026-09-02');
  equal([trend[0].current, trend[0].currentKnown, trend[0].transactions], [null, 613347, 1040]);
  equal([trend[1].currentKnown, trend[1].currentCoverage.status], [null, 'empty']);
  equal(unresolvedComponents(rows), { sales: 508, refunds: 5, taxRows: 1 });
  equal(salesGroups(rows, [row()], 'machine')[0].change.absolute, null);
});
Deno.test('no calculable rows cannot display a zero subtotal; a known zero remains valid', () => {
  const unknown = moneyCoverage([row({ netSalesCents: null })]);
  equal([unknown.displayValue, unknown.status, moneyCoverageText(unknown)], [null, 'partial', 'Unavailable']);
  equal(moneyCoverage([]).displayValue, null);
  equal(moneyCoverage([row({ netSalesCents: 0 })]).displayValue, 0);
  equal(moneyCoverage([row({ netSalesCents: 0 }), row({ netSalesCents: null })]).displayValue, 0);
});
Deno.test('refund subtotals preserve canonical signs and present deductions, reversals and zero consistently', () => {
  for (const [amount, text] of [[1000, '-$10.00'], [-1000, '+$10.00'], [0, '$0.00']] as const) {
    const coverage = moneyCoverage([row({ refundAmountCents: amount }), row({ refundAmountCents: null })], 'refundAmountCents');
    equal(coverage.value, null); equal(coverage.knownValue, amount);
    equal(moneyCoverageText(coverage, refundImpactMoney), `${text} (known subtotal)`);
  }
  equal(refundImpactMoney(null), 'Unavailable');
});
Deno.test('cohort separates unmatched records without treating absence as zero', () => {
  const groups = salesGroups([row(), row({ machineId: 'new', netSalesCents: 500 })], [row({ netSalesCents: 800 }), row({ machineId: 'old' })], 'machine');
  equal(groups.find(item => item.id === 'a')?.change.absolute, 200);
  equal(groups.find(item => item.id === 'new')?.cohort, 'current_only'); equal(groups.find(item => item.id === 'new')?.previous, null);
  equal(groups.find(item => item.id === 'old')?.cohort, 'previous_only');
});
Deno.test('trend gaps remain null with explicit elapsed comparison dates', () => {
  const trend = alignedTrend([row()], [row({ periodStart: '2026-08-01', netSalesCents: 500 })], '2026-09-01', '2026-09-03', '2026-08-01');
  equal(trend.length, 3); equal(trend[0].previous, 500); equal(trend[1].current, null); equal(trend[1].priorDate, '2026-08-02');
});
Deno.test('prior-year trend uses matching dates and leaves leap day unavailable without shifting March', () => {
  const prior = [row({ periodStart: '2023-02-28', netSalesCents: 500 }), row({ periodStart: '2023-03-01', netSalesCents: 600 })];
  const trend = alignedTrend([], prior, '2024-02-28', '2024-03-01', '2023-02-28', 'previous_year');
  equal(trend.map(item => [item.priorDate, item.previous]), [['2023-02-28', 500], [null, null], ['2023-03-01', 600]]);
  const nonLeap = alignedTrend([], [row({ periodStart: '2024-02-29', netSalesCents: 500 }), row({ periodStart: '2024-03-01', netSalesCents: 600 })], '2025-02-28', '2025-03-01', '2024-02-28', 'previous_year');
  equal(nonLeap.map(item => [item.priorDate, item.previous]), [['2024-02-28', null], ['2024-03-01', 600]]);
});
Deno.test('a machine without prior-year history remains unavailable and not comparable', () => {
  const groups = salesGroups([row()], [], 'machine');
  equal(groups[0].previous, null); equal(groups[0].previousTransactions, null);
  equal(groups[0].change, { absolute: null, percent: null });
  const trend = alignedTrend([row()], [], '2026-09-01', '2026-09-01', '2025-09-01', 'previous_year');
  equal(trend[0].previous, null); equal(knownMoney([], 'netSalesCents').value, null);
});
Deno.test('saved view malformed storage cannot introduce arbitrary states', () => {
  equal(parseSavedViews('not json'), []); equal(parseSavedViews('[{"id":"bad","name":"x","state":{"dateFrom":"bad"}}]'), []);
});

Deno.test('central navigation lists only business reporting destinations', () => {
  equal(workspaceViews, ['overview', 'sales', 'machines', 'finance', 'locations', 'partners']);
  equal(readWorkspaceState(new URLSearchParams('view=labor')).view, 'labor');
  equal(readWorkspaceState(new URLSearchParams('view=refunds')).view, 'refunds');
});
Deno.test('operational report links preserve explicit scope and omit sales-only controls', () => {
  const linked = new URLSearchParams('view=labor&from=2026-02-30&to=2026-03-01&machine=a&location=north&tender=credit&compare=previous_year');
  equal(operationalReportHref('labor', linked), '/portal/time-review?view=reports&from=2026-02-30&to=2026-03-01&location=north&machine=a');
  equal(operationalReportHref('refunds', { dateFrom: '2026-09-01', dateTo: '2026-09-07', locationId: 'all', machineId: 'a' }), '/refunds?view=reports&from=2026-09-01&to=2026-09-07&machine=a');
});
