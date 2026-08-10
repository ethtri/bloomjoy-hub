import {
  MACHINE_INTEREST_OPTIONS,
  normalizeMachineInterest as normalizeMachineInterestValue,
} from '@/lib/machineNames';

const STORAGE_KEY = 'bloomjoy.lead_attribution.v1';
const campaignKeys = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;
const touchKinds = new Set(['direct', 'organic', 'referral', 'campaign', 'internal', 'planner']);
const plannerRecommendations = new Set(['commercial', 'mini', 'micro', 'undecided']);
const plannerBands = new Set(['clear', 'close_call', 'exploring', 'blank', 'low', 'medium', 'high']);
const searchReferrerDomains = [
  'bing.com',
  'duckduckgo.com',
  'search.yahoo.com',
  'ecosia.org',
];
const googleSearchHostPattern = /(^|\.)google\.(?:com|[a-z]{2,3})(?:\.[a-z]{2})?$/i;
const emailLikePattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const phoneLikePattern = /(?:\+?\d[\s().-]*){7,}/;
const campaignValuePattern = /^[a-z0-9][a-z0-9 _./-]*$/i;
const hostPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const privatePathPrefixes = ['/portal', '/admin', '/login', '/reset-password', '/refunds'];

type CampaignKey = (typeof campaignKeys)[number];
type TouchKind = 'direct' | 'organic' | 'referral' | 'campaign' | 'internal' | 'planner';
type PlannerRecommendation = 'commercial' | 'mini' | 'micro' | 'undecided';
type PlannerBand = 'clear' | 'close_call' | 'exploring' | 'blank' | 'low' | 'medium' | 'high';

export type LeadAttributionTouch = Partial<Record<CampaignKey, string>> & {
  kind: TouchKind;
  landing_path: string;
  referrer_host?: string;
  internal_source_path?: string;
  machine_interest?: string;
  planner_recommendation?: PlannerRecommendation;
  planner_band?: PlannerBand;
};

export type LeadAttribution = {
  version: 1;
  first_touch: LeadAttributionTouch;
  last_touch: LeadAttributionTouch;
};

export type LeadAttributionPayload = LeadAttribution & {
  conversion: {
    source_path: string;
    machine_interest?: string;
    planner_recommendation?: PlannerRecommendation;
    planner_band?: PlannerBand;
  };
};

let documentEntryPending = true;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const containsLikelyPii = (value: string) =>
  emailLikePattern.test(value) || phoneLikePattern.test(value);

const containsControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

const normalizePath = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) return undefined;

  try {
    const path = new URL(trimmed, 'https://www.bloomjoyusa.com').pathname;
    const decodedPath = decodeURIComponent(path);
    const isPrivatePath = privatePathPrefixes.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`)
    );
    if (isPrivatePath || containsLikelyPii(decodedPath) || containsControlCharacter(decodedPath)) {
      return undefined;
    }
    return path.slice(0, 160);
  } catch {
    return undefined;
  }
};

const normalizeCampaignValue = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 80) return undefined;
  if (
    containsLikelyPii(trimmed) ||
    !campaignValuePattern.test(trimmed) ||
    trimmed.includes('://') ||
    trimmed.includes('?') ||
    trimmed.includes('#')
  ) {
    return undefined;
  }
  return trimmed;
};

const normalizeHost = (value?: string | null) => {
  const host = value?.trim().toLowerCase().replace(/\.$/, '');
  if (!host || !hostPattern.test(host) || containsLikelyPii(host)) return undefined;
  return host;
};

const normalizeAllowedMachineInterest = (value?: string | null) => {
  const normalized = normalizeMachineInterestValue(value ?? null);
  return MACHINE_INTEREST_OPTIONS.includes(normalized as (typeof MACHINE_INTEREST_OPTIONS)[number])
    ? normalized
    : value?.trim() === 'Not sure yet'
      ? 'Not sure yet'
      : undefined;
};

const normalizePlannerRecommendation = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase();
  return normalized && plannerRecommendations.has(normalized)
    ? (normalized as PlannerRecommendation)
    : undefined;
};

const normalizePlannerBand = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase();
  return normalized && plannerBands.has(normalized)
    ? (normalized as PlannerBand)
    : undefined;
};

const normalizeTouch = (value: unknown): LeadAttributionTouch | null => {
  if (!isRecord(value)) return null;

  const kind = typeof value.kind === 'string' ? value.kind : '';
  const landingPath = normalizePath(typeof value.landing_path === 'string' ? value.landing_path : '');
  if (!touchKinds.has(kind) || !landingPath) return null;

  const touch: LeadAttributionTouch = {
    kind: kind as TouchKind,
    landing_path: landingPath,
  };
  const referrerHost = normalizeHost(typeof value.referrer_host === 'string' ? value.referrer_host : '');
  const internalSourcePath = normalizePath(
    typeof value.internal_source_path === 'string' ? value.internal_source_path : ''
  );
  const machineInterest = normalizeAllowedMachineInterest(
    typeof value.machine_interest === 'string' ? value.machine_interest : ''
  );
  const plannerRecommendation = normalizePlannerRecommendation(
    typeof value.planner_recommendation === 'string' ? value.planner_recommendation : ''
  );
  const plannerBand = normalizePlannerBand(
    typeof value.planner_band === 'string' ? value.planner_band : ''
  );

  if (referrerHost) touch.referrer_host = referrerHost;
  if (internalSourcePath) touch.internal_source_path = internalSourcePath;
  if (machineInterest) touch.machine_interest = machineInterest;
  if (plannerRecommendation) touch.planner_recommendation = plannerRecommendation;
  if (plannerBand) touch.planner_band = plannerBand;

  for (const key of campaignKeys) {
    const campaignValue = normalizeCampaignValue(typeof value[key] === 'string' ? value[key] : '');
    if (campaignValue) touch[key] = campaignValue;
  }

  return touch;
};

const readStoredAttribution = (): LeadAttribution | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1) return null;
    const firstTouch = normalizeTouch(parsed.first_touch);
    const lastTouch = normalizeTouch(parsed.last_touch);
    return firstTouch && lastTouch
      ? { version: 1, first_touch: firstTouch, last_touch: lastTouch }
      : null;
  } catch {
    return null;
  }
};

const writeStoredAttribution = (attribution: LeadAttribution) => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    // Storage policy/private mode failures must not block the public form.
  }
};

const getDocumentReferrerHost = () => {
  if (!documentEntryPending || typeof document === 'undefined' || typeof window === 'undefined') {
    return undefined;
  }

  documentEntryPending = false;
  if (!document.referrer) return undefined;

  try {
    const referrer = new URL(document.referrer);
    if (referrer.origin === window.location.origin) return undefined;
    return normalizeHost(referrer.hostname);
  } catch {
    return undefined;
  }
};

const classifyReferrer = (host: string): TouchKind => {
  const isKnownSearchHost =
    googleSearchHostPattern.test(host) ||
    searchReferrerDomains.some(
      (domain) => host === domain || host.endsWith(`.${domain}`)
    );

  return isKnownSearchHost ? 'organic' : 'referral';
};

const deriveTouch = (): LeadAttributionTouch | null => {
  if (typeof window === 'undefined') return null;

  const landingPath = normalizePath(window.location.pathname) ?? '/';
  const params = new URLSearchParams(window.location.search);
  const campaign: Partial<Record<CampaignKey, string>> = {};
  for (const key of campaignKeys) {
    const value = normalizeCampaignValue(params.get(key));
    if (value) campaign[key] = value;
  }

  const referrerHost = getDocumentReferrerHost();
  const internalSourcePath = normalizePath(params.get('source'));
  const machineInterest = normalizeAllowedMachineInterest(params.get('interest'));
  const plannerRecommendation = normalizePlannerRecommendation(params.get('planner_recommendation'));
  const plannerBand = normalizePlannerBand(params.get('planner_band'));
  const hasCampaign = Object.keys(campaign).length > 0;
  const hasPlanner = Boolean(
    plannerRecommendation ||
    plannerBand ||
    internalSourcePath?.includes('/resources/business-playbook/planner') ||
    internalSourcePath?.includes('/resources/business-playbook/payback-planner')
  );

  const kind: TouchKind = hasCampaign
    ? 'campaign'
    : hasPlanner
      ? 'planner'
      : internalSourcePath
        ? 'internal'
        : referrerHost
          ? classifyReferrer(referrerHost)
          : 'direct';

  return {
    kind,
    landing_path: landingPath,
    ...campaign,
    ...(referrerHost ? { referrer_host: referrerHost } : {}),
    ...(internalSourcePath ? { internal_source_path: internalSourcePath } : {}),
    ...(machineInterest ? { machine_interest: machineInterest } : {}),
    ...(plannerRecommendation ? { planner_recommendation: plannerRecommendation } : {}),
    ...(plannerBand ? { planner_band: plannerBand } : {}),
  };
};

export const captureLeadAttribution = (): LeadAttribution | null => {
  const derivedTouch = deriveTouch();
  if (!derivedTouch) return null;

  const existing = readStoredAttribution();
  if (!existing) {
    const initial = { version: 1, first_touch: derivedTouch, last_touch: derivedTouch } as const;
    writeStoredAttribution(initial);
    return initial;
  }

  if (derivedTouch.kind === 'direct' || JSON.stringify(existing.last_touch) === JSON.stringify(derivedTouch)) {
    return existing;
  }

  const updated: LeadAttribution = { ...existing, last_touch: derivedTouch };
  writeStoredAttribution(updated);
  return updated;
};

export const buildLeadAttributionPayload = ({
  sourcePage,
  machineInterest,
}: {
  sourcePage: string;
  machineInterest?: string;
}): LeadAttributionPayload | undefined => {
  const attribution = captureLeadAttribution() ?? readStoredAttribution();
  if (!attribution) return undefined;

  const safeSourcePath = normalizePath(sourcePage) ?? '/contact';
  const safeMachineInterest = normalizeAllowedMachineInterest(machineInterest);
  const plannerRecommendation = attribution.last_touch.planner_recommendation;
  const plannerBand = attribution.last_touch.planner_band;

  return {
    ...attribution,
    conversion: {
      source_path: safeSourcePath,
      ...(safeMachineInterest ? { machine_interest: safeMachineInterest } : {}),
      ...(plannerRecommendation ? { planner_recommendation: plannerRecommendation } : {}),
      ...(plannerBand ? { planner_band: plannerBand } : {}),
    },
  };
};
