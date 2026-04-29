import type { CartItem } from '@/lib/cart';
import type { BlankSticksAddressType, StickSize } from '@/lib/sticks';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';

interface CheckoutResponse {
  url?: string;
  error?: string;
}

interface BlankSticksCheckoutInput {
  boxCount: number;
  stickSize: StickSize;
  addressType: BlankSticksAddressType;
}

export async function startPlusCheckout(origin: string) {
  const data = await invokeEdgeFunction<CheckoutResponse>(
    'stripe-plus-checkout',
    {
      successUrl: `${origin}/plus?checkout=success`,
      cancelUrl: `${origin}/plus?checkout=cancel`,
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

export async function startSugarCheckout(items: CartItem[], origin: string) {
  const data = await invokeEdgeFunction<CheckoutResponse>(
    'stripe-sugar-checkout',
    {
      items: items.map((item) => ({
        sku: item.sku,
        quantity: item.quantity,
        type: item.type,
      })),
      successUrl: `${origin}/cart?checkout=success`,
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
      successUrl: `${origin}/supplies?sticksCheckout=success`,
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
