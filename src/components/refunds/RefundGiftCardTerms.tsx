import { giftCardAmount, giftCardExpiry, type RefundGiftCardOffer, type RefundGiftCardStatus } from '@/lib/refundGiftCard';
import type { RefundCustomerLocale } from '@/lib/refundCustomerCopy';

export function RefundGiftCardTerms({ offer, locale = 'en', hideValue = false }: { offer: RefundGiftCardOffer | RefundGiftCardStatus; locale?: RefundCustomerLocale; hideValue?: boolean }) {
  const spanish = locale === 'es';
  const expiry = spanish ? new Intl.DateTimeFormat('es-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(offer.expires_at)) : giftCardExpiry(offer.expires_at);
  return <div data-testid="refund-gift-card-terms" className="space-y-2 text-sm leading-6">
    {!hideValue && <p className="font-display text-2xl font-bold text-pink-900">{giftCardAmount(offer.value, offer.currency)} {spanish ? 'Tarjeta de regalo Bloomjoy' : 'Bloomjoy gift card'}</p>}
    <p>{spanish ? 'Úsela en' : 'Use at'} {offer.eligible_locations.join(', ')}.</p>
    <p>{spanish ? 'Vence' : 'Expires'} {expiry}. {spanish ? 'Un solo uso; el valor no utilizado no se conserva como saldo.' : 'One use only; any unused value is not kept as a balance.'}</p>
  </div>;
}
