const campaignKeys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;
const touchKinds = new Set([
  "direct",
  "organic",
  "referral",
  "campaign",
  "internal",
  "planner",
]);
const plannerRecommendations = new Set([
  "commercial",
  "mini",
  "micro",
  "undecided",
]);
const plannerBands = new Set([
  "clear",
  "close_call",
  "exploring",
  "not-started",
  "incomplete",
  "reviewed",
  "blank",
  "low",
  "medium",
  "high",
]);
const machineInterests = new Set([
  "Commercial Machine",
  "Mini Machine",
  "Micro Machine",
  "Not sure yet",
]);
const emailLikePattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const phoneLikePattern = /(?:\+?\d[\s().-]*){7,}/;
const campaignValuePattern = /^[a-z0-9][a-z0-9 _./-]*$/i;
const hostPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const privatePathPrefixes = [
  "/portal",
  "/admin",
  "/login",
  "/reset-password",
  "/refunds",
];

type CampaignKey = (typeof campaignKeys)[number];
type LeadAttributionTouch = Partial<Record<CampaignKey, string>> & {
  kind: string;
  landing_path: string;
  referrer_host?: string;
  internal_source_path?: string;
  machine_interest?: string;
  planner_recommendation?: string;
  planner_band?: string;
};

export type NormalizedLeadAttribution = {
  version: 1;
  first_touch?: LeadAttributionTouch;
  last_touch?: LeadAttributionTouch;
  conversion: {
    source_path: string;
    machine_interest?: string;
    planner_recommendation?: string;
    planner_band?: string;
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const containsLikelyPii = (value: string) =>
  emailLikePattern.test(value) || phoneLikePattern.test(value);

const containsControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

const normalizePath = (value: unknown, fallback?: string) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;

  try {
    const pathname = new URL(raw, "https://www.bloomjoyusa.com").pathname;
    const decodedPath = decodeURIComponent(pathname);
    const isPrivatePath = privatePathPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
    if (
      isPrivatePath ||
      containsLikelyPii(decodedPath) ||
      containsControlCharacter(decodedPath)
    ) {
      return fallback;
    }
    return pathname.slice(0, 160);
  } catch {
    return fallback;
  }
};

const normalizeCampaignValue = (value: unknown) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (
    !raw ||
    raw.length > 80 ||
    containsLikelyPii(raw) ||
    !campaignValuePattern.test(raw) ||
    raw.includes("://") ||
    raw.includes("?") ||
    raw.includes("#")
  ) {
    return undefined;
  }
  return raw;
};

const normalizeHost = (value: unknown) => {
  const raw = typeof value === "string"
    ? value.trim().toLowerCase().replace(/\.$/, "")
    : "";
  if (!raw || !hostPattern.test(raw) || containsLikelyPii(raw)) return undefined;
  return raw;
};

const normalizeMachineInterest = (value: unknown) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (machineInterests.has(raw)) return raw;

  const normalized = raw.replace(/[-_]/g, " ").replace(/\s+/g, " ").toLowerCase();
  if (normalized.includes("commercial")) return "Commercial Machine";
  if (normalized === "mini" || normalized === "mini machine") return "Mini Machine";
  if (normalized === "micro" || normalized === "micro machine") return "Micro Machine";
  return undefined;
};

const normalizePlannerRecommendation = (value: unknown) => {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return plannerRecommendations.has(raw) ? raw : undefined;
};

const normalizePlannerBand = (value: unknown) => {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return plannerBands.has(raw) ? raw : undefined;
};

const normalizeTouch = (value: unknown): LeadAttributionTouch | undefined => {
  if (!isRecord(value)) return undefined;

  const kind = typeof value.kind === "string" ? value.kind.trim().toLowerCase() : "";
  const landingPath = normalizePath(value.landing_path);
  if (!touchKinds.has(kind) || !landingPath) return undefined;

  const touch: LeadAttributionTouch = { kind, landing_path: landingPath };
  const referrerHost = normalizeHost(value.referrer_host);
  const internalSourcePath = normalizePath(value.internal_source_path);
  const machineInterest = normalizeMachineInterest(value.machine_interest);
  const plannerRecommendation = normalizePlannerRecommendation(
    value.planner_recommendation,
  );
  const plannerBand = normalizePlannerBand(value.planner_band);

  if (referrerHost) touch.referrer_host = referrerHost;
  if (internalSourcePath) touch.internal_source_path = internalSourcePath;
  if (machineInterest) touch.machine_interest = machineInterest;
  if (plannerRecommendation) {
    touch.planner_recommendation = plannerRecommendation;
  }
  if (plannerBand) touch.planner_band = plannerBand;

  for (const key of campaignKeys) {
    const campaignValue = normalizeCampaignValue(value[key]);
    if (campaignValue) touch[key] = campaignValue;
  }

  return touch;
};

export const normalizeLeadAttribution = (
  value: unknown,
  {
    sourcePage,
    machineInterest,
  }: {
    sourcePage: string;
    machineInterest?: string;
  },
): NormalizedLeadAttribution => {
  const payload = isRecord(value) ? value : {};
  const conversionPayload = isRecord(payload.conversion)
    ? payload.conversion
    : {};
  const firstTouch = normalizeTouch(payload.first_touch);
  const lastTouch = normalizeTouch(payload.last_touch);
  const safeMachineInterest = normalizeMachineInterest(machineInterest);
  const plannerRecommendation = normalizePlannerRecommendation(
    conversionPayload.planner_recommendation,
  ) ?? normalizePlannerRecommendation(lastTouch?.planner_recommendation);
  const plannerBand = normalizePlannerBand(
    conversionPayload.planner_band,
  ) ?? normalizePlannerBand(lastTouch?.planner_band);

  return {
    version: 1,
    ...(firstTouch ? { first_touch: firstTouch } : {}),
    ...(lastTouch ? { last_touch: lastTouch } : {}),
    conversion: {
      source_path: normalizePath(sourcePage, "/contact") ?? "/contact",
      ...(safeMachineInterest ? { machine_interest: safeMachineInterest } : {}),
      ...(plannerRecommendation ? { planner_recommendation: plannerRecommendation } : {}),
      ...(plannerBand ? { planner_band: plannerBand } : {}),
    },
  };
};

const formatTouch = (
  label: string,
  touch: LeadAttributionTouch | undefined,
): string[] => {
  if (!touch) return [`- ${label}: unavailable`];

  const parts = [`${touch.kind} @ ${touch.landing_path}`];
  if (touch.referrer_host) parts.push(`referrer=${touch.referrer_host}`);
  if (touch.internal_source_path) {
    parts.push(`source=${touch.internal_source_path}`);
  }
  if (touch.utm_source) parts.push(`utm_source=${touch.utm_source}`);
  if (touch.utm_medium) parts.push(`utm_medium=${touch.utm_medium}`);
  if (touch.utm_campaign) parts.push(`utm_campaign=${touch.utm_campaign}`);
  if (touch.utm_content) parts.push(`utm_content=${touch.utm_content}`);
  if (touch.utm_term) parts.push(`utm_term=${touch.utm_term}`);
  if (touch.machine_interest) parts.push(`machine=${touch.machine_interest}`);
  if (touch.planner_recommendation) {
    parts.push(`planner=${touch.planner_recommendation}`);
  }
  if (touch.planner_band) parts.push(`band=${touch.planner_band}`);
  return [`- ${label}: ${parts.join(" | ")}`];
};

export const formatLeadAttributionLines = (
  attribution: unknown,
): string[] => {
  if (!isRecord(attribution) || !isRecord(attribution.conversion)) return [];

  const normalizedAttribution = attribution as NormalizedLeadAttribution;
  const sourcePath = normalizePath(normalizedAttribution.conversion.source_path);
  if (!sourcePath) return [];
  const machineInterest = normalizeMachineInterest(
    normalizedAttribution.conversion.machine_interest,
  );
  const plannerRecommendation = normalizePlannerRecommendation(
    normalizedAttribution.conversion.planner_recommendation,
  );
  const plannerBand = normalizePlannerBand(
    normalizedAttribution.conversion.planner_band,
  );

  const conversionParts = [
    `source=${sourcePath}`,
    ...(machineInterest
      ? [`machine=${machineInterest}`]
      : []),
    ...(plannerRecommendation
      ? [`planner=${plannerRecommendation}`]
      : []),
    ...(plannerBand
      ? [`band=${plannerBand}`]
      : []),
  ];

  return [
    "",
    "Lead Attribution:",
    ...formatTouch("First touch", normalizeTouch(normalizedAttribution.first_touch)),
    ...formatTouch("Last touch", normalizeTouch(normalizedAttribution.last_touch)),
    `- Conversion: ${conversionParts.join(" | ")}`,
  ];
};
