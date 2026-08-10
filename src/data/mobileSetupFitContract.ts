export const MOBILE_SETUP_FIT_CHECKER_PATH =
  '/resources/business-playbook/mobile-setup-fit-checker';

export const MOBILE_FIT_BANDS = [
  'incomplete',
  'likely-fit',
  'needs-confirmation',
  'not-supported',
] as const;

export const MOBILE_FIT_MACHINE_SIGNALS = [
  'commercial',
  'mini',
  'micro',
  'undecided',
] as const;

export const MOBILE_FIT_PLACEMENTS = ['installed', 'adjacent', 'undecided'] as const;

export const MOBILE_FIT_OPEN_QUESTION_KEYS = [
  'placement',
  'machine-path',
  'space-access',
  'power-source',
  'staffing-flow',
  'service-volume',
  'transport-plan',
  'local-review',
  'micro-specs',
] as const;

export type MobileFitBand = (typeof MOBILE_FIT_BANDS)[number];
export type MobileFitMachineSignal = (typeof MOBILE_FIT_MACHINE_SIGNALS)[number];
export type MobileFitPlacement = (typeof MOBILE_FIT_PLACEMENTS)[number];
export type MobileFitOpenQuestionKey = (typeof MOBILE_FIT_OPEN_QUESTION_KEYS)[number];

export const mobileFitBandLabels: Record<MobileFitBand, string> = {
  incomplete: 'Incomplete setup screen',
  'likely-fit': 'Likely fit to explore',
  'needs-confirmation': 'Needs confirmation',
  'not-supported': 'Not currently supported',
};

export const mobileFitMachineLabels: Record<MobileFitMachineSignal, string> = {
  commercial: 'Commercial Machine',
  mini: 'Mini Machine',
  micro: 'Micro Machine',
  undecided: 'No machine path yet',
};

export const mobileFitPlacementLabels: Record<MobileFitPlacement, string> = {
  installed: 'Installed in a truck or trailer',
  adjacent: 'Adjacent station or pop-up',
  undecided: 'Placement not decided',
};

export const mobileFitOpenQuestionLabels: Record<MobileFitOpenQuestionKey, string> = {
  placement: 'placement model',
  'machine-path': 'machine path',
  'space-access': 'space, access, and guest flow',
  'power-source': 'complete electrical load and approved source',
  'staffing-flow': 'staffing and service flow',
  'service-volume': 'service-volume expectations',
  'transport-plan': 'transport, load-in, orientation, or securing',
  'local-review': 'venue, insurer, professional, or local review',
  'micro-specs': 'unpublished Micro mobile setup specifications',
};

export const MOBILE_FIT_DECISION_BOUNDARY =
  'This checker organizes categorical planning signals. It does not certify generator compatibility, safe vehicle mounting or securing, transport orientation, ventilation, weather use, permit approval, venue acceptance, throughput, revenue, margin, ROI, or payback.';
