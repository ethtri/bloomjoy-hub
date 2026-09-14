export const SUNZE_CASH_CORRELATION_BATCH_SIZE = 500;
export const SUNZE_CASH_CORRELATION_MAX_BATCHES = 10;

export type SunzeCashCorrelationDrainResult = {
  evaluated: number;
  skipped: number;
  remaining: number | null;
  deferred: boolean;
  batches: number;
};

type CorrelationBatchResponse = { data: unknown; error: unknown };

const boundedCount = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;

export const drainSunzeCashCorrelation = async (
  callBatch: (limit: number) => Promise<CorrelationBatchResponse>,
  maxBatches = SUNZE_CASH_CORRELATION_MAX_BATCHES,
): Promise<SunzeCashCorrelationDrainResult> => {
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 20) {
    throw new Error("Invalid Sunze cash correlation execution bound.");
  }

  let evaluated = 0;
  let skipped = 0;
  let remaining: number | null = null;
  for (let batch = 1; batch <= maxBatches; batch += 1) {
    const { data, error } = await callBatch(SUNZE_CASH_CORRELATION_BATCH_SIZE);
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Unable to continue Sunze cash correlation safely.");
    }
    const result = data as Record<string, unknown>;
    const batchEvaluated = boundedCount(result.evaluated);
    const batchSkipped = boundedCount(result.skipped);
    const batchRemaining = boundedCount(result.remaining);
    if (
      batchEvaluated === null || batchSkipped === null || batchRemaining === null
      || typeof result.hasMore !== "boolean"
      || result.hasMore !== (batchRemaining > 0)
    ) {
      throw new Error("Invalid Sunze cash correlation continuation receipt.");
    }
    evaluated += batchEvaluated;
    skipped += batchSkipped;
    remaining = batchRemaining;
    if (!result.hasMore) {
      return { evaluated, skipped, remaining: 0, deferred: false, batches: batch };
    }
  }

  return { evaluated, skipped, remaining, deferred: true, batches: maxBatches };
};
