import { giftCardAmount, giftCardExpiry, type RefundGiftCardOffer, type RefundGiftCardStatus } from '@/lib/refundGiftCard';

export function RefundGiftCardTerms({ offer }: { offer: RefundGiftCardOffer | RefundGiftCardStatus }) {
  return <div data-testid="refund-gift-card-terms" className="space-y-2 text-sm leading-6">
    <p className="font-display text-2xl font-bold text-pink-900">{giftCardAmount(offer.value, offer.currency)} Bloomjoy gift card</p>
    <p>Use at {offer.eligible_locations.join(', ')}.</p>
    <p>Expires {giftCardExpiry(offer.expires_at)}. One use only; any unused value is not kept as a balance.</p>
  </div>;
}
