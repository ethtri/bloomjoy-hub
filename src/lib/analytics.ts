const MARKETING_ORIGIN = 'https://www.bloomjoyusa.com';
const GA_SCRIPT_ID = 'bloomjoy-ga4';
const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,15}$/;
const MAX_PROPERTY_LENGTH = 120;
const ANALYTICS_CONSENT_STORAGE_KEY = 'bloomjoy_analytics_consent_v1';
export const ANALYTICS_CONSENT_EVENT = 'bloomjoy:analytics-consent';

export type AnalyticsConsent = 'granted' | 'denied';

type EventName = string;

export interface EventProperties {
  [key: string]: string | number | boolean | undefined;
}

type GtagClient = (...args: unknown[]) => void;

type AnalyticsWindow = Window & {
  dataLayer?: unknown[][];
  gtag?: GtagClient;
  __bloomjoyGaInitialized?: boolean;
  __bloomjoyLastPageViewPath?: string;
  __bloomjoyPreviousPagePath?: string;
};

const publicStaticRoutes = new Set([
  '/',
  '/about',
  '/billing-cancellation',
  '/cart',
  '/contact',
  '/machines',
  '/machines/commercial-robotic-machine',
  '/machines/micro',
  '/machines/mini',
  '/plus',
  '/privacy',
  '/resources',
  '/resources/business-playbook',
  '/resources/business-playbook/payback-planner',
  '/resources/business-playbook/planner',
  '/supplies',
  '/terms',
]);

const publicRoutePrefixes = ['/resources/business-playbook/', '/solutions/'];

const publicProviderEvents = new Set([
  'add_to_cart',
  'buyer_cta_click',
  'checkout_start',
  'checkout_success',
  'click_business_playbook_cta',
  'click_buy_sticks',
  'click_buy_sugar',
  'click_buyer_flow_playbook_link',
  'click_plus_preview_resource',
  'click_quote_micro',
  'click_request_quote_commercial',
  'click_request_quote_mini',
  'click_resources_playbook_card',
  'lead_form_error',
  'lead_form_start',
  'lead_form_submit',
  'page_view',
  'planner_complete',
  'planner_start',
  'remove_from_cart',
  'submit_contact_from_playbook',
  'update_business_playbook_payback_planner',
  'update_business_playbook_planner',
  'update_mobile_setup_fit_checker',
  'view_business_playbook_article',
  'view_business_playbook_payback_planner',
  'view_business_playbook_planner',
  'view_mobile_setup_fit_checker',
  'view_cart',
  'view_home',
  'view_product_commercial_robotic',
  'view_product_micro',
  'view_product_mini',
  'view_supplies',
]);

const providerEventAliases: Record<string, string> = {
  plus_subscription_activated: 'checkout_success',
  purchase_completed: 'checkout_success',
  start_checkout: 'checkout_start',
  start_plus_checkout: 'checkout_start',
  view_plus_pricing: 'plus_explore',
};

publicProviderEvents.add('plus_explore');

const allowedPropertyKeys = new Set([
  'action',
  'answer',
  'billing_model',
  'budget_machine',
  'budget_band',
  'category',
  'checkout_type',
  'content',
  'cost_band',
  'cta',
  'demand_band',
  'destination',
  'destination_type',
  'has_rent',
  'has_revenue_share',
  'href',
  'inquiry_type',
  'machine',
  'machine_interest',
  'machine_signal',
  'open_question_band',
  'placement',
  'planner',
  'preset_id',
  'question',
  'recommended_machine',
  'result_band',
  'route',
  'scenario_type',
  'sku',
  'slug',
  'source',
  'source_page',
  'surface',
  'variant',
]);

const pathPropertyKeys = new Set(['destination', 'href', 'route', 'source', 'source_page']);
const oncePerPageKeys = new Set<string>();

const getAnalyticsWindow = (): AnalyticsWindow | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window as AnalyticsWindow;
};

const getConfiguredMeasurementId = () =>
  import.meta.env.VITE_GA_MEASUREMENT_ID?.trim().toUpperCase() ?? '';

export const getAnalyticsConsent = (): AnalyticsConsent | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
    return stored === 'granted' || stored === 'denied' ? stored : null;
  } catch {
    return null;
  }
};

export const setAnalyticsConsent = (consent: AnalyticsConsent): void => {
  const analyticsWindow = getAnalyticsWindow();
  if (!analyticsWindow) {
    return;
  }

  try {
    analyticsWindow.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, consent);
  } catch {
    // Storage failure leaves analytics disabled and must not interrupt the visitor.
    return;
  }

  analyticsWindow.__bloomjoyLastPageViewPath = undefined;
  analyticsWindow.__bloomjoyPreviousPagePath = undefined;
  analyticsWindow.gtag?.('consent', 'update', {
    ad_personalization: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    analytics_storage: consent,
  });
  analyticsWindow.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT, { detail: consent }));
};

const isDebugMode = () => {
  if (import.meta.env.DEV || import.meta.env.VITE_GA_DEBUG_MODE === 'true') {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  return new URLSearchParams(window.location.search).get('analytics_debug') === '1';
};

export const isValidGaMeasurementId = (measurementId?: string | null) =>
  GA_MEASUREMENT_ID_PATTERN.test(measurementId?.trim().toUpperCase() ?? '');

export const sanitizeAnalyticsPath = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith('//')) {
    return undefined;
  }

  try {
    const url = new URL(trimmed, MARKETING_ORIGIN);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return undefined;
    }

    return url.pathname.startsWith('/') ? url.pathname : undefined;
  } catch {
    return undefined;
  }
};

export const isPublicAnalyticsPath = (pathname?: string | null) => {
  const safePath = sanitizeAnalyticsPath(pathname);
  if (!safePath) {
    return false;
  }

  return (
    publicStaticRoutes.has(safePath) ||
    publicRoutePrefixes.some((prefix) => safePath.startsWith(prefix))
  );
};

export const sanitizeAnalyticsProperties = (properties?: EventProperties): EventProperties => {
  if (!properties) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, value]) => {
      if (!allowedPropertyKeys.has(key) || value === undefined || typeof value === 'number') {
        return [];
      }

      if (typeof value === 'boolean') {
        return [[key, value]];
      }

      const safeValue = pathPropertyKeys.has(key)
        ? sanitizeAnalyticsPath(value)
        : value.trim().slice(0, MAX_PROPERTY_LENGTH);

      return safeValue ? [[key, safeValue]] : [];
    })
  );
};

const getSafePageContext = () => {
  const analyticsWindow = getAnalyticsWindow();
  if (!analyticsWindow) {
    return {};
  }

  const pagePath = sanitizeAnalyticsPath(analyticsWindow.location.pathname) ?? '/';
  const pageLocation = `${analyticsWindow.location.origin}${pagePath}`;
  const previousPagePath = sanitizeAnalyticsPath(analyticsWindow.__bloomjoyPreviousPagePath);
  const referrerPath = previousPagePath ?? sanitizeAnalyticsPath(document.referrer);
  let pageReferrer = '';

  if (previousPagePath) {
    pageReferrer = `${analyticsWindow.location.origin}${previousPagePath}`;
  } else if (document.referrer && referrerPath) {
    try {
      pageReferrer = `${new URL(document.referrer).origin}${referrerPath}`;
    } catch {
      pageReferrer = `${MARKETING_ORIGIN}${referrerPath}`;
    }
  }

  return {
    page_location: pageLocation,
    page_path: pagePath,
    page_referrer: pageReferrer,
  };
};

const logDebugEvent = (name: string, properties: EventProperties, providerEnabled: boolean) => {
  if (!import.meta.env.DEV) {
    return;
  }

  console.info(
    `${providerEnabled ? '[Analytics debug]' : '[Analytics disabled]'} ${name} ${JSON.stringify(
      properties
    )}`
  );
};

export const initializePublicAnalytics = (): boolean => {
  const analyticsWindow = getAnalyticsWindow();
  if (
    !analyticsWindow ||
    getAnalyticsConsent() !== 'granted' ||
    !isPublicAnalyticsPath(analyticsWindow.location.pathname)
  ) {
    return false;
  }

  const measurementId = getConfiguredMeasurementId();
  if (!isValidGaMeasurementId(measurementId)) {
    return false;
  }

  if (analyticsWindow.__bloomjoyGaInitialized && analyticsWindow.gtag) {
    return true;
  }

  analyticsWindow.dataLayer = analyticsWindow.dataLayer ?? [];
  analyticsWindow.gtag =
    analyticsWindow.gtag ?? ((...args: unknown[]) => analyticsWindow.dataLayer?.push(args));
  analyticsWindow.__bloomjoyGaInitialized = true;

  if (!document.getElementById(GA_SCRIPT_ID)) {
    const script = document.createElement('script');
    script.id = GA_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
      measurementId
    )}`;
    document.head.appendChild(script);
  }

  analyticsWindow.gtag('consent', 'default', {
    ad_personalization: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    analytics_storage: 'granted',
  });
  analyticsWindow.gtag('js', new Date());
  analyticsWindow.gtag('config', measurementId, {
    ...getSafePageContext(),
    allow_ad_personalization_signals: false,
    allow_google_signals: false,
    debug_mode: isDebugMode(),
    send_page_view: false,
  });

  return true;
};

export const trackEvent = (name: EventName, properties?: EventProperties): void => {
  const analyticsWindow = getAnalyticsWindow();
  const providerName = providerEventAliases[name] ?? name;
  const safeProperties = sanitizeAnalyticsProperties({
    ...properties,
    ...(name === 'start_plus_checkout' || name === 'plus_subscription_activated'
      ? { checkout_type: 'plus' }
      : {}),
  });
  const providerEnabled = initializePublicAnalytics();

  logDebugEvent(providerName, safeProperties, providerEnabled);

  if (
    !analyticsWindow?.gtag ||
    !providerEnabled ||
    !publicProviderEvents.has(providerName) ||
    !isPublicAnalyticsPath(analyticsWindow.location.pathname)
  ) {
    return;
  }

  try {
    analyticsWindow.gtag('event', providerName, {
      ...safeProperties,
      ...getSafePageContext(),
      debug_mode: isDebugMode(),
    });
  } catch {
    // Analytics must never interrupt a user-facing flow.
  }
};

export const trackEventOnce = (
  key: string,
  name: EventName,
  properties?: EventProperties
): void => {
  if (oncePerPageKeys.has(key)) {
    return;
  }

  oncePerPageKeys.add(key);
  trackEvent(name, properties);
};

export const trackPublicPageView = (pathname: string): void => {
  const analyticsWindow = getAnalyticsWindow();
  const route = sanitizeAnalyticsPath(pathname);

  if (!analyticsWindow || !route || !isPublicAnalyticsPath(route)) {
    return;
  }

  if (analyticsWindow.__bloomjoyLastPageViewPath === route) {
    return;
  }

  analyticsWindow.__bloomjoyPreviousPagePath = analyticsWindow.__bloomjoyLastPageViewPath;
  analyticsWindow.__bloomjoyLastPageViewPath = route;
  oncePerPageKeys.clear();
  trackEvent('page_view', { route });
};

export const getMachineAnalyticsContext = (pathname?: string | null) => {
  const safePath = sanitizeAnalyticsPath(pathname);
  if (safePath === '/machines/commercial-robotic-machine') return 'commercial';
  if (safePath === '/machines/mini') return 'mini';
  if (safePath === '/machines/micro') return 'micro';
  if (safePath === '/machines') return 'all';
  return undefined;
};

export const getBuyerCtaClassification = (destination?: string | null) => {
  const safePath = sanitizeAnalyticsPath(destination);
  if (!safePath) return undefined;
  if (safePath === '/contact') return 'request_quote';
  if (safePath === '/supplies' || safePath === '/cart') return 'supplies';
  if (safePath === '/plus') return 'plus';
  if (safePath.includes('/planner')) return 'planner';
  if (safePath === '/machines' || safePath.startsWith('/machines/')) return 'machine';
  if (safePath === '/resources' || safePath.startsWith('/resources/')) return 'content';
  return undefined;
};

export function identifyUser(_userId: string, _traits?: Record<string, unknown>): void {
  if (import.meta.env.DEV) {
    console.info('[Analytics identity disabled] GA4 public measurement does not receive user IDs');
  }
}
