import { appConfig } from '@/lib/config';

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
  | 'view_training_detail'
  | 'training_video_iframe_loaded'
  | 'training_mark_completed'
  | 'training_resource_opened'
  | 'training_certificate_unlocked'
  | 'training_certificate_downloaded'
  | 'submit_support_request_concierge'
  | 'submit_support_request_parts'
  | 'submit_support_request_onboarding'
  | 'reorder_sugar_click'
  | 'reorder_sugar_completed'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'view_cart'
  | 'submit_lead_form'
  | 'lead_qualification_assigned'
  | 'marketing_attribution_captured'
  | 'admin_support_request_updated'
  | 'admin_order_fulfillment_updated'
  | 'admin_machine_inventory_updated'
  | 'admin_plus_access_granted'
  | 'admin_plus_access_revoked'
  | 'admin_role_granted'
  | 'admin_role_revoked';

interface EventProperties {
  [key: string]: string | number | boolean | undefined;
}

type PosthogClient = {
  capture: (name: EventName, properties?: EventProperties) => void;
  identify?: (userId: string, traits?: Record<string, unknown>) => void;
};

type GtagClient = (...args: unknown[]) => void;

type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  posthog?: PosthogClient;
  gtag?: GtagClient;
};

let ga4Initialized = false;

const getAnalyticsWindow = (): AnalyticsWindow | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window as AnalyticsWindow;
};

export function initAnalytics(): void {
  const measurementId = appConfig.ga4MeasurementId;
  const analyticsWindow = getAnalyticsWindow();

  if (!measurementId || !analyticsWindow || ga4Initialized) {
    return;
  }

  analyticsWindow.dataLayer = analyticsWindow.dataLayer ?? [];
  analyticsWindow.gtag =
    analyticsWindow.gtag ??
    function gtag(...args: unknown[]) {
      analyticsWindow.dataLayer?.push(args);
    };

  if (!document.getElementById('bloomjoy-ga4')) {
    const script = document.createElement('script');
    script.id = 'bloomjoy-ga4';
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
      measurementId
    )}`;
    document.head.appendChild(script);
  }

  analyticsWindow.gtag('js', new Date());
  analyticsWindow.gtag('config', measurementId, {
    anonymize_ip: true,
    send_page_view: false,
  });
  ga4Initialized = true;
}

export function trackPageView(path: string, title?: string): void {
  const analyticsWindow = getAnalyticsWindow();

  if (analyticsWindow?.posthog) {
    analyticsWindow.posthog.capture('$pageview' as EventName, {
      path,
      title,
    });
  }

  if (analyticsWindow?.gtag && appConfig.ga4MeasurementId) {
    analyticsWindow.gtag('event', 'page_view', {
      page_path: path,
      page_title: title,
    });
  }
}

export function trackEvent(name: EventName, properties?: EventProperties): void {
  if (import.meta.env.DEV) {
    console.log('[Analytics]', name, properties);
  }

  const analyticsWindow = getAnalyticsWindow();
  if (analyticsWindow?.posthog) {
    analyticsWindow.posthog.capture(name, properties);
  }

  if (analyticsWindow?.gtag) {
    analyticsWindow.gtag('event', name, properties);
  }
}

export function identifyUser(userId: string, traits?: Record<string, unknown>): void {
  if (import.meta.env.DEV) {
    console.log('[Analytics] Identify:', userId, traits);
  }

  const analyticsWindow = getAnalyticsWindow();
  if (analyticsWindow?.posthog?.identify) {
    analyticsWindow.posthog.identify(userId, traits);
  }
}
