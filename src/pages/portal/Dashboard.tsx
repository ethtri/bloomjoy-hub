import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Lock,
  Package,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { PortalPageIntro } from '@/components/portal/PortalPageIntro';
import { portalDestinations, type PortalAccessLevel } from '@/components/portal/portalNavigation';
import { useAuth } from '@/contexts/AuthContext';
import { trackEvent } from '@/lib/analytics';
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
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  access: PortalAccessLevel;
  upsellCopy?: string;
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
    title: 'Reorder Supplies',
    description: 'Jump into the current supply checkout without using the sales navigation.',
    href: '/supplies',
    icon: Package,
    access: 'baseline',
  },
  ...portalDestinations
    .filter((destination) => destination.href !== '/portal')
    .map((destination) => ({
      title: destination.label,
      description: destination.description,
      href: destination.href,
      icon: destination.icon,
      access: destination.access,
      upsellCopy: destination.upsellCopy,
    })),
];

export default function PortalDashboard() {
  const { user, isMember, signOut } = useAuth();
  const onboardingProgress = getOnboardingProgress(user?.email);
  const { data: library = [] } = useTrainingLibrary(isMember);
  const { data: trackDefinitions = [] } = useTrainingTracks(isMember);
  const { data: trainingProgress = [] } = useTrainingProgress(user?.id, isMember);

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

  const primaryAction = !isMember
    ? {
        label: 'Reorder Supplies',
        href: '/supplies',
        description: 'Jump into the current supply checkout without using the public sales nav.',
        helper: 'Baseline access starts with reorders, account details, and order history.',
      }
    : !onboardingComplete
      ? {
          label: 'Continue Setup',
          href: '/portal/onboarding',
          description: 'Finish the remaining onboarding milestones before your next shift.',
          helper:
            onboardingRemainingCount === 1
              ? 'One setup step still needs attention.'
              : `${onboardingRemainingCount} setup steps still need attention.`,
        }
      : continueLearningItem
        ? {
            label: 'Resume Training',
            href: `/portal/training/${continueLearningItem.id}`,
            description:
              continueLearningItem.description ||
              'Return to Operator Essentials and keep moving through the next task.',
            helper: 'Your setup is complete. The next best move is to keep training momentum.',
          }
        : {
            label: 'Open Training Hub',
            href: '/portal/training',
            description: 'Browse the full operator hub of videos, quick aids, and manuals.',
            helper: 'Training recommendations are ready whenever you want to jump back in.',
          };

  const secondaryAction = !isMember
    ? {
        label: 'View Orders',
        href: '/portal/orders',
      }
    : !onboardingComplete
      ? {
          label: 'Open Training Hub',
          href: '/portal/training',
        }
      : {
          label: 'Manage Account',
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
            title="Welcome back"
            description="Your portal is now organized around the next task that matters most, with training, onboarding, support, orders, and account actions all within a tighter workflow."
            badges={[
              {
                label: isMember ? 'Plus Basic Active' : 'Baseline Access',
                tone: isMember ? 'success' : 'accent',
                icon: CheckCircle2,
              },
              {
                label: isMember
                  ? `${completedRequiredCount}/${requiredTrackItems.length || 0} core training tasks complete`
                  : 'Orders and account are available today',
                tone: 'muted',
              },
            ]}
            actions={
              <Button variant="outline" size="sm" onClick={() => signOut()}>
                Sign Out
              </Button>
            }
          >
            <div className="grid gap-4 xl:grid-cols-[1.35fr,0.95fr]">
              <div className="rounded-[24px] border border-border bg-background p-5 shadow-[var(--shadow-sm)] sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  Primary next step
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
                <div className="rounded-[24px] border border-border bg-background p-5 shadow-[var(--shadow-sm)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Portal access
                  </p>
                  <p className="mt-2 font-display text-xl font-semibold text-foreground">
                    {isMember ? 'Everything is unlocked' : 'Start with baseline essentials'}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {isMember
                      ? 'You can move directly from setup to training, support, orders, and account changes without leaving the portal shell.'
                      : 'Baseline access keeps reorders, order history, and account updates simple while Bloomjoy Plus unlocks guided setup, training, and support.'}
                  </p>
                </div>

                {isMember ? (
                  <div className="rounded-[24px] border border-border bg-background p-5 shadow-[var(--shadow-sm)]">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Setup progress
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="font-display text-3xl font-bold text-foreground">
                        {onboardingProgress.progressPercent}%
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {onboardingProgress.completedCount}/{onboardingProgress.totalSteps} complete
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
                        ? 'Setup essentials are complete. Keep momentum in the training hub.'
                        : 'Finish setup milestones before your next production shift.'}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-[24px] border border-primary/20 bg-primary/5 p-5 shadow-[var(--shadow-sm)]">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                      Unlock Bloomjoy Plus
                    </p>
                    <p className="mt-2 font-display text-xl font-semibold text-foreground">
                      Training, onboarding, and support live behind Plus
                    </p>
                    <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                      <li>Guided operator setup and first-spin milestones</li>
                      <li>Task-first training hub with quick aids and manuals</li>
                      <li>Concierge support, WeChat help, and parts assistance</li>
                    </ul>
                    <Button asChild className="mt-5">
                      <Link to="/plus">View Plus Membership</Link>
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
                  Jump back in
                </p>
                <h2 className="mt-1 font-display text-2xl font-semibold text-foreground">
                  Quick actions
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  The most common portal destinations stay visible, with clearer upgrade cues for
                  Plus-only areas.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {dashboardActions.map((action) => {
                const locked = action.access === 'plus' && !isMember;
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
                          Plus
                        </span>
                      )}
                    </div>
                    <h3 className="mt-4 font-display text-lg font-semibold text-foreground group-hover:text-primary">
                      {action.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {locked ? action.upsellCopy : action.description}
                    </p>
                    <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary">
                      <span>{locked ? 'See access details' : 'Open now'}</span>
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
                      Onboarding snapshot
                    </p>
                    <h2 className="mt-1 font-display text-2xl font-semibold text-foreground">
                      {onboardingComplete ? 'Setup is in a good place' : 'Setup still needs attention'}
                    </h2>
                  </div>
                  <span className="self-start rounded-full bg-sage-light px-3 py-1.5 text-sm font-medium text-sage">
                    {onboardingProgress.progressPercent}% complete
                  </span>
                </div>
                <div className="mt-5 space-y-3">
                  {onboardingComplete ? (
                    <div className="rounded-[20px] border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                      All onboarding milestones are complete. Use the training hub to keep building
                      operator confidence and reference quick aids when new questions come up.
                    </div>
                  ) : (
                    nextOnboardingSteps.map((step) => (
                      <div
                        key={step.id}
                        className="rounded-[20px] border border-border bg-muted/20 p-4"
                      >
                        <p className="font-medium text-foreground">{step.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                      </div>
                    ))
                  )}
                </div>
                <Button asChild className="mt-5 w-full sm:w-auto">
                  <Link to="/portal/onboarding">
                    {onboardingComplete ? 'Review setup checklist' : 'Continue setup'}
                  </Link>
                </Button>
              </div>

              <div className="rounded-[28px] border border-border bg-background p-5 shadow-[var(--shadow-sm)] sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Recommended training
                    </p>
                    <h2 className="mt-1 font-display text-2xl font-semibold text-foreground">
                      Live next-step recommendations
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
                    No live recommendations are ready yet. Open the training hub to browse operator
                    tasks, quick aids, and manuals without relying on placeholders.
                  </div>
                )}
                <Button asChild variant="outline" className="mt-5 w-full sm:w-auto">
                  <Link to="/portal/training">
                    Open training hub
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-5 xl:grid-cols-[1.05fr,0.95fr]">
              <div className="rounded-[28px] border border-border bg-background p-5 shadow-[var(--shadow-sm)] sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Baseline tools
                </p>
                <h2 className="mt-1 font-display text-2xl font-semibold text-foreground">
                  What you can do right now
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Baseline access stays lean: keep supplies moving, check order history, and update
                  your billing or shipping details without extra navigation noise.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <Link
                    to="/portal/orders"
                    className="rounded-[20px] border border-border bg-muted/20 p-4 transition-colors hover:border-primary/20 hover:bg-muted/30"
                  >
                    <p className="font-medium text-foreground">Order history</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      View receipts, totals, and shipment tracking.
                    </p>
                  </Link>
                  <Link
                    to="/portal/account"
                    className="rounded-[20px] border border-border bg-muted/20 p-4 transition-colors hover:border-primary/20 hover:bg-muted/30"
                  >
                    <p className="font-medium text-foreground">Account settings</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Update profile, shipping, and billing details.
                    </p>
                  </Link>
                </div>
              </div>

              <div className="rounded-[28px] border border-primary/20 bg-primary/5 p-5 shadow-[var(--shadow-sm)] sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  Why operators upgrade
                </p>
                <h2 className="mt-1 font-display text-2xl font-semibold text-foreground">
                  Bloomjoy Plus turns the portal into an operating system
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
                            <p className="font-medium text-foreground">{destination.label}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {destination.upsellCopy}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
                <Button asChild className="mt-5 w-full sm:w-auto">
                  <Link to="/plus">Explore Bloomjoy Plus</Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </PortalLayout>
  );
}
