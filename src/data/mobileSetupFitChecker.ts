import {
  type MobileFitBand,
  type MobileFitMachineSignal,
  type MobileFitOpenQuestionKey,
  type MobileFitPlacement,
} from '@/data/mobileSetupFitContract';

export * from '@/data/mobileSetupFitContract';

export type MobileFitQuestionId =
  | 'placement'
  | 'machine'
  | 'space'
  | 'power'
  | 'staffing'
  | 'service'
  | 'transport'
  | 'localReview';

export type MobileFitAnswer =
  | 'installed'
  | 'adjacent'
  | 'undecided'
  | 'mini'
  | 'commercial'
  | 'micro'
  | 'model-fit-reviewed'
  | 'measured-needs-match'
  | 'not-measured'
  | 'known-no-fit'
  | 'complete-load-reviewed'
  | 'load-listed-needs-review'
  | 'machine-watts-only'
  | 'generator-approval-required'
  | 'trained-manual-staff'
  | 'staff-can-be-assigned'
  | 'automatic-stick-required'
  | 'no-staff-plan'
  | 'flexible-pilot'
  | 'target-needs-review'
  | 'guaranteed-rate-required'
  | 'model-specific-review-complete'
  | 'plan-needs-review'
  | 'not-started'
  | 'improvised'
  | 'confirmed'
  | 'in-progress'
  | 'bloomjoy-approval-required';

export type MobileFitAnswers = Partial<Record<MobileFitQuestionId, MobileFitAnswer>>;

type MobileFitQuestion = {
  id: MobileFitQuestionId;
  category: MobileFitOpenQuestionKey;
  title: string;
  help: string;
  options: readonly {
    id: MobileFitAnswer;
    label: string;
    detail: string;
  }[];
};

export const mobileFitQuestions: readonly MobileFitQuestion[] = [
  {
    id: 'placement',
    category: 'placement',
    title: 'Where would the machine operate?',
    help: 'Installed and adjacent stations create different access, transport, power, and local-review questions.',
    options: [
      {
        id: 'installed',
        label: 'Inside a truck or trailer',
        detail: 'The machine would travel and operate as part of the vehicle or trailer setup.',
      },
      {
        id: 'adjacent',
        label: 'At an adjacent station',
        detail: 'The machine would unload into a stable pop-up, booth, or event-service area.',
      },
      {
        id: 'undecided',
        label: 'Not decided yet',
        detail: 'Both placement models are still being considered.',
      },
    ],
  },
  {
    id: 'machine',
    category: 'machine-path',
    title: 'Which machine path are you checking?',
    help: 'Choose the current path. This is not a compatibility decision or purchase recommendation.',
    options: [
      {
        id: 'mini',
        label: 'Mini Machine',
        detail: 'Published dimensions, weight, power, and staffed service guidance are available.',
      },
      {
        id: 'commercial',
        label: 'Commercial Machine',
        detail: 'A larger quote-only configuration with automatic stick dispensing.',
      },
      {
        id: 'micro',
        label: 'Micro Machine',
        detail: 'A lower-volume path without published mobile setup specifications.',
      },
      {
        id: 'undecided',
        label: 'I need a starting path',
        detail: 'Use staffing and setup answers to identify which product page to investigate.',
      },
    ],
  },
  {
    id: 'space',
    category: 'space-access',
    title: 'What is known about space and access?',
    help: 'Count the published machine envelope, doors and load-in, operator/service clearance, cleaning access, and guest flow.',
    options: [
      {
        id: 'model-fit-reviewed',
        label: 'Exact model and clearances reviewed',
        detail: 'The published model envelope and the full access/service path have been checked.',
      },
      {
        id: 'measured-needs-match',
        label: 'Setup measured; model match pending',
        detail: 'Usable dimensions exist, but an exact machine and clearance review remains.',
      },
      {
        id: 'not-measured',
        label: 'Not measured yet',
        detail: 'The usable footprint, height, access route, or service clearance is still unknown.',
      },
      {
        id: 'known-no-fit',
        label: 'The selected model does not fit',
        detail: 'A known space, access, or guest-flow conflict exists for the current path.',
      },
    ],
  },
  {
    id: 'power',
    category: 'power-source',
    title: 'How far has electrical planning gone?',
    help: 'Published volts and watts are planning inputs only. They do not approve a generator or prove safe total load.',
    options: [
      {
        id: 'complete-load-reviewed',
        label: 'Complete load and source reviewed',
        detail: 'Concurrent loads, approved source, connection, protection, and conditions were reviewed by the appropriate owner.',
      },
      {
        id: 'load-listed-needs-review',
        label: 'All loads listed; review pending',
        detail: 'The machine and other concurrent loads are documented but not yet qualified.',
      },
      {
        id: 'machine-watts-only',
        label: 'Only machine volts/watts are known',
        detail: 'The rest of the operating load and approved source still need review.',
      },
      {
        id: 'generator-approval-required',
        label: 'Bloomjoy must approve my generator',
        detail: 'The plan depends on Bloomjoy certifying a specific generator or electrical system.',
      },
    ],
  },
  {
    id: 'staffing',
    category: 'staffing-flow',
    title: 'What service model is required?',
    help: 'Mini requires trained manual stick feeding. Commercial dispenses sticks automatically, but the wider service plan still needs review.',
    options: [
      {
        id: 'trained-manual-staff',
        label: 'Trained staffed service',
        detail: 'A person can manage stick feeding when required, guests, payment, resets, and shutdowns.',
      },
      {
        id: 'staff-can-be-assigned',
        label: 'Staff can be assigned and trained',
        detail: 'The role is possible, but training and service flow are not complete.',
      },
      {
        id: 'automatic-stick-required',
        label: 'Automatic stick dispensing is required',
        detail: 'Manual stick feeding does not fit the intended service model.',
      },
      {
        id: 'no-staff-plan',
        label: 'No staff plan exists',
        detail: 'Guest flow, payment, monitoring, restock, cleaning, and shutdown ownership remain unclear.',
      },
    ],
  },
  {
    id: 'service',
    category: 'service-volume',
    title: 'How flexible is the service-volume target?',
    help: 'Machine cycles are not guaranteed served throughput. Pattern, staffing, guest/payment flow, and resets change results.',
    options: [
      {
        id: 'flexible-pilot',
        label: 'A flexible pilot or service window',
        detail: 'The team can observe real operating rhythm without requiring a guaranteed rate.',
      },
      {
        id: 'target-needs-review',
        label: 'A target exists and needs review',
        detail: 'The expected window or volume must be checked against machine and staffing realities.',
      },
      {
        id: 'guaranteed-rate-required',
        label: 'A guaranteed serving rate is required',
        detail: 'The decision depends on Bloomjoy promising a fixed throughput outcome.',
      },
    ],
  },
  {
    id: 'transport',
    category: 'transport-plan',
    title: 'What is the transport and load-in posture?',
    help: 'Weight and dimensions do not establish safe handling, orientation, mounting, or securing.',
    options: [
      {
        id: 'model-specific-review-complete',
        label: 'Model-specific plan reviewed',
        detail: 'The appropriate manufacturer, vehicle, handling, and venue owners reviewed the selected setup.',
      },
      {
        id: 'plan-needs-review',
        label: 'A plan exists; review remains',
        detail: 'People, equipment, route, surface, orientation, or securing still need the appropriate confirmation.',
      },
      {
        id: 'not-started',
        label: 'Not started',
        detail: 'The transport, load-in, or installed-travel plan has not been mapped.',
      },
      {
        id: 'improvised',
        label: 'The plan would be improvised',
        detail: 'The current path depends on unreviewed handling, orientation, mounting, or securing.',
      },
    ],
  },
  {
    id: 'localReview',
    category: 'local-review',
    title: 'What is the local and venue review status?',
    help: 'Rules and terminology vary. The relevant venue, insurer, fire/food authority, and enforcement agency own their decisions.',
    options: [
      {
        id: 'confirmed',
        label: 'Applicable reviews identified and confirmed',
        detail: 'The team has current answers from the owners that govern this specific operation.',
      },
      {
        id: 'in-progress',
        label: 'Reviews are in progress',
        detail: 'The right owners are identified, but one or more answers remain open.',
      },
      {
        id: 'not-started',
        label: 'Not started',
        detail: 'Venue, insurer, authority, or enforcement-agency questions have not been mapped.',
      },
      {
        id: 'bloomjoy-approval-required',
        label: 'Bloomjoy must approve permits or local use',
        detail: 'The plan depends on Bloomjoy replacing a venue, insurer, professional, or authority decision.',
      },
    ],
  },
] as const;

export type MobileFitDriver = {
  category: MobileFitOpenQuestionKey;
  tone: 'confirm' | 'stop';
  title: string;
  detail: string;
};

export type MobileFitEvaluation = {
  band: MobileFitBand;
  machineSignal: MobileFitMachineSignal;
  placement: MobileFitPlacement;
  headline: string;
  summary: string;
  drivers: MobileFitDriver[];
  unresolvedQuestions: MobileFitOpenQuestionKey[];
  answeredCount: number;
  missingQuestions: MobileFitQuestionId[];
};

const unique = <TValue,>(values: TValue[]) => [...new Set(values)];

const getMachineSignal = (answers: MobileFitAnswers): MobileFitMachineSignal => {
  if (answers.machine === 'mini' && answers.staffing === 'automatic-stick-required') {
    return 'commercial';
  }
  if (
    answers.machine === 'mini' ||
    answers.machine === 'commercial' ||
    answers.machine === 'micro'
  ) {
    return answers.machine;
  }
  if (answers.staffing === 'automatic-stick-required') return 'commercial';
  if (
    answers.staffing === 'trained-manual-staff' ||
    answers.staffing === 'staff-can-be-assigned'
  ) {
    return 'mini';
  }
  return 'undecided';
};

export const getMobileFitAnswerLabel = (
  questionId: MobileFitQuestionId,
  answer?: MobileFitAnswer
) =>
  mobileFitQuestions
    .find((question) => question.id === questionId)
    ?.options.find((option) => option.id === answer)?.label;

export const evaluateMobileSetupFit = (answers: MobileFitAnswers): MobileFitEvaluation => {
  const missingQuestions = mobileFitQuestions
    .filter((question) => !answers[question.id])
    .map((question) => question.id);
  const answeredCount = mobileFitQuestions.length - missingQuestions.length;
  const machineSignal = getMachineSignal(answers);
  const placement: MobileFitPlacement =
    answers.placement === 'installed' || answers.placement === 'adjacent'
      ? answers.placement
      : 'undecided';

  if (missingQuestions.length > 0) {
    return {
      band: 'incomplete',
      machineSignal,
      placement,
      headline: `Finish ${missingQuestions.length} setup ${missingQuestions.length === 1 ? 'check' : 'checks'}`,
      summary:
        'No fit band is assigned until every categorical check has an answer. Missing information fails safely instead of producing a precise-looking result.',
      drivers: [],
      unresolvedQuestions: missingQuestions.map(
        (questionId) =>
          mobileFitQuestions.find((question) => question.id === questionId)?.category ??
          'machine-path'
      ),
      answeredCount,
      missingQuestions,
    };
  }

  const stopDrivers: MobileFitDriver[] = [];
  const confirmDrivers: MobileFitDriver[] = [];

  if (answers.space === 'known-no-fit') {
    stopDrivers.push({
      category: 'space-access',
      tone: 'stop',
      title: 'The selected path has a known physical conflict',
      detail: 'Do not proceed as though a machine fits when its envelope, access, service clearance, or guest flow does not work.',
    });
  } else if (answers.space !== 'model-fit-reviewed') {
    confirmDrivers.push({
      category: 'space-access',
      tone: 'confirm',
      title: 'Exact model space and access remain open',
      detail: 'Match the published model envelope to load-in, operator/service clearance, cleaning access, and guest flow.',
    });
  }

  if (answers.power === 'generator-approval-required') {
    stopDrivers.push({
      category: 'power-source',
      tone: 'stop',
      title: 'Bloomjoy cannot certify generator compatibility',
      detail: 'A qualified electrical review and the appropriate manufacturer guidance must confirm the complete load and approved source.',
    });
  } else if (answers.power !== 'complete-load-reviewed') {
    confirmDrivers.push({
      category: 'power-source',
      tone: 'confirm',
      title: 'The complete electrical plan is unresolved',
      detail: 'Machine volts and watts alone do not prove capacity, connection, protection, generator compatibility, or safe total load.',
    });
  }

  if (answers.machine === 'mini' && answers.staffing === 'automatic-stick-required') {
    stopDrivers.push({
      category: 'staffing-flow',
      tone: 'stop',
      title: 'Mini conflicts with the required stick flow',
      detail: 'Mini uses manual stick feeding. Investigate the larger Commercial path if automatic stick dispensing is required.',
    });
  } else if (answers.machine === 'mini' && answers.staffing === 'no-staff-plan') {
    stopDrivers.push({
      category: 'staffing-flow',
      tone: 'stop',
      title: 'Mini has no trained staffed-service plan',
      detail: 'Mini requires a person to feed sticks and manage the guest-service rhythm.',
    });
  } else if (
    answers.staffing === 'staff-can-be-assigned' ||
    answers.staffing === 'no-staff-plan'
  ) {
    confirmDrivers.push({
      category: 'staffing-flow',
      tone: 'confirm',
      title: 'Staffing and service ownership need confirmation',
      detail: 'Name who handles guest flow, payment, monitoring, restock, cleaning, resets, and shutdowns before treating the setup as ready.',
    });
  }

  if (answers.service === 'guaranteed-rate-required') {
    stopDrivers.push({
      category: 'service-volume',
      tone: 'stop',
      title: 'A guaranteed serving rate is outside the supported decision',
      detail: 'Machine-cycle guidance is not guaranteed served throughput, revenue, margin, ROI, or payback.',
    });
  } else if (answers.service === 'target-needs-review') {
    confirmDrivers.push({
      category: 'service-volume',
      tone: 'confirm',
      title: 'The service target needs an operating review',
      detail: 'Pattern, staffing, manual stick feeding, guest/payment flow, cleaning, and resets can change served volume.',
    });
  }

  if (answers.transport === 'improvised') {
    stopDrivers.push({
      category: 'transport-plan',
      tone: 'stop',
      title: 'Improvised handling or securing is not supported',
      detail: 'Use model-specific manufacturer guidance and qualified vehicle, handling, and venue review before moving forward.',
    });
  } else if (answers.transport !== 'model-specific-review-complete') {
    confirmDrivers.push({
      category: 'transport-plan',
      tone: 'confirm',
      title: 'Transport and load-in remain open',
      detail: 'Weight and dimensions do not establish safe handling, orientation, mounting, securing, route, or surface.',
    });
  }

  if (answers.localReview === 'bloomjoy-approval-required') {
    stopDrivers.push({
      category: 'local-review',
      tone: 'stop',
      title: 'Bloomjoy cannot replace local or professional approval',
      detail: 'Venue, insurer, fire/food authority, enforcement agency, and licensed professional decisions stay with those owners.',
    });
  } else if (answers.localReview !== 'confirmed') {
    confirmDrivers.push({
      category: 'local-review',
      tone: 'confirm',
      title: 'One or more governing reviews remain open',
      detail: 'Confirm current requirements with the owners that govern this exact vehicle, venue, event, and jurisdiction.',
    });
  }

  if (answers.placement === 'undecided') {
    confirmDrivers.push({
      category: 'placement',
      tone: 'confirm',
      title: 'The physical placement model is undecided',
      detail: 'Installed and adjacent stations require different access, power-route, environment, transport, and local-review questions.',
    });
  }

  if (answers.machine === 'undecided') {
    confirmDrivers.push({
      category: 'machine-path',
      tone: 'confirm',
      title: 'The exact machine path still needs comparison',
      detail: 'Use the indicated product page as a starting point, then match published facts to the actual setup.',
    });
  }

  if (answers.machine === 'micro') {
    confirmDrivers.push({
      category: 'micro-specs',
      tone: 'confirm',
      title: 'Micro mobile specifications are not published',
      detail: 'Do not infer dimensions, weight, power, throughput, or mobile compatibility from its name, price, or qualitative positioning.',
    });
  }

  const drivers = stopDrivers.length > 0 ? stopDrivers : confirmDrivers;
  const band: MobileFitBand =
    stopDrivers.length > 0
      ? 'not-supported'
      : confirmDrivers.length > 0
        ? 'needs-confirmation'
        : 'likely-fit';
  const unresolvedQuestions = unique(drivers.map((driver) => driver.category));

  return {
    band,
    machineSignal,
    placement,
    headline:
      band === 'not-supported'
        ? 'Pause this setup path'
        : band === 'needs-confirmation'
          ? 'Confirm the open setup questions'
          : 'The inputs support a fit conversation',
    summary:
      band === 'not-supported'
        ? 'One or more requirements conflict with published product facts or depend on an approval Bloomjoy cannot provide.'
        : band === 'needs-confirmation'
          ? 'The setup may be worth exploring, but the named checks must be resolved before treating the path as workable.'
          : 'No stop condition is present in these categorical answers. Continue with model-specific, manufacturer, professional, venue, insurer, and local review.',
    drivers,
    unresolvedQuestions,
    answeredCount,
    missingQuestions,
  };
};
