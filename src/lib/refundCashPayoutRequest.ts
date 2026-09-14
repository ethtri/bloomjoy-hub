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
 * unrelated delivery record or an active request for another field cannot
 * make it eligible, and an active correction always retains the one-request
 * guard.
 */
export const canRequestDistinctCashPayoutDestination = (
  facts: CashPayoutRequestFacts,
) => facts.paymentMethod === 'cash' &&
  !facts.zellePaymentContact?.trim() &&
  facts.payoutDestinationRequest?.canRequest === true &&
  facts.customerCorrection?.isActive !== true &&
  !facts.customerCorrection?.requestedFields.includes('zelle_payment_contact');
