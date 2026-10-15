import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ArrowRight, BookOpen, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Layout } from '@/components/layout/Layout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { businessPlaybookPlusTools } from '@/data/businessPlaybookPlusTools';
import { trackEvent } from '@/lib/analytics';
import { trackBusinessPlaybookCtaClick } from '@/lib/businessPlaybookAnalytics';
import { getCheckoutStatus, startPlusCheckout } from '@/lib/stripeCheckout';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';

const benefits = [
  {
    title: 'Onboarding Checklist',
    description: 'Setup steps and help connecting with manufacturer support on WeChat.',
  },
  {
    title: 'Training Library',
    description: 'Videos, working sheets, and job aids for setup, daily operation, cleaning, and troubleshooting.',
  },
  {
    title: 'Operator Certificate',
    description: 'A Bloomjoy completion certificate after the Operator Essentials training path.',
  },
  {
    title: 'Connected Reporting',
    description: 'Assigned-machine sales, trends, and exports when reporting is enabled for your account.',
  },
  {
    title: 'Concierge Support',
    description: 'Operating guidance, issue triage, and translation or escalation to the manufacturer.',
  },
];

const PLUS_MONTHLY_PRICE = 100;
const launchChecklistPreview = businessPlaybookPlusTools.find((tool) => tool.id === 'launch-checklist');

type CheckoutNotice = { title: string; description: string; state: 'checking' | 'confirmed' | 'pending' | 'error' | 'cancelled' };

export default function PlusPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [checkoutNotice, setCheckoutNotice] = useState<CheckoutNotice | null>(null);

  useEffect(() => {
    trackEvent('view_plus_pricing');
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutStatus = params.get('checkout');
    if (!checkoutStatus) return;

    if (checkoutStatus === 'cancel') {
      setCheckoutNotice({ state: 'cancelled', title: 'Checkout canceled', description: 'You can start again when you’re ready. If you expected a payment to complete, check your account first.' });
      window.history.replaceState({}, '', '/plus');
      return;
    }

    const sessionId = params.get('session_id');
    if (checkoutStatus !== 'return' || !sessionId) {
      setCheckoutNotice({ state: 'error', title: 'We couldn’t verify this checkout', description: 'Check your account for membership status before trying again, or contact us for help.' });
      window.history.replaceState({}, '', '/plus');
      return;
    }

    let cancelled = false;
    setCheckoutNotice({ state: 'checking', title: 'Checking your payment', description: 'Please wait while we confirm your Plus checkout.' });
    void getCheckoutStatus(sessionId)
      .then((status) => {
        if (cancelled) return;
        if (status.paymentStatus === 'paid' && status.orderType === 'plus_subscription') {
          setCheckoutNotice({ state: 'confirmed', title: 'Payment confirmed. Welcome to Bloomjoy Plus!', description: 'Your subscription payment is confirmed. Open your account to check membership access and billing.' });
          return;
        }
        setCheckoutNotice({ state: 'pending', title: 'Payment is not yet confirmed', description: 'Your Plus subscription is not confirmed yet. Check your account before starting another checkout.' });
      })
      .catch(() => {
        if (cancelled) return;
        setCheckoutNotice({ state: 'error', title: 'We couldn’t verify your payment', description: 'Check your account before trying again. If you need help, contact us with your checkout email.' });
      })
      .finally(() => {
        if (!cancelled) window.history.replaceState({}, '', '/plus');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleStartMembership = async () => {
    if (!user?.id || !user.email) {
      toast.error('Please log in before starting Bloomjoy Plus checkout.');
      navigate('/login', { state: { from: { pathname: '/plus' } } });
      return;
    }

    trackEvent('start_plus_checkout', {
      billing_model: 'flat_monthly',
      monthly_total: PLUS_MONTHLY_PRICE,
      user_id: user.id,
    });
    try {
      setIsStartingCheckout(true);
      const checkoutUrl = await startPlusCheckout(window.location.origin);
      window.location.assign(checkoutUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start checkout.';
      toast.error(message);
      setIsStartingCheckout(false);
    }
  };

  return (
    <Layout>
      <section className="bg-gradient-to-b from-cream to-background py-8 sm:py-12">
        <div className="container-page">
          <div className="mx-auto max-w-5xl">
            {checkoutNotice && (
              <Alert variant={checkoutNotice.state === 'error' ? 'destructive' : 'default'} className="mb-8" role="status" aria-live="polite">
                {checkoutNotice.state === 'confirmed' ? <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> : <AlertCircle aria-hidden="true" className="h-4 w-4" />}
                <AlertTitle>{checkoutNotice.title}</AlertTitle>
                <AlertDescription>
                  <p>{checkoutNotice.description}</p>
                  {checkoutNotice.state !== 'checking' && checkoutNotice.state !== 'cancelled' && (
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                      <Link to="/portal/account" className="font-semibold underline underline-offset-4">Open your account</Link>
                      <Link to="/contact?type=general&source=%2Fplus" className="font-semibold underline underline-offset-4">Contact Bloomjoy</Link>
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}
            <h1 className="font-display text-4xl font-bold text-foreground sm:text-5xl">Bloomjoy Plus</h1>
            <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              Training, practical tools, and concierge guidance for running your machine.
            </p>

            <div className="mt-7 grid items-start gap-8 lg:mt-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12">
              <div className="order-2 lg:order-1">
                <h2 className="font-display text-2xl font-bold text-foreground">What’s included</h2>
                <ul className="mt-5 space-y-5">
                  {benefits.map((benefit) => (
                    <li key={benefit.title} className="flex items-start gap-3">
                      <Check aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-primary" />
                      <div>
                        <h3 className="font-semibold text-foreground">{benefit.title}</h3>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{benefit.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="order-1 overflow-hidden rounded-2xl border border-border bg-card shadow-elevated lg:order-2">
                <div className="bg-foreground p-6 text-background sm:p-7">
                  <h2 className="font-display text-xl font-bold">One membership for your account</h2>
                  <p className="mt-3 flex items-baseline gap-1.5">
                    <span className="font-display text-5xl font-bold">${PLUS_MONTHLY_PRICE}</span>
                    <span className="text-background/80">/month</span>
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-background/80">
                    Flat monthly price, regardless of machine count. Cancel anytime.
                  </p>
                </div>
                <div className="p-6 sm:p-7">
                  <p className="text-sm leading-relaxed text-muted-foreground">Optional membership, billed separately from your machine purchase.</p>
                  <Button
                    variant="hero"
                    size="lg"
                    className="mt-5 min-h-12 w-full"
                    onClick={handleStartMembership}
                    disabled={isStartingCheckout || (checkoutNotice !== null && checkoutNotice.state !== 'cancelled')}
                  >
                    {isStartingCheckout ? 'Opening checkout…' : user ? 'Start membership' : 'Log in to join Plus'}
                    <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" />
                  </Button>
                  <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                    By continuing, you agree to our{' '}
                    <Link to="/terms" className="underline underline-offset-4 hover:text-foreground">Terms</Link> and{' '}
                    <Link to="/billing-cancellation" className="underline underline-offset-4 hover:text-foreground">Billing & Cancellation</Link> policies.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-muted/30 py-8 sm:py-10">
        <div className="container-page">
          <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-2 md:gap-12">
            <div>
              <h2 className="font-display text-2xl font-bold text-foreground">How support works</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Bloomjoy concierge helps with onboarding, operating questions, and manufacturer communication during US business hours: Monday–Friday, 9am–5pm EST. Response times vary.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Manufacturer technical support is available to all machine owners via WeChat, including diagnostics, troubleshooting, and warranty service. Plus is not required for that support.
              </p>
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold text-foreground">What’s separate</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
                <li>Machine purchases and supplies are ordered separately.</li>
                <li>Manufacturer technical and warranty service stays with the manufacturer.</li>
                <li>Bloomjoy concierge is not a 24/7 service.</li>
                <li>Connected reporting requires account access to be enabled.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="py-8 sm:py-12">
        <div className="container-page">
          <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-2 md:gap-12">
            {launchChecklistPreview && (
              <div>
                <h2 className="font-display text-2xl font-bold text-foreground">A look inside the tools</h2>
                <h3 className="mt-4 font-semibold text-foreground">{launchChecklistPreview.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{launchChecklistPreview.description}</p>
                <blockquote className="mt-4 border-l-2 border-primary pl-4 text-sm leading-relaxed text-foreground">
                  {launchChecklistPreview.samplePreview}
                </blockquote>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Public sample. Member tools and training are accessed in the portal.</p>
              </div>
            )}
            <div>
              <BookOpen aria-hidden="true" className="h-6 w-6 text-primary" />
              <h2 className="mt-3 font-display text-2xl font-bold text-foreground">Still planning your business?</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Our free Business Playbook covers startup budgets, location selection, and launch planning.</p>
              <Link
                to="/resources/business-playbook"
                onClick={() => trackBusinessPlaybookCtaClick({ surface: 'plus_page', cta: 'open_playbook', href: '/resources/business-playbook' })}
                className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline"
              >
                Open the free Playbook <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
              <p className="mt-5 border-t border-border pt-5 text-sm text-muted-foreground">
                Questions about membership?{' '}
                <Link to="/contact?type=general&source=%2Fplus" className="font-semibold text-primary underline underline-offset-4">Contact Bloomjoy</Link>.
              </p>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
