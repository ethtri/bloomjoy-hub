import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  BookOpen, 
  ShoppingBag, 
  HeadphonesIcon, 
  Settings, 
  CheckCircle2,
  ArrowRight,
  Package
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { useAuth } from '@/contexts/AuthContext';
import { trackEvent } from '@/lib/analytics';
import { getOnboardingProgress } from '@/lib/onboardingChecklist';
import {
  bindTracksToLibrary,
  useTrainingLibrary,
  useTrainingProgress,
  useTrainingTracks,
} from '@/lib/trainingRepository';

const quickActions = [
  {
    title: 'Reorder Sugar',
    description: 'Quick reorder for premium cotton candy sugar',
    icon: Package,
    href: '/supplies',
    action: 'reorder',
  },
  {
    title: 'Training Library',
    description: 'Video tutorials and operational guides',
    icon: BookOpen,
    href: '/portal/training',
    action: 'training',
  },
  {
    title: 'Concierge Support',
    description: 'Submit a support request',
    icon: HeadphonesIcon,
    href: '/portal/support',
    action: 'support',
  },
  {
    title: 'Order History',
    description: 'View past orders and invoices',
    icon: ShoppingBag,
    href: '/portal/orders',
    action: 'orders',
  },
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

  const handleReorderSugar = () => {
    trackEvent('reorder_sugar_click');
  };

  const hydratedTracks = bindTracksToLibrary(trackDefinitions, library);
  const operatorTrack = hydratedTracks.find((track) => track.slug === 'operator-essentials');
  const progressByTrainingId = new Map(trainingProgress.map((item) => [item.trainingId, item]));
  const continueLearningItem =
    operatorTrack?.items.find(
      (item) =>
        item.training &&
        progressByTrainingId.get(item.trainingId)?.startedAt &&
        !progressByTrainingId.get(item.trainingId)?.completedAt
    )?.training ??
    operatorTrack?.items.find((item) => item.training && !progressByTrainingId.get(item.trainingId)?.completedAt)
      ?.training;
  const requiredTrackItems = operatorTrack?.items.filter((item) => item.required) ?? [];
  const completedRequiredCount = requiredTrackItems.filter((item) =>
    progressByTrainingId.get(item.trainingId)?.completedAt
  ).length;
  const trainingRecommendations =
    operatorTrack?.items
      .filter((item) => item.training && !progressByTrainingId.get(item.trainingId)?.completedAt)
      .slice(0, 3)
      .map((item) => item.training!) ??
    operatorTrack?.items
      .filter((item) => item.training)
      .slice(0, 3)
      .map((item) => item.training!) ??
    [];

  if (!user) return null;

  return (
    <PortalLayout>
      <section className="bg-gradient-to-b from-cream to-background section-padding">
        <div className="container-page">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="font-display text-3xl font-bold text-foreground">
                Welcome back
              </h1>
              <p className="mt-1 text-muted-foreground">{user.email}</p>
            </div>
            <div className="flex items-center gap-3">
              {isMember && (
                <span className="flex items-center gap-2 rounded-full bg-sage-light px-4 py-2 text-sm font-semibold text-sage">
                  <CheckCircle2 className="h-4 w-4" />
                  Plus Basic Active
                </span>
              )}
              {!isMember && (
                <span className="rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
                  Baseline Access
                </span>
              )}
              <Button variant="outline" size="sm" onClick={() => signOut()}>
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="section-padding">
        <div className="container-page">
          {/* Quick Actions */}
          <h2 className="font-display text-xl font-semibold text-foreground">Quick Actions</h2>
          {!isMember && (
            <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
              Baseline access includes Orders and Account. Training, onboarding, and support are
              available with Bloomjoy Plus.
            </div>
          )}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {quickActions.map((action) => (
              <Link
                key={action.title}
                to={action.href}
                onClick={action.action === 'reorder' ? handleReorderSugar : undefined}
                className="group card-elevated p-5 transition-all hover:-translate-y-0.5"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <action.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mt-4 font-semibold text-foreground group-hover:text-primary">
                  {action.title}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{action.description}</p>
              </Link>
            ))}
          </div>

          {/* Onboarding Progress */}
          <div className="mt-12">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-foreground">
                Onboarding Progress
              </h2>
              <Link
                to="/portal/onboarding"
                className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                View all
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="mt-4 card-elevated p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sage-light">
                  <span className="font-display text-lg font-bold text-sage">
                    {onboardingProgress.completedCount}/{onboardingProgress.totalSteps}
                  </span>
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-foreground">
                    {onboardingProgress.progressPercent}% Complete
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Complete your onboarding to get the most out of your machine.
                  </p>
                </div>
                <Link to="/portal/onboarding">
                  <Button>Continue Setup</Button>
                </Link>
              </div>
            </div>
          </div>

          {/* Recent Training */}
          <div className="mt-12">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-foreground">
                Training
              </h2>
              <Link
                to="/portal/training"
                className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Open training hub
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            {!isMember ? (
              <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-5">
                <p className="font-semibold text-foreground">Training unlocks with Bloomjoy Plus</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Plus members get the operator training hub, setup guides, maintenance checklists,
                  and the Bloomjoy Operator Essentials certificate path.
                </p>
                <Link to="/plus" className="mt-4 inline-flex text-sm font-medium text-primary hover:underline">
                  Explore Bloomjoy Plus
                </Link>
              </div>
            ) : (
              <>
                <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr,1fr]">
                  <div className="card-elevated p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                      Continue learning
                    </p>
                    <h3 className="mt-2 font-display text-xl font-semibold text-foreground">
                      {continueLearningItem?.title ?? 'Operator Essentials'}
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {continueLearningItem?.description ??
                        'Start or continue the Operator Essentials path to cover setup, daily operation, cleaning, and troubleshooting.'}
                    </p>
                    <div className="mt-4 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                      {completedRequiredCount}/{requiredTrackItems.length || 0} required items complete
                    </div>
                    <Link to={continueLearningItem ? `/portal/training/${continueLearningItem.id}` : '/portal/training'}>
                      <Button className="mt-4">
                        {continueLearningItem ? 'Resume training' : 'Open training hub'}
                      </Button>
                    </Link>
                  </div>
                  <div className="card-elevated p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                      Recommended next
                    </p>
                    <div className="mt-3 space-y-3">
                      {trainingRecommendations.map((item) => (
                        <Link
                          key={item.id}
                          to={`/portal/training/${item.id}`}
                          className="block rounded-xl border border-border p-3 transition hover:border-primary/30 hover:bg-muted/30"
                        >
                          <p className="font-medium text-foreground">{item.title}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{item.taskCategory}</p>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}
