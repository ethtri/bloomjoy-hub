import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { Check, Circle, Clock3, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { isEdgeFunctionError } from '@/lib/edgeFunctions';
import { fetchRefundCustomerStatus, isLocalUatDemoForced } from '@/lib/refundOperations';
import {
  getRefundCustomerRefreshMs,
  getRefundCustomerStatusCopy,
  refundCustomerLifecycleStages,
  type RefundCustomerLifecycle,
  type RefundCustomerStatusCopy,
} from '@/lib/refundCustomerStatus';
import { cn } from '@/lib/utils';

const SESSION_TOKEN_KEY = 'bloomjoy-refund-status-capability';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

const readHashToken = () => {
  if (typeof window === 'undefined' || !window.location.hash) {
    return { present: false, token: '' };
  }
  const token = window.location.hash.startsWith('#token=')
    ? window.location.hash.slice('#token='.length)
    : '';
  return { present: true, token: tokenPattern.test(token) ? token : '' };
};

const getInitialToken = () => {
  if (typeof window === 'undefined') return '';
  const hash = readHashToken();
  if (hash.present) return hash.token;
  const saved = window.sessionStorage.getItem(SESSION_TOKEN_KEY) ?? '';
  return tokenPattern.test(saved) ? saved : '';
};

const milestones: Array<{
  key: Exclude<RefundCustomerStatusCopy['milestone'], 'denied'>;
  label: string;
}> = [
  { key: 'received', label: 'Received' },
  { key: 'reviewing', label: 'Reviewing' },
  { key: 'initiated', label: 'Initiated' },
  { key: 'confirming', label: 'Confirming' },
  { key: 'confirmed', label: 'Confirmed' },
];

const milestoneRank: Record<RefundCustomerStatusCopy['milestone'], number> = {
  received: 0,
  reviewing: 1,
  initiated: 2,
  confirming: 3,
  confirmed: 4,
  denied: -1,
};

const formatLastUpdated = (value: string) => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return 'Recently';
  }
};

export default function RefundStatusPage() {
  const location = useLocation();
  const [token, setToken] = useState(getInitialToken);
  const isDemoMode = isLocalUatDemoForced();
  const demoLifecycle = useMemo<RefundCustomerLifecycle | null>(() => {
    if (!isDemoMode || typeof window === 'undefined') return null;
    const requestedStage = new URLSearchParams(window.location.search).get('stage') ?? 'matching';
    const stage = refundCustomerLifecycleStages.includes(
      requestedStage as RefundCustomerLifecycle['stage'],
    )
      ? requestedStage as RefundCustomerLifecycle['stage']
      : 'matching';
    return {
      schemaVersion: 'refund_lifecycle_v1',
      stage,
      stageRank: refundCustomerLifecycleStages.indexOf(stage),
      lastUpdatedAt: new Date().toISOString(),
      publicCopyKey: `demo_${stage}`,
      terminal: stage === 'customer_notified' || stage === 'denied',
      refreshAfterSeconds: stage === 'customer_notified' || stage === 'denied' ? null : 5,
      payloadRedacted: true,
    };
  }, [isDemoMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = readHashToken();
    if (hash.present) {
      if (!hash.token) {
        window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
        if (token) setToken('');
      } else if (hash.token !== token) {
        setToken(hash.token);
        return;
      } else {
        window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
      }
      window.history.replaceState(window.history.state, '', window.location.pathname);
      return;
    }
    if (!tokenPattern.test(token)) return;
    window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  }, [location.hash, token]);

  const statusQuery = useQuery({
    queryKey: ['refund-customer-status', token || 'missing-capability'],
    queryFn: () => fetchRefundCustomerStatus(token),
    enabled: !isDemoMode && tokenPattern.test(token),
    retry: (failureCount, error) => {
      if (failureCount >= 3) return false;
      return !isEdgeFunctionError(error) || error.status === 429 || error.status >= 500;
    },
    retryDelay: (attempt) => Math.min(15_000, 1_000 * 2 ** attempt),
    refetchInterval: (query) => {
      const lifecycle = query.state.data?.lifecycle;
      return lifecycle ? getRefundCustomerRefreshMs(lifecycle) : false;
    },
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });

  const lifecycle = demoLifecycle ?? statusQuery.data?.lifecycle ?? null;
  const copy = useMemo(
    () => lifecycle ? getRefundCustomerStatusCopy(lifecycle) : null,
    [lifecycle],
  );
  const isChecking = !isDemoMode && tokenPattern.test(token) && statusQuery.isPending;
  const genericUnavailable = !isDemoMode && (!tokenPattern.test(token) || statusQuery.isError);
  const activeRank = copy ? milestoneRank[copy.milestone] : 0;

  return (
    <Layout>
      <section className="min-h-[70vh] bg-gradient-to-b from-pink-50 via-background to-background px-4 py-8 sm:py-12">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-2xl border border-pink-200 bg-white p-5 shadow-sm sm:p-8">
            <div className="flex items-center gap-2 text-sm font-semibold text-pink-800">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Secure refund status
            </div>

            {isDemoMode && (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">
                DEMO DATA — visual review only. No case or refund was read or changed.
              </div>
            )}

            {isChecking && (
              <div className="flex min-h-64 flex-col items-center justify-center text-center" role="status">
                <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
                <h1 className="mt-4 font-display text-2xl font-bold text-foreground">
                  Checking your request
                </h1>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                  This page is read-only. It cannot submit or retry a refund.
                </p>
              </div>
            )}

            {genericUnavailable && !isChecking && (
              <div className="py-8 text-center" role="alert">
                <h1 className="font-display text-3xl font-bold text-foreground">
                  This secure link is not available
                </h1>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                  The link may be incomplete or no longer active. This does not create a new
                  request or change an existing refund.
                </p>
                <div className="mx-auto mt-6 max-w-md rounded-xl border border-border bg-muted/30 p-4 text-left text-sm text-muted-foreground">
                  <div className="flex gap-3">
                    <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <p>
                      Reply to your Bloomjoy refund email or contact customer service with your
                      reference. You do not need to submit another form.
                    </p>
                  </div>
                </div>
                <Button asChild className="mt-6">
                  <a href="mailto:info@bloomjoysweets.com?subject=Bloomjoy%20refund%20status%20help">
                    Email Bloomjoy customer service
                  </a>
                </Button>
              </div>
            )}

            {lifecycle && copy && !genericUnavailable && (
              <div className="mt-5" aria-live="polite">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-pink-700">
                  Current status
                </p>
                <h1 className="mt-2 font-display text-3xl font-bold text-foreground sm:text-4xl">
                  {copy.title}
                </h1>
                <p className="mt-3 text-base leading-7 text-foreground">{copy.detail}</p>

                {copy.milestone === 'denied' ? (
                  <div className="mt-6 rounded-xl border border-border bg-muted/25 p-4">
                    <p className="font-semibold text-foreground">Review complete</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      No refund was issued. Reply to your Bloomjoy email if you want us to review
                      the same request again.
                    </p>
                  </div>
                ) : (
                  <ol className="mt-7 grid gap-2 sm:grid-cols-5" aria-label="Refund progress">
                    {milestones.map((milestone, index) => {
                      const complete = index <= activeRank;
                      const current = index === activeRank;
                      return (
                        <li
                          key={milestone.key}
                          aria-current={current ? 'step' : undefined}
                          className={cn(
                            'flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold',
                            complete
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                              : 'border-border bg-background text-muted-foreground',
                          )}
                        >
                          {complete ? (
                            <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                          ) : (
                            <Circle className="h-4 w-4 shrink-0" aria-hidden="true" />
                          )}
                          {milestone.label}
                        </li>
                      );
                    })}
                  </ol>
                )}

                <section className="mt-6 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sky-950">
                  <h2 className="font-semibold">What happens next</h2>
                  <p className="mt-1 text-sm leading-6">{copy.nextExpectation}</p>
                </section>

                <div className="mt-5 flex flex-col gap-2 border-t border-border pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-center gap-2">
                    <Clock3 className="h-4 w-4" aria-hidden="true" />
                    Last updated {formatLastUpdated(lifecycle.lastUpdatedAt)}
                  </p>
                  {!lifecycle.terminal && (
                    <p role="status">
                      {statusQuery.isFetching ? 'Checking for updates…' : 'Updates automatically'}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <p className="mx-auto mt-4 max-w-xl text-center text-xs leading-5 text-muted-foreground">
            For your privacy, this page does not show card digits, payment-provider details, or
            internal review notes.
          </p>
        </div>
      </section>
    </Layout>
  );
}
