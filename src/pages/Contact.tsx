import { startTransition, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Layout } from '@/components/layout/Layout';
import { trackEvent } from '@/lib/analytics';
import {
  getNormalizedBusinessPlaybookSourcePage,
  getNormalizedInternalSourcePage,
  trackBuyerFlowPlaybookLinkClick,
  trackContactSubmitFromPlaybook,
} from '@/lib/businessPlaybookAnalytics';
import { createLeadSubmission } from '@/lib/leadSubmissions';
import { MACHINE_NAMES } from '@/lib/machineNames';
import {
  buildStructuredQuoteMessage,
  getMobileFitQuoteContextLabels,
  getPlannerQuoteContextLabels,
  getQuoteSourceLabel,
  getSafeMobileFitQuoteContext,
  getSafePlannerQuoteContext,
  getSafeQuoteMachineInterest,
  getSafeQuoteVenueUse,
  QUOTE_READINESS_OPTIONS,
  QUOTE_TIMELINE_OPTIONS,
  QUOTE_VENUE_OPTIONS,
} from '@/lib/quoteIntake';

const validInquiryTypes = new Set(['quote', 'demo', 'procurement', 'general']);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ContactFormData = {
  name: string;
  email: string;
  type: string;
  interest: string;
  organization: string;
  venueUse: string;
  serviceRegion: string;
  timeline: string;
  readiness: string;
  message: string;
  website: string;
};

type FieldErrors = Partial<Record<keyof ContactFormData, string>>;

type SubmissionSuccess = {
  inquiryType: string;
  machineInterest: string;
  timeline: string;
  venueUse: string;
};

const createInitialFormData = (type: string, interest: string, venueUse: string): ContactFormData => ({
  name: '',
  email: '',
  type,
  interest,
  organization: '',
  venueUse,
  serviceRegion: '',
  timeline: '',
  readiness: '',
  message: '',
  website: '',
});

const getPostSubmitPlaybookLinks = (interest: string) => {
  if (interest === 'Commercial Machine') {
    return [
      {
        label: 'Pressure-test payback assumptions',
        href: '/resources/business-playbook/payback-planner',
      },
      {
        label: 'Read the Commercial location guide',
        href: '/resources/business-playbook/best-locations-for-cotton-candy-vending-machines',
      },
      {
        label: 'Compare revenue share and rent terms',
        href: '/resources/business-playbook/revenue-share-vs-rent-cotton-candy-machine-placement',
      },
    ];
  }

  if (interest === 'Mini Machine' || interest === 'Micro Machine') {
    return [
      {
        label: 'Pressure-test event payback assumptions',
        href: '/resources/business-playbook/payback-planner',
      },
      {
        label: 'Read the event business guide',
        href: '/resources/business-playbook/mini-micro-event-catering-business-guide',
      },
      {
        label: 'Read the ROI and payback guide',
        href: '/resources/business-playbook/cotton-candy-machine-roi-sales-payback-planning',
      },
    ];
  }

  return [
    {
      label: 'Pressure-test payback assumptions',
      href: '/resources/business-playbook/payback-planner',
    },
    {
      label: 'Start with the business launch guide',
      href: '/resources/business-playbook/how-to-start-cotton-candy-vending-business',
    },
    {
      label: 'Review the startup budget checklist',
      href: '/resources/business-playbook/startup-budget-checklist-cotton-candy-machine-business',
    },
  ];
};

const FieldError = ({ id, message }: { id: string; message?: string }) =>
  message ? (
    <p id={id} className="mt-1.5 flex items-center gap-1.5 text-sm text-destructive">
      <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
      {message}
    </p>
  ) : null;

const selectClassName =
  'mt-1.5 min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground shadow-sm sm:text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export default function ContactPage() {
  const [searchParams] = useSearchParams();
  const [queryReady, setQueryReady] = useState(false);
  const queryType = queryReady ? searchParams.get('type') : null;
  const querySource = queryReady ? searchParams.get('source') : null;
  const queryUse = queryReady ? searchParams.get('use') : null;
  const initialType = queryType && validInquiryTypes.has(queryType) ? queryType : 'general';
  const requestedMachineInterest = getSafeQuoteMachineInterest(
    queryReady ? searchParams.get('interest') : null
  );
  const initialInterest = initialType === 'quote' ? MACHINE_NAMES.commercial : '';
  const initialVenueUse = initialType === 'quote' ? getSafeQuoteVenueUse(queryUse) : '';
  const sourcePage = getNormalizedInternalSourcePage(querySource) ?? '/contact';
  const playbookSourcePage = getNormalizedBusinessPlaybookSourcePage(querySource);
  const sourceLabel = getQuoteSourceLabel(sourcePage);
  const plannerContext = getSafePlannerQuoteContext({
    sourcePage,
    machineSignal: queryReady ? searchParams.get('planner_machine') : null,
    intendedPath: queryReady ? searchParams.get('planner_path') : null,
    budgetBand: queryReady ? searchParams.get('planner_budget') : null,
    openQuestions: queryReady ? searchParams.get('planner_open') : null,
  });
  const plannerContextLabels = plannerContext
    ? getPlannerQuoteContextLabels(plannerContext)
    : null;
  const mobileFitContext = getSafeMobileFitQuoteContext({
    sourcePage,
    resultBand: queryReady ? searchParams.get('mobile_fit') : null,
    machineSignal: queryReady ? searchParams.get('mobile_machine') : null,
    placement: queryReady ? searchParams.get('mobile_placement') : null,
    openQuestions: queryReady ? searchParams.get('mobile_open') : null,
  });
  const mobileFitContextLabels = mobileFitContext
    ? getMobileFitQuoteContextLabels(mobileFitContext)
    : null;
  const redirectedMachineInterest =
    initialType === 'quote' &&
    (requestedMachineInterest === MACHINE_NAMES.mini ||
      requestedMachineInterest === MACHINE_NAMES.micro)
      ? requestedMachineInterest
      : '';
  const redirectedMachinePath =
    redirectedMachineInterest === MACHINE_NAMES.mini
      ? '/machines/mini'
      : redirectedMachineInterest === MACHINE_NAMES.micro
        ? '/machines/micro'
        : '/machines';

  const [formData, setFormData] = useState<ContactFormData>(() =>
    createInitialFormData(initialType, initialInterest, initialVenueUse)
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SubmissionSuccess | null>(null);
  const submissionGuardRef = useRef(false);
  const submissionIdRef = useRef<string | null>(null);
  const startTrackedRef = useRef(false);
  const errorSummaryRef = useRef<HTMLDivElement | null>(null);
  const successRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const isQuote = formData.type === 'quote';

  useEffect(() => {
    startTransition(() => setQueryReady(true));
  }, []);

  useEffect(() => {
    if (!queryReady) return;
    startTransition(() => {
      setFormData((current) => ({
        ...current,
        type: initialType,
        interest: initialInterest,
        venueUse: initialVenueUse,
        serviceRegion: initialType === 'quote' ? current.serviceRegion : '',
        timeline: initialType === 'quote' ? current.timeline : '',
        readiness: initialType === 'quote' ? current.readiness : '',
      }));
    });
  }, [initialInterest, initialType, initialVenueUse, queryReady]);

  useEffect(() => {
    if (!success) return;
    successRef.current?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    successRef.current?.focus({ preventScroll: true });
  }, [success]);

  const updateField = (field: keyof ContactFormData, value: string) => {
    setFormData((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setServerError('');
  };

  const updateInquiryType = (type: string) => {
    setFormData((current) => ({
      ...current,
      type,
      interest: type === 'quote' ? MACHINE_NAMES.commercial : '',
      venueUse: type === 'quote' ? current.venueUse : '',
      serviceRegion: type === 'quote' ? current.serviceRegion : '',
      timeline: type === 'quote' ? current.timeline : '',
      readiness: type === 'quote' ? current.readiness : '',
    }));
    setFieldErrors({});
    setServerError('');
  };

  const handleFormFocus = () => {
    if (startTrackedRef.current) return;
    startTrackedRef.current = true;
    trackEvent('lead_form_start', {
      inquiry_type: formData.type,
      route: '/contact',
      source: sourcePage,
    });
  };

  const validateForm = () => {
    const nextErrors: FieldErrors = {};

    if (!formData.name.trim()) nextErrors.name = 'Enter your name.';
    if (!emailPattern.test(formData.email.trim())) {
      nextErrors.email = 'Enter a valid email address.';
    }

    if (isQuote) {
      if (!formData.venueUse) nextErrors.venueUse = 'Choose the setting closest to your plan.';
      if (!formData.serviceRegion.trim()) {
        nextErrors.serviceRegion = 'Enter the city/state or region you plan to serve.';
      }
      if (!formData.timeline) nextErrors.timeline = 'Choose your current purchase timeline.';
    } else if (!formData.message.trim()) {
      nextErrors.message = 'Tell us how we can help.';
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return false;
    }

    return true;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (submissionGuardRef.current) return;

    if (formData.website.trim()) {
      setSuccess({ inquiryType: formData.type, machineInterest: '', timeline: '', venueUse: '' });
      return;
    }

    if (!validateForm()) {
      trackEvent('lead_form_error', {
        inquiry_type: formData.type,
        route: '/contact',
        source: sourcePage,
      });
      return;
    }

    const clientSubmissionId = submissionIdRef.current ?? crypto.randomUUID();
    submissionIdRef.current = clientSubmissionId;
    submissionGuardRef.current = true;
    setSubmitting(true);
    setServerError('');

    try {
      const submittedMachineInterest = isQuote ? MACHINE_NAMES.commercial : '';
      const submittedMessage = isQuote
        ? buildStructuredQuoteMessage({
            organization: formData.organization,
            venueUse: formData.venueUse,
            serviceRegion: formData.serviceRegion,
            timeline: formData.timeline,
            readiness: formData.readiness,
            additionalDetails: formData.message,
            plannerContext,
            mobileFitContext,
          })
        : formData.message.trim();

      await createLeadSubmission({
        submissionType: formData.type as 'quote' | 'demo' | 'procurement' | 'general',
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
        message: submittedMessage,
        machineInterest: submittedMachineInterest || undefined,
        sourcePage,
        clientSubmissionId,
      });

      if (playbookSourcePage) {
        trackContactSubmitFromPlaybook({
          sourcePage: playbookSourcePage,
          inquiryType: formData.type,
          machineInterest: submittedMachineInterest || undefined,
        });
      }

      trackEvent('lead_form_submit', {
        inquiry_type: formData.type,
        route: '/contact',
        source: sourcePage,
      });
      setSuccess({
        inquiryType: formData.type,
        machineInterest: submittedMachineInterest || 'Not sure yet',
        timeline: formData.timeline,
        venueUse: formData.venueUse,
      });
      submissionIdRef.current = null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '';
      setServerError(
        /failed to fetch|network|load failed/i.test(errorMessage)
          ? 'We couldn’t connect to Bloomjoy. Your entries are still here—check your connection and try again.'
          : /request failed with status 5\d\d/i.test(errorMessage)
            ? 'Bloomjoy couldn’t accept the request right now. Your entries are still here—please try again.'
          : errorMessage || 'We could not send your request. Your entries are still here—please try again.'
      );
      trackEvent('lead_form_error', {
        inquiry_type: formData.type,
        route: '/contact',
        source: sourcePage,
      });
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
    } finally {
      submissionGuardRef.current = false;
      setSubmitting(false);
    }
  };

  const startAnotherMessage = () => {
    setSuccess(null);
    setFieldErrors({});
    setServerError('');
    setFormData(createInitialFormData(initialType, initialInterest, initialVenueUse));
    startTrackedRef.current = false;
    submissionIdRef.current = null;
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('#contact-name')?.focus());
  };

  const postSubmitPlaybookLinks = success
    ? getPostSubmitPlaybookLinks(success.machineInterest)
    : [];
  const errorCount = Object.keys(fieldErrors).length;

  return (
    <Layout>
      <section className="border-b border-border/70 bg-gradient-to-b from-cream to-background py-8 sm:py-10">
        <div className="container-page">
          <div className="mx-auto max-w-5xl">
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {isQuote ? 'Request a Commercial Machine quote' : 'Contact Bloomjoy'}
            </h1>
            <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">
              {isQuote
                ? 'Tell us where and when you plan to operate. We’ll review your needs and follow up by email.'
                : 'Ask about machines, supplies, procurement, or Bloomjoy Plus. We’ll follow up by email.'}
            </p>
          </div>
        </div>
      </section>

      <section className="py-6 sm:py-10">
        <div className="container-page">
          {success ? (
            <div
              ref={successRef}
              tabIndex={-1}
              role="status"
              aria-live="polite"
              className="mx-auto max-w-3xl scroll-mt-24 rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background p-6 shadow-elevated outline-none focus-visible:ring-2 focus-visible:ring-primary sm:p-9"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                <CheckCircle2 aria-hidden="true" className="h-7 w-7" />
              </div>
              <p className="mt-6 text-sm font-bold uppercase tracking-[0.16em] text-primary">
                Request received
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold text-foreground">
                {success.inquiryType === 'quote'
                  ? 'Your Commercial Machine quote request is with Bloomjoy.'
                  : 'Your message is with Bloomjoy.'}
              </h2>
              <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
                {success.inquiryType === 'quote'
                  ? 'We’ll review the setting, service region, timing, and Commercial Machine fit, then follow up using the email you provided. We may ask a few clarifying questions before discussing quote options.'
                  : 'We’ll review your message and follow up using the email you provided.'}
              </p>

              {success.inquiryType === 'quote' && (
                <div className="mt-6 grid gap-3 rounded-2xl border border-border bg-background/80 p-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Machine</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{success.machineInterest}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Setting</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{success.venueUse}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timing</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{success.timeline}</p>
                  </div>
                </div>
              )}

              {success.inquiryType === 'quote' && postSubmitPlaybookLinks.length > 0 && (
                <div className="mt-7 border-t border-border pt-6">
                  <div className="flex items-start gap-3">
                    <BookOpen aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    <div>
                      <h3 className="font-display text-xl font-bold text-foreground">
                        Useful while you wait
                      </h3>
                      <div className="mt-3 grid gap-2">
                        {postSubmitPlaybookLinks.map((link) => (
                          <Link
                            key={link.href}
                            to={link.href}
                            onClick={() =>
                              trackBuyerFlowPlaybookLinkClick({
                                surface: 'contact_success',
                                cta: link.label,
                                href: link.href,
                                machine: success.machineInterest,
                              })
                            }
                            className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            {link.label}
                            <ArrowRight aria-hidden="true" className="h-4 w-4" />
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-7 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Need to add something? Email{' '}
                  <a className="font-semibold text-primary hover:underline" href="mailto:info@bloomjoyusa.com">
                    info@bloomjoyusa.com
                  </a>
                  .
                </p>
                <Button type="button" variant="outline" onClick={startAnotherMessage}>
                  Send another message
                </Button>
              </div>
            </div>
          ) : (
            <div className="mx-auto grid max-w-5xl grid-cols-1 items-start gap-8 lg:grid-cols-[1.35fr_0.65fr] lg:gap-10">
              <div className="min-w-0 rounded-2xl border border-border bg-card p-5 shadow-elevated sm:p-8">
                {(errorCount > 0 || serverError) && (
                  <Alert
                    ref={errorSummaryRef}
                    tabIndex={-1}
                    variant="destructive"
                    className="mb-6 scroll-mt-24 outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                  >
                    <AlertCircle aria-hidden="true" className="h-4 w-4" />
                    <AlertTitle>{serverError ? 'We couldn’t send the form' : 'Check the highlighted fields'}</AlertTitle>
                    <AlertDescription>
                      {serverError || `${errorCount} ${errorCount === 1 ? 'field needs' : 'fields need'} your attention. Your other entries are still here.`}
                      {errorCount > 0 && (
                        <ul className="mt-2 space-y-1">
                          {Object.entries(fieldErrors).map(([field, message]) => (
                            <li key={field}>
                              <a
                                href={`#contact-${field === 'venueUse' ? 'venue' : field === 'serviceRegion' ? 'region' : field}`}
                                className="underline underline-offset-4"
                                onClick={(event) => {
                                  event.preventDefault();
                                  const fieldId = field === 'venueUse' ? 'venue' : field === 'serviceRegion' ? 'region' : field;
                                  formRef.current?.querySelector<HTMLElement>(`#contact-${fieldId}`)?.focus();
                                }}
                              >
                                {message}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                <form
                  ref={formRef}
                  onSubmit={handleSubmit}
                  onFocusCapture={handleFormFocus}
                  className="space-y-6"
                  noValidate
                >
                  <div className="hidden" aria-hidden="true">
                    <Label htmlFor="website">Website</Label>
                    <Input
                      id="website"
                      name="website"
                      value={formData.website}
                      onChange={(event) => updateField('website', event.target.value)}
                      tabIndex={-1}
                      autoComplete="off"
                    />
                  </div>

                  <div>
                    <Label htmlFor="contact-type">What can we help with?</Label>
                    <select
                      id="contact-type"
                      name="type"
                      value={formData.type}
                      onChange={(event) => updateInquiryType(event.target.value)}
                      className={selectClassName}
                    >
                      <option value="general">General inquiry</option>
                      <option value="quote">Commercial Machine quote request</option>
                      <option value="demo">Demo request</option>
                      <option value="procurement">Procurement questions</option>
                    </select>
                  </div>

                  <fieldset className="space-y-5">
                    <legend className="font-display text-xl font-bold text-foreground">
                      Your contact details
                    </legend>
                    <p className="text-sm text-muted-foreground">Fields marked required must be completed.</p>
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="contact-name">Name <span className="text-destructive">(required)</span></Label>
                        <Input
                          id="contact-name"
                          required
                          name="name"
                          value={formData.name}
                          onChange={(event) => updateField('name', event.target.value)}
                          autoComplete="name"
                          aria-invalid={Boolean(fieldErrors.name)}
                          aria-describedby={fieldErrors.name ? 'contact-name-error' : undefined}
                          className="mt-1.5 min-h-11 text-base sm:text-sm"
                        />
                        <FieldError id="contact-name-error" message={fieldErrors.name} />
                      </div>
                      <div>
                        <Label htmlFor="contact-email">Email <span className="text-destructive">(required)</span></Label>
                        <Input
                          id="contact-email"
                          required
                          name="email"
                          type="email"
                          inputMode="email"
                          value={formData.email}
                          onChange={(event) => updateField('email', event.target.value)}
                          autoComplete="email"
                          spellCheck={false}
                          aria-invalid={Boolean(fieldErrors.email)}
                          aria-describedby={fieldErrors.email ? 'contact-email-error' : undefined}
                          className="mt-1.5 min-h-11 text-base sm:text-sm"
                        />
                        <FieldError id="contact-email-error" message={fieldErrors.email} />
                      </div>
                    </div>
                  </fieldset>

                  {isQuote && (redirectedMachineInterest || sourceLabel || initialVenueUse || plannerContextLabels || mobileFitContextLabels) && (
                    <div className="space-y-3 border-t border-border pt-5 text-sm leading-relaxed text-muted-foreground">
                      {redirectedMachineInterest && (
                        <p>
                          This form is for Commercial Machine quotes. For {redirectedMachineInterest} pricing and availability,{' '}
                          <Link to={redirectedMachinePath} className="font-semibold text-primary underline underline-offset-4">
                            view the {redirectedMachineInterest}
                          </Link>.
                        </p>
                      )}
                      {sourceLabel && <p>Continuing from the {sourceLabel}.</p>}
                      {initialVenueUse && <p>We’ve selected “{initialVenueUse}” below. You can change it.</p>}
                      {(plannerContextLabels || mobileFitContextLabels) && (
                        <details className="rounded-lg border border-border p-3">
                          <summary className="cursor-pointer font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            Review your planning summary
                          </summary>
                          <p className="mt-3">Only the categories below are included. Your exact financial figures and free-text notes have not been transferred.</p>
                          {plannerContextLabels && (
                            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                              <div><dt className="font-semibold text-foreground">Machine considered</dt><dd>{plannerContextLabels.machineSignal}</dd></div>
                              <div><dt className="font-semibold text-foreground">Intended use</dt><dd>{plannerContextLabels.intendedPath}</dd></div>
                              <div><dt className="font-semibold text-foreground">Budget completeness</dt><dd>{plannerContextLabels.budgetBand}</dd></div>
                              <div><dt className="font-semibold text-foreground">Open questions</dt><dd>{plannerContextLabels.openQuestions.join(', ') || 'None recorded'}</dd></div>
                            </dl>
                          )}
                          {mobileFitContextLabels && (
                            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                              <div><dt className="font-semibold text-foreground">Setup check result</dt><dd>{mobileFitContextLabels.resultBand}</dd></div>
                              <div><dt className="font-semibold text-foreground">Machine considered</dt><dd>{mobileFitContextLabels.machineSignal}</dd></div>
                              <div><dt className="font-semibold text-foreground">Placement</dt><dd>{mobileFitContextLabels.placement}</dd></div>
                              <div><dt className="font-semibold text-foreground">Open questions</dt><dd>{mobileFitContextLabels.openQuestions.join(', ') || 'None recorded'}</dd></div>
                            </dl>
                          )}
                          <p className="mt-3">This request is for the Commercial Machine, even if you explored another model. A planning result does not confirm suitability or replace manufacturer, professional, venue, insurer, or local approval.</p>
                        </details>
                      )}
                    </div>
                  )}

                  {isQuote ? (
                    <fieldset className="space-y-5 border-t border-border pt-6">
                      <legend className="font-display text-xl font-bold text-foreground">
                        Your operating plan
                      </legend>
                      <div>
                        <Label htmlFor="contact-organization">Business or organization <span className="font-normal text-muted-foreground">(optional)</span></Label>
                        <Input
                          id="contact-organization"
                          name="organization"
                          value={formData.organization}
                          onChange={(event) => updateField('organization', event.target.value)}
                          autoComplete="organization"
                          className="mt-1.5 min-h-11 text-base sm:text-sm"
                          placeholder="Business name, concept, or organization"
                        />
                      </div>
                      <div>
                        <Label htmlFor="contact-venue">Intended setting or use <span className="text-destructive">(required)</span></Label>
                        <select
                          id="contact-venue"
                          required
                          name="venueUse"
                          value={formData.venueUse}
                          onChange={(event) => updateField('venueUse', event.target.value)}
                          aria-invalid={Boolean(fieldErrors.venueUse)}
                          aria-describedby={fieldErrors.venueUse ? 'contact-venue-error' : undefined}
                          className={selectClassName}
                        >
                          <option value="">Choose the closest setting</option>
                          {QUOTE_VENUE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                        <FieldError id="contact-venue-error" message={fieldErrors.venueUse} />
                      </div>
                      <div className="grid gap-5 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="contact-region">City/state or service region <span className="text-destructive">(required)</span></Label>
                          <Input
                            id="contact-region"
                            required
                            name="serviceRegion"
                            value={formData.serviceRegion}
                            onChange={(event) => updateField('serviceRegion', event.target.value)}
                            autoComplete="address-level1"
                            aria-invalid={Boolean(fieldErrors.serviceRegion)}
                            aria-describedby={fieldErrors.serviceRegion ? 'contact-region-error' : 'contact-region-help'}
                            className="mt-1.5 min-h-11 text-base sm:text-sm"
                            placeholder="Example: Sacramento, CA"
                          />
                          <p id="contact-region-help" className="mt-1.5 text-xs text-muted-foreground">A general service area is enough; no street address needed.</p>
                          <FieldError id="contact-region-error" message={fieldErrors.serviceRegion} />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">Quoted machine</p>
                          <div className="mt-1.5 min-h-11 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
                            <p className="text-sm font-semibold text-foreground">{MACHINE_NAMES.commercial}</p>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              Configuration and delivery are confirmed during the quote conversation.
                            </p>
                          </div>
                          <input type="hidden" name="interest" value={MACHINE_NAMES.commercial} />
                        </div>
                      </div>
                      <div className="grid gap-5 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="contact-timeline">Purchase timeline <span className="text-destructive">(required)</span></Label>
                          <select
                            id="contact-timeline"
                            required
                            name="timeline"
                            value={formData.timeline}
                            onChange={(event) => updateField('timeline', event.target.value)}
                            aria-invalid={Boolean(fieldErrors.timeline)}
                            aria-describedby={fieldErrors.timeline ? 'contact-timeline-error' : undefined}
                            className={selectClassName}
                          >
                            <option value="">Choose a timeline</option>
                            {QUOTE_TIMELINE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                          <FieldError id="contact-timeline-error" message={fieldErrors.timeline} />
                        </div>
                        <div>
                          <Label htmlFor="contact-readiness">Procurement readiness <span className="font-normal text-muted-foreground">(optional)</span></Label>
                          <select
                            id="contact-readiness"
                            name="readiness"
                            value={formData.readiness}
                            onChange={(event) => updateField('readiness', event.target.value)}
                            className={selectClassName}
                          >
                            <option value="">Choose if useful</option>
                            {QUOTE_READINESS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="contact-message">Anything else we should know? <span className="font-normal text-muted-foreground">(optional)</span></Label>
                        <Textarea
                          id="contact-message"
                          name="message"
                          value={formData.message}
                          onChange={(event) => updateField('message', event.target.value)}
                          rows={4}
                          className="mt-1.5 text-base sm:text-sm"
                          placeholder="Power, mobility, venue, staffing, procurement, or other context"
                        />
                      </div>
                    </fieldset>
                  ) : (
                    <div>
                      <Label htmlFor="contact-message">Message <span className="text-destructive">(required)</span></Label>
                      <Textarea
                        id="contact-message"
                        name="message"
                        value={formData.message}
                        onChange={(event) => updateField('message', event.target.value)}
                        rows={6}
                        required
                        aria-invalid={Boolean(fieldErrors.message)}
                        aria-describedby={fieldErrors.message ? 'contact-message-error' : undefined}
                        className="mt-1.5 text-base sm:text-sm"
                        placeholder="How can we help?"
                      />
                      <FieldError id="contact-message-error" message={fieldErrors.message} />
                    </div>
                  )}

                  <Button
                    type="submit"
                    variant="hero"
                    size="lg"
                    className="min-h-12 w-full px-3 text-sm sm:px-8 sm:text-base"
                    disabled={submitting}
                  >
                    {submitting ? (
                      'Sending…'
                    ) : isQuote ? (
                      <>
                        <span className="sm:hidden">Send Commercial request</span>
                        <span className="hidden sm:inline">Send Commercial quote request</span>
                      </>
                    ) : (
                      'Send message'
                    )}
                    {!submitting && <ArrowRight aria-hidden="true" className="ml-1 h-4 w-4" />}
                  </Button>
                  <p className="text-center text-xs leading-relaxed text-muted-foreground">
                    We’ll use your details to respond to your inquiry. Read our{' '}
                    <Link to="/privacy" className="underline underline-offset-4 hover:text-foreground">Privacy Policy</Link>.
                    {isQuote && ' Sending a request does not reserve a machine or confirm a price.'}
                  </p>
                </form>
              </div>
              <aside className="min-w-0 space-y-6 lg:pt-3" aria-label="What happens next">
                <div>
                  <h2 className="font-display text-xl font-bold text-foreground">What happens next</h2>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {isQuote
                      ? 'We’ll review your setting, location, and timing, then email you about fit, configuration, and delivery. We may ask for more details before preparing a quote.'
                      : 'We’ll review your message and email you about the next step.'}
                  </p>
                </div>
                <div className="flex gap-3 border-t border-border pt-5">
                  <ShieldCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Your contact details and message stay out of page links and analytics.
                  </p>
                </div>
                <div className="flex gap-3">
                  <Mail aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Prefer email?{' '}
                    <a href="mailto:info@bloomjoyusa.com" className="break-words font-semibold text-primary underline underline-offset-4">info@bloomjoyusa.com</a>
                  </p>
                </div>
              </aside>
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}
