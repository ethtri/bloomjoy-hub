/**
 * Resolve the amount that may be used for a cash review.
 *
 * `undefined` means the caller did not provide safe evidence yet, so the
 * reviewed customer estimate remains the fallback unless the case already
 * has a durable selected sale. `null` is intentional: the caller has checked
 * the source and knows that no usable amount exists.
 */
export const resolveCashReviewAmountCents = (
  customerEstimateCents: number | null | undefined,
  safeEvidenceAmountCents: number | null | undefined,
  hasDurableSelectedSale = false,
): number | null | undefined => (
  typeof safeEvidenceAmountCents === 'undefined'
    ? hasDurableSelectedSale
      ? null
      : customerEstimateCents
    : safeEvidenceAmountCents
);
