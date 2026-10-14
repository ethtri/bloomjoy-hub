/// <reference lib="deno.ns" />
import { homeLaborPeriods, homePayReportHref, homeTimeReportHref, validateHomeLaborAccess, validateHomeLaborReport } from './homeLaborSummary.ts';
import type { LaborAnalyticsAccess, LaborAnalyticsReport } from './laborAnalyticsModel.ts';
import { getTodayInTimekeepingZone } from './timekeepingUi.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

Deno.test('Home periods use Pacific calendar month at UTC month rollover', () => {
  equal(homeLaborPeriods(getTodayInTimekeepingZone(new Date('2026-11-01T01:00:00Z'))), {
    current: { dateFrom: '2026-10-01', dateTo: '2026-10-31' },
    previous: { dateFrom: '2026-09-01', dateTo: '2026-09-30' },
  });
  equal(homeLaborPeriods(getTodayInTimekeepingZone(new Date('2026-11-01T07:00:00Z'))), {
    current: { dateFrom: '2026-11-01', dateTo: '2026-11-30' },
    previous: { dateFrom: '2026-10-01', dateTo: '2026-10-31' },
  });
});

Deno.test('Home prior month handles year rollover and leap-year February', () => {
  equal(homeLaborPeriods('2027-01-02').previous, { dateFrom: '2026-12-01', dateTo: '2026-12-31' });
  equal(homeLaborPeriods('2028-03-01').previous, { dateFrom: '2028-02-01', dateTo: '2028-02-29' });
});

Deno.test('Home drilldowns preserve inclusive month and require admin pay destination access', () => {
  const scope = homeLaborPeriods('2026-10-13').previous;
  equal(homeTimeReportHref(scope), '/portal/time-review?view=reports&from=2026-09-01&to=2026-09-30');
  equal(homePayReportHref(scope, false), '/portal/time-review?view=reports&from=2026-09-01&to=2026-09-30');
  equal(homePayReportHref(scope, true), '/admin/payouts?month=2026-09');
});

Deno.test('Home treats missing dates, malformed counts and partial pay as errors, not zero', () => {
  const scope = homeLaborPeriods('2026-10-13').previous;
  const report = {
    ...scope, access: { hasAccess: true, canViewPay: true }, rows: [],
    pay: { calculationIssueCount: 3, missingShiftRateEntries: 2, revisionRequiredCount: 1 },
  } as LaborAnalyticsReport;
  equal(validateHomeLaborReport(report, scope, 'pay').pay?.revisionRequiredCount, 1);
  for (const invalid of [
    null, { ...report, dateFrom: undefined }, { ...report, dateTo: '2026-10-31' },
    { ...report, pay: null }, { ...report, pay: { ...report.pay, revisionRequiredCount: undefined } },
    { ...report, pay: { ...report.pay, calculationIssueCount: -1 } },
  ]) {
    let threw = false;
    try { validateHomeLaborReport(invalid as LaborAnalyticsReport, scope, 'pay'); } catch { threw = true; }
    equal(threw, true);
  }
  let threw = false;
  try { validateHomeLaborReport({ ...report, rows: [{ entryCount: 1, actualMinutes: NaN, paidShifts: 1 }] } as LaborAnalyticsReport, scope, 'time'); } catch { threw = true; }
  equal(threw, true);
});

Deno.test('Revoked report access stays denied even with old pay fields in the response', () => {
  const scope = homeLaborPeriods('2026-10-13').previous;
  const report = { ...scope, access: { hasAccess: false, canViewPay: false }, pay: { revisionRequiredCount: 999 } } as LaborAnalyticsReport;
  equal(validateHomeLaborReport(report, scope, 'pay').access.canViewPay, false);
});

Deno.test('Missing or partial access responses cannot mount Home data queries', () => {
  equal(validateHomeLaborAccess({ hasAccess: false, canViewPay: false }), { hasAccess: false, canViewPay: false });
  for (const value of [null, {}, { hasAccess: true }, { hasAccess: 'true', canViewPay: true }]) {
    let threw = false;
    try { validateHomeLaborAccess(value as LaborAnalyticsAccess); } catch { threw = true; }
    equal(threw, true);
  }
});
