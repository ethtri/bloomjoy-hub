/// <reference lib="deno.ns" />
import { laborAnalyticsCsv, laborAnalyticsTotals } from './laborAnalyticsModel.ts';
import type { LaborAnalyticsReport } from './laborAnalyticsModel.ts';

const row = { machineId: 'machine', machineLabel: '=HYPERLINK("bad")', locationId: 'location', locationName: 'Synthetic location', week: '2026-07-06', entryCount: 1, actualMinutes: 20, paidShifts: 1 };
const fixture: LaborAnalyticsReport = { access: { hasAccess: true, canViewPay: false }, dateFrom: '2026-07-01', dateTo: '2026-07-31', generatedAt: '2026-08-01T00:00:00Z', dateBasis: 'Location-local work dates', calculationVersion: 'v1', rows: [row], pay: null };
function equal(actual: unknown, expected: unknown) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
Deno.test('three independently rounded short entries retain one actual hour and three shifts', () => equal(laborAnalyticsTotals([row,row,row]), { actualMinutes: 60, paidShifts: 3, entryCount: 3 }));
Deno.test('empty recorded effort is a count, not invented earnings', () => equal(laborAnalyticsTotals([]), { actualMinutes: 0, paidShifts: 0, entryCount: 0 }));
Deno.test('CSV preserves date basis and protects formula labels', () => {
  const csv = laborAnalyticsCsv(fixture);
  if (!csv.includes("'=HYPERLINK") || !csv.includes('Location-local work dates') || !csv.includes('2026-07-31')) throw new Error('Missing export context/protection');
});
Deno.test('CSV refuses unauthorized pay even if a stale payload contains it', () => {
  const report = { ...fixture, pay: { shiftEarningsCents: 987654 } } as LaborAnalyticsReport;
  if (laborAnalyticsCsv(report).includes('987654')) throw new Error('Pay leaked');
});



