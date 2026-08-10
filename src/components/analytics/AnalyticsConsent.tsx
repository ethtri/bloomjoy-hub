import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BarChart3, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ANALYTICS_CONSENT_EVENT,
  getAnalyticsConsent,
  isPublicAnalyticsPath,
  setAnalyticsConsent,
  trackPublicPageView,
  type AnalyticsConsent,
} from '@/lib/analytics';

const useAnalyticsConsent = () => {
  const [consent, setConsent] = useState<AnalyticsConsent | null>(null);

  useEffect(() => {
    setConsent(getAnalyticsConsent());

    const handleConsentChange = (event: Event) => {
      setConsent((event as CustomEvent<AnalyticsConsent>).detail);
    };

    window.addEventListener(ANALYTICS_CONSENT_EVENT, handleConsentChange);
    return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, handleConsentChange);
  }, []);

  return consent;
};

const saveConsent = (consent: AnalyticsConsent) => {
  setAnalyticsConsent(consent);
  if (consent === 'granted') {
    trackPublicPageView(window.location.pathname);
  }
};

export const AnalyticsConsentBanner = () => {
  const { pathname } = useLocation();
  const consent = useAnalyticsConsent();

  if (consent || !isPublicAnalyticsPath(pathname)) {
    return null;
  }

  return (
    <aside
      role="dialog"
      aria-label="Website analytics choice"
      aria-live="polite"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-4xl overflow-hidden rounded-2xl border border-border bg-background/95 shadow-elevated-lg backdrop-blur sm:bottom-5"
    >
      <div className="h-1 bg-gradient-to-r from-primary via-accent to-primary" />
      <div className="grid gap-5 p-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-6">
        <div className="hidden h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary sm:flex">
          <BarChart3 className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">
            Help us improve the buyer journey
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Allow privacy-minimized analytics for page visits and controlled actions. We exclude
            contact fields, messages, account IDs, query strings, and exact planner inputs. Read our{' '}
            <Link to="/privacy" className="font-semibold text-primary hover:underline">
              privacy policy
            </Link>
            .
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <Button variant="outline" onClick={() => saveConsent('denied')}>
            No thanks
          </Button>
          <Button onClick={() => saveConsent('granted')}>Allow analytics</Button>
        </div>
      </div>
    </aside>
  );
};

export const AnalyticsConsentControls = () => {
  const consent = useAnalyticsConsent();

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-semibold text-foreground">
            Analytics preference
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {consent === 'granted'
              ? 'Analytics is allowed. You can stop future public-site measurement at any time.'
              : consent === 'denied'
                ? 'Analytics is off. Bloomjoy will not load the Google Analytics tag.'
                : 'No choice is saved yet. Analytics stays off until you allow it.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={consent === 'denied' ? 'default' : 'outline'}
              onClick={() => saveConsent('denied')}
            >
              Keep analytics off
            </Button>
            <Button
              size="sm"
              variant={consent === 'granted' ? 'default' : 'outline'}
              onClick={() => saveConsent('granted')}
            >
              Allow analytics
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
