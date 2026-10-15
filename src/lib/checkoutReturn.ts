export type CheckoutReturnScope = 'cart' | 'sticks';

export type VerifiedCheckoutStatus = {
  paymentStatus: string;
  orderType: string;
};

type CheckoutCartItem = { sku: string; quantity: number; type: string };
type CheckoutStorage = Pick<Storage, 'getItem' | 'setItem'>;

const expectedOrderTypes = (scope: CheckoutReturnScope) =>
  scope === 'cart' ? ['sugar', 'micro_machine', 'mixed'] : ['blank_sticks'];

export type CheckoutReturnState =
  | { status: 'none' | 'checking' | 'canceled' | 'pending' | 'error' }
  | { status: 'paid'; orderType: string };

export function isVerifiedPaidCheckout(status: VerifiedCheckoutStatus, scope: CheckoutReturnScope): boolean {
  return status.paymentStatus === 'paid' && expectedOrderTypes(scope).includes(status.orderType);
}

export async function readCheckoutReturn(
  result: string | null,
  sessionId: string | null,
  scope: CheckoutReturnScope,
  readStatus: (id: string) => Promise<VerifiedCheckoutStatus>,
): Promise<CheckoutReturnState> {
  if (!result) return { status: 'none' };
  if (result === 'cancel') return { status: 'canceled' };
  if (result !== 'return' || !sessionId) return { status: 'error' };
  try {
    const status = await readStatus(sessionId);
    if (!expectedOrderTypes(scope).includes(status.orderType)) return { status: 'error' };
    return isVerifiedPaidCheckout(status, scope)
      ? { status: 'paid', orderType: status.orderType }
      : { status: 'pending' };
  } catch {
    return { status: 'error' };
  }
}

export function checkoutOrderLabel(orderType: string): string {
  switch (orderType) {
    case 'sugar': return 'sugar order';
    case 'micro_machine': return 'Micro Machine order';
    case 'mixed': return 'machine and supplies order';
    case 'blank_sticks': return 'Bloomjoy branded sticks order';
    default: return 'order';
  }
}

const cartFingerprint = (items: CheckoutCartItem[]) => JSON.stringify(
  items.map(({ sku, quantity, type }) => ({ sku, quantity, type }))
    .sort((left, right) => left.sku.localeCompare(right.sku)),
);

const persistedCartFingerprint = (storage: CheckoutStorage): string | null => {
  try {
    const raw = storage.getItem('bloomjoy-cart');
    if (!raw) return null;
    const items: unknown = JSON.parse(raw)?.state?.items;
    if (!Array.isArray(items) || !items.every((item) =>
      item && typeof item.sku === 'string' && typeof item.type === 'string'
        && Number.isSafeInteger(item.quantity) && item.quantity > 0
    )) return null;
    return cartFingerprint(items);
  } catch {
    return null;
  }
};

/** Associate the submitted cart with the session returned by the checkout service. */
export function rememberCheckoutCart(checkoutUrl: string, items: CheckoutCartItem[], storage: CheckoutStorage): boolean {
  const url = new URL(checkoutUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') return false;
  const sessionId = url.pathname.match(/\/(cs_(?:test|live)_[A-Za-z0-9]+)(?:\/|$)/)?.[1];
  if (!sessionId) return false;
  storage.setItem(`bloomjoy-checkout-cart:${sessionId}`, cartFingerprint(items));
  return true;
}

// A snapshot/marker only decides whether to clear the cart, never whether a
// payment succeeded. The caller must first obtain a verified paid server result.
export function claimPaidCartReturn(sessionId: string, items: CheckoutCartItem[], storage: CheckoutStorage): 'clear' | 'retain' | 'already-handled' {
  const key = `bloomjoy-cart-return:${sessionId}`;
  if (storage.getItem(key)) return 'already-handled';
  const expected = storage.getItem(`bloomjoy-checkout-cart:${sessionId}`);
  // Zustand does not automatically refresh in-memory state after another tab
  // writes. Check the latest persisted cart before clearing shared storage.
  const matchesCheckout = expected !== null && expected === cartFingerprint(items)
    && expected === persistedCartFingerprint(storage);
  storage.setItem(key, 'handled');
  return matchesCheckout ? 'clear' : 'retain';
}
