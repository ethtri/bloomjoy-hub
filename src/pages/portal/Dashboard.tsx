import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Lock,
  Package,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { PortalPageIntro } from '@/components/portal/PortalPageIntro';
import {
  canAccessPortalLevel,
  getAccessLevelLabelKey,
  portalDestinations,
  type PortalAccessLevel,
} from '@/components/portal/portalNavigation';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { trackEvent } from '@/lib/analytics';
import type { TranslationKey } from '@/lib/i18n';
import { getOnboardingProgress } from '@/lib/onboardingChecklist';
import {
  bindTracksToTrainingExperience,
  buildTrainingExperience,
  mapTrainingProgressToCanonical,
  useTrainingLibrary,
  useTrainingProgress,
  useTrainingTracks,
} from '@/lib/trainingRepository';
import type { TrainingExperienceItem } from '@/lib/trainingTypes';
import { cn } from '@/lib/utils';

interface DashboardAction {
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  href: string;
  icon: LucideIcon;
  access: PortalAccessLevel;
  upsellCopyKey?: TranslationKey;
}

const sortTrainingItems = (left: TrainingExperienceItem, right: TrainingExperienceItem) => {
  const leftFeatured = left.featuredOrder ?? Number.MAX_SAFE_INTEGER;
  const rightFeatured = right.featuredOrder ?? Number.MAX_SAFE_INTEGER;
  if (leftFeatured !== rightFeatured) {
    return leftFeatured - rightFeatured;
  }

  const leftPriority = left.operatorPriority ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = right.operatorPriority ?? Number.MAX_SAFE_INTEGER;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return left.title.localeCompare(right.title);
};

const dashboardActions: DashboardAction[] = [
  {
    titleKey: 'dashboard.reorderSupplies',
    descriptionKey: 'dashboard.reorderSuppliesDescription',
    href: '/supplies',
    icon: Package,
    access: 'baseline',
  },
  ...portalDestinations
    .filter((destination) => destination.href !== '/portal')
    .map((destination) => ({
      titleKey: destination.labelKey,
      descriptionKey: destination.descriptionKey,
      href: destination.href,
      icon: destination.icon,
      access: destination.access,
      upsellCopyKey: destination.upsellCopyKey,
    })),
];

const onboardingStepCopyKeys: Record<
  string,
  { titleKey: TranslationKey; descriptionKey: TranslationKey }
> = {
  '1': {
    titleKey: 'dashboard.onboardingStep1Title',
    descriptionKey: 'dashboard.onboardingStep1Description',
  },
  '2': {
    titleKey: 'dashboard.onboardingStep2Title',
    descriptionKey: 'dashboard.onboardingStep2Description',
  },
  '3': {
    titleKey: 'dashboard.onboardingStep3Title',
    descriptionKey: 'dashboard.onboardingStep3Description',
  },
  '4': {
    titleKey: 'dashboard.onboardingStep4Title',
    descriptionKey: 'dashboard.onboardingStep4Description',
  },
  '5': {
    titleKey: 'dashboard.onboardingStep5Title',
    descriptionKey: 'dashboard.onboardingStep5Description',
  },
};

export default function PortalDashboard() {
  const { t } = useLanguage();
  const {
    user,
    isMember,
    canAccessTraining,
    hasReportingAccess,
    reportingMachineCount,
    reportingLocationCount,
    portalAccessTier,
    signOut,
  } = useAuth();
  const onboardingProgress = getOnboardingProgress(user?.email);
  const { data: library = [] } = useTrainingLibrary(canAccessTraining);
  const { data: trackDefinitions = [] } = useTrainingTracks(canAccessTraining);
  const { data: trainingProgress = [] } = useTrainingProgress(user?.id, canAccessTraining);

  useEffect(() => {
    trackEvent('view_dashboard');
  }, []);

  if (!user) {
    return null;
  }

  const trainingExperience = buildTrainingExperience(library);
  const canonicalProgress = mapTrainingProgressToCanonical(trainingProgress, trainingExperience);
  const hydratedTracks = bindTracksToTrainingExperience(trackDefinitions, trainingExperience);
  const operatorTrack = hydratedTracks.find((track) => track.slug === 'operator-essentials');
  const progressByTrainingId = new Map(canonicalProgress.map((item) => [item.trainingId, item]));
  const continueLearningItem =
    operatorTrack?.items.find(
      (item) =>
        item.training &&
        progressByTrainingId.get(item.trainingId)?.startedAt &&
        !progressByTrainingId.get(item.trainingId)?.completedAt
    )?.training ??
    operatorTrack?.items.find(
      (item) => item.training && !progressByTrainingId.get(item.trainingId)?.completedAt
    )?.training;
  const requiredTrackItems = operatorTrack?.items.filter((item) => item.required) ?? [];
  const completedRequiredCount = requiredTrackItems.filter((item) =>
    progressByTrainingId.get(item.trainingId)?.completedAt
  ).length;
  const recommendedTrainingItems =
    operatorTrack?.items
      .filter((item) => item.training && !progressByTrainingId.get(item.trainingId)?.completedAt)
      .slice(0, 3)
      .map((item) => item.training!)
      .filter(Boolean) ??
    [];
  const fallbackRecommendations =
    recommendedTrainingItems.length > 0
      ? recommendedTrainingItems
      : [...trainingExperience.tasks].sort(sortTrainingItems).slice(0, 3);
  const onboardingComplete = onboardingProgress.completedCount >= onboardingProgress.totalSteps;
  const onboardingRemainingCount =
    onboardingProgress.totalSteps - onboardingProgress.completedCount;
  const nextOnboardingSteps = onboardingProgress.steps.filter((step) => !step.completed).slice(0, 3);
  const reportingScopeDescription =
    reportingMachineCount > 0
      ? reportingLocationCount > 0
        ? t('dashboard.reportingScopeWithLocations', {
            machines: reportingMachineCount,
            locations: reportingLocationCount,
          })
        : t('dashboard.reportingScopeMachines', { machines: reportingMachineCount })
      : t('dashboard.reportingScopeAssigned');

  const primaryAction = hasReportingAccess && !isMember
    ? {
        label: t('dashboard.openReporting'),
        href: '/portal/reports',
        description: t('dashboard.primaryReportingDescription'),
        helper: reportingScopeDescription,
      }
    : !canAccessTraining
    ? {
        label: t('dashboard.reorderSupplies'),
        href: '/supplies',
        description: t('dashboard.primarySuppliesDescription'),
        helper: t('dashboard.helperBaseline'),
      }
    : !isMember
      ? continueLearningItem
        ? {
            label: t('dashboard.resumeTraining'),
            href: `/portal/training/${continueLearningItem.id}`,
            description: t('dashboard.primaryTrainingResumeDescription'),
            helper: t('dashboard.helperTrainingAccess'),
          }
        : {
            label: t('dashboard.openTrainingHub'),
            href: '/portal/training',
            description: t('dashboard.primaryTrainingHubDescription'),
            helper: t('dashboard.helperTrainingOnly'),
          }
      : !onboardingComplete
      ? {
          label: t('dashboard.continueSetup'),
          href: '/portal/onboarding',
          description: t('dashboard.primaryContinueSetupDescription'),
          helper:
            onboardingRemainingCount === 1
              ? t('dashboard.helperOneSetupStep')
              : t('dashboard.helperManySetupSteps', { count: onboardingRemainingCount }),
        }
      : continueLearningItem
        ? {
            label: t('dashboard.resumeTraining'),
            href: `/portal/training/${continueLearningItem.id}`,
            description: t('dashboard.primaryTrainingResumeDescription'),
            helper: t('dashboard.helperSetupComplete'),
          }
        : {
            label: t('dashboard.openTrainingHub'),
            href: '/portal/training',
            description: t('dashboard.primaryTrainingRecommendationsDescription'),
            helper: t('dashboard.helperTrainingRecommendations'),
          };

  const secondaryAction = !canAccessTraining
    ? {
        label: t('dashboard.viewOrders'),
        href: '/portal/orders',
      }
    : !isMember
      ? {
          label: t('dashboard.openTrainingHub'),
        href: '/portal/training',
      }
    : !onboardingComplete
      ? {
          label: t('dashboard.openTrainingHub'),
        href: '/portal/training',
      }
      : {
          label: t('dashboard.manageAccount'),
          href: '/portal/account',
        };

  const handleDashboardActionClick = (href: string) => {
    if (href === '/supplies') {
      trackEvent('reorder_sugar_click');
      return;
    }

    trackEvent('dashboard_action_click', { href });
  };

  return (
    <PortalLayout>
      <section className="portal-section">
        <div className="container-page portal-stack">
          <PortalPageIntro
            title={t('dashboard.welcome')}
            description={t('dashboard.description')}
            badges={[
              {
                label: isMember
                  ? t('dashboard.plusActive')
                  : canAccessTraining
                    ? t('dashboard.trainingAccess')
                    : t('dashboard.baselineAccess'),
                tone: isMember ? 'success' : canAccessTraining ? 'accent' : 'accent',
                icon: CheckCircle2,
              },
              {
                label: canAccessTraining
                  ? t('dashboard.coreTrainingComplete', {
                      completed: completedRequiredCount,
                      total: requiredTrackItems.length || 0,
                    })
                  : t('dashboard.ordersAccountAvailable'),
                tone: 'muted',
              },
            ]}
            actions={
              <Button variant="outline" size="sm" onClick={() => signOut()}>
                {t('dashboard.signOut')}
              </Button>
            }
          >
            <div className="grid gap-4 xl:grid-cols-[1.35fr,0.95fr]">
              <div className="rounded-[24px] border border-border bg-background p-5 shadow-[var(--shadow-sm)] sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  {t('dashboard.primaryNextStep')}
                </p>
                <h2 className="mt-2 font-display text-2xl font-semibold text-foreground">
                  {primaryAction.label}
                </h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {primaryAction.description}
                </p>
                <p className="mt-3 text-sm text-muted-foreground">{primaryAction.helper}</p>
                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <Button asChild>
                    <Link to={primaryAction.href} onClick={() => handleDashboardActionClick(primaryAction.href)}>
                      {primaryAction.label}
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to={secondaryAction.href}>{secondaryAction.label}</Link>
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                {hasReportingAccess && (
                  <div className="rounded-[24px] border border-primary/20 bg-primary/5 p-5 shadow-[var(--shadow-sm)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                          {t('dashboard.reportingAccess')}
                        </p>
                        <p className="mt-2 font-display text-xl font-semibold text-foreground">
                          {t('dashboard.reportingReady')}
                        </p>
                      </div>
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <BarChart3 className="h-5 w-5" />
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {reportingScopeDescription}
                    </p>
                    <Button asChild variant="outline" className="mt-5 w-full sm:w-auto">
                      <Link to="/portal/reports">{t('dashboard.openReporting')}</Link>
                    </Button>
                  </div>
                )}

                <div className="rounded-[24px] border border-border bg-background p-5 shadow-[var(--shadow-sm)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {t('dashboard.portalAccess')}
                  </p>
                  <p className="mt-2 font-display text-xl font-semibold text-foreground">
                    {isMember
                      ? t('dashboard.everythingUnlocked')
                      : canAccessTraining
                        ? t('dashboard.trainingUnlocked')
                        : t('dashboard.baselineEssentials')}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {isMember
                      ? t('dashboard.portalAccessDescriptionPlus')
                      : canAccessTraining
                        ? t('dashboard.portalAccessDescriptionTraining')
                        : t('dashboard.portalAccessDescriptionBaseline')}
                  </p>
                </div>

                {canAccessTraining ? (
                  <div className="rounded-[24px] border border-border bg-background p-5 shadow-[var(--shadow-sm)]">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {isMember ? t('dashboard.setupProgress') : t('dashboard.trainingProgress')}
                    </p>
                    {isMember ? (
                      <>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <span className="font-display text-3xl font-bold text-foreground">
                            {onboardingProgress.progressPercent}%
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {t('dashboard.progressComplete', {
                              completed: onboardingProgress.completedCount,
                              total: onboardingProgress.totalSteps,
                            })}
                          </span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-sage transition-all"
                            style={{ width: `${onboardingProgress.progressPercent}%` }}
                          />
                        </div>
                        <p className="mt-3 text-sm text-muted-foreground">
                          {onboardingComplete
                            ? t('dashboard.setupCompleteDescription')
                            : t('dashboard.setupIncompleteDescription')}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="mt-2 font-display text-3xl font-bold text-foreground">
                          {completedRequiredCount}/{requiredTrackItems.length || 0}
                        </p>
                        <p className="mt-3 text-sm text-muted-foreground">
                          {t('dashboard.trainingOnlyProgressDescription')}
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="rounded-[24px] border border-primary/20 bg-primary/5 p-5 shadow-[var(--shadow-sm)]">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                      {t('dashboard.unlockPlus')}
                    </p>
                    <p className="mt-2 font-display text-xl font-semibold text-foreground">
                      {t('dashboard.plusUnlocks')}
                    </p>
                    <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                      <li>{t('dashboard.plusBulletSetup')}</li>
                      <li>{t('dashboard.plusBulletTraining')}</li>
                      <li>{t('dashboard.plusBulletSupport')}</li>
                    </ul>
                    <Button asChild className="mt-5">
                      <Link to="/plus">{t('dashboard.viewPlus')}</Link>
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </PortalPageIntro>

          <div className="rounded-[28px] border border-border bg-background/90 p-5 shadow-[var(--shadow-sm)] sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {t('dashboard.jumpBackIn')}
                </p>
                <h2 className="mt-1 font-display text-2xl font-semibold text-foreground">
                  {t('dashboard.quickActions')}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('dashboard.quickActionsDescription')}
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {dashboardActions
                .filter((action) => action.access !== 'reporting' || hasReportingAccess)
                .filter((action) =>
                  portalAccessTier === 'training'
                    ? canAccessPortalLevel(portalAccessTier, action.access, hasReportingAccess)
                    : true
                )
                .map((action) => {
                const locked = !canAccessPortalLevel(
                  portalAccessTier,
                  action.access,
                  hasReportingAccess
                );
                const ActionIcon = action.icon;

                return (
                  <Link
                    key={action.href}
                    to={action.href}
                    onClick={() => handleDashboardActionClick(action.href)}
                    className={cn(
                      'group rounded-[24px] border p-5 transition-all hover:-translate-y-0.5',
                      locked
                        ? 'border-primary/20 bg-primary/5 hover:border-primary/30'
                        : 'border-border bg-background hover:border-primary/20 hover:bg-muted/20'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className={cn(
                          'flex h-11 w-11 items-center justify-center rounded-2xl',
                          locked ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        <ActionIcon className="h-5 w-5" />
                      </span>
                      {locked && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
                          <Lock className="h-3.5 w-3.5" />
                          {t(getAccessLevelLabelKey(action.access))}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-4 font-display text-lg font-semibold text-foreground group-hover:text-primary">
                      {t(action.titleKey)}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {locked
                        ? t(action.upsellCopyKey ?? action.descriptionKey)
                        : t(action.descriptionKey)}
                    </p>
                    <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary">
                      <span>{locked ? t('dashboard.seeAccessDetails') : t('dashboard.openNow')}</span>
                      <ArrowRight className="h-4 w-4" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {isMember ? (
            <div className="grid gap-5 xl:grid-cols-[1.05fr,0.95fr]">
              <div className="rounded-[28px] border border-border bg-background p-5 shadow-[var(--shadow-sm)] sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {t('dashboard.onboardingSnapshot')}
                    </p>
                    <h2 className="mt-1 font-display text-2xl font-semibold text-foreground">
                      {onboardingComplete
                        ? t('dashboard.setupGoodPlace')
                        : t('dashboard.setupNeedsAttention')}
                    </h2>
                  </div>
                  <span className="self-start rounded-full bg-sage-light px-3 py-1.5 text-sm font-medium text-sage">
                    {t('dashboard.percentComplete', { percent: onboardingProgress.progressPercent })}
                  </span>
                </div>
                <div className="mt-5 space-y-3">
                  {onboardingComplete ? (
                    <div className="rounded-[20px] border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                      {t('dashboard.allOnboardingComplete')}
                    </div>
                  ) : (
                    nextOnboardingSteps.map((step) => (
                      <div
                        key={step.id}
                        className="rounded-[20px] border border-border bg-muted/20 p-4"
                      >
                        <p className="font-medium text-foreground">
                          {onboardingStepCopyKeys[step.id]
                            ? t(onboardingStepCopyKeys[step.id].titleKey)
                            : step.title}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {onboardingStepCopyKeys[step.id]
                            ? t(onboardingStepCopyKeys[step.id].descriptionKey)
                            : step.description}
                        </p>
                      </div>
                    ))
                  )}
                </div>
                <Button asChild className="mt-5 w-full sm:w-auto">
                  <Link to="/portal/onboarding">
                    {onboardingComplete
                      ? t('dashboard.reviewSetupChecklist')
                      : t('dashboard.continueSetup')}
                  </Link>
                </Button>
              </div>

              <div className="rounded-[28px] border border-border bg-background p-5 shadow-[var(--shadow-sm)] sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {t('dashboard.recommendedTraining')}
                    </p>
                    <h2 className="mt-1 font-display text-2xl font-semibold text-foreground">
                      {t('dashboard.liveNextStepRecommendations')}
                    </h2>
                  </div>
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                {fallbackRecommendations.length > 0 ? (
                  <div className="mt-5 space-y-3">
                    {fallbackRecommendations.map((item) => (
                      <Link
                        key={item.id}
                        to={`/portal/training/${item.id}`}
                        className="block rounded-[20px] border border-border bg-muted/20 p-4 transition-colors hover:border-primary/20 hover:bg-muted/30"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-foreground">{item.title}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {item.taskCategory}
                              {item.duration ? ` • ${item.duration}` : ''}
                            </p>
                          </div>
                          <ArrowRight className="mt-0.5 h-4 w-4 text-primary" />
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="mt-5 rounded-[20px] border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                    {t('dashboard.noLiveRecommendations')}
                  </div>
                )}
                <Button asChild variant="outline" className="mt-5 w-full sm:w-auto">
                  <Link to="/portal/training">
                    {t('dashboard.openTrainingHub')}
                  </Link>
                </Button>
              </div>
            </div>
          ) : canAccessTraining ? (
            <div className="grid gap-5 xl:grid-cols-[1.05fr,0.95fr]">
              <div className="rounded-[28px] border border-border bg-background p-5 shadow-[var(--shadow-sm)] sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {t('dashboard.trainingWorkspace')}
                </p>
                <h2 className="mt-1 font-display text-2xl font-semibold text-foreground">
                  {t('dashboard.operatorReadiness')}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t('dashboard.trainingWorkspaceDescription')}
                </p>
                <Button asChild className="mt-5 w-full sm:w-auto">
                  <Link to="/portal/training">{t('dashboard.openTrainingHub')}</Link>
                </Button>
              </div>

              <div className="rounded-[28px] border border-border bg-background p-5 shadow-[var(--shadow-sm)] sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {t('dashboard.recommendedTraining')}
                    </p>
                    <h2 className="mt-1 font-display text-2xl font-semibold text-foreground">
                      {t('dashboard.nextOperatorTasks')}
                    </h2>
                  </div>
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                {fallbackRecommendations.length > 0 ? (
                  <div className="mt-5 space-y-3">
                    {fallbackRecommendations.map((item) => (
                      <Link
                        key={item.id}
                        to={`/portal/training/${item.id}`}
                        className="block rounded-[20px] border border-border bg-muted/20 p-4 transition-colors hover:border-primary/20 hover:bg-muted/30"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-foreground">{item.title}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {item.taskCategory}
                              {item.duration ? ` - ${item.duration}` : ''}
                            </p>
                          </div>
                          <ArrowRight className="mt-0.5 h-4 w-4 text-primary" />
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="mt-5 rounded-[20px] border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                    {t('dashboard.noTrainingRecommendations')}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-5 xl:grid-cols-[1.05fr,0.95fr]">
              <div className="rounded-[28px] border border-border bg-background p-5 shadow-[var(--shadow-sm)] sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {t('dashboard.baselineTools')}
                </p>
                <h2 className="mt-1 font-display text-2xl font-semibold text-foreground">
                  {t('dashboard.whatCanDo')}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t('dashboard.baselineToolsDescription')}
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <Link
                    to="/portal/orders"
                    className="rounded-[20px] border border-border bg-muted/20 p-4 transition-colors hover:border-primary/20 hover:bg-muted/30"
                  >
                    <p className="font-medium text-foreground">{t('dashboard.orderHistory')}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('dashboard.orderHistoryDescription')}
                    </p>
                  </Link>
                  <Link
                    to="/portal/account"
                    className="rounded-[20px] border border-border bg-muted/20 p-4 transition-colors hover:border-primary/20 hover:bg-muted/30"
                  >
                    <p className="font-medium text-foreground">{t('dashboard.accountSettings')}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('dashboard.accountSettingsDescription')}
                    </p>
                  </Link>
                </div>
              </div>

              <div className="rounded-[28px] border border-primary/20 bg-primary/5 p-5 shadow-[var(--shadow-sm)] sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  {t('dashboard.whyUpgrade')}
                </p>
                <h2 className="mt-1 font-display text-2xl font-semibold text-foreground">
                  {t('dashboard.plusOperatingSystem')}
                </h2>
                <div className="mt-5 space-y-3">
                  {portalDestinations
                    .filter((destination) => destination.access === 'plus')
                    .map((destination) => (
                      <div
                        key={destination.href}
                        className="rounded-[20px] border border-primary/15 bg-background/70 p-4"
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                            <destination.icon className="h-5 w-5" />
                          </span>
                          <div>
                            <p className="font-medium text-foreground">{t(destination.labelKey)}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {t(destination.upsellCopyKey ?? destination.descriptionKey)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
                <Button asChild className="mt-5 w-full sm:w-auto">
                  <Link to="/plus">{t('dashboard.explorePlus')}</Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </PortalLayout>
  );
}
