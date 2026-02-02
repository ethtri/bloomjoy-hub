import type { CartItem } from '@/lib/cart';
import { supabaseClient } from '@/lib/supabaseClient';

interface CheckoutResponse {
  url?: string;
  error?: string;
}

export async function startSugarCheckout(items: CartItem[], origin: string) {
  if (!supabaseClient) {
    throw new Error('Supabase is not configured.');
  }

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
