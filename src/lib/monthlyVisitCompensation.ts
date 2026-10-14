export type MonthlyVisitAgreement = {
  id: string;
  operator_profile_id: string;
  reporting_machine_id: string;
  effective_start_date: string;
  effective_end_date: string | null;
  monthly_base_cents: number;
  included_visits: number;
  included_minutes_per_visit: number;
  extra_hour_rate_cents: number;
  active: boolean;
  revision: number;
};

export type MonthlyVisitLine = {
  agreement: MonthlyVisitAgreement;
  machineId: string;
  machineLabel: string;
  evaluation: {
    calculationStatus: 'ready' | 'blocked';
    actualMinutes: number;
    visitUnits: number;
    extraActualMinutes: number;
    baseEarningsCents: number | null;
    extraEarningsCents: number | null;
    timeEarningsCents: number | null;
    blockers: Array<{ code: string; message: string }>;
  };
  entries: Array<{ id: string; workDate: string; actualStartAt: string; actualEndAt: string; actualMinutes: number }>;
};

export function monthlyVisitTotals(lines: MonthlyVisitLine[]) {
  const blocked = lines.some(line => line.evaluation.blockers.length > 0
    || line.evaluation.baseEarningsCents === null || line.evaluation.extraEarningsCents === null);
  return {
    monthlyBaseEarningsCents: blocked ? null : lines.reduce((sum, line) => sum + line.evaluation.baseEarningsCents!, 0),
    extraTimeEarningsCents: blocked ? null : lines.reduce((sum, line) => sum + line.evaluation.extraEarningsCents!, 0),
    visitUnits: lines.reduce((sum, line) => sum + line.evaluation.visitUnits, 0),
  };
}

export function monthlyAgreementMoney(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('Enter an amount with no more than two decimal places.');
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents) || cents > 2147483647) throw new Error('Amount is outside the supported range.');
  return cents;
}
