// This browser-visible flag controls whether the Micro purchase CTA is shown.
// The Edge Function still enforces Stripe Price and Shipping Rate configuration.
export const isMicroCheckoutEnabled =
  import.meta.env.VITE_MICRO_CHECKOUT_ENABLED === 'true';
