/** A display choice is identified only by its returned candidate token. */
export const getRefundPurchaseReviewIdentity = <Candidate extends { candidateToken: string }, Selected>({
  candidates, selectedToken, savedSelection, hasSavedSelection, recommendedCandidate, legacyReviewRequired,
}: {
  candidates: Candidate[];
  selectedToken: string;
  savedSelection?: Selected | null;
  hasSavedSelection: boolean;
  recommendedCandidate?: Candidate | null;
  legacyReviewRequired?: boolean;
}) => {
  if (legacyReviewRequired) return { candidate: null, selected: null, locallySelected: false, draftUnavailable: false };
  const token = selectedToken.trim();
  if (token) {
    const candidate = candidates.find((item) => item.candidateToken === token) ?? null;
    return { candidate, selected: null, locallySelected: Boolean(candidate), draftUnavailable: !candidate };
  }
  if (hasSavedSelection) {
    // Returned candidates do not expose their provider IDs. Matching a tuple of
    // amount, digits and time cannot prove which one is the saved transaction.
    return { candidate: null, selected: savedSelection ?? null, locallySelected: false, draftUnavailable: false };
  }
  return { candidate: recommendedCandidate ?? null, selected: null, locallySelected: false, draftUnavailable: false };
};

type CardNetwork = 'visa' | 'mastercard' | 'discover' | 'american_express' | 'other_unknown';

/** Normalize only explicit provider network or recognized brand values. */
export const getRefundProviderCardNetwork = (evidence: { cardNetwork?: string | null; cardBrand?: string | null }): CardNetwork | null => {
  const normalize = (value: string | null | undefined): CardNetwork | null => {
    switch (value?.toLowerCase().replace(/[^a-z]/g, '')) {
      case 'visa': return 'visa';
      case 'mastercard': return 'mastercard';
      case 'discover': return 'discover';
      case 'americanexpress':
      case 'amex': return 'american_express';
      case 'otherunknown': return 'other_unknown';
      default: return null;
    }
  };
  const network = normalize(evidence.cardNetwork);
  const brand = normalize(evidence.cardBrand);
  return network && network !== 'other_unknown' ? network : brand ?? network;
};
