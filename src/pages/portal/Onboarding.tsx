import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PortalLayout } from '@/components/portal/PortalLayout';
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
      <section className="section-padding">
        <div className="container-page">
          <div className="mx-auto max-w-2xl">
            <h1 className="font-display text-3xl font-bold text-foreground">
              Onboarding Checklist
            </h1>
            <p className="mt-2 text-muted-foreground">
              Complete these steps to get the most out of your Bloomjoy machine.
            </p>

            {/* Progress */}
            <div className="mt-8 card-elevated p-6">
              <div className="flex items-center justify-between">
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

            {/* Steps */}
            <div className="mt-8 space-y-4">
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
                        <Link to={step.action.href} className="mt-3 inline-block">
                          <Button variant="outline" size="sm">
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
