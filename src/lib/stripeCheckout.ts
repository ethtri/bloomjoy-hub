import type { CartItem } from '@/lib/cart';
import { supabaseClient } from '@/lib/supabaseClient';

interface CheckoutResponse {
  url?: string;
  error?: string;
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
        returnUrl: `${origin}/portal/account`,
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
