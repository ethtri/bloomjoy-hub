import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { PortalPageIntro } from '@/components/portal/PortalPageIntro';
import { useAuth } from '@/contexts/AuthContext';
import { trackEvent } from '@/lib/analytics';
import {
  OnboardingStepWithState,
  readOnboardingSteps,
  saveOnboardingSteps,
} from '@/lib/onboardingChecklist';
import { cn } from '@/lib/utils';

export default function OnboardingPage() {
  const { user } = useAuth();
  const userKey = user?.email;
  const [steps, setSteps] = useState<OnboardingStepWithState[]>(() =>
    readOnboardingSteps(userKey)
  );

  useEffect(() => {
    setSteps(readOnboardingSteps(userKey));
  }, [userKey]);

  const completedCount = steps.filter((step) => step.completed).length;
  const totalSteps = steps.length;
  const progressPercent = totalSteps === 0 ? 0 : Math.round((completedCount / totalSteps) * 100);

  const toggleStep = (id: string) => {
    setSteps((prev) => {
      const updatedSteps = prev.map((step) =>
        step.id === id ? { ...step, completed: !step.completed } : step
      );
      saveOnboardingSteps(userKey, updatedSteps);
      return updatedSteps;
    });
    trackEvent('submit_support_request_onboarding', { step_id: id });
  };

  return (
    <PortalLayout>
      <section className="portal-section">
        <div className="container-page">
          <div className="mx-auto max-w-3xl">
            <PortalPageIntro
              title="Onboarding Checklist"
              description="Work through the guided setup milestones that get a new operator from unboxing to a confident first successful run."
              badges={[
                { label: `${completedCount}/${totalSteps} complete`, tone: 'success' },
                { label: `${progressPercent}% ready`, tone: 'muted' },
              ]}
              actions={
                <Button asChild variant="outline">
                  <Link to="/portal/training">
                    Go to Training
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              }
            >
              <div className="rounded-[24px] border border-border bg-background p-5 shadow-[var(--shadow-sm)]">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-semibold text-foreground">
                    {completedCount} of {totalSteps} complete
                  </span>
                  <span className="text-sm text-muted-foreground">{progressPercent}%</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-sage transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </PortalPageIntro>

            <div className="mt-6 card-elevated p-5 sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Current milestone
                  </p>
                  <h2 className="mt-1 font-display text-xl font-semibold text-foreground">
                    Keep setup momentum
                  </h2>
                </div>
                <span className="self-start rounded-full bg-sage-light px-3 py-1.5 text-sm font-medium text-sage">
                  {progressPercent}% ready
                </span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Mark each completed milestone as you go so this page stays useful between sessions
                and after re-login.
              </p>
            </div>

            <div className="mt-6 space-y-4">
              {steps.map((step) => (
                <div
                  key={step.id}
                  className={cn(
                    'card-elevated p-5 transition-all',
                    step.completed && 'bg-muted/50'
                  )}
                >
                  <div className="flex items-start gap-4">
                    <button
                      onClick={() => toggleStep(step.id)}
                      className={cn(
                        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                        step.completed
                          ? 'border-sage bg-sage text-sage-light'
                          : 'border-border hover:border-primary'
                      )}
                    >
                      {step.completed && <Check className="h-4 w-4" />}
                    </button>
                    <div className="flex-1">
                      <h3
                        className={cn(
                          'font-semibold',
                          step.completed ? 'text-muted-foreground line-through' : 'text-foreground'
                        )}
                      >
                        {step.title}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                      {step.action && !step.completed && (
                        <Link to={step.action.href} className="mt-3 inline-block w-full sm:w-auto">
                          <Button variant="outline" size="sm" className="w-full sm:w-auto">
                            {step.action.label}
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}
