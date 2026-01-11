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

type PosthogClient = {
  capture: (name: EventName, properties?: EventProperties) => void;
  identify: (userId: string, traits?: Record<string, unknown>) => void;
};

type GtagClient = (command: "event", name: EventName, params?: EventProperties) => void;

type AnalyticsWindow = Window & {
  posthog?: PosthogClient;
  gtag?: GtagClient;
};

const getAnalyticsWindow = (): AnalyticsWindow | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window as AnalyticsWindow;
};

export function trackEvent(name: EventName, properties?: EventProperties): void {
  // Development logging
  if (import.meta.env.DEV) {
    console.log('[Analytics]', name, properties);
  }

  // PostHog stub
  const analyticsWindow = getAnalyticsWindow();
  if (analyticsWindow?.posthog) {
    analyticsWindow.posthog.capture(name, properties);
  }

  // GA4 stub
  if (analyticsWindow?.gtag) {
    analyticsWindow.gtag('event', name, properties);
  }
}

export function identifyUser(userId: string, traits?: Record<string, unknown>): void {
  if (import.meta.env.DEV) {
    console.log('[Analytics] Identify:', userId, traits);
  }

  const analyticsWindow = getAnalyticsWindow();
  if (analyticsWindow?.posthog) {
    analyticsWindow.posthog.identify(userId, traits);
  }
}