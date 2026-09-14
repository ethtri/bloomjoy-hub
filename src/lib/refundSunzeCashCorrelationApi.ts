import { invokeEdgeFunction } from '@/lib/edgeFunctions';
import {
  parseRefundSunzeCashCorrelation,
  type RefundSunzeCashCorrelation,
} from '@/lib/refundSunzeCashCorrelation';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isInteger = (value: unknown, minimum = 0): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;

export const fetchRefundSunzeCashCorrelation = async (
  caseId: string,
  signal?: AbortSignal,
): Promise<RefundSunzeCashCorrelation> => {
  if (!UUID.test(caseId)) throw new Error('A valid cash refund case is required.');
  const result = await invokeEdgeFunction<{
    correlation?: unknown;
    payloadRedacted?: boolean;
  }>(
    'refund-case-sunze-correlation',
    { operation: 'read', caseId, candidateLimit: 8 },
    { requireUserAuth: true, signal },
  );
  if (result.payloadRedacted !== true || !result.correlation) {
    throw new Error('Cash sales history returned an invalid response.');
  }
  return parseRefundSunzeCashCorrelation(result.correlation);
};

export const selectRefundSunzeCashCandidate = async (input: {
  caseId: string;
  attemptId: string;
  salesFactId: string;
  caseFactVersion: number;
  expectedLinkVersion: number;
}) => {
  if (!UUID.test(input.caseId) || !UUID.test(input.attemptId) || !UUID.test(input.salesFactId) ||
    !isInteger(input.caseFactVersion, 1) || !isInteger(input.expectedLinkVersion)) {
    throw new Error('Current cash evidence is required to select a sale.');
  }
  const result = await invokeEdgeFunction<{
    selection?: unknown;
    payloadRedacted?: boolean;
  }>(
    'refund-case-sunze-correlation',
    { operation: 'select', ...input },
    { requireUserAuth: true },
  );
  if (result.payloadRedacted !== true || !isRecord(result.selection)) {
    throw new Error('Cash sale selection returned an invalid response.');
  }
  return result.selection;
};
