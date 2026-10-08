export type MachineRateStatus = 'provisional' | 'confirmed';
export type MachineRatePeriod = 'past' | 'current' | 'both';
export type MachineRateDraft = {
  ratePercent: string;
  status: MachineRateStatus;
  startsOn: string;
  endsOn: string;
  reason: string;
  evidenceReference: string;
};

export type MachineRatePolicy = {
  id: string;
  ratePercent: number;
  status: MachineRateStatus;
  startsOn: string;
  endsOn: string | null;
  reason: string;
  evidenceReference: string | null;
  createdAt: string;
  createdByLabel: string;
  supersededAt: string | null;
};

export type MachineRatePolicyState = {
  machineId: string;
  asOfDate: string;
  historyStartsOn: string | null;
  revision: string;
  current: {
    ratePercent: number | null;
    status: MachineRateStatus | 'source_verified' | 'unavailable';
    source: string | null;
    label: string;
    startsOn: string | null;
    endsOn: string | null;
  };
  policies: MachineRatePolicy[];
};

export type MachineRateImpactAmounts = {
  knownSalesExTaxCents: number | null;
  knownRefundExTaxCents: number | null;
  unknownSalesComponents: number;
  unknownRefundComponents: number;
  estimatedSalesExTaxCents: number | null;
  estimatedRefundExTaxCents: number | null;
  estimatedNetExTaxCents: number | null;
  provisionalSalesComponents: number;
  provisionalRefundComponents: number;
};

export type MachineRatePreview = {
  previewToken: string;
  expiresAt: string;
  revision: string;
  range: { startsOn: string; endsOn: string | null };
  affectedSalesComponents: number;
  affectedRefundComponents: number;
  preservedActualTaxComponents: number;
  before: MachineRateImpactAmounts;
  after: MachineRateImpactAmounts;
  sourceBehavior: 'provisional_fallback' | 'confirmed_override';
  warnings: string[];
};

export const isMachineRateDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export const machineRateDraftError = (draft: MachineRateDraft): string | null => {
  if (!['provisional', 'confirmed'].includes(draft.status)) return 'Choose provisional or confirmed evidence.';
  if (!draft.ratePercent.trim() || !/^\d+(?:\.\d+)?$/.test(draft.ratePercent.trim())) return 'Enter a tax percentage, such as 9 for 9%.';
  const rate = Number(draft.ratePercent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return 'Enter a tax percentage from 0 to 100.';
  if (!isMachineRateDate(draft.startsOn)) return 'Choose the first purchase date this rate applies to.';
  if (draft.endsOn && (!isMachineRateDate(draft.endsOn) || draft.endsOn < draft.startsOn)) return 'The last purchase date must be on or after the first date.';
  if (!draft.reason.trim()) return 'Explain why this rate is being set.';
  return null;
};

export const machineRateDraftKey = (draft: MachineRateDraft): string => JSON.stringify(draft);

export const applyMachineRatePeriod = (draft: MachineRateDraft, period: MachineRatePeriod, today: string, historyStartsOn: string | null = null): MachineRateDraft => {
  if (!isMachineRateDate(today)) throw new Error('The reporting date is unavailable.');
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (period === 'current') return { ...draft, startsOn: today, endsOn: '' };
  return { ...draft, startsOn: draft.startsOn && draft.startsOn < today ? draft.startsOn : historyStartsOn || '', endsOn: period === 'past' ? yesterday.toISOString().slice(0, 10) : '' };
};

const invalidResponse = (): never => { throw new Error('The tax rate service returned an unsupported response.'); };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalidResponse();
const text = (value: unknown): string => typeof value === 'string' ? value : invalidResponse();
const nullableText = (value: unknown): string | null => value === null ? null : text(value);
const date = (value: unknown): string => typeof value === 'string' && isMachineRateDate(value) ? value : invalidResponse();
const nullableDate = (value: unknown): string | null => value === null ? null : date(value);
const instant = (value: unknown): string => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : invalidResponse();
const count = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalidResponse();
const cents = (value: unknown): number | null => value === null ? null : typeof value === 'number' && Number.isSafeInteger(value) ? value : invalidResponse();
const percent = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : invalidResponse();
const status = (value: unknown): MachineRateStatus => value === 'provisional' || value === 'confirmed' ? value : invalidResponse();

export const parseMachineRatePolicyState = (value: unknown): MachineRatePolicyState => {
  const row = object(value), current = object(row.current);
  if (!Array.isArray(row.policies)) invalidResponse();
  const currentStatus = ['provisional', 'confirmed', 'source_verified', 'unavailable'].includes(String(current.status)) ? current.status as MachineRatePolicyState['current']['status'] : invalidResponse();
  const policies = (row.policies as unknown[]).map(value => {
    const policy = object(value);
    const startsOn = date(policy.startsOn), endsOn = nullableDate(policy.endsOn);
    if (endsOn && endsOn < startsOn) invalidResponse();
    return { id: text(policy.id), ratePercent: percent(policy.ratePercent), status: status(policy.status), startsOn, endsOn, reason: text(policy.reason), evidenceReference: nullableText(policy.evidenceReference), createdAt: instant(policy.createdAt), createdByLabel: text(policy.createdByLabel), supersededAt: policy.supersededAt === null ? null : instant(policy.supersededAt) };
  });
  const ratePercent = current.ratePercent === null ? null : percent(current.ratePercent);
  if ((currentStatus === 'unavailable') !== (ratePercent === null)) invalidResponse();
  return { machineId: text(row.machineId), asOfDate: date(row.asOfDate), historyStartsOn: nullableDate(row.historyStartsOn), revision: text(row.revision), current: { ratePercent, status: currentStatus, source: nullableText(current.source), label: text(current.label), startsOn: nullableDate(current.startsOn), endsOn: nullableDate(current.endsOn) }, policies };
};

const impactAmounts = (value: unknown): MachineRateImpactAmounts => {
  const row = object(value);
  return { knownSalesExTaxCents: cents(row.knownSalesExTaxCents), knownRefundExTaxCents: cents(row.knownRefundExTaxCents), unknownSalesComponents: count(row.unknownSalesComponents), unknownRefundComponents: count(row.unknownRefundComponents), estimatedSalesExTaxCents: cents(row.estimatedSalesExTaxCents), estimatedRefundExTaxCents: cents(row.estimatedRefundExTaxCents), estimatedNetExTaxCents: cents(row.estimatedNetExTaxCents), provisionalSalesComponents: count(row.provisionalSalesComponents), provisionalRefundComponents: count(row.provisionalRefundComponents) };
};

export const parseMachineRatePreview = (value: unknown): MachineRatePreview => {
  const row = object(value), range = object(row.range);
  const startsOn = date(range.startsOn), endsOn = nullableDate(range.endsOn);
  const token = text(row.previewToken);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token) || (endsOn && endsOn < startsOn) || !Array.isArray(row.warnings)) invalidResponse();
  const sourceBehavior = row.sourceBehavior === 'provisional_fallback' || row.sourceBehavior === 'confirmed_override' ? row.sourceBehavior : invalidResponse();
  return { previewToken: token, expiresAt: instant(row.expiresAt), revision: text(row.revision), range: { startsOn, endsOn }, affectedSalesComponents: count(row.affectedSalesComponents), affectedRefundComponents: count(row.affectedRefundComponents), preservedActualTaxComponents: count(row.preservedActualTaxComponents), before: impactAmounts(row.before), after: impactAmounts(row.after), sourceBehavior, warnings: (row.warnings as unknown[]).map(text) };
};

