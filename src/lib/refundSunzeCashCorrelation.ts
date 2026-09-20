export type RefundSunzeCashMatchState =
  | 'checking_sales_history'
  | 'sale_found'
  | 'multiple_possible_sales'
  | 'no_sale_found_with_complete_coverage'
  | 'sales_history_unavailable';

export type RefundSunzeCashCandidate = {
  salesFactId: string;
  rank: number;
  paymentTime: string;
  amountCents: number;
  actualAmountCents: number;
  timeDeltaSeconds: number;
  amountDeltaCents: number | null;
  evidenceCodes: string[];
  selectionConflict: boolean;
  machineLabel: string | null;
  locationName: string | null;
  tradeLabel: string | null;
};

export type RefundSunzeCashSelectedSale = {
  salesFactId: string;
  paymentTime: string;
  actualAmountCents: number;
  machineLabel: string | null;
  locationName: string | null;
  tradeLabel: string | null;
};

export type RefundSunzeCashSelectionPending = {
  operationId: string;
  afterDataUpdatedAt: number;
  recoveryAvailable: boolean;
};

export const refundSunzeCashSelectionOperationOwnsMarker = (
  pending: RefundSunzeCashSelectionPending | null | undefined,
  operationId: string,
) => pending?.operationId === operationId;

export const refundSunzeCashSelectionRefreshIsAuthoritative = (
  pending: RefundSunzeCashSelectionPending | null | undefined,
  dataUpdatedAt: number,
  hasAuthoritativeData: boolean,
) => Boolean(
  pending &&
  pending.recoveryAvailable &&
  hasAuthoritativeData &&
  Number.isSafeInteger(dataUpdatedAt) &&
  dataUpdatedAt > pending.afterDataUpdatedAt
);

export type RefundSunzeCashCorrelation = {
  caseFactVersion: number;
  attemptId: string | null;
  policyVersion: 'sunze_cash_correlation_v1' | null;
  state: RefundSunzeCashMatchState;
  reason: string | null;
  sourceReadiness:
    | 'correlation_pending'
    | 'stale'
    | 'awaiting_coverage'
    | 'unavailable'
    | 'complete_coverage';
  coverageStartedAt: string | null;
  coveredThrough: string | null;
  freshnessExpiresAt: string | null;
  evaluatedAt: string | null;
  candidateCount: number;
  returnedCandidateCount: number;
  candidatesTruncated: boolean;
  candidates: RefundSunzeCashCandidate[];
  selectedSalesFactId: string | null;
  selectedLinkVersion: number;
  expectedLinkVersion: number;
  selectedSale: RefundSunzeCashSelectedSale | null;
  evidenceOnly: true;
};

type CorrelationRecord = Record<string, unknown>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const correlationStates = new Set<RefundSunzeCashMatchState>([
  'checking_sales_history',
  'sale_found',
  'multiple_possible_sales',
  'no_sale_found_with_complete_coverage',
  'sales_history_unavailable',
]);

const readinessStates = new Set<RefundSunzeCashCorrelation['sourceReadiness']>([
  'correlation_pending',
  'stale',
  'awaiting_coverage',
  'unavailable',
  'complete_coverage',
]);

const isRecord = (value: unknown): value is CorrelationRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isInteger = (value: unknown, minimum = 0): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;

const optionalIso = (value: unknown): string | null =>
  value === null || value === undefined
    ? null
    : typeof value === 'string' && !Number.isNaN(Date.parse(value))
    ? value
    : (() => { throw new Error('Unsupported Sunze cash correlation timestamp.'); })();

const optionalText = (value: unknown): string | null =>
  value === null || value === undefined
    ? null
    : typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : (() => { throw new Error('Unsupported Sunze cash correlation label.'); })();

const parseCandidate = (value: unknown): RefundSunzeCashCandidate => {
  const candidateKeys = new Set([
    'salesFactId', 'rank', 'paymentTime', 'amountCents', 'actualAmountCents',
    'timeDeltaSeconds', 'amountDeltaCents', 'evidenceCodes', 'selectionConflict',
    'machineLabel', 'locationName', 'tradeLabel',
  ]);
  if (!isRecord(value) ||
    !Object.keys(value).every((key) => candidateKeys.has(key)) ||
    typeof value.salesFactId !== 'string' || !UUID.test(value.salesFactId) ||
    !isInteger(value.rank, 1) ||
    typeof value.paymentTime !== 'string' || Number.isNaN(Date.parse(value.paymentTime)) ||
    !isInteger(value.amountCents) || !isInteger(value.actualAmountCents) ||
    !isInteger(value.timeDeltaSeconds) ||
    !(value.amountDeltaCents === null || isInteger(value.amountDeltaCents)) ||
    !Array.isArray(value.evidenceCodes) ||
    !value.evidenceCodes.every((code) => typeof code === 'string' && code.length <= 80) ||
    typeof value.selectionConflict !== 'boolean') {
    throw new Error('Unsupported Sunze cash correlation candidate.');
  }
  return {
    salesFactId: value.salesFactId,
    rank: value.rank,
    paymentTime: value.paymentTime,
    amountCents: value.amountCents,
    actualAmountCents: value.actualAmountCents,
    timeDeltaSeconds: value.timeDeltaSeconds,
    amountDeltaCents: value.amountDeltaCents === null ? null : Number(value.amountDeltaCents),
    evidenceCodes: value.evidenceCodes,
    selectionConflict: value.selectionConflict,
    machineLabel: optionalText(value.machineLabel),
    locationName: optionalText(value.locationName),
    tradeLabel: optionalText(value.tradeLabel),
  };
};

const parseSelectedSale = (value: unknown): RefundSunzeCashSelectedSale | null => {
  if (value === null || value === undefined) return null;
  const selectedSaleKeys = new Set([
    'salesFactId', 'paymentTime', 'actualAmountCents', 'machineLabel',
    'locationName', 'tradeLabel',
  ]);
  if (!isRecord(value) ||
    !Object.keys(value).every((key) => selectedSaleKeys.has(key)) ||
    typeof value.salesFactId !== 'string' || !UUID.test(value.salesFactId) ||
    typeof value.paymentTime !== 'string' || Number.isNaN(Date.parse(value.paymentTime)) ||
    !isInteger(value.actualAmountCents)) {
    throw new Error('Unsupported selected Sunze cash sale.');
  }
  return {
    salesFactId: value.salesFactId,
    paymentTime: value.paymentTime,
    actualAmountCents: value.actualAmountCents,
    machineLabel: optionalText(value.machineLabel),
    locationName: optionalText(value.locationName),
    tradeLabel: optionalText(value.tradeLabel),
  };
};

export const parseRefundSunzeCashCorrelation = (value: unknown): RefundSunzeCashCorrelation => {
  const responseKeys = new Set([
    'caseFactVersion', 'attemptId', 'policyVersion', 'state', 'reason', 'sourceReadiness',
    'coverageStartedAt', 'coveredThrough', 'freshnessExpiresAt', 'evaluatedAt',
    'candidateCount', 'returnedCandidateCount', 'candidatesTruncated', 'candidates',
    'selectedSalesFactId', 'selectedLinkVersion', 'expectedLinkVersion', 'selectedSale',
    'evidenceOnly',
  ]);
  if (!isRecord(value) ||
    !Object.keys(value).every((key) => responseKeys.has(key)) ||
    !isInteger(value.caseFactVersion, 1) ||
    !(value.attemptId === null || typeof value.attemptId === 'string' && UUID.test(value.attemptId)) ||
    !(value.policyVersion === null || value.policyVersion === 'sunze_cash_correlation_v1') ||
    typeof value.state !== 'string' || !correlationStates.has(value.state as RefundSunzeCashMatchState) ||
    !(value.reason === null || typeof value.reason === 'string') ||
    typeof value.sourceReadiness !== 'string' || !readinessStates.has(value.sourceReadiness as RefundSunzeCashCorrelation['sourceReadiness']) ||
    !isInteger(value.candidateCount) || !isInteger(value.returnedCandidateCount) ||
    typeof value.candidatesTruncated !== 'boolean' || !Array.isArray(value.candidates) ||
    value.candidates.length !== value.returnedCandidateCount ||
    value.returnedCandidateCount > value.candidateCount ||
    !value.candidates.every((candidate) => {
      try { parseCandidate(candidate); return true; } catch { return false; }
    }) ||
    !(value.selectedSalesFactId === null || typeof value.selectedSalesFactId === 'string' && UUID.test(value.selectedSalesFactId)) ||
    !isInteger(value.selectedLinkVersion) || !isInteger(value.expectedLinkVersion) ||
    !(value.selectedSale === null || isRecord(value.selectedSale)) ||
    value.evidenceOnly !== true) {
    throw new Error('Unsupported Sunze cash correlation response.');
  }

  if (
    value.selectedSalesFactId !== null &&
    (!isRecord(value.selectedSale) || value.selectedSale.salesFactId !== value.selectedSalesFactId)
  ) {
    throw new Error('Selected Sunze cash sale does not match its active link.');
  }

  return {
    caseFactVersion: value.caseFactVersion,
    attemptId: value.attemptId === null ? null : String(value.attemptId),
    policyVersion: value.policyVersion === null ? null : 'sunze_cash_correlation_v1',
    state: value.state as RefundSunzeCashMatchState,
    reason: value.reason === null ? null : String(value.reason),
    sourceReadiness: value.sourceReadiness as RefundSunzeCashCorrelation['sourceReadiness'],
    coverageStartedAt: optionalIso(value.coverageStartedAt),
    coveredThrough: optionalIso(value.coveredThrough),
    freshnessExpiresAt: optionalIso(value.freshnessExpiresAt),
    evaluatedAt: optionalIso(value.evaluatedAt),
    candidateCount: value.candidateCount,
    returnedCandidateCount: value.returnedCandidateCount,
    candidatesTruncated: value.candidatesTruncated,
    candidates: value.candidates.map(parseCandidate),
    selectedSalesFactId: value.selectedSalesFactId === null ? null : String(value.selectedSalesFactId),
    selectedLinkVersion: value.selectedLinkVersion,
    expectedLinkVersion: value.expectedLinkVersion,
    selectedSale: parseSelectedSale(value.selectedSale),
    evidenceOnly: true,
  };
};
