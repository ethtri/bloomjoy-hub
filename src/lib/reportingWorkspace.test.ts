/// <reference lib="deno.ns" />
import { alignedTrend, comparisonRange, defaultWorkspaceState, knownMoney, parseSavedViews, periodChange, readWorkspaceState, reportingPeriods, salesGroups, writeWorkspaceState } from './reportingWorkspace.ts';
import type { SalesReportRow } from './reporting.ts';
const equal = (actual: unknown, expected: unknown) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); };
const row = (patch: Partial<SalesReportRow> = {}): SalesReportRow => ({ calculationVersion: 'shared-sales-basis-v1', periodStart: '2026-09-01', machineId: 'a', machineLabel: 'Machine A', locationId: 'north', locationName: 'North', paymentMethod: 'credit', netSalesCents: 1000, grossSalesCents: 1200, refundAmountCents: 200, taxCents: 90, refundRequestDeductionCents: 200, refundReversalCents: 0, refundLegacyPaidDeductionCents: 0, refundPaidContextCents: 0, refundOutstandingContextCents: 200, unresolvedSalesCount: 0, unresolvedSalesCents: 0, unresolvedRefundCount: 0, unresolvedRefundCents: 0, unresolvedPaidContextCount: 0, unresolvedPaidContextCents: 0, transactionCount: 2, ...patch });
Deno.test('complete-day and week presets cross DST without losing a business date', () => {
  const periods = reportingPeriods(new Date(2026, 2, 9, 12));
  const range = (id: string) => { const value = periods.find(item => item.id === id)!; return [value.dateFrom, value.dateTo]; };
  equal(range('last_7'), ['2026-03-02', '2026-03-08']);
  equal(range('last_week'), ['2026-03-02', '2026-03-08']);
  equal(range('this_week'), ['2026-03-09', '2026-03-09']);
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
Deno.test('no prior rows and zero/negative denominators never fabricate percent growth', () => {
  equal(periodChange(1000, null), { absolute: null, percent: null }); equal(periodChange(1000, 0), { absolute: 1000, percent: null }); equal(periodChange(1000, -200), { absolute: 1200, percent: null });
});
Deno.test('nullable totals keep known subtotal separate and empty source unknown', () => {
  equal(knownMoney([row(), row({ netSalesCents: null })], 'netSalesCents'), { value: null, knownValue: 1000, omittedRows: 1 });
  equal(knownMoney([], 'netSalesCents'), { value: null, knownValue: 0, omittedRows: 0 });
  equal(knownMoney([row({ netSalesCents: 0 })], 'netSalesCents').value, 0);
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
Deno.test('saved view malformed storage cannot introduce arbitrary states', () => {
  equal(parseSavedViews('not json'), []); equal(parseSavedViews('[{"id":"bad","name":"x","state":{"dateFrom":"bad"}}]'), []);
});
