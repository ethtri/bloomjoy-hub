export type LaborAnalyticsScope = { dateFrom: string; dateTo: string; machineIds?: string[]; locationIds?: string[] };
export type LaborAnalyticsAccess = {
  hasAccess: boolean; canViewPay: boolean;
  dimensions?: { machineId: string; machineLabel: string; locationId: string; locationName: string }[];
};
export type LaborAnalyticsRow = {
  machineId: string; machineLabel: string; locationId: string; locationName: string;
  week: string; entryCount: number; actualMinutes: number; paidShifts: number;
};
export type LaborAnalyticsReport = {
  access: LaborAnalyticsAccess; dateFrom: string; dateTo: string; generatedAt: string;
  dateBasis: string; calculationVersion: string; rows: LaborAnalyticsRow[];
  pay: null | {
    shiftEarningsCents: number | null; commissionEarningsCents: number | null;
    missingShiftRateEntries: number; calculationIssueCount: number; readyCalculationCount: number;
    revisionRequiredCount: number; partialMonthCalculationCount: number; publishedStatementCount: number; unallocatedOtherEarningsCents: number | null;
    coverage: string; statementBasis: string;
  };
};

export function laborAnalyticsTotals(rows: LaborAnalyticsRow[]) {
  return rows.reduce((sum, row) => ({
    actualMinutes: sum.actualMinutes + row.actualMinutes,
    paidShifts: sum.paidShifts + row.paidShifts,
    entryCount: sum.entryCount + row.entryCount,
  }), { actualMinutes: 0, paidShifts: 0, entryCount: 0 });
}

/** CSV formula protection applies to all labels and metadata, not only data cells. */
export function laborAnalyticsCsv(report: LaborAnalyticsReport): string {
  const cell = (value: unknown) => {
    let text = String(value ?? 'Unavailable');
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows: unknown[][] = [
    ['Labor analytics', report.dateFrom, report.dateTo],
    ['Generated at', report.generatedAt], ['Calculation version', report.calculationVersion],
    ['Date basis', report.dateBasis],
    ['Coverage', 'Recorded entries only; no entries does not prove no work.'],
    ['Week starting', 'Machine', 'Entries', 'Recorded minutes', 'Recorded hours', 'Paid shifts'],
    ...report.rows.map(row => [row.week, row.machineLabel, row.entryCount, row.actualMinutes, row.actualMinutes / 60, row.paidShifts]),
  ];
  if (report.access.canViewPay && report.pay) rows.push(
    ['Authorized account pay coverage', report.pay.coverage],
    ['Statement basis', report.pay.statementBasis],
    ['Attributable shift earnings cents', report.pay.shiftEarningsCents],
    ['Attributable commission earnings cents', report.pay.commissionEarningsCents],
    ['Unallocated other earnings cents', report.pay.unallocatedOtherEarningsCents],
    ['Missing shift rates', report.pay.missingShiftRateEntries],
    ['Account-scope calculation issues', report.pay.calculationIssueCount],
    ['Account-scope ready calculations', report.pay.readyCalculationCount],
    ['Account-scope partial-month estimates', report.pay.partialMonthCalculationCount],
    ['Account-scope revisions required', report.pay.revisionRequiredCount],
    ['Account-scope published statements', report.pay.publishedStatementCount],
  );
  return rows.map(row => row.map(cell).join(',')).join('\r\n');
}


