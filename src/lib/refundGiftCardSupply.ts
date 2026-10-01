export type RefundGiftCardSupplyPool = {
  id: string; provider: string; currency: string; faceValueCents: number;
  expiresAt: string; enabled: boolean; eligibleLocations: string[];
  usableCount: number; expiredCount: number; minAvailable: number | null;
  targetAvailable: number | null; maxBatchSize: number | null; configured: boolean;
  lastCheckAt: string | null; lastReason: string | null; refillState: string;
};

export const requireRefundGiftCardSupply = (value: unknown): RefundGiftCardSupplyPool[] => {
  const result = value as { pools?: RefundGiftCardSupplyPool[]; payloadRedacted?: boolean } | null;
  if (result?.payloadRedacted !== true || !Array.isArray(result.pools)) throw new Error('Gift card supply is temporarily unavailable.');
  return result.pools.map((pool) => {
    if (typeof pool.id !== 'string' || typeof pool.provider !== 'string' || !/^[A-Z]{3}$/.test(pool.currency) ||
        !Number.isSafeInteger(pool.faceValueCents) || pool.faceValueCents <= 0 ||
        !Number.isFinite(Date.parse(pool.expiresAt)) || typeof pool.enabled !== 'boolean' ||
        !Array.isArray(pool.eligibleLocations) || !pool.eligibleLocations.every((item) => typeof item === 'string') ||
        !Number.isSafeInteger(pool.usableCount) || pool.usableCount < 0 || !Number.isSafeInteger(pool.expiredCount) || pool.expiredCount < 0 ||
        typeof pool.configured !== 'boolean' || typeof pool.refillState !== 'string' ||
        ![pool.minAvailable, pool.targetAvailable, pool.maxBatchSize].every((item) => item === null || Number.isSafeInteger(item))) {
      throw new Error('Gift card supply is temporarily unavailable.');
    }
    // Keep only display facts; credentials, private codes and raw provider configuration never enter this view.
    return { id: pool.id, provider: pool.provider, currency: pool.currency, faceValueCents: pool.faceValueCents,
      expiresAt: pool.expiresAt, enabled: pool.enabled, eligibleLocations: [...pool.eligibleLocations],
      usableCount: pool.usableCount, expiredCount: pool.expiredCount, minAvailable: pool.minAvailable,
      targetAvailable: pool.targetAvailable, maxBatchSize: pool.maxBatchSize, configured: pool.configured,
      lastCheckAt: pool.lastCheckAt, lastReason: pool.lastReason, refillState: pool.refillState };
  });
};

export const refundGiftCardSupplyStatus = (pool: RefundGiftCardSupplyPool) => {
  if (!pool.configured) return 'Supply setup is incomplete';
  if (!pool.enabled) return 'Supply is being set up';
  if (pool.refillState === 'unknown') return 'Replenishment result is being checked';
  if (pool.refillState === 'failed') return 'Automatic replenishment needs attention';
  if (['preparing', 'submitting'].includes(pool.refillState)) return 'Automatic replenishment is in progress';
  if (pool.usableCount === 0) return 'Waiting for automatic replenishment';
  if (pool.usableCount < (pool.minAvailable ?? 0)) return 'Automatic replenishment is due';
  return 'Automatic replenishment is ready';
};
