/// <reference lib="deno.ns" />

import { newestPublishedStatements, parsePublishedPayStub, payStubHref, publishedPayAmount, publishedStatementDate } from './publishedPayStub.ts';
import { monthlyStatementFixture } from './monthlyVisitCompensation.fixture.ts';

const equal = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Published Pay Stub assertion failed.');
};

Deno.test('monthly statement preserves saved base, extra, exact time and later-month YTD', () => {
  const saved = monthlyStatementFixture();
  equal(parsePublishedPayStub(saved), saved);
  equal(publishedPayAmount(saved), 20900);
  saved.current = { ...saved.current, actualMinutes: 20, paidShifts: 1, shiftEarningsCents: 2000,
    monthlyBaseEarningsCents: 0, extraTimeEarningsCents: 0, visitUnits: 0, totalEarningsCents: 2500 };
  saved.monthlyVisitLines = [];
  equal(parsePublishedPayStub(saved)?.yearToDate.monthlyBaseEarningsCents, 18000);
});

Deno.test('incomplete, blocked, duplicated or inconsistent monthly details never show a payable amount', () => {
  const invalid = [
    (p: ReturnType<typeof monthlyStatementFixture>) => { p.monthlyVisitLines[0].agreement.included_visits = -3; },
    (p: ReturnType<typeof monthlyStatementFixture>) => { p.monthlyVisitLines[0].entries = []; },
    (p: ReturnType<typeof monthlyStatementFixture>) => { p.monthlyVisitLines[0].entries[1].id = p.monthlyVisitLines[0].entries[0].id; },
    (p: ReturnType<typeof monthlyStatementFixture>) => { p.current.totalEarningsCents++; },
    (p: ReturnType<typeof monthlyStatementFixture>) => { p.monthlyVisitLines[0].entries[0].actualMinutes = 1; },
  ];
  for (const change of invalid) { const p = monthlyStatementFixture(); change(p); equal(parsePublishedPayStub(p), null); equal(publishedPayAmount(p), null); }
  equal(parsePublishedPayStub({ ...monthlyStatementFixture(), earningsSchemaVersion: 'future' }), null);
  equal(parsePublishedPayStub({ ...monthlyStatementFixture(), earningsSchemaVersion: undefined }), null);
  equal(publishedPayAmount({ ...monthlyStatementFixture(), earningsSchemaVersion: undefined }), null);
  equal(publishedPayAmount({ ...fixture(), yearToDate: null }), 14764);
  equal(publishedPayAmount({ ...fixture(), yearToDate: undefined }), 14764);
});
const fixture = () => {
  const totals = { paidShifts: 5, shiftEarningsCents: 12500, commissionableSalesCents: 25455, commissionEarningsCents: 764, bonusCents: 1000, supplyCreditCents: 500, expenseReimbursementCents: 0, totalEarningsCents: 14764 };
  return {
    schemaVersion: 'operator-pay-stub-v2', id: 'published-2', statementNumber: 'SYNTHETIC-002', statementLabel: 'Pay Stub', status: 'issued', version: 2,
    issuedAt: '2026-08-06T10:00:00Z', statementDate: '2026-08-06', entity: { name: 'Synthetic payer' }, contractor: { displayName: 'Synthetic technician' },
    period: { periodStartDate: '2026-07-01', periodEndDate: '2026-07-31' }, current: { ...totals, actualMinutes: 181 }, yearToDate: { ...totals, totalEarningsCents: 45123 },
    machines: [{ machineId: 'm1', machineLabel: 'Synthetic machine', grossSalesCents: 30000, refundAdjustmentCents: 2000, taxCents: 2545, commissionableSalesCents: 25455, commissionEarningsCents: 764, commissionSegments: [] }],
    shiftRateLines: [{ machineLabel: 'Synthetic machine', shiftRateCents: 2500, paidShifts: 5, actualDurationMinutes: 181, shiftEarningsCents: 12500 }],
    classificationNotice: 'Synthetic contractor notice.',
  };
};

Deno.test('published amounts never use a mutable history total or live calculation', () => {
  const saved = fixture();
  const summary = { id: saved.id, totalPayoutCents: 999999 };
  equal(publishedPayAmount(saved), 14764);
  equal(publishedPayAmount(summary), null);
  equal(publishedPayAmount({ currentTotalCents: 888888 }), null);
  summary.totalPayoutCents = 777777;
  equal(publishedPayAmount(saved), 14764);
});

Deno.test('latest is ordered by period, with one current published version per period', () => {
  const statement = (id: string, periodStartDate: string, version: number, status = 'issued') => ({ id, periodStartDate, periodEndDate: `${periodStartDate.slice(0, 7)}-28`, version, status });
  equal(newestPublishedStatements([
    statement('older-recently-revised', '2026-06-01', 7), statement('draft', '2026-08-01', 1, 'draft'),
    statement('superseded', '2026-07-01', 1, 'revised'), statement('current', '2026-07-01', 2), statement('duplicate-old', '2026-07-01', 1),
  ]).map(item => item.id), ['current', 'older-recently-revised']);
});

Deno.test('readable v2 preserves exact saved cents, YTD and machine/rate lines', () => {
  const saved = fixture();
  const parsed = parsePublishedPayStub(saved);
  equal(parsed, saved);
  equal(parsed?.current.actualMinutes, 181);
  equal(parsed?.yearToDate.totalEarningsCents, 45123);
  equal(publishedStatementDate(saved), '2026-08-06');
});

Deno.test('missing or malformed breakdown fields fall back without inventing values', () => {
  const saved = fixture();
  equal(parsePublishedPayStub({ ...saved, yearToDate: null }), null);
  equal(parsePublishedPayStub({ ...saved, current: { ...saved.current, actualMinutes: undefined } }), null);
  equal(parsePublishedPayStub({ ...saved, statementDate: '2026-02-30' }), null);
  equal(parsePublishedPayStub({ ...saved, machines: [{ ...saved.machines[0], taxCents: '2545' }] }), null);
  equal(parsePublishedPayStub({ ...saved, current: { ...saved.current, totalEarningsCents: 1.23 } }), null);
  equal(publishedPayAmount({ ...saved, current: { totalEarningsCents: null } }), null);
});

Deno.test('draft, superseded and unsupported payloads do not expose an inferred amount', () => {
  equal(publishedPayAmount({ ...fixture(), status: 'draft' }), null);
  equal(parsePublishedPayStub({ ...fixture(), status: 'revised' }), null);
  equal(publishedPayAmount({ ...fixture(), schemaVersion: 'imported-pdf' }), null);
  equal(parsePublishedPayStub({ ...fixture(), schemaVersion: 'imported-pdf' }), null);
  equal(publishedStatementDate({ ...fixture(), schemaVersion: 'imported-pdf' }), null);
});

Deno.test('legacy published payload retains authoritative total but has no fabricated v2 detail', () => {
  const legacy = { schemaVersion: 'operator-pay-statement-v1', status: 'issued', totals: { totalPayoutCents: 12345 } };
  equal(publishedPayAmount(legacy), 12345);
  equal(parsePublishedPayStub(legacy), null);
  equal(publishedStatementDate(legacy), null);
});

Deno.test('statement links preserve profile and statement identity within the existing pay route', () => {
  const link = new URL(payStubHref('profile & one', 'statement/two'), 'https://example.invalid');
  equal([link.pathname, link.searchParams.get('profile'), link.searchParams.get('statement'), link.hash], ['/portal/time', 'profile & one', 'statement/two', '#pay-stubs']);
});
