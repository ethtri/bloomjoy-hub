import type { CartItem } from '@/lib/cart';
import type { BlankSticksAddressType, StickSize } from '@/lib/sticks';
import { supabaseClient } from '@/lib/supabaseClient';

interface CheckoutResponse {
  url?: string;
  error?: string;
}

interface BlankSticksCheckoutInput {
  boxCount: number;
  stickSize: StickSize;
  addressType: BlankSticksAddressType;
}

export async function startPlusCheckout(
  origin: string,
  machineCount: number
) {
  const { data, error } = await supabaseClient.functions.invoke<CheckoutResponse>(
    'stripe-plus-checkout',
    {
      body: {
        machineCount,
        successUrl: `${origin}/plus?checkout=success`,
        cancelUrl: `${origin}/plus?checkout=cancel`,
      },
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.url) {
    throw new Error(data?.error || 'Checkout URL missing.');
  }

  return data.url;
}

export async function openCustomerPortal(email: string, origin: string) {
  const { data, error } = await supabaseClient.functions.invoke<CheckoutResponse>(
    'stripe-customer-portal',
    {
      body: {
        email,
        returnUrl: `${origin}/portal/account?billing=return`,
      },
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.url) {
    throw new Error(data?.error || 'Customer portal URL missing.');
  }

  return data.url;
}

export async function startSugarCheckout(items: CartItem[], origin: string) {
  const { data, error } = await supabaseClient.functions.invoke<CheckoutResponse>(
    'stripe-sugar-checkout',
    {
      body: {
        items: items.map((item) => ({
          sku: item.sku,
          quantity: item.quantity,
          type: item.type,
        })),
        successUrl: `${origin}/cart?checkout=success`,
        cancelUrl: `${origin}/cart?checkout=cancel`,
      },
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.url) {
    throw new Error(data?.error || 'Checkout URL missing.');
  }

  return data.url;
}

export async function startBlankSticksCheckout(
  { boxCount, stickSize, addressType }: BlankSticksCheckoutInput,
  origin: string
) {
  const { data, error } = await supabaseClient.functions.invoke<CheckoutResponse>(
    'stripe-sticks-checkout',
    {
      body: {
        boxCount,
        stickSize,
        addressType,
        successUrl: `${origin}/supplies?sticksCheckout=success`,
        cancelUrl: `${origin}/supplies?sticksCheckout=cancel`,
      },
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.url) {
    throw new Error(data?.error || 'Checkout URL missing.');
  }

  return data.url;
}
