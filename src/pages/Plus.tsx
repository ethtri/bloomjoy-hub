import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Layout } from '@/components/layout/Layout';
import { trackEvent } from '@/lib/analytics';

const benefits = [
  {
    title: 'Onboarding Checklist',
    description: 'Step-by-step guidance to get your machine operational, including WeChat setup with Sunze support.',
  },
  {
    title: 'Training Library',
    description: 'Video tutorials, operational playbooks, and best-practice guides hosted on our platform.',
  },
  {
    title: 'Member Community',
    description: 'Connect with other Bloomjoy operators to share tips and experiences.',
  },
  {
    title: 'Concierge Support',
    description: 'Triage assistance, best-practice guidance, and translation/escalation with manufacturer support.',
  },
];

export default function PlusPage() {
  useEffect(() => {
    trackEvent('view_plus_pricing');
  }, []);

  const handleStartMembership = () => {
    trackEvent('start_plus_checkout');
  };

  return (
    <Layout>
      {/* Hero */}
      <section className="bg-gradient-to-b from-cream to-background section-padding">
        <div className="container-page">
          <div className="mx-auto max-w-3xl text-center">
            <span className="rounded-full bg-primary/10 px-4 py-1.5 text-sm font-semibold text-primary">
              Bloomjoy Plus
            </span>
            <h1 className="mt-6 font-display text-4xl font-bold text-foreground sm:text-5xl">
              Onboarding + Playbooks + Concierge
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
              Get up and running faster with guided onboarding, training resources, and concierge support from the Bloomjoy team.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing Card */}
      <section className="section-padding">
        <div className="container-page">
          <div className="mx-auto max-w-2xl">
            <div className="card-elevated overflow-hidden">
              <div className="bg-foreground p-8 text-center text-background">
                <h2 className="font-display text-2xl font-bold">Plus Basic</h2>
                <div className="mt-4 flex items-baseline justify-center gap-1">
                  <span className="font-display text-5xl font-bold">$49</span>
                  <span className="text-muted">/month</span>
                </div>
                <p className="mt-2 text-sm text-muted">Billed monthly. Cancel anytime.</p>
              </div>
              <div className="p-8">
                <ul className="space-y-4">
                  {benefits.map((benefit) => (
                    <li key={benefit.title} className="flex items-start gap-4">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sage-light">
                        <Check className="h-4 w-4 text-sage" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">{benefit.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{benefit.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="hero"
                  size="xl"
                  className="mt-8 w-full"
                  onClick={handleStartMembership}
                >
                  Start Membership
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  Membership is optional and separate from machine purchase.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Support Boundaries */}
      <section className="bg-muted/50 section-padding">
        <div className="container-page">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-center font-display text-2xl font-bold text-foreground">
              Support Boundaries
            </h2>
            <p className="mt-4 text-center text-muted-foreground">
              Clear expectations for what's included.
            </p>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-background p-6">
                <h3 className="font-display text-lg font-semibold text-foreground">
                  Bloomjoy Concierge
                </h3>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                    Onboarding assistance
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                    Best-practice guidance
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                    Translation/escalation support
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                    US business hours (Mon–Fri, 9am–5pm EST)
                  </li>
                </ul>
                <p className="mt-4 rounded-lg bg-amber/10 p-3 text-xs text-amber">
                  Not a 24/7 service. Response times may vary.
                </p>
              </div>
              <div className="rounded-xl border border-border bg-background p-6">
                <h3 className="font-display text-lg font-semibold text-foreground">
                  Sunze Technical Support
                </h3>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                    24/7 first-line technical support
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                    Direct manufacturer access via WeChat
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                    Machine diagnostics & troubleshooting
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                    Warranty service
                  </li>
                </ul>
                <p className="mt-4 rounded-lg bg-sage-light p-3 text-xs text-sage">
                  Available to all machine owners, not just Plus members.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section-padding">
        <div className="container-page text-center">
          <h2 className="font-display text-2xl font-bold text-foreground">
            Questions about Plus?
          </h2>
          <p className="mt-2 text-muted-foreground">
            We're happy to walk you through what's included.
          </p>
          <Link to="/contact" className="mt-6 inline-block">
            <Button variant="outline" size="lg">
              Contact Us
            </Button>
          </Link>
        </div>
      </section>
    </Layout>
  );
}
