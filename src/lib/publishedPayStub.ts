/** Saved statement data only. Never derive published earnings from a live pay report. */
export type PublishedPayTotals = {
  paidShifts: number;
  shiftEarningsCents: number;
  commissionableSalesCents: number;
  commissionEarningsCents: number;
  bonusCents: number;
  supplyCreditCents: number;
  expenseReimbursementCents: number;
  totalEarningsCents: number;
};

export type PublishedPaySegment = {
  segmentStartDate: string | null;
  segmentEndDate: string | null;
  taxRatePercent: number | null;
  commissionBasisPoints: number | null;
  grossSalesCents: number;
  refundAdjustmentCents: number;
  taxCents: number;
  commissionableSalesCents: number;
  commissionEarningsCents: number;
};

export type PublishedPayMachine = Omit<PublishedPaySegment, 'segmentStartDate' | 'segmentEndDate' | 'taxRatePercent' | 'commissionBasisPoints'> & {
  machineId: string;
  machineLabel: string;
  commissionSegments: PublishedPaySegment[];
};

export type PublishedPayShiftLine = {
  machineLabel?: string | null;
  shiftRateCents: number | null;
  paidShifts: number;
  actualDurationMinutes: number;
  shiftEarningsCents: number;
};

/** Matches the fields rendered by the existing pay-stub PDF contract. */
export type PublishedPayStub = {
  schemaVersion: 'operator-pay-stub-v2';
  id: string;
  statementNumber: string;
  statementLabel: string;
  status: 'issued' | 'revised';
  version: number;
  issuedAt: string;
  statementDate: string;
  entity: { name: string; legalName?: string | null };
  contractor: { displayName: string; workerIdentifier?: string | null; positionTitle?: string | null };
  period: { periodStartDate: string; periodEndDate: string };
  current: PublishedPayTotals & { actualMinutes: number };
  yearToDate: PublishedPayTotals;
  machines: PublishedPayMachine[];
  shiftRateLines?: PublishedPayShiftLine[];
  otherEarnings?: Array<{ description: string; amountCents: number }>;
  classificationNotice: string;
};

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const optionalText = (value: unknown) => value == null || typeof value === 'string';
export const isPayDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const totals = (value: unknown): value is PublishedPayTotals & Record<string, unknown> => record(value) && ['paidShifts', 'shiftEarningsCents', 'commissionableSalesCents', 'commissionEarningsCents', 'bonusCents', 'supplyCreditCents', 'expenseReimbursementCents', 'totalEarningsCents'].every(key => integer(value[key]));
const machineAmounts = (value: Record<string, unknown>) => ['grossSalesCents', 'refundAdjustmentCents', 'taxCents', 'commissionableSalesCents', 'commissionEarningsCents'].every(key => integer(value[key]));
const nullableNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));

/** Unsupported/incomplete legacy payloads remain downloadable; missing values are never zero-filled. */
export function parsePublishedPayStub(value: unknown): PublishedPayStub | null {
  if (!record(value) || value.schemaVersion !== 'operator-pay-stub-v2'
    || typeof value.id !== 'string' || value.status !== 'issued' || !integer(value.version)
    || typeof value.statementNumber !== 'string' || typeof value.statementLabel !== 'string'
    || typeof value.issuedAt !== 'string' || !isPayDate(value.statementDate)
    || !record(value.entity) || typeof value.entity.name !== 'string' || !optionalText(value.entity.legalName)
    || !record(value.contractor) || typeof value.contractor.displayName !== 'string'
    || !optionalText(value.contractor.workerIdentifier) || !optionalText(value.contractor.positionTitle)
    || !record(value.period) || !isPayDate(value.period.periodStartDate) || !isPayDate(value.period.periodEndDate)
    || !totals(value.current) || !integer(value.current.actualMinutes) || !totals(value.yearToDate)
    || typeof value.classificationNotice !== 'string' || !Array.isArray(value.machines)) return null;
  if (!value.machines.every(machine => record(machine) && typeof machine.machineId === 'string'
    && typeof machine.machineLabel === 'string' && machineAmounts(machine) && Array.isArray(machine.commissionSegments)
    && machine.commissionSegments.every(segment => record(segment) && machineAmounts(segment)
      && (segment.segmentStartDate === null || isPayDate(segment.segmentStartDate))
      && (segment.segmentEndDate === null || isPayDate(segment.segmentEndDate))
      && nullableNumber(segment.taxRatePercent) && nullableNumber(segment.commissionBasisPoints)))) return null;
  if (value.shiftRateLines !== undefined && (!Array.isArray(value.shiftRateLines) || !value.shiftRateLines.every(line => record(line)
    && optionalText(line.machineLabel) && (line.shiftRateCents === null || integer(line.shiftRateCents))
    && integer(line.paidShifts) && integer(line.actualDurationMinutes) && integer(line.shiftEarningsCents)))) return null;
  if (value.otherEarnings !== undefined && (!Array.isArray(value.otherEarnings) || !value.otherEarnings.every(line => record(line)
    && typeof line.description === 'string' && integer(line.amountCents)))) return null;
  return value as PublishedPayStub;
}

export function publishedPayAmount(value: unknown): number | null {
  if (!record(value) || value.status !== 'issued') return null;
  if (value.schemaVersion === 'operator-pay-stub-v2' && record(value.current) && integer(value.current.totalEarningsCents)) return value.current.totalEarningsCents;
  if (value.schemaVersion === 'operator-pay-statement-v1' && record(value.totals) && integer(value.totals.totalPayoutCents)) return value.totals.totalPayoutCents;
  return null;
}

export function publishedStatementDate(value: unknown): string | null {
  return record(value) && value.schemaVersion === 'operator-pay-stub-v2' && value.status === 'issued' && isPayDate(value.statementDate) ? value.statementDate : null;
}

export function newestPublishedStatements<T extends { id: string; status: string; version: number; periodStartDate: string; periodEndDate: string }>(statements: T[]): T[] {
  const periods = new Set<string>();
  return statements.filter(statement => statement.status === 'issued').slice()
    .sort((a, b) => b.periodStartDate.localeCompare(a.periodStartDate) || b.version - a.version)
    .filter(statement => {
      const period = `${statement.periodStartDate}:${statement.periodEndDate}`;
      if (periods.has(period)) return false;
      periods.add(period);
      return true;
    });
}

export function payStubHref(profileId?: string, statementId?: string) {
  const search = new URLSearchParams();
  if (profileId) search.set('profile', profileId);
  if (statementId) search.set('statement', statementId);
  return `/portal/time${search.size ? `?${search}` : ''}#pay-stubs`;
}
