import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  HeadphonesIcon,
  ListChecks,
  Package,
  ReceiptText,
  RefreshCw,
  Settings2,
  ShoppingBag,
  Sparkles,
  Users2,
  type LucideIcon,
} from 'lucide-react';
import { getVisibleAdminDestinations } from '@/components/layout/authenticatedNavigation';
import { PortalLayout } from '@/components/portal/PortalLayout';
import {
  canAccessPortalLevel,
  type PortalAccessLevel,
} from '@/components/portal/portalNavigation';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePortalTechnicianManagement } from '@/hooks/usePortalTechnicianManagement';
import { usePortalTimekeepingAccess } from '@/hooks/usePortalTimekeepingAccess';
import { trackEvent } from '@/lib/analytics';
import type { TranslationKey } from '@/lib/i18n';
import { getOnboardingProgress } from '@/lib/onboardingChecklist';
import {
  markPortalDashboardDataReady,
  markPortalDashboardVisible,
} from '@/lib/portalPerformance';
import {
  bindTracksToTrainingExperience,
  buildTrainingExperience,
  mapTrainingProgressToCanonical,
  useTrainingLibrary,
  useTrainingProgress,
  useTrainingTracks,
} from '@/lib/trainingRepository';
import { cn } from '@/lib/utils';

interface DashboardActionDefinition {
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  href: string;
  icon: LucideIcon;
  access: PortalAccessLevel;
}

interface DashboardAction {
  title: string;
  description: string;
  helper?: string;
  label: string;
  href: string;
  icon: LucideIcon;
  needsAttention?: boolean;
}

interface DashboardAttentionItem {
  title: string;
  description: string;
  actionLabel: string;
  href: string;
  icon: LucideIcon;
}

interface DashboardStatusItem {
  title: string;
  description: string;
  icon: LucideIcon;
  progress?: {
    value: number;
    label: string;
  };
}

const shortcutDefinitions: DashboardActionDefinition[] = [
  {
    titleKey: 'dashboard.reorderSupplies',
    descriptionKey: 'dashboard.reorderSuppliesDescription',
    href: '/supplies',
    icon: Package,
    access: 'baseline',
  },
  {
    titleKey: 'portal.nav.orders',
    descriptionKey: 'portal.nav.ordersDescription',
    href: '/portal/orders',
    icon: ShoppingBag,
    access: 'baseline',
  },
  {
    titleKey: 'portal.nav.account',
    descriptionKey: 'portal.nav.accountDescription',
    href: '/portal/account',
    icon: Settings2,
    access: 'account',
  },
  {
    titleKey: 'portal.nav.reporting',
    descriptionKey: 'portal.nav.reportingDescription',
    href: '/portal/reports',
    icon: BarChart3,
    access: 'reporting',
  },
  {
    titleKey: 'portal.nav.time',
    descriptionKey: 'portal.nav.timeDescription',
    href: '/portal/time',
    icon: Clock3,
    access: 'timekeeping',
  },
  {
    titleKey: 'portal.nav.team',
    descriptionKey: 'portal.nav.teamDescription',
    href: '/portal/team',
    icon: Users2,
    access: 'team',
  },
  {
    titleKey: 'portal.nav.support',
    descriptionKey: 'portal.nav.supportDescription',
    href: '/portal/support',
    icon: HeadphonesIcon,
    access: 'support',
  },
  {
    titleKey: 'portal.nav.refunds',
    descriptionKey: 'portal.nav.refundsDescription',
    href: '/refunds',
    icon: ReceiptText,
    access: 'refunds',
  },
];

const shortcutPriority = {
  baseline: ['/portal/account', '/portal/orders', '/supplies'],
  member: [
    '/supplies',
    '/portal/orders',
    '/portal/support',
    '/portal/team',
    '/portal/reports',
    '/portal/account',
    '/portal/time',
    '/refunds',
  ],
  operator: ['/portal/reports', '/portal/time', '/refunds'],
  partner: [
    '/portal/team',
    '/portal/support',
    '/portal/account',
    '/supplies',
    '/portal/orders',
    '/portal/time',
  ],
} as const;

const getShortcutRoot = (href: string) => {
  if (href.startsWith('/portal/time')) {
    return '/portal/time';
  }

  return href;
};

const isOpenTimePeriod = (status: string | undefined) =>
  status === 'open' || status === 'grace_period' || status === 'reopened';

export default function PortalDashboard() {
  const { language, t } = useLanguage();
  const {
    user,
    isMember,
    canAccessTraining,
    canManageTechnicians,
    capabilities,
    hasReportingAccess,
    adminAccess,
    isCorporatePartner,
    isSuperAdmin,
    reportingMachineCount,
    reportingLocationCount,
    portalAccessTier,
  } = useAuth();
  const allowedAdminSurfaces = new Set(adminAccess.allowedSurfaces);
  const hasRefundOperationsAccess =
    isSuperAdmin || allowedAdminSurfaces.has('*') || allowedAdminSurfaces.has('refunds');
  const visibleAdminDestinations = getVisibleAdminDestinations({
    adminAccess,
    isSuperAdmin,
  });
  const firstAdminDestination = visibleAdminDestinations[0];
  const hasActionableAdminPrimary = Boolean(
    adminAccess.canAccessAdmin && (firstAdminDestination || hasRefundOperationsAccess),
  );
  const hasEffectiveReportingAccess =
    hasReportingAccess || capabilities.includes('reports.partner.view');
  const teamAccess = usePortalTechnicianManagement();
  const timekeepingAccess = usePortalTimekeepingAccess();
  const { canUsePortalTeam } = teamAccess;
  const { canUsePortalTimekeeping } = timekeepingAccess;
  const canAccessPortalAction = (access: PortalAccessLevel) => {
    if (access === 'team') {
      return canUsePortalTeam;
    }

    if (access === 'timekeeping') {
      return canUsePortalTimekeeping;
    }

    return canAccessPortalLevel(
      portalAccessTier,
      access,
      hasEffectiveReportingAccess,
      capabilities,
      hasRefundOperationsAccess,
      canManageTechnicians,
      adminAccess.isScopedAdmin,
      canUsePortalTimekeeping,
    );
  };
  const usesDashboardTrainingData = canAccessTraining && !hasActionableAdminPrimary;
  const onboardingProgress = getOnboardingProgress(user?.email);
  const libraryQuery = useTrainingLibrary(usesDashboardTrainingData);
  const tracksQuery = useTrainingTracks(usesDashboardTrainingData);
  const progressQuery = useTrainingProgress(user?.id, usesDashboardTrainingData);
  const { data: library = [] } = libraryQuery;
  const { data: trackDefinitions = [] } = tracksQuery;
  const { data: trainingProgress = [] } = progressQuery;
  const trainingProgressResolving =
    usesDashboardTrainingData && progressQuery.isFetching && !progressQuery.isFetched;
  const dashboardDataReady =
    !teamAccess.isLoading &&
    !timekeepingAccess.isLoading &&
    !trainingProgressResolving &&
    (!usesDashboardTrainingData ||
      (!libraryQuery.isLoading && !tracksQuery.isLoading && !progressQuery.isLoading));

  useEffect(() => {
    trackEvent('view_dashboard');
    const frame = window.requestAnimationFrame(markPortalDashboardVisible);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!user?.id || !dashboardDataReady) {
      return;
    }

    const frame = window.requestAnimationFrame(markPortalDashboardDataReady);
    return () => window.cancelAnimationFrame(frame);
  }, [dashboardDataReady, user?.id]);

  if (!user) {
    return null;
  }

  const trainingExperience = buildTrainingExperience(library);
  const canonicalProgress = mapTrainingProgressToCanonical(trainingProgress, trainingExperience);
  const hydratedTracks = bindTracksToTrainingExperience(trackDefinitions, trainingExperience);
  const operatorTrack = hydratedTracks.find((track) => track.slug === 'operator-essentials');
  const progressByTrainingId = new Map(
    canonicalProgress.map((item) => [item.trainingId, item]),
  );
  const requiredTrackItems = operatorTrack?.items.filter((item) => item.required) ?? [];
  const completedRequiredCount = requiredTrackItems.filter(
    (item) => progressByTrainingId.get(item.trainingId)?.completedAt,
  ).length;
  const hasRecordedTrainingProgress = canonicalProgress.some(
    (item) => item.startedAt || item.completedAt,
  );
  const continueLearningItem =
    operatorTrack?.items.find(
      (item) =>
        item.training &&
        progressByTrainingId.get(item.trainingId)?.startedAt &&
        !progressByTrainingId.get(item.trainingId)?.completedAt,
    )?.training ??
    operatorTrack?.items.find(
      (item) => item.training && !progressByTrainingId.get(item.trainingId)?.completedAt,
    )?.training;
  const continueLearningProgress = continueLearningItem
    ? progressByTrainingId.get(continueLearningItem.id)
    : undefined;
  const trainingIncomplete =
    hasRecordedTrainingProgress &&
    requiredTrackItems.length > 0 &&
    completedRequiredCount < requiredTrackItems.length;
  const requiredTrainingComplete =
    hasRecordedTrainingProgress &&
    requiredTrackItems.length > 0 &&
    completedRequiredCount >= requiredTrackItems.length;
  const onboardingComplete =
    onboardingProgress.completedCount >= onboardingProgress.totalSteps;
  const onboardingRemainingCount =
    onboardingProgress.totalSteps - onboardingProgress.completedCount;
  const activeTimeProfile = timekeepingAccess.data?.profiles.find(
    (profile) => profile.status === 'active',
  );
  const canSubmitTime = Boolean(
    activeTimeProfile && isOpenTimePeriod(activeTimeProfile.currentPeriod.status),
  );
  const reportingScopeDescription =
    reportingMachineCount > 0
      ? reportingLocationCount > 0
        ? t('dashboard.reportingScopeWithLocations', {
            machines: reportingMachineCount,
            locations: reportingLocationCount,
          })
        : t('dashboard.reportingScopeMachines', { machines: reportingMachineCount })
      : t('dashboard.reportingScopeNone');
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(language === 'zh-Hans' ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: 'numeric',
    }).format(new Date(`${value}T00:00:00`));

  let primaryAction: DashboardAction;

  if (hasActionableAdminPrimary && firstAdminDestination) {
    primaryAction = {
      title: t(firstAdminDestination.labelKey),
      description: t(firstAdminDestination.descriptionKey),
      helper: t('dashboard.adminWorkspaceHelper'),
      label: t('dashboard.openAdminWorkspace'),
      href: firstAdminDestination.href,
      icon: firstAdminDestination.icon,
    };
  } else if (hasActionableAdminPrimary && hasRefundOperationsAccess) {
    primaryAction = {
      title: t('portal.nav.refunds'),
      description: t('portal.nav.refundsDescription'),
      helper: t('dashboard.adminWorkspaceHelper'),
      label: t('dashboard.openRefunds'),
      href: '/refunds',
      icon: ReceiptText,
    };
  } else if (canUsePortalTimekeeping) {
    primaryAction = {
      title: canSubmitTime ? t('dashboard.logTimeTitle') : t('dashboard.openTimeTitle'),
      description: canSubmitTime
        ? t('dashboard.logTimeDescription')
        : t('dashboard.openTimeDescription'),
      helper: activeTimeProfile
        ? t('dashboard.timeDueDescription', {
            date: formatDate(activeTimeProfile.currentPeriod.submissionDueDate),
          })
        : t('dashboard.timeSetupDescription'),
      label: canSubmitTime ? t('dashboard.logTime') : t('dashboard.openTime'),
      href: canSubmitTime ? '/portal/time/new' : '/portal/time',
      icon: Clock3,
    };
  } else if (hasEffectiveReportingAccess) {
    primaryAction = {
      title: t('dashboard.reportingReady'),
      description: t('dashboard.primaryReportingDescription'),
      helper: reportingScopeDescription,
      label: t('dashboard.openReporting'),
      href: '/portal/reports',
      icon: BarChart3,
    };
  } else if (isMember && !onboardingComplete) {
    primaryAction = {
      title: t('dashboard.setupNeedsAttention'),
      description: t('dashboard.primaryContinueSetupDescription'),
      helper: t('dashboard.deviceSetupRemaining', { count: onboardingRemainingCount }),
      label: t('dashboard.continueSetup'),
      href: '/portal/onboarding',
      icon: ListChecks,
      needsAttention: true,
    };
  } else if (canAccessTraining) {
    primaryAction = {
      title: continueLearningItem?.title ?? t('dashboard.operatorReadiness'),
      description: continueLearningItem
        ? t('dashboard.primaryTrainingResumeDescription')
        : t('dashboard.primaryTrainingHubDescription'),
      helper:
        requiredTrackItems.length > 0
          ? hasRecordedTrainingProgress
            ? t('dashboard.coreTrainingComplete', {
                completed: completedRequiredCount,
                total: requiredTrackItems.length,
              })
            : t('dashboard.coreTrainingAvailable', {
                total: requiredTrackItems.length,
              })
          : t('dashboard.trainingLibraryReady'),
      label: continueLearningProgress?.startedAt
        ? t('dashboard.resumeTraining')
        : requiredTrainingComplete
          ? t('dashboard.browseTraining')
          : t('dashboard.startTraining'),
      href: continueLearningItem
        ? `/portal/training/${continueLearningItem.id}`
        : '/portal/training',
      icon: Sparkles,
      needsAttention: !trainingProgressResolving && trainingIncomplete,
    };
  } else {
    primaryAction = {
      title: t('dashboard.reorderSupplies'),
      description: t('dashboard.primarySuppliesDescription'),
      label: t('dashboard.reorderSupplies'),
      href: '/supplies',
      icon: Package,
    };
  }

  const secondaryAction =
    primaryAction.href.startsWith('/admin') || primaryAction.href === '/refunds'
      ? hasEffectiveReportingAccess
        ? {
            label: t('dashboard.openReporting'),
            href: '/portal/reports',
          }
        : null
      : primaryAction.href.startsWith('/portal/time')
        ? {
            label: t('dashboard.viewOrders'),
            href: '/portal/orders',
          }
        : primaryAction.href === '/portal/reports'
          ? canAccessTraining
            ? trainingProgressResolving || trainingIncomplete
              ? null
              : {
                  label: t('dashboard.openTrainingHub'),
                  href: '/portal/training',
                }
            : {
                label: t('dashboard.manageAccount'),
                href: '/portal/account',
              }
          : primaryAction.href === '/portal/onboarding'
            ? {
                label: t('dashboard.openTrainingHub'),
                href: '/portal/training',
              }
            : primaryAction.href.startsWith('/portal/training')
              ? hasEffectiveReportingAccess
                ? {
                    label: t('dashboard.openReporting'),
                    href: '/portal/reports',
                  }
                : null
              : {
                  label: t('dashboard.viewOrders'),
                  href: '/portal/orders',
                };

  const attentionItems: DashboardAttentionItem[] = [];

  if (
    !hasActionableAdminPrimary &&
    isMember &&
    !onboardingComplete &&
    primaryAction.href !== '/portal/onboarding'
  ) {
    attentionItems.push({
      title: t('dashboard.setupNeedsAttention'),
      description: t('dashboard.deviceSetupRemaining', { count: onboardingRemainingCount }),
      actionLabel: t('dashboard.continueSetup'),
      href: '/portal/onboarding',
      icon: ListChecks,
    });
  }

  if (
    !hasActionableAdminPrimary &&
    canAccessTraining &&
    !trainingProgressResolving &&
    trainingIncomplete &&
    !primaryAction.href.startsWith('/portal/training')
  ) {
    attentionItems.push({
      title: t('dashboard.trainingAttentionTitle'),
      description: t('dashboard.trainingAttentionDescription', {
        completed: completedRequiredCount,
        total: requiredTrackItems.length,
      }),
      actionLabel: t('dashboard.openTrainingHub'),
      href: '/portal/training',
      icon: Sparkles,
    });
  }

  const visibleSecondaryAction =
    secondaryAction &&
    !attentionItems.some(
      (item) => getShortcutRoot(item.href) === getShortcutRoot(secondaryAction.href),
    )
      ? secondaryAction
      : null;
  const statusItems: DashboardStatusItem[] = [];

  if (!hasActionableAdminPrimary && isMember) {
    statusItems.push({
      title: t('dashboard.deviceSetupStatus'),
      description: t('dashboard.deviceSetupStatusDescription', {
        completed: onboardingProgress.completedCount,
        total: onboardingProgress.totalSteps,
      }),
      icon: ListChecks,
      progress: {
        value: onboardingProgress.progressPercent,
        label: t('dashboard.percentComplete', {
          percent: onboardingProgress.progressPercent,
        }),
      },
    });
  }

  if (
    hasEffectiveReportingAccess &&
    primaryAction.href !== '/portal/reports'
  ) {
    statusItems.push({
      title: t('dashboard.reportingAccess'),
      description: reportingScopeDescription,
      icon: BarChart3,
    });
  }

  if (canUsePortalTimekeeping) {
    statusItems.push({
      title: t('dashboard.timeStatusTitle'),
      description: activeTimeProfile
        ? t('dashboard.timeAssignmentDescription', {
            count: activeTimeProfile.assignedMachines.length,
          })
        : t('dashboard.timeSetupDescription'),
      icon: Clock3,
    });
  }

  if (
    !hasActionableAdminPrimary &&
    canAccessTraining &&
    !trainingProgressResolving
  ) {
    const trainingPercent =
      requiredTrackItems.length > 0
        ? Math.round((completedRequiredCount / requiredTrackItems.length) * 100)
        : 0;
    statusItems.push({
      title: t('dashboard.trainingProgress'),
      description:
        requiredTrackItems.length > 0
          ? hasRecordedTrainingProgress
            ? t('dashboard.coreTrainingComplete', {
                completed: completedRequiredCount,
                total: requiredTrackItems.length,
              })
            : t('dashboard.coreTrainingAvailable', {
                total: requiredTrackItems.length,
              })
          : t('dashboard.trainingLibraryReady'),
      icon: Sparkles,
      progress:
        requiredTrackItems.length > 0 && hasRecordedTrainingProgress
          ? {
              value: trainingPercent,
              label: t('dashboard.percentComplete', { percent: trainingPercent }),
            }
          : undefined,
    });
  }

  if (canUsePortalTeam) {
    statusItems.push({
      title: t('dashboard.teamStatusTitle'),
      description: t('dashboard.teamStatusDescription', {
        count: teamAccess.data?.accounts.length ?? 0,
      }),
      icon: Users2,
    });
  }

  if (
    statusItems.length === 0 &&
    hasActionableAdminPrimary &&
    (firstAdminDestination || hasRefundOperationsAccess)
  ) {
    statusItems.push({
      title: t('dashboard.adminScopeStatus'),
      description: t('dashboard.adminScopeDescription', {
        count: visibleAdminDestinations.length || 1,
      }),
      icon: firstAdminDestination?.icon ?? Settings2,
    });
  }

  if (statusItems.length === 0) {
    statusItems.push({
      title: t('dashboard.baselineEssentials'),
      description: t('dashboard.accountEssentialsStatusDescription'),
      icon: CheckCircle2,
    });
  }

  const orderedShortcutHrefs = isCorporatePartner
    ? shortcutPriority.partner
    : canAccessTraining && !isMember
      ? shortcutPriority.operator
      : isMember
        ? shortcutPriority.member
        : shortcutPriority.baseline;
  const shortcutByHref = new Map(
    shortcutDefinitions.map((shortcut) => [shortcut.href, shortcut]),
  );
  const excludedShortcutHrefs = new Set([
    getShortcutRoot(primaryAction.href),
    visibleSecondaryAction ? getShortcutRoot(visibleSecondaryAction.href) : '',
  ]);
  const shortcutActions = orderedShortcutHrefs
    .map((href) => shortcutByHref.get(href))
    .filter((shortcut): shortcut is DashboardActionDefinition => Boolean(shortcut))
    .filter((shortcut) => canAccessPortalAction(shortcut.access))
    .filter((shortcut) => !excludedShortcutHrefs.has(shortcut.href))
    .slice(0, 3);
  const dashboardStatusResolving =
    teamAccess.isResolvingPortalTeam ||
    timekeepingAccess.isResolvingPortalTimekeeping ||
    trainingProgressResolving;
  const dashboardStatusUnavailable = Boolean(
    timekeepingAccess.error ||
      (teamAccess.hasAdvertisedTeamCapability && teamAccess.error),
  );
  const primaryActionResolving =
    (!hasActionableAdminPrimary && timekeepingAccess.isResolvingPortalTimekeeping) ||
    (!hasActionableAdminPrimary &&
      !canUsePortalTimekeeping &&
      !hasEffectiveReportingAccess &&
      (!isMember || onboardingComplete) &&
      canAccessTraining &&
      trainingProgressResolving);
  const showCaughtUp =
    !hasActionableAdminPrimary &&
    canAccessTraining &&
    !trainingProgressResolving &&
    requiredTrainingComplete &&
    (!isMember || onboardingComplete) &&
    attentionItems.length === 0;

  const handleDashboardActionClick = (href: string) => {
    if (href === '/supplies') {
      trackEvent('reorder_sugar_click');
      return;
    }

    trackEvent('dashboard_action_click', { href });
  };

  const retryDashboardStatus = () => {
    const requests: Promise<unknown>[] = [timekeepingAccess.refetch()];
    if (teamAccess.hasAdvertisedTeamCapability) {
      requests.push(teamAccess.refetch());
    }

    void Promise.all(requests);
  };

  return (
    <PortalLayout>
      <section className="portal-section">
        <div
          className="container-page space-y-5 sm:space-y-6"
          data-dashboard-state={
            dashboardStatusUnavailable
              ? 'error'
              : primaryActionResolving || dashboardStatusResolving
                ? 'loading'
                : showCaughtUp
                  ? 'empty'
                  : 'ready'
          }
        >
          <header
            className="border-b border-border pb-5 sm:flex sm:items-end sm:justify-between sm:gap-6"
            data-dashboard-header
          >
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {t('portal.memberPortal')}
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground sm:text-4xl">
                {t('dashboard.welcome')}
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">
                {t('dashboard.taskFirstDescription')}
              </p>
            </div>
          </header>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.85fr)]">
            <section
              aria-labelledby="dashboard-next-up-title"
              className="overflow-hidden rounded-[24px] border border-border bg-background shadow-[var(--shadow-sm)]"
              data-dashboard-primary-task
            >
              <div className="border-b border-border px-5 py-4 sm:px-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  {primaryAction.needsAttention
                    ? t('dashboard.needsAttention')
                    : t('dashboard.nextUp')}
                </p>
                <h2
                  id="dashboard-next-up-title"
                  className="mt-1 font-display text-xl font-semibold text-foreground"
                >
                  {t('dashboard.oneClearNextStep')}
                </h2>
              </div>

              <div className="px-5 py-5 sm:px-6 sm:py-6">
                {primaryActionResolving ? (
                  <div
                    className="flex min-h-40 items-start gap-4"
                    role="status"
                    data-dashboard-primary-loading
                  >
                    <Skeleton className="h-11 w-11 shrink-0 rounded-2xl" />
                    <div className="w-full max-w-2xl space-y-3">
                      <Skeleton className="h-7 w-48" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-11 w-36" />
                    </div>
                    <span className="sr-only">{t('dashboard.statusChecking')}</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                    <div className="flex min-w-0 items-start gap-4">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <primaryAction.icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-display text-2xl font-semibold text-foreground">
                          {primaryAction.title}
                        </h3>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                          {primaryAction.description}
                        </p>
                        {primaryAction.helper && (
                          <p className="mt-2 text-sm font-medium text-foreground/80">
                            {primaryAction.helper}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto md:justify-end">
                      <Button asChild className="min-h-11 w-full sm:w-auto">
                        <Link
                          to={primaryAction.href}
                          data-dashboard-primary-action
                          onClick={() => handleDashboardActionClick(primaryAction.href)}
                        >
                          {primaryAction.label}
                          <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                        </Link>
                      </Button>
                      {visibleSecondaryAction && canAccessPortalAction(
                        visibleSecondaryAction.href === '/portal/reports'
                          ? 'reporting'
                          : visibleSecondaryAction.href === '/portal/training'
                            ? 'training'
                            : visibleSecondaryAction.href === '/portal/orders'
                              ? 'baseline'
                              : 'account',
                      ) && (
                        <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto">
                          <Link
                            to={visibleSecondaryAction.href}
                            data-dashboard-secondary-action
                          >
                            {visibleSecondaryAction.label}
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {attentionItems.length > 0 && (
                <div
                  className="border-t border-border"
                  data-dashboard-attention-list
                  data-dashboard-needs-attention
                >
                  <div className="px-5 pb-2 pt-4 sm:px-6">
                    <h3 className="text-sm font-semibold text-foreground">
                      {t('dashboard.needsAttention')}
                    </h3>
                  </div>
                  <ul className="divide-y divide-border">
                    {attentionItems.slice(0, 2).map((item) => (
                      <li key={item.href} data-dashboard-attention-item>
                        <Link
                          to={item.href}
                          className="group flex min-h-11 items-start gap-3 px-5 py-4 outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6"
                        >
                          <item.icon
                            className="mt-0.5 h-5 w-5 shrink-0 text-primary"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium text-foreground">
                              {item.title}
                            </span>
                            <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                              {item.description}
                            </span>
                          </span>
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                            {item.actionLabel}
                            <ArrowRight className="h-4 w-4" aria-hidden="true" />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {showCaughtUp && (
                <div
                  className="flex items-start gap-3 border-t border-border bg-sage-light/60 px-5 py-4 sm:px-6"
                  data-dashboard-attention-empty
                  data-dashboard-empty-state
                >
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-sage" aria-hidden="true" />
                  <div>
                    <p className="font-medium text-foreground">{t('dashboard.caughtUp')}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('dashboard.caughtUpDescription')}
                    </p>
                  </div>
                </div>
              )}
            </section>

            <aside
              aria-labelledby="dashboard-current-status-title"
              className="rounded-[24px] border border-border bg-background p-5 shadow-[var(--shadow-sm)] sm:p-6"
              data-dashboard-current-status
            >
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t('dashboard.currentWork')}
              </p>
              <h2
                id="dashboard-current-status-title"
                className="mt-1 font-display text-xl font-semibold text-foreground"
              >
                {t('dashboard.atAGlance')}
              </h2>

              <div className="mt-4 divide-y divide-border">
                {statusItems.slice(0, 3).map((item) => (
                  <div key={item.title} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-start gap-3">
                      <item.icon
                        className="mt-0.5 h-5 w-5 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground">{item.title}</p>
                        <p className="mt-1 text-sm leading-5 text-muted-foreground">
                          {item.description}
                        </p>
                        {item.progress && (
                          <div className="mt-3">
                            <Progress
                              value={item.progress.value}
                              aria-label={item.progress.label}
                              className="h-2"
                            />
                            <p className="mt-1.5 text-xs text-muted-foreground">
                              {item.progress.label}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {dashboardStatusResolving && statusItems.length < 3 && (
                  <div className="py-4" role="status" data-dashboard-status-loading>
                    <div className="flex items-start gap-3">
                      <Skeleton className="h-5 w-5 shrink-0 rounded-md" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-3 w-full" />
                      </div>
                    </div>
                    <span className="sr-only">{t('dashboard.statusChecking')}</span>
                  </div>
                )}
              </div>

              {dashboardStatusUnavailable && (
                <div
                  className="mt-5 rounded-2xl border border-amber/25 bg-amber/10 p-4"
                  role="alert"
                  data-dashboard-error-state
                  data-dashboard-status-error
                >
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber" aria-hidden="true" />
                    <div>
                      <p className="font-medium text-foreground">
                        {t('dashboard.statusUnavailable')}
                      </p>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        {t('dashboard.statusUnavailableDescription')}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3 min-h-11"
                        onClick={retryDashboardStatus}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                        {t('dashboard.retryStatus')}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </aside>
          </div>

          {shortcutActions.length > 0 && (
            <nav
              aria-labelledby="dashboard-shortcuts-title"
              className="overflow-hidden rounded-[24px] border border-border bg-background shadow-[var(--shadow-sm)]"
              data-dashboard-shortcuts
            >
              <div className="border-b border-border px-5 py-4 sm:px-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {t('dashboard.usefulLinks')}
                </p>
                <h2
                  id="dashboard-shortcuts-title"
                  className="mt-1 font-display text-xl font-semibold text-foreground"
                >
                  {t('dashboard.usefulLinksTitle')}
                </h2>
              </div>
              <div
                className={cn(
                  'grid divide-y divide-border md:divide-x md:divide-y-0',
                  shortcutActions.length === 1
                    ? 'md:grid-cols-1'
                    : shortcutActions.length === 2
                      ? 'md:grid-cols-2'
                      : 'md:grid-cols-3',
                )}
              >
                {shortcutActions.map((action) => {
                  const ActionIcon = action.icon;

                  return (
                    <Link
                      key={action.href}
                      to={action.href}
                      onClick={() => handleDashboardActionClick(action.href)}
                      className="group flex min-h-11 items-start gap-3 p-5 outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-6"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground group-hover:text-primary">
                        <ActionIcon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="font-medium text-foreground">
                          {t(action.titleKey)}
                        </span>
                        <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                          {t(action.descriptionKey)}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </nav>
          )}
        </div>
      </section>
    </PortalLayout>
  );
}
