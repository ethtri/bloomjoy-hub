import { MACHINE_INTEREST_OPTIONS, normalizeMachineInterest } from '@/lib/machineNames';
import { plannerPath } from '@/data/businessPlaybookPlanner';
import { FOOD_TRUCK_DESSERT_ADD_ONS_PATH } from '@/data/dessertAddOnComparisonContract';
import { FOOD_TRUCK_CATERING_DESSERT_MENU_PATH } from '@/data/cateringDessertMenuContract';
import {
  MOBILE_FIT_BANDS,
  MOBILE_FIT_MACHINE_SIGNALS,
  MOBILE_FIT_OPEN_QUESTION_KEYS,
  MOBILE_FIT_PLACEMENTS,
  MOBILE_SETUP_FIT_CHECKER_PATH,
  mobileFitBandLabels,
  mobileFitMachineLabels,
  mobileFitOpenQuestionLabels,
  mobileFitPlacementLabels,
  type MobileFitBand,
  type MobileFitMachineSignal,
  type MobileFitOpenQuestionKey,
  type MobileFitPlacement,
} from '@/data/mobileSetupFitContract';

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

export const PLANNER_MACHINE_SIGNALS = ['commercial', 'mini', 'micro', 'undecided'] as const;
export const PLANNER_INTENDED_PATHS = [
  'venue-placement',
  'events-catering',
  'small-test',
  'exploring',
] as const;
export const PLANNER_BUDGET_BANDS = ['not-started', 'incomplete', 'reviewed'] as const;
export const PLANNER_OPEN_QUESTION_KEYS = [
  'operating-path',
  'setting',
  'service-model',
  'pattern-needs',
  'operating-blocker',
  'budget-scenario',
  'machine-cost',
  'landed-cost',
] as const;

export type PlannerMachineSignal = (typeof PLANNER_MACHINE_SIGNALS)[number];
export type PlannerIntendedPath = (typeof PLANNER_INTENDED_PATHS)[number];
export type PlannerBudgetBand = (typeof PLANNER_BUDGET_BANDS)[number];
export type PlannerOpenQuestionKey = (typeof PLANNER_OPEN_QUESTION_KEYS)[number];

export type PlannerQuoteContext = {
  machineSignal: PlannerMachineSignal;
  intendedPath: PlannerIntendedPath;
  budgetBand: PlannerBudgetBand;
  openQuestions: PlannerOpenQuestionKey[];
};

export type MobileFitQuoteContext = {
  resultBand: MobileFitBand;
  machineSignal: MobileFitMachineSignal;
  placement: MobileFitPlacement;
  openQuestions: MobileFitOpenQuestionKey[];
};

const plannerMachineSignalLabels: Record<PlannerMachineSignal, string> = {
  commercial: 'Commercial Machine',
  mini: 'Mini Machine',
  micro: 'Micro Machine',
  undecided: 'No clear machine signal yet',
};

const plannerIntendedPathLabels: Record<PlannerIntendedPath, string> = {
  'venue-placement': 'Venue placement',
  'events-catering': 'Events or catering',
  'small-test': 'Smaller test before expanding',
  exploring: 'Still exploring the operating path',
};

const plannerBudgetBandLabels: Record<PlannerBudgetBand, string> = {
  'not-started': 'No budget scenario selected',
  incomplete: 'Working budget with unresolved categories',
  reviewed: 'All planner budget categories reviewed',
};

const plannerOpenQuestionLabels: Record<PlannerOpenQuestionKey, string> = {
  'operating-path': 'operating path',
  setting: 'intended setting',
  'service-model': 'service model',
  'pattern-needs': 'pattern needs',
  'operating-blocker': 'largest operating blocker',
  'budget-scenario': 'budget scenario',
  'machine-cost': 'machine cost or quote',
  'landed-cost': 'freight and landed cost',
};

const plannerMachineSignals = new Set<string>(PLANNER_MACHINE_SIGNALS);
const plannerIntendedPaths = new Set<string>(PLANNER_INTENDED_PATHS);
const plannerBudgetBands = new Set<string>(PLANNER_BUDGET_BANDS);
const plannerOpenQuestionKeys = new Set<string>(PLANNER_OPEN_QUESTION_KEYS);
const mobileFitBands = new Set<string>(MOBILE_FIT_BANDS);
const mobileFitMachineSignals = new Set<string>(MOBILE_FIT_MACHINE_SIGNALS);
const mobileFitPlacements = new Set<string>(MOBILE_FIT_PLACEMENTS);
const mobileFitOpenQuestionKeys = new Set<string>(MOBILE_FIT_OPEN_QUESTION_KEYS);

const normalizePlannerValue = <TValue extends string>(
  value: string | null | undefined,
  allowed: Set<string>
) => {
  const normalized = value?.trim().toLowerCase();
  return normalized && allowed.has(normalized) ? (normalized as TValue) : undefined;
};

const normalizePlannerOpenQuestions = (
  values: readonly string[] | string | null | undefined
): PlannerOpenQuestionKey[] => {
  const candidates = Array.isArray(values) ? values : String(values ?? '').split(',');
  return [...new Set(candidates
    .map((value) => normalizePlannerValue<PlannerOpenQuestionKey>(value, plannerOpenQuestionKeys))
    .filter((value): value is PlannerOpenQuestionKey => Boolean(value))
  )];
};

export const buildPlannerQuoteHref = ({
  machineSignal,
  intendedPath,
  budgetBand,
  openQuestions,
}: PlannerQuoteContext) => {
  const safeMachineSignal =
    normalizePlannerValue<PlannerMachineSignal>(machineSignal, plannerMachineSignals) ?? 'undecided';
  const safeIntendedPath =
    normalizePlannerValue<PlannerIntendedPath>(intendedPath, plannerIntendedPaths) ?? 'exploring';
  const safeBudgetBand =
    normalizePlannerValue<PlannerBudgetBand>(budgetBand, plannerBudgetBands) ?? 'not-started';
  const safeOpenQuestions = normalizePlannerOpenQuestions(openQuestions);
  const params = new URLSearchParams({
    type: 'quote',
    interest: 'commercial',
    source: plannerPath,
    planner_machine: safeMachineSignal,
    planner_path: safeIntendedPath,
    planner_budget: safeBudgetBand,
  });

  if (safeOpenQuestions.length > 0) {
    params.set('planner_open', safeOpenQuestions.join(','));
  }

  return `/contact?${params.toString()}`;
};

export const getSafePlannerQuoteContext = ({
  sourcePage,
  machineSignal,
  intendedPath,
  budgetBand,
  openQuestions,
}: {
  sourcePage: string;
  machineSignal?: string | null;
  intendedPath?: string | null;
  budgetBand?: string | null;
  openQuestions?: string | null;
}): PlannerQuoteContext | null => {
  if (sourcePage !== plannerPath) return null;

  const safeMachineSignal = normalizePlannerValue<PlannerMachineSignal>(
    machineSignal,
    plannerMachineSignals
  );
  const safeIntendedPath = normalizePlannerValue<PlannerIntendedPath>(
    intendedPath,
    plannerIntendedPaths
  );
  const safeBudgetBand = normalizePlannerValue<PlannerBudgetBand>(budgetBand, plannerBudgetBands);
  const safeOpenQuestions = normalizePlannerOpenQuestions(openQuestions);

  if (!safeMachineSignal && !safeIntendedPath && !safeBudgetBand && safeOpenQuestions.length === 0) {
    return null;
  }

  return {
    machineSignal: safeMachineSignal ?? 'undecided',
    intendedPath: safeIntendedPath ?? 'exploring',
    budgetBand: safeBudgetBand ?? 'not-started',
    openQuestions: safeOpenQuestions,
  };
};

export const getPlannerQuoteContextLabels = (context: PlannerQuoteContext) => ({
  machineSignal: plannerMachineSignalLabels[context.machineSignal],
  intendedPath: plannerIntendedPathLabels[context.intendedPath],
  budgetBand: plannerBudgetBandLabels[context.budgetBand],
  openQuestions: context.openQuestions.map((key) => plannerOpenQuestionLabels[key]),
});

const normalizeMobileFitOpenQuestions = (
  values: readonly string[] | string | null | undefined
): MobileFitOpenQuestionKey[] => {
  const candidates = Array.isArray(values) ? values : String(values ?? '').split(',');
  return [...new Set(candidates
    .map((value) =>
      normalizePlannerValue<MobileFitOpenQuestionKey>(value, mobileFitOpenQuestionKeys)
    )
    .filter((value): value is MobileFitOpenQuestionKey => Boolean(value))
  )];
};

export const buildMobileFitQuoteHref = ({
  resultBand,
  machineSignal,
  placement,
  openQuestions,
}: MobileFitQuoteContext) => {
  const safeResultBand =
    normalizePlannerValue<MobileFitBand>(resultBand, mobileFitBands) ?? 'needs-confirmation';
  const safeMachineSignal =
    normalizePlannerValue<MobileFitMachineSignal>(machineSignal, mobileFitMachineSignals) ??
    'undecided';
  const safePlacement =
    normalizePlannerValue<MobileFitPlacement>(placement, mobileFitPlacements) ?? 'undecided';
  const safeOpenQuestions = normalizeMobileFitOpenQuestions(openQuestions);
  const params = new URLSearchParams({
    type: 'quote',
    interest: 'commercial',
    source: MOBILE_SETUP_FIT_CHECKER_PATH,
    use: 'mobile-food',
    mobile_fit: safeResultBand,
    mobile_machine: safeMachineSignal,
    mobile_placement: safePlacement,
  });

  if (safeOpenQuestions.length > 0) {
    params.set('mobile_open', safeOpenQuestions.join(','));
  }

  return `/contact?${params.toString()}`;
};

export const getSafeMobileFitQuoteContext = ({
  sourcePage,
  resultBand,
  machineSignal,
  placement,
  openQuestions,
}: {
  sourcePage: string;
  resultBand?: string | null;
  machineSignal?: string | null;
  placement?: string | null;
  openQuestions?: string | null;
}): MobileFitQuoteContext | null => {
  if (sourcePage !== MOBILE_SETUP_FIT_CHECKER_PATH) return null;

  const safeResultBand = normalizePlannerValue<MobileFitBand>(resultBand, mobileFitBands);
  const safeMachineSignal = normalizePlannerValue<MobileFitMachineSignal>(
    machineSignal,
    mobileFitMachineSignals
  );
  const safePlacement = normalizePlannerValue<MobileFitPlacement>(placement, mobileFitPlacements);
  const safeOpenQuestions = normalizeMobileFitOpenQuestions(openQuestions);

  if (!safeResultBand && !safeMachineSignal && !safePlacement && safeOpenQuestions.length === 0) {
    return null;
  }

  return {
    resultBand: safeResultBand ?? 'needs-confirmation',
    machineSignal: safeMachineSignal ?? 'undecided',
    placement: safePlacement ?? 'undecided',
    openQuestions: safeOpenQuestions,
  };
};

export const getMobileFitQuoteContextLabels = (context: MobileFitQuoteContext) => ({
  resultBand: mobileFitBandLabels[context.resultBand],
  machineSignal: mobileFitMachineLabels[context.machineSignal],
  placement: mobileFitPlacementLabels[context.placement],
  openQuestions: context.openQuestions.map((key) => mobileFitOpenQuestionLabels[key]),
});

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
    [MOBILE_SETUP_FIT_CHECKER_PATH]: 'mobile setup fit checker',
    [FOOD_TRUCK_DESSERT_ADD_ONS_PATH]: 'food-truck dessert add-on comparison',
    [FOOD_TRUCK_CATERING_DESSERT_MENU_PATH]: 'food-truck catering dessert package guide',
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
  plannerContext,
  mobileFitContext,
}: QuoteIntakeFields & {
  additionalDetails: string;
  plannerContext?: PlannerQuoteContext | null;
  mobileFitContext?: MobileFitQuoteContext | null;
}) => {
  const plannerLabels = plannerContext
    ? getPlannerQuoteContextLabels(plannerContext)
    : null;
  const mobileFitLabels = mobileFitContext
    ? getMobileFitQuoteContextLabels(mobileFitContext)
    : null;

  return [
    `Business or organization: ${organization.trim() || 'Not provided'}`,
    `Intended setting or use: ${venueUse.trim()}`,
    `Service region: ${serviceRegion.trim()}`,
    `Purchase timeline: ${timeline.trim()}`,
    `Procurement readiness: ${readiness.trim() || 'Not provided'}`,
    '',
    'Additional details:',
    additionalDetails.trim() || 'None provided',
    ...(plannerLabels
      ? [
          '',
          'Planner summary (categorical; no exact financial inputs):',
          `Machine signal: ${plannerLabels.machineSignal}`,
          `Intended path: ${plannerLabels.intendedPath}`,
          `Budget completeness: ${plannerLabels.budgetBand}`,
          `Open question categories: ${plannerLabels.openQuestions.join(', ') || 'None recorded'}`,
        ]
      : []),
    ...(mobileFitLabels
      ? [
          '',
          'Mobile setup fit-checker summary (categorical; no free text or exact financial inputs):',
          `Result band: ${mobileFitLabels.resultBand}`,
          `Machine signal: ${mobileFitLabels.machineSignal}`,
          `Placement: ${mobileFitLabels.placement}`,
          `Open question categories: ${mobileFitLabels.openQuestions.join(', ') || 'None recorded'}`,
        ]
      : []),
  ].join('\n');
};
