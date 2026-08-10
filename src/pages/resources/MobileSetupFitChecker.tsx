import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clipboard,
  Gauge,
  HelpCircle,
  MapPin,
  Printer,
  RotateCcw,
  ShieldCheck,
  Truck,
  XCircle,
  Zap,
} from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import {
  FOOD_TRUCK_SOLUTION_PATH,
  MOBILE_SETUP_GUIDE_PATH,
} from '@/data/mobileOperatorPages';
import {
  MOBILE_FIT_DECISION_BOUNDARY,
  MOBILE_SETUP_FIT_CHECKER_PATH,
  evaluateMobileSetupFit,
  getMobileFitAnswerLabel,
  mobileFitBandLabels,
  mobileFitMachineLabels,
  mobileFitOpenQuestionLabels,
  mobileFitQuestions,
  type MobileFitAnswer,
  type MobileFitAnswers,
  type MobileFitEvaluation,
  type MobileFitQuestionId,
} from '@/data/mobileSetupFitChecker';
import {
  trackBusinessPlaybookCtaClick,
  trackMobileSetupFitCheckerInteraction,
} from '@/lib/businessPlaybookAnalytics';
import { buildMobileFitQuoteHref } from '@/lib/quoteIntake';

const machinePaths = {
  commercial: '/machines/commercial-robotic-machine',
  mini: '/machines/mini',
  micro: '/machines/micro',
  undecided: '/machines',
} as const;

const bandStyles = {
  incomplete: {
    shell: 'border-border bg-background',
    badge: 'bg-muted text-muted-foreground',
    icon: HelpCircle,
    iconClassName: 'text-muted-foreground',
  },
  'likely-fit': {
    shell: 'border-sage/40 bg-sage-light/35',
    badge: 'bg-sage text-white',
    icon: CheckCircle2,
    iconClassName: 'text-sage',
  },
  'needs-confirmation': {
    shell: 'border-amber-300/70 bg-amber-50/70',
    badge: 'bg-amber-500 text-white',
    icon: AlertTriangle,
    iconClassName: 'text-amber-600',
  },
  'not-supported': {
    shell: 'border-[#a65043]/45 bg-[#fff3f0]',
    badge: 'bg-[#8b3e32] text-white',
    icon: XCircle,
    iconClassName: 'text-[#8b3e32]',
  },
} as const;

const resultBandExplainers = [
  {
    icon: CheckCircle2,
    title: 'Likely fit to explore',
    body: 'Every category is answered without a current stop signal. Model-specific and outside approvals still remain.',
    className: 'text-sage',
  },
  {
    icon: AlertTriangle,
    title: 'Needs confirmation',
    body: 'The setup may be worth exploring, but one or more named facts or reviews remain open.',
    className: 'text-amber-600',
  },
  {
    icon: XCircle,
    title: 'Not currently supported',
    body: 'The selected path conflicts with a published fact or requires Bloomjoy to make a decision it cannot make.',
    className: 'text-[#8b3e32]',
  },
] as const;

const decisionBoundaries = [
  {
    icon: Zap,
    title: 'No generator or electrical certification',
    body: 'Published voltage and maximum power do not prove generator compatibility, connection requirements, or safe total load.',
  },
  {
    icon: Truck,
    title: 'No vehicle or transport approval',
    body: 'Weight and dimensions do not establish safe mounting, securing, handling, orientation, ventilation, or travel conditions.',
  },
  {
    icon: MapPin,
    title: 'No permit or venue approval',
    body: 'The applicable authority, venue, insurer, fire/food reviewer, and qualified professional own their decisions.',
  },
  {
    icon: Gauge,
    title: 'No throughput or financial promise',
    body: 'Machine-cycle guidance is not guaranteed served volume, demand, revenue, margin, ROI, or payback.',
  },
] as const;

const getOpenQuestionBand = (evaluation: MobileFitEvaluation) =>
  evaluation.unresolvedQuestions.length === 0
    ? 'none'
    : evaluation.unresolvedQuestions.length <= 2
      ? 'few'
      : 'several';

export default function MobileSetupFitCheckerPage() {
  const [answers, setAnswers] = useState<MobileFitAnswers>({});
  const [copyStatus, setCopyStatus] = useState('');
  const firstQuestionRef = useRef<HTMLFieldSetElement | null>(null);
  const startTrackedRef = useRef(false);
  const completionTrackedRef = useRef(false);
  const evaluation = useMemo(() => evaluateMobileSetupFit(answers), [answers]);
  const openQuestionBand = getOpenQuestionBand(evaluation);
  const quoteHref = buildMobileFitQuoteHref({
    resultBand: evaluation.band,
    machineSignal: evaluation.machineSignal,
    placement: evaluation.placement,
    openQuestions: evaluation.unresolvedQuestions,
  });
  const productHref = machinePaths[evaluation.machineSignal];
  const resultStyle = bandStyles[evaluation.band];
  const ResultIcon = resultStyle.icon;
  const isComplete = evaluation.band !== 'incomplete';
  const canRequestQuote = isComplete && evaluation.band !== 'not-supported';

  useEffect(() => {
    trackMobileSetupFitCheckerInteraction({
      action: 'view',
      resultBand: evaluation.band,
      machineSignal: evaluation.machineSignal,
      placement: evaluation.placement,
      openQuestionBand,
    });
    // The first render is the only page-view event for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isComplete || completionTrackedRef.current) return;
    completionTrackedRef.current = true;
    trackMobileSetupFitCheckerInteraction({
      action: 'complete',
      resultBand: evaluation.band,
      machineSignal: evaluation.machineSignal,
      placement: evaluation.placement,
      openQuestionBand,
    });
  }, [evaluation, isComplete, openQuestionBand]);

  const handleAnswer = (questionId: MobileFitQuestionId, answer: MobileFitAnswer) => {
    const nextAnswers = { ...answers, [questionId]: answer };
    setAnswers(nextAnswers);
    setCopyStatus('');

    if (!startTrackedRef.current) {
      startTrackedRef.current = true;
      const nextEvaluation = evaluateMobileSetupFit(nextAnswers);
      trackMobileSetupFitCheckerInteraction({
        action: 'start',
        resultBand: nextEvaluation.band,
        machineSignal: nextEvaluation.machineSignal,
        placement: nextEvaluation.placement,
        openQuestionBand: getOpenQuestionBand(nextEvaluation),
      });
    }
  };

  const trackResultAction = (
    action: 'result_to_product' | 'result_to_quote' | 'result_to_setup_guide',
    cta: string,
    href: string
  ) => {
    trackBusinessPlaybookCtaClick({
      surface: 'mobile_setup_fit_checker',
      cta,
      href,
      machine: mobileFitMachineLabels[evaluation.machineSignal],
    });
    trackMobileSetupFitCheckerInteraction({
      action,
      resultBand: evaluation.band,
      machineSignal: evaluation.machineSignal,
      placement: evaluation.placement,
      openQuestionBand,
    });
  };

  const copySummary = async () => {
    const answerLines = mobileFitQuestions.map((question) => {
      const label = getMobileFitAnswerLabel(question.id, answers[question.id]);
      return `${question.title}: ${label ?? 'Not answered'}`;
    });
    const openLines = evaluation.unresolvedQuestions.map(
      (key) => `- ${mobileFitOpenQuestionLabels[key]}`
    );
    const summary = [
      'Bloomjoy mobile setup fit checker',
      `Result: ${mobileFitBandLabels[evaluation.band]}`,
      `Machine signal: ${mobileFitMachineLabels[evaluation.machineSignal]}`,
      evaluation.summary,
      '',
      'Categorical answers:',
      ...answerLines,
      '',
      'Unresolved checks:',
      ...(openLines.length > 0 ? openLines : ['- No unresolved category surfaced by these answers.']),
      '',
      MOBILE_FIT_DECISION_BOUNDARY,
      `Source: https://www.bloomjoyusa.com${MOBILE_SETUP_FIT_CHECKER_PATH}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(summary);
      setCopyStatus('Fit-checker summary copied.');
    } catch {
      setCopyStatus('Copy was unavailable. Use Print summary instead.');
    }

    trackMobileSetupFitCheckerInteraction({
      action: 'copy_summary',
      resultBand: evaluation.band,
      machineSignal: evaluation.machineSignal,
      placement: evaluation.placement,
      openQuestionBand,
    });
  };

  const printSummary = () => {
    trackMobileSetupFitCheckerInteraction({
      action: 'print_summary',
      resultBand: evaluation.band,
      machineSignal: evaluation.machineSignal,
      placement: evaluation.placement,
      openQuestionBand,
    });
    window.print();
  };

  const resetChecker = () => {
    trackMobileSetupFitCheckerInteraction({
      action: 'reset',
      resultBand: evaluation.band,
      machineSignal: evaluation.machineSignal,
      placement: evaluation.placement,
      openQuestionBand,
    });
    setAnswers({});
    setCopyStatus('Checker reset. No answers are stored in the browser.');
    startTrackedRef.current = false;
    completionTrackedRef.current = false;
    window.requestAnimationFrame(() => firstQuestionRef.current?.focus());
  };

  return (
    <Layout>
      <main>
        <header className="relative overflow-hidden border-b border-border bg-[#1d2722] text-white">
          <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:36px_36px]" />
          <div className="absolute -right-24 -top-28 h-96 w-96 rounded-full bg-primary/25 blur-3xl" />
          <div className="container-page relative py-12 sm:py-16 lg:py-20">
            <Link
              to={MOBILE_SETUP_GUIDE_PATH}
              className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-white/70 transition hover:text-white motion-reduce:transition-none"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back to the mobile setup guide
            </Link>
            <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
                  Interactive mobile-operator tool
                </p>
                <h1 className="mt-4 max-w-4xl font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
                  Mobile setup fit checker for food trucks and trailers
                </h1>
                <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/70">
                  Turn eight categorical setup answers into a conservative fit band, a machine path
                  to investigate, and a named list of unresolved checks. No exact dimensions,
                  electrical values, financial assumptions, PII, or free-form notes are collected.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Button asChild size="lg">
                    <a href="#mobile-fit-checker">
                      Check your setup <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                  <Button asChild variant="outline" size="lg" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white">
                    <Link to={FOOD_TRUCK_SOLUTION_PATH}>Review the mobile solution</Link>
                  </Button>
                </div>
              </div>
              <div className="rounded-3xl border border-white/15 bg-white/5 p-5 backdrop-blur-sm">
                <div className="flex items-center gap-3">
                  <ShieldCheck aria-hidden="true" className="h-6 w-6 text-primary" />
                  <p className="font-display text-xl font-bold">A screen, not an approval</p>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-white/65">
                  Every result keeps manufacturer, electrical, vehicle, venue, insurer, and local
                  decisions with the appropriate owner.
                </p>
              </div>
            </div>
          </div>
        </header>

        <section className="border-b border-border bg-[#fff8f2] py-8">
          <div className="container-page grid gap-4 sm:grid-cols-3">
            {[
              ['8', 'bounded setup checks'],
              ['0', 'exact values collected'],
              ['3', 'transparent result bands'],
            ].map(([value, label]) => (
              <div key={label} className="flex items-baseline gap-3 rounded-2xl border border-border bg-background px-5 py-4 shadow-sm">
                <span className="font-display text-3xl font-bold text-primary">{value}</span>
                <span className="text-sm font-semibold text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="mobile-fit-checker" className="scroll-mt-20 py-12 sm:py-16 lg:py-20">
          <div className="container-page">
            <div className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1.18fr)_minmax(22rem,0.82fr)] xl:items-start">
              <div className="min-w-0">
                <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
                      Setup screen
                    </p>
                    <h2 className="mt-2 font-display text-3xl font-bold text-foreground">
                      Answer with the closest current state
                    </h2>
                    <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">
                      Do not enter exact measurements, customer details, permit numbers, electrical
                      values, revenue, or financial assumptions. Use the setup guide for the detailed
                      work behind each category.
                    </p>
                  </div>
                  <div className="shrink-0 rounded-2xl border border-border bg-background px-5 py-3 text-center shadow-sm" aria-live="polite">
                    <p className="font-display text-2xl font-bold text-primary">
                      {evaluation.answeredCount}/{mobileFitQuestions.length}
                    </p>
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      answered
                    </p>
                  </div>
                </div>

                <div className="mt-8 space-y-7">
                  {mobileFitQuestions.map((question, questionIndex) => (
                    <fieldset
                      key={question.id}
                      ref={questionIndex === 0 ? firstQuestionRef : undefined}
                      tabIndex={questionIndex === 0 ? -1 : undefined}
                      className="min-w-0 rounded-3xl border border-border bg-background p-5 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary sm:p-6"
                    >
                      <legend className="max-w-full px-2 font-display text-xl font-bold text-foreground sm:text-2xl">
                        <span className="mr-2 text-primary">{questionIndex + 1}.</span>
                        {question.title}
                      </legend>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {question.help}
                      </p>
                      <div className="mt-5 grid min-w-0 gap-3 sm:grid-cols-2">
                        {question.options.map((option) => {
                          const selected = answers[question.id] === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => handleAnswer(question.id, option.id)}
                              className={`group flex min-h-24 min-w-0 items-start gap-3 rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none ${
                                selected
                                  ? 'border-primary bg-primary/5 shadow-sm'
                                  : 'border-border bg-background hover:border-primary/35 hover:bg-muted/35'
                              }`}
                            >
                              <span
                                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                                  selected
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'border-border bg-muted/50 text-transparent'
                                }`}
                              >
                                <Check aria-hidden="true" className="h-4 w-4" />
                              </span>
                              <span className="min-w-0">
                                <span className="block font-semibold text-foreground">
                                  {option.label}
                                </span>
                                <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                                  {option.detail}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                  ))}
                </div>
              </div>

              <aside className="min-w-0 xl:sticky xl:top-24">
                <div
                  className={`min-w-0 rounded-[2rem] border p-5 shadow-elevated sm:p-7 ${resultStyle.shell}`}
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <div className="flex min-w-0 items-start gap-4">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-background shadow-sm">
                      <ResultIcon aria-hidden="true" className={`h-6 w-6 ${resultStyle.iconClassName}`} />
                    </span>
                    <div className="min-w-0">
                      <span className={`inline-flex max-w-full rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] ${resultStyle.badge}`}>
                        {mobileFitBandLabels[evaluation.band]}
                      </span>
                      <h2 className="mt-3 font-display text-2xl font-bold text-foreground sm:text-3xl">
                        {evaluation.headline}
                      </h2>
                    </div>
                  </div>

                  <p className="mt-5 leading-relaxed text-muted-foreground">{evaluation.summary}</p>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                    <div className="rounded-2xl border border-border/80 bg-background/85 p-4">
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        Machine signal
                      </p>
                      <p className="mt-1 font-display text-lg font-bold text-foreground">
                        {mobileFitMachineLabels[evaluation.machineSignal]}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border/80 bg-background/85 p-4">
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        Open categories
                      </p>
                      <p className="mt-1 font-display text-lg font-bold text-foreground">
                        {evaluation.unresolvedQuestions.length}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6">
                    <h3 className="font-display text-lg font-bold text-foreground">
                      {isComplete ? 'What drove this result' : 'Still needed before a result'}
                    </h3>
                    {evaluation.drivers.length > 0 ? (
                      <div className="mt-3 space-y-3">
                        {evaluation.drivers.map((driver) => (
                          <div key={`${driver.category}-${driver.title}`} className="rounded-2xl border border-border/80 bg-background/85 p-4">
                            <div className="flex gap-3">
                              {driver.tone === 'stop' ? (
                                <XCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#8b3e32]" />
                              ) : (
                                <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                              )}
                              <div>
                                <p className="font-semibold text-foreground">{driver.title}</p>
                                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                                  {driver.detail}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : isComplete ? (
                      <div className="mt-3 flex gap-3 rounded-2xl border border-sage/25 bg-background/85 p-4">
                        <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-sage" />
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          All eight categorical checks are answered without a current stop or open
                          signal. This is still only a path to explore, not approval.
                        </p>
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {evaluation.unresolvedQuestions.map((key) => (
                          <span key={key} className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                            {mobileFitOpenQuestionLabels[key]}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {isComplete && (
                    <div className="mt-6">
                      <h3 className="font-display text-lg font-bold text-foreground">
                        Unresolved checks
                      </h3>
                      {evaluation.unresolvedQuestions.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {evaluation.unresolvedQuestions.map((key) => (
                            <span key={key} className="rounded-full border border-border bg-background/85 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                              {mobileFitOpenQuestionLabels[key]}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                          No unresolved category surfaced from these answers. Model-specific,
                          manufacturer, professional, venue, insurer, and local confirmation still
                          apply where required.
                        </p>
                      )}
                    </div>
                  )}

                  {isComplete && (
                    <div className="mt-6">
                      <h3 className="font-display text-lg font-bold text-foreground">Answer review</h3>
                      <dl className="mt-3 divide-y divide-border rounded-2xl border border-border bg-background/85 px-4">
                        {mobileFitQuestions.map((question) => (
                          <div key={question.id} className="py-3">
                            <dt className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
                              {question.title}
                            </dt>
                            <dd className="mt-1 text-sm font-semibold text-foreground">
                              {getMobileFitAnswerLabel(question.id, answers[question.id])}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}

                  <div className="mt-6 rounded-2xl bg-[#1d2722] p-4 text-white">
                    <div className="flex gap-3">
                      <ShieldCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                      <p className="text-sm leading-relaxed text-white/70">
                        {MOBILE_FIT_DECISION_BOUNDARY}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 grid min-w-0 gap-3">
                    {isComplete && (
                      <Button asChild size="lg" className="h-auto min-h-11 max-w-full whitespace-normal text-center">
                        <Link
                          to={productHref}
                          onClick={() =>
                            trackResultAction(
                              'result_to_product',
                              'mobile_fit_result_to_product',
                              productHref
                            )
                          }
                        >
                          {evaluation.machineSignal === 'undecided'
                            ? 'Compare machine paths'
                            : `Review ${mobileFitMachineLabels[evaluation.machineSignal]}`}
                          <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                    )}
                    {canRequestQuote && (
                      <Button asChild variant="outline" size="lg" className="h-auto min-h-11 max-w-full whitespace-normal text-center">
                        <Link
                          to={quoteHref}
                          onClick={() =>
                            trackResultAction(
                              'result_to_quote',
                              'mobile_fit_result_to_commercial_quote',
                              quoteHref
                            )
                          }
                        >
                          {evaluation.machineSignal === 'commercial'
                            ? 'Request a Commercial quote'
                            : 'Compare with a Commercial quote'}
                        </Link>
                      </Button>
                    )}
                    <Button asChild variant={isComplete ? 'ghost' : 'outline'} size="lg" className="h-auto min-h-11 max-w-full whitespace-normal text-center">
                      <Link
                        to={`${MOBILE_SETUP_GUIDE_PATH}${evaluation.band === 'not-supported' ? '#stop-confirm' : ''}`}
                        onClick={() =>
                          trackResultAction(
                            'result_to_setup_guide',
                            evaluation.band === 'not-supported'
                              ? 'mobile_fit_review_stop_conditions'
                              : 'mobile_fit_open_setup_guide',
                            MOBILE_SETUP_GUIDE_PATH
                          )
                        }
                      >
                        {evaluation.band === 'not-supported'
                          ? 'Review stop conditions'
                          : 'Open the detailed setup guide'}
                      </Link>
                    </Button>
                  </div>

                  <div className="mt-5 grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3 print:hidden">
                    <Button type="button" variant="outline" onClick={copySummary} className="min-h-11">
                      <Clipboard aria-hidden="true" className="mr-2 h-4 w-4" /> Copy
                    </Button>
                    <Button type="button" variant="outline" onClick={printSummary} className="min-h-11">
                      <Printer aria-hidden="true" className="mr-2 h-4 w-4" /> Print
                    </Button>
                    <Button type="button" variant="ghost" onClick={resetChecker} className="min-h-11">
                      <RotateCcw aria-hidden="true" className="mr-2 h-4 w-4" /> Reset
                    </Button>
                  </div>
                  {copyStatus && (
                    <p role="status" className="mt-3 text-sm font-semibold text-muted-foreground">
                      {copyStatus}
                    </p>
                  )}
                </div>
              </aside>
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-[#fff8f2] py-12 sm:py-16">
          <div className="container-page">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
              Transparent output
            </p>
            <h2 className="mt-3 max-w-3xl font-display text-3xl font-bold text-foreground sm:text-4xl">
              The result band says how to proceed—not whether a setup is approved.
            </h2>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {resultBandExplainers.map(({ icon: Icon, title, body, className }) => (
                <article key={title} className="rounded-3xl border border-border bg-background p-6 shadow-sm">
                  <Icon aria-hidden="true" className={`h-7 w-7 ${className}`} />
                  <h3 className="mt-5 font-display text-xl font-bold text-foreground">{title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="py-12 sm:py-16 lg:py-20">
          <div className="container-page">
            <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr]">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
                  Decision boundary
                </p>
                <h2 className="mt-3 font-display text-3xl font-bold text-foreground sm:text-4xl">
                  Four things this checker will never decide
                </h2>
                <p className="mt-4 leading-relaxed text-muted-foreground">
                  Bloomjoy can organize the quote conversation around published facts and open
                  questions. It cannot replace model-specific instructions, qualified work, venue
                  or insurer acceptance, or the authority that governs your operation.
                </p>
                <Button asChild variant="outline" className="mt-6 min-h-11">
                  <Link to={MOBILE_SETUP_GUIDE_PATH}>
                    Read who confirms what <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {decisionBoundaries.map(({ icon: Icon, title, body }) => (
                  <article key={title} className="rounded-2xl border border-border bg-background p-5 shadow-sm">
                    <Icon aria-hidden="true" className="h-6 w-6 text-primary" />
                    <h3 className="mt-4 font-display text-xl font-bold text-foreground">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-border bg-[#1d2722] py-12 text-white sm:py-16">
          <div className="container-page">
            <div className="grid min-w-0 gap-7 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="min-w-0">
                <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
                  Work from facts, not assumptions
                </p>
                <h2 className="mt-3 max-w-3xl font-display text-3xl font-bold sm:text-4xl">
                  Use the checker first, then resolve each open category with its actual owner.
                </h2>
                <p className="mt-4 max-w-2xl leading-relaxed text-white/70">
                  Nothing is saved in the browser. Quote navigation transfers only the result band,
                  machine signal, placement category, and allowlisted open-question keys.
                </p>
              </div>
              <Button asChild size="xl" className="h-auto min-h-12 max-w-full whitespace-normal px-5 text-center sm:w-fit sm:px-8">
                <a href="#mobile-fit-checker">
                  Check another setup <ArrowRight aria-hidden="true" className="ml-2 h-5 w-5" />
                </a>
              </Button>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
