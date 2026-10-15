type PlusCheckoutStatus = { paymentStatus: string; orderType: string };

/** A verified checkout for another product cannot establish Plus payment. */
export function getPlusPaymentState(status: PlusCheckoutStatus): 'confirmed' | 'pending' | 'error' {
  if (status.orderType !== 'plus_subscription') return 'error';
  return status.paymentStatus === 'paid' ? 'confirmed' : 'pending';
}
