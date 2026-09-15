type CashPayoutRequestFacts = {
  paymentMethod?: string | null;
  zellePaymentContact?: string | null;
  payoutDestinationRequest?: {
    state?: string;
    canRequest: boolean;
    payloadRedacted?: true;
  } | null;
  customerCorrection?: {
    isActive?: boolean;
    requestedFields: string[];
  } | null;
};

/**
 * A payout-destination question is a distinct, ledger-backed action. An
 * unrelated delivery record cannot suppress it, but any unexpired active
 * purchase correction retains the one-request guard regardless of its fields.
 */
export const canRequestDistinctCashPayoutDestination = (
  facts: CashPayoutRequestFacts,
) => {
  const correction = facts.customerCorrection;
  // The server projection marks every unexpired purchase correction active,
  // regardless of requested fields. Keep the field-specific fallback only for
  // legacy/stale projections that explicitly name the payout destination.
  const correctionBlocksPayoutDestination =
    correction?.isActive === true ||
    (correction?.isActive === false && correction.requestedFields.includes('zelle_payment_contact'));

  return facts.paymentMethod === 'cash' &&
    !facts.zellePaymentContact?.trim() &&
    facts.payoutDestinationRequest?.canRequest === true &&
    !correctionBlocksPayoutDestination;
};
