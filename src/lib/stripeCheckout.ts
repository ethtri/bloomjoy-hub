import type { CartItem } from '@/lib/cart';
import type { BlankSticksAddressType, StickSize } from '@/lib/sticks';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';

interface CheckoutResponse {
  url?: string;
  error?: string;
}

interface CheckoutStatusResponse {
  paymentStatus?: string;
  checkoutStatus?: string;
  orderType?: string;
  error?: string;
}

interface BlankSticksCheckoutInput {
  boxCount: number;
  stickSize: StickSize;
  addressType: BlankSticksAddressType;
}

export async function startPlusCheckout(origin: string, returnPath = '/plus') {
  const checkoutReturnPath = returnPath.startsWith('/') ? returnPath : '/plus';
  const querySeparator = checkoutReturnPath.includes('?') ? '&' : '?';

  const data = await invokeEdgeFunction<CheckoutResponse>(
    'stripe-plus-checkout',
    {
      successUrl: `${origin}${checkoutReturnPath}${querySeparator}checkout=return&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}${checkoutReturnPath}${querySeparator}checkout=cancel`,
    },
    {
      requireUserAuth: true,
      authErrorMessage: 'Please log in before starting Bloomjoy Plus checkout.',
    }
  );

  if (!data?.url) {
    throw new Error(data?.error || 'Checkout URL missing.');
  }

  return data.url;
}

export async function openCustomerPortal(origin: string) {
  const data = await invokeEdgeFunction<CheckoutResponse>(
    'stripe-customer-portal',
    {
      returnUrl: `${origin}/portal/account?billing=return`,
    },
    {
      requireUserAuth: true,
      authErrorMessage: 'Log in to manage billing.',
    }
  );

  if (!data?.url) {
    throw new Error(data?.error || 'Customer portal URL missing.');
  }

  return data.url;
}

export async function startStorefrontCheckout(items: CartItem[], origin: string) {
  const data = await invokeEdgeFunction<CheckoutResponse>(
    'stripe-sugar-checkout',
    {
      items: items.map((item) => ({
        sku: item.sku,
        quantity: item.quantity,
        type: item.type,
      })),
      successUrl: `${origin}/cart?checkout=return&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/cart?checkout=cancel`,
    },
    {
      includeUserAuth: true,
    }
  );

  if (!data?.url) {
    throw new Error(data?.error || 'Checkout URL missing.');
  }

  return data.url;
}

export async function startBlankSticksCheckout(
  { boxCount, stickSize, addressType }: BlankSticksCheckoutInput,
  origin: string
) {
  const data = await invokeEdgeFunction<CheckoutResponse>(
    'stripe-sticks-checkout',
    {
      boxCount,
      stickSize,
      addressType,
      successUrl: `${origin}/supplies?sticksCheckout=return&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/supplies?sticksCheckout=cancel`,
    },
    {
      includeUserAuth: true,
    }
  );

  if (!data?.url) {
    throw new Error(data?.error || 'Checkout URL missing.');
  }

  return data.url;
}

export async function getCheckoutStatus(sessionId: string) {
  const data = await invokeEdgeFunction<CheckoutStatusResponse>(
    'stripe-checkout-status',
    { sessionId }
  );

  if (!data?.paymentStatus) {
    throw new Error(data?.error || 'Checkout status is unavailable.');
  }

  return {
    paymentStatus: data.paymentStatus,
    checkoutStatus: data.checkoutStatus ?? null,
    orderType: data.orderType ?? 'unknown',
  };
}
