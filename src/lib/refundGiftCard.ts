export type RefundResolutionMethod = 'gift_card' | 'original_payment';

export type RefundGiftCardOffer = {
  pool_id: string;
  /** Face value in integer cents, supplied by the configured server policy. */
  value: number;
  currency: string;
  eligible_locations: string[];
  expires_at: string;
  one_use: true;
  redemption_instructions: string;
};

export type RefundGiftCardStatus = {
  state: 'pending_inventory' | 'manager_review' | 'issued' | 'denied';
  value: number;
  currency: string;
  expires_at: string;
  eligible_locations: string[];
  issued_at: string | null;
  delivery_state: string;
};

export const requireRefundGiftCardOffer = (value: unknown): RefundGiftCardOffer => {
  const offer = value as RefundGiftCardOffer | null;
  if (!offer || typeof offer.pool_id !== 'string' || !offer.pool_id ||
      !Number.isSafeInteger(offer.value) || offer.value <= 0 ||
      !/^[A-Z]{3}$/.test(offer.currency) ||
      !Array.isArray(offer.eligible_locations) || !offer.eligible_locations.length ||
      !offer.eligible_locations.every((location) => typeof location === 'string' && location.trim()) ||
      !Number.isFinite(Date.parse(offer.expires_at)) || offer.one_use !== true ||
      typeof offer.redemption_instructions !== 'string' || !offer.redemption_instructions.trim()) {
    throw new Error('We could not load the gift card terms. Please try again.');
  }
  // Copy only the public offer fields; never retain inventory codes or customer history.
  return { pool_id: offer.pool_id, value: offer.value, currency: offer.currency,
    eligible_locations: [...offer.eligible_locations], expires_at: offer.expires_at,
    one_use: true, redemption_instructions: offer.redemption_instructions };
};

export const requireRefundGiftCardStatus = (value: unknown): RefundGiftCardStatus | null => {
  if (value == null) return null;
  const card = value as RefundGiftCardStatus;
  if (!['pending_inventory', 'manager_review', 'issued', 'denied'].includes(card.state) ||
      !Number.isSafeInteger(card.value) || card.value <= 0 || !/^[A-Z]{3}$/.test(card.currency) ||
      !Number.isFinite(Date.parse(card.expires_at)) || !Array.isArray(card.eligible_locations) ||
      !card.eligible_locations.length || !card.eligible_locations.every((item) => typeof item === 'string' && item.trim()) ||
      !(card.issued_at === null || (typeof card.issued_at === 'string' && Number.isFinite(Date.parse(card.issued_at)))) ||
      typeof card.delivery_state !== 'string') {
    throw new Error('Your gift card status is temporarily unavailable. Please try again.');
  }
  return { state: card.state, value: card.value, currency: card.currency,
    expires_at: card.expires_at, eligible_locations: [...card.eligible_locations],
    issued_at: card.issued_at, delivery_state: card.delivery_state };
};

export const giftCardAmount = (value: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value / 100);

export const giftCardExpiry = (value: string) =>
  new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(new Date(value));

export const giftCardStatusCopy = (card: RefundGiftCardStatus) => {
  if (card.state === 'manager_review') return {
    title: 'Your request is being reviewed',
    detail: 'Our team is reviewing your gift card request. Your answers are saved.',
    next: 'We will email you when the review is complete. You do not need to submit again.',
  };
  if (card.state === 'pending_inventory') return {
    title: 'We’re preparing your gift card',
    detail: 'Your request is saved. Your gift card is not ready yet.',
    next: 'We will email your code once it is ready. There is nothing else you need to do.',
  };
  if (card.state === 'denied') return {
    title: 'Your review is complete',
    detail: 'A gift card was not issued for this request.',
    next: 'Reply to your Bloomjoy email if you would like us to review the same request again.',
  };
  const delivered = card.delivery_state === 'delivered';
  const accepted = ['sent', 'accepted'].includes(card.delivery_state);
  const delayed = ['failed', 'bounced', 'complained', 'delivery_unknown', 'delivery_unconfirmed'].includes(card.delivery_state);
  return {
    title: 'A little sweetness is on its way',
    detail: `Your ${giftCardAmount(card.value, card.currency)} Bloomjoy gift card is ready.`,
    next: delivered ? 'Your gift card email was delivered. Use the code and instructions in that email.'
      : accepted ? 'We have sent your gift card email. Check your inbox or spam folder. Reply to your Bloomjoy email if you need a hand.'
      : delayed ? 'Your gift card is saved, but its email delivery needs attention. Our team is working on it. You do not need to submit again.'
      : 'We’re sending your gift card email. Your code and instructions will be in that email.',
  };
};
