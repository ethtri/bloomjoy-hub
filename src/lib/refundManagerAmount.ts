export function parseManagerRefundAmount(value: string, maximumCents?: number | null): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) && cents > 0 && (!maximumCents || cents <= maximumCents) ? cents : null;
}

export const roundedManagerGiftAmount = (cents: number) => Math.ceil(cents / 500) * 500;

export function resolveManagerRefundAmountDraft(draft: { key: string; value: string } | null, key: string, fullAmountCents: number) {
  const value = draft?.key === key ? draft.value : (fullAmountCents / 100).toFixed(2);
  return { key, value, cents: parseManagerRefundAmount(value, fullAmountCents) };
}
