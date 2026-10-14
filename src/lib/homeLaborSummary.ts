import type { LaborAnalyticsAccess, LaborAnalyticsReport, LaborAnalyticsScope } from './laborAnalyticsModel';

/** Calendar months are selected in Pacific time; recorded work dates retain their location basis. */
export function homeLaborPeriods(today: string) {
  const [year, month] = today.split('-').map(Number);
  const date = (value: Date) => value.toISOString().slice(0, 10);
  return {
    current: { dateFrom: `${today.slice(0, 7)}-01`, dateTo: date(new Date(Date.UTC(year, month, 0))) },
    previous: {
      dateFrom: date(new Date(Date.UTC(year, month - 2, 1))),
      dateTo: date(new Date(Date.UTC(year, month - 1, 0))),
    },
  };
}

export function homeTimeReportHref(scope: LaborAnalyticsScope) {
  return `/portal/time-review?view=reports&from=${scope.dateFrom}&to=${scope.dateTo}`;
}

export function homePayReportHref(scope: LaborAnalyticsScope, canOpenAdminPay: boolean) {
  return canOpenAdminPay ? `/admin/payouts?month=${scope.dateFrom.slice(0, 7)}` : homeTimeReportHref(scope);
}

export function validateHomeLaborAccess(access: LaborAnalyticsAccess) {
  if (typeof access?.hasAccess !== 'boolean' || typeof access?.canViewPay !== 'boolean') {
    throw new Error('Summary access could not be confirmed. Try again.');
  }
  return access;
}

/** A partial/mismatched response must become a recoverable error, never a false zero. */
export function validateHomeLaborReport(report: LaborAnalyticsReport, scope: LaborAnalyticsScope, kind: 'time' | 'pay') {
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (!report || report.dateFrom !== scope.dateFrom || report.dateTo !== scope.dateTo ||
    typeof report.access?.hasAccess !== 'boolean' || typeof report.access?.canViewPay !== 'boolean' ||
    (kind === 'time' && report.access.hasAccess && (!Array.isArray(report.rows) || !report.rows.every(row =>
      row && count(row.entryCount) && count(row.actualMinutes) && count(row.paidShifts)))) ||
    (kind === 'pay' && report.access.canViewPay && (!report.pay || !count(report.pay.calculationIssueCount) ||
      !count(report.pay.missingShiftRateEntries) || !count(report.pay.revisionRequiredCount)))) {
    throw new Error('The summary response was incomplete. Try again.');
  }
  return report;
}
