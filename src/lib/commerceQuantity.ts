/** Keep incomplete edits separate from quantities that may be ordered. */
export function parseOrderQuantity(value: string, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity >= minimum && quantity <= maximum
    ? quantity
    : null;
}
