// This browser-visible flag controls whether the Micro purchase CTA is shown.
// The Edge Function still enforces Stripe Price and Shipping Rate configuration.
export const isMicroCheckoutEnabled =
  import.meta.env.VITE_MICRO_CHECKOUT_ENABLED === 'true';

// Enable only after the Mini price, delivery policy, tax, and paid-order UAT pass.
export const isMiniCheckoutEnabled =
  import.meta.env.VITE_MINI_CHECKOUT_ENABLED === 'true';
