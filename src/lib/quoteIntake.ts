import { MACHINE_INTEREST_OPTIONS, normalizeMachineInterest } from '@/lib/machineNames';

export const QUOTE_MACHINE_OPTIONS = [...MACHINE_INTEREST_OPTIONS, 'Not sure yet'] as const;

export const QUOTE_VENUE_OPTIONS = [
  'Mobile food facility or food truck',
  'Events and catering',
  'Indoor retail or family entertainment',
  'Hospitality, attractions, or venue placement',
  'School, nonprofit, or community organization',
  'Still exploring the setting',
] as const;

const quoteUsePresets: Record<string, string> = {
  'mobile-food': QUOTE_VENUE_OPTIONS[0],
};

export const QUOTE_TIMELINE_OPTIONS = [
  'Within 30 days',
  '1–3 months',
  '3–6 months',
  'More than 6 months',
  'Researching — no date yet',
] as const;

export const QUOTE_READINESS_OPTIONS = [
  'Ready to review a quote',
  'Comparing machine options',
  'Building an internal plan or budget',
  'Need help identifying the next step',
] as const;

export type QuoteIntakeFields = {
  organization: string;
  venueUse: string;
  serviceRegion: string;
  timeline: string;
  readiness: string;
};

const approvedMachineOptions = new Set<string>(QUOTE_MACHINE_OPTIONS);

export const getSafeQuoteMachineInterest = (rawInterest: string | null) => {
  const normalized = normalizeMachineInterest(rawInterest);
  return approvedMachineOptions.has(normalized) ? normalized : '';
};

export const getSafeQuoteVenueUse = (rawUse: string | null) =>
  rawUse ? quoteUsePresets[rawUse] ?? '' : '';

export const getQuoteSourceLabel = (sourcePage: string) => {
  const sourceLabels: Record<string, string> = {
    '/': 'Bloomjoy home page',
    '/machines': 'machine overview',
    '/machines/commercial-robotic-machine': 'Commercial Machine page',
    '/machines/mini': 'Mini Machine page',
    '/machines/micro': 'Micro Machine page',
    '/solutions/food-trucks': 'food-truck solution guide',
    '/resources/business-playbook/food-truck-mobile-setup-guide': 'mobile setup guide',
    '/resources/business-playbook/payback-planner': 'payback planner',
    '/resources/business-playbook/planner': 'machine-fit planner',
  };

  if (sourceLabels[sourcePage]) return sourceLabels[sourcePage];
  if (sourcePage.startsWith('/resources/business-playbook/')) {
    return 'Bloomjoy Business Playbook';
  }
  if (sourcePage.startsWith('/resources')) return 'Bloomjoy resources';
  if (sourcePage.startsWith('/machines/')) return 'Bloomjoy machine guide';
  return sourcePage === '/contact' ? undefined : 'Bloomjoy website';
};

export const buildStructuredQuoteMessage = ({
  organization,
  venueUse,
  serviceRegion,
  timeline,
  readiness,
  additionalDetails,
}: QuoteIntakeFields & { additionalDetails: string }) =>
  [
    `Business or organization: ${organization.trim() || 'Not provided'}`,
    `Intended setting or use: ${venueUse.trim()}`,
    `Service region: ${serviceRegion.trim()}`,
    `Purchase timeline: ${timeline.trim()}`,
    `Procurement readiness: ${readiness.trim() || 'Not provided'}`,
    '',
    'Additional details:',
    additionalDetails.trim() || 'None provided',
  ].join('\n');
