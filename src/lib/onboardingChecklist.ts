export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  action?: { label: string; href: string };
}

export interface OnboardingStepWithState extends OnboardingStep {
  completed: boolean;
}

interface StoredOnboardingState {
  completedStepIds: string[];
}

const STORAGE_KEY_PREFIX = 'bloomjoy-onboarding';

const defaultCompletedStepIds = ['1', '2'];

export const onboardingSteps: OnboardingStep[] = [
  {
    id: '1',
    title: 'Machine unboxing and setup',
    description: 'Unpack your machine and complete the physical setup following the included guide.',
  },
  {
    id: '2',
    title: 'Power on and initial calibration',
    description: 'Power on your machine and run the initial calibration sequence.',
  },
  {
    id: '3',
    title: 'Set up WeChat for manufacturer support',
    description: 'Download WeChat and connect with Sunze support for 24/7 technical assistance.',
    action: { label: 'View Setup Guide', href: '/portal/support' },
  },
  {
    id: '4',
    title: 'Complete first cotton candy spin',
    description: 'Load sugar and complete your first successful cotton candy production.',
  },
  {
    id: '5',
    title: 'Watch essential training videos',
    description: 'Complete the beginner training modules in the training library.',
    action: { label: 'Go to Training', href: '/portal/training' },
  },
];

const getStorageKey = (userKey: string) =>
  `${STORAGE_KEY_PREFIX}:${userKey.trim().toLowerCase()}`;

const getDefaultSteps = (): OnboardingStepWithState[] =>
  onboardingSteps.map((step) => ({
    ...step,
    completed: defaultCompletedStepIds.includes(step.id),
  }));

export const readOnboardingSteps = (userKey?: string): OnboardingStepWithState[] => {
  const defaultSteps = getDefaultSteps();

  if (!userKey || typeof window === 'undefined') {
    return defaultSteps;
  }

  try {
    const rawState = window.localStorage.getItem(getStorageKey(userKey));
    if (!rawState) {
      return defaultSteps;
    }

    const parsed = JSON.parse(rawState) as StoredOnboardingState | null;
    const completedIds = new Set(
      Array.isArray(parsed?.completedStepIds)
        ? parsed.completedStepIds.filter((id): id is string => typeof id === 'string')
        : []
    );

    return onboardingSteps.map((step) => ({
      ...step,
      completed: completedIds.has(step.id),
    }));
  } catch {
    return defaultSteps;
  }
};

export const saveOnboardingSteps = (
  userKey: string | undefined,
  steps: OnboardingStepWithState[]
) => {
  if (!userKey || typeof window === 'undefined') {
    return;
  }

  const state: StoredOnboardingState = {
    completedStepIds: steps.filter((step) => step.completed).map((step) => step.id),
  };

  window.localStorage.setItem(getStorageKey(userKey), JSON.stringify(state));
};

export const getOnboardingProgress = (userKey?: string) => {
  const steps = readOnboardingSteps(userKey);
  const completedCount = steps.filter((step) => step.completed).length;
  const totalSteps = steps.length;
  const progressPercent = totalSteps === 0 ? 0 : Math.round((completedCount / totalSteps) * 100);

  return {
    steps,
    completedCount,
    totalSteps,
    progressPercent,
  };
};
