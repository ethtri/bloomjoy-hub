export const REFUND_SELECTED_NAYAX_MATCH_FACTOR_LIMIT = 20;
export const REFUND_SELECTED_NAYAX_MATCH_FACTOR_LABEL_LIMIT = 300;

const REFUND_SELECTED_NAYAX_MATCH_FACTOR_SEPARATOR_LENGTH = '; '.length;

// The producer builds matchExplanation by joining every bounded factor label.
export const REFUND_SELECTED_NAYAX_MATCH_EXPLANATION_LIMIT =
  REFUND_SELECTED_NAYAX_MATCH_FACTOR_LIMIT * REFUND_SELECTED_NAYAX_MATCH_FACTOR_LABEL_LIMIT +
  (REFUND_SELECTED_NAYAX_MATCH_FACTOR_LIMIT - 1) *
    REFUND_SELECTED_NAYAX_MATCH_FACTOR_SEPARATOR_LENGTH;

export const isSupportedRefundSelectedNayaxMatchExplanation = (
  value: unknown,
): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= REFUND_SELECTED_NAYAX_MATCH_EXPLANATION_LIMIT;
