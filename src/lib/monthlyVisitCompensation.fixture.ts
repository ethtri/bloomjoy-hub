/** Synthetic saved-payload fixture shared by renderer and portal tests. */
export function monthlyStatementFixture() {
  const minutes = [120, 35.5, 45];
  const entries = minutes.map((actualMinutes, i) => {
    const actualStartAt = `2025-01-${String(5 + i * 7).padStart(2, '0')}T08:00:00Z`;
    return { id: `synthetic-visit-${i}`, workDate: actualStartAt.slice(0, 10), actualStartAt,
      actualEndAt: new Date(Date.parse(actualStartAt) + actualMinutes * 60000).toISOString(), actualMinutes };
  });
  const current = { actualMinutes: 200.5, paidShifts: 0, shiftEarningsCents: 0, monthlyBaseEarningsCents: 18000,
    extraTimeEarningsCents: 2400, visitUnits: 3, commissionableSalesCents: 10000, commissionEarningsCents: 500,
    bonusCents: 0, supplyCreditCents: 0, expenseReimbursementCents: 0, totalEarningsCents: 20900 };
  return {
    schemaVersion: 'operator-pay-stub-v2' as const, earningsSchemaVersion: 'monthly-visits-v1' as const,
    id: 'synthetic-statement', statementNumber: 'SYNTHETIC-MONTHLY-001', statementLabel: 'Pay Stub',
    status: 'issued' as const, version: 1, issuedAt: '2025-02-05T08:00:00Z', statementDate: '2025-02-05',
    entity: { name: 'Synthetic payer' }, contractor: { displayName: 'Synthetic technician' },
    period: { periodStartDate: '2025-01-01', periodEndDate: '2025-01-31' }, current, yearToDate: { ...current },
    shiftRateLines: [], machines: [{ machineId: 'synthetic-machine', machineLabel: 'Synthetic machine', locationName: 'Synthetic location',
      grossSalesCents: 10000, refundAdjustmentCents: 0, taxCents: 0, commissionableSalesCents: 10000, commissionEarningsCents: 500,
      commissionSegments: [] }],
    monthlyVisitLines: [{ machineId: 'synthetic-machine', machineLabel: 'Synthetic machine',
      agreement: { id: 'synthetic-agreement', operator_profile_id: 'synthetic-profile', reporting_machine_id: 'synthetic-machine',
        effective_start_date: '2025-01-01', effective_end_date: null, monthly_base_cents: 18000, included_visits: 3,
        included_minutes_per_visit: 60, extra_hour_rate_cents: 2400, active: true, revision: 1 },
      evaluation: { calculationStatus: 'ready' as const, actualMinutes: 200.5, visitUnits: 3, extraActualMinutes: 60,
        baseEarningsCents: 18000, extraEarningsCents: 2400, timeEarningsCents: 20400, blockers: [] }, entries }],
    classificationNotice: 'Synthetic contractor statement. No payment execution.',
  };
}
