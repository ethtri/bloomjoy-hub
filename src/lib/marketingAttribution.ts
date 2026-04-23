const STORAGE_KEY = 'bloomjoy.marketing_attribution.v1';

const campaignParamKeys = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
] as const;

export type CampaignParamKey = (typeof campaignParamKeys)[number];

export type MarketingAttribution = Partial<Record<CampaignParamKey, string>> & {
  first_landing_page?: string;
  latest_page?: string;
  first_referrer?: string;
  latest_referrer?: string;
  first_seen_at?: string;
  latest_seen_at?: string;
  source_page?: string;
};

const readCurrentPage = () => {
  if (typeof window === 'undefined') {
    return '/';
  }

  return `${window.location.pathname}${window.location.search}`;
};

const safeParse = (value: string | null): MarketingAttribution | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as MarketingAttribution;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const readStoredAttribution = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return safeParse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
};

const writeStoredAttribution = (attribution: MarketingAttribution) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    // Private browsing or storage policy failures should not block lead capture.
  }
};

const getExternalReferrer = () => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return '';
  }

  if (!document.referrer) {
    return '';
  }

  try {
    const referrerUrl = new URL(document.referrer);
    return referrerUrl.origin === window.location.origin ? '' : document.referrer;
  } catch {
    return document.referrer;
  }
};

const readCampaignParams = (search: string) => {
  const params = new URLSearchParams(search);
  const campaign: Partial<Record<CampaignParamKey, string>> = {};

  for (const key of campaignParamKeys) {
    const value = params.get(key)?.trim();
    if (value) {
      campaign[key] = value.slice(0, 200);
    }
  }

  return campaign;
};

export const captureMarketingAttribution = (): MarketingAttribution | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const existing = readStoredAttribution();
  const campaign = readCampaignParams(window.location.search);
  const hasCampaignParams = Object.keys(campaign).length > 0;

  if (!hasCampaignParams && existing) {
    const refreshed = {
      ...existing,
      latest_page: readCurrentPage(),
      latest_seen_at: new Date().toISOString(),
    };
    writeStoredAttribution(refreshed);
    return refreshed;
  }

  const now = new Date().toISOString();
  const referrer = getExternalReferrer();
  const attribution: MarketingAttribution = {
    ...existing,
    ...campaign,
    first_landing_page: existing?.first_landing_page ?? readCurrentPage(),
    latest_page: readCurrentPage(),
    first_referrer: existing?.first_referrer ?? (referrer || undefined),
    latest_referrer: referrer || existing?.latest_referrer,
    first_seen_at: existing?.first_seen_at ?? now,
    latest_seen_at: now,
  };

  writeStoredAttribution(attribution);
  return attribution;
};

export const getStoredMarketingAttribution = (): MarketingAttribution | null =>
  readStoredAttribution();

export const buildLeadAttributionPayload = (sourcePage: string): MarketingAttribution => ({
  ...(getStoredMarketingAttribution() ?? captureMarketingAttribution() ?? {}),
  latest_page: readCurrentPage(),
  source_page: sourcePage,
  latest_seen_at: new Date().toISOString(),
});
