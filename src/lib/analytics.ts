// Analytics event tracking stub (PostHog/GA4 style)
// Replace with actual implementation when ready

type EventName =
  | 'view_home'
  | 'view_product_commercial_robotic'
  | 'view_product_mini'
  | 'view_product_micro'
  | 'view_supplies'
  | 'click_buy_sugar'
  | 'click_buy_sticks'
  | 'click_request_quote_commercial'
  | 'click_request_quote_mini'
  | 'click_buy_micro'
  | 'start_checkout'
  | 'purchase_completed'
  | 'view_plus_pricing'
  | 'start_plus_checkout'
  | 'plus_subscription_activated'
  | 'login'
  | 'view_dashboard'
  | 'view_training_catalog'
  | 'open_training_item'
  | 'submit_support_request_concierge'
  | 'submit_support_request_parts'
  | 'submit_support_request_onboarding'
  | 'reorder_sugar_click'
  | 'reorder_sugar_completed'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'view_cart';

interface EventProperties {
  [key: string]: string | number | boolean | undefined;
}

export function trackEvent(name: EventName, properties?: EventProperties): void {
  // Development logging
  if (import.meta.env.DEV) {
    console.log('[Analytics]', name, properties);
  }

  // PostHog stub
  if (typeof window !== 'undefined' && (window as any).posthog) {
    (window as any).posthog.capture(name, properties);
  }

  // GA4 stub
  if (typeof window !== 'undefined' && (window as any).gtag) {
    (window as any).gtag('event', name, properties);
  }
}

export function identifyUser(userId: string, traits?: Record<string, any>): void {
  if (import.meta.env.DEV) {
    console.log('[Analytics] Identify:', userId, traits);
  }

  if (typeof window !== 'undefined' && (window as any).posthog) {
    (window as any).posthog.identify(userId, traits);
  }
}
