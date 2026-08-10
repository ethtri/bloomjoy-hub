import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Apple,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  ChefHat,
  CircleHelp,
  ClipboardCheck,
  Cookie,
  ExternalLink,
  Flame,
  Gauge,
  Scale,
  SlidersHorizontal,
  Snowflake,
  Sparkles,
  Store,
  Truck,
} from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import {
  FOOD_TRUCK_DESSERT_ADD_ONS_PATH,
  comparisonPostureLabels,
  dessertComparisonCriteria,
  dessertComparisonSources,
  dessertOptions,
  foodTruckDessertAddOnsQuotePath,
  type ComparisonPosture,
  type DessertOptionId,
} from '@/data/dessertAddOnComparison';
import {
  FOOD_TRUCK_SOLUTION_PATH,
  MOBILE_SETUP_GUIDE_PATH,
} from '@/data/mobileOperatorPages';
import { MOBILE_SETUP_FIT_CHECKER_PATH } from '@/data/mobileSetupFitContract';
import { FOOD_TRUCK_CATERING_DESSERT_MENU_PATH } from '@/data/cateringDessertMenuContract';
import { trackEvent } from '@/lib/analytics';
import { trackBusinessPlaybookCtaClick } from '@/lib/businessPlaybookAnalytics';

const dessertIcons = {
  'cotton-candy': Sparkles,
  'baked-treats': Cookie,
  'fried-desserts': Flame,
  'frozen-desserts': Snowflake,
  'fresh-fruit': Apple,
} satisfies Record<DessertOptionId, typeof Sparkles>;

const postureClasses: Record<ComparisonPosture, string> = {
  advantage: 'border-sage/25 bg-sage-light text-sage',
  confirm: 'border-amber-300/60 bg-amber-50 text-amber-800',
  heavier: 'border-[#d9a79e] bg-[#fff3f0] text-[#8b3e32]',
};

const trackLink = (cta: string, href: string) =>
  trackBusinessPlaybookCtaClick({
    surface: 'dessert_add_on_comparison',
    cta,
    href,
  });

const relatedLinks = [
  {
    eyebrow: 'Commercial fit',
    title: 'Food trucks and mobile operators',
    body: 'Start with the machine path, operating patterns, and stop conditions for a robotic cotton-candy setup.',
    href: FOOD_TRUCK_SOLUTION_PATH,
  },
  {
    eyebrow: 'Physical setup',
    title: 'Mobile setup guide',
    body: 'Work through space, total load, transport, storage, cleaning, service flow, and outside approvals.',
    href: MOBILE_SETUP_GUIDE_PATH,
  },
  {
    eyebrow: 'Interactive screen',
    title: 'Mobile setup fit checker',
    body: 'Turn eight categorical answers into a conservative fit band and explicit unresolved checks.',
    href: MOBILE_SETUP_FIT_CHECKER_PATH,
  },
  {
    eyebrow: 'Broader planning',
    title: 'Machine Fit + Startup Budget Planner',
    body: 'Compare machine paths and cost categories without sending exact private assumptions into analytics.',
    href: '/resources/business-playbook/planner',
  },
  {
    eyebrow: 'Catering proposals',
    title: 'Build a buyer-ready dessert package',
    body: 'Define scope, service window, responsibilities, terms, weather, and paperwork without a serving or earnings promise.',
    href: FOOD_TRUCK_CATERING_DESSERT_MENU_PATH,
  },
];

const postureGuidance: readonly {
  posture: ComparisonPosture;
  title: string;
  body: string;
}[] = [
  {
    posture: 'advantage',
    title: 'Potential advantage',
    body: 'This category can make the criterion lighter in the described operating model. It is not a universal score.',
  },
  {
    posture: 'confirm',
    title: 'Confirm the plan',
    body: 'The answer changes with the menu, equipment, placement, staffing, venue, or jurisdiction.',
  },
  {
    posture: 'heavier',
    title: 'Heavier obligation',
    body: 'This category commonly adds equipment, safety, storage, staff, or approval work that should be resolved early.',
  },
] as const;

export default function FoodTruckDessertAddOnsPage() {
  useEffect(() => {
    trackEvent('view_business_playbook_article', {
      slug: 'food-truck-dessert-add-ons',
      category: 'events',
      source_page: FOOD_TRUCK_DESSERT_ADD_ONS_PATH,
    });
  }, []);

  return (
    <Layout>
      <main>
        <section className="relative overflow-hidden bg-[#1d2722] text-white">
          <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px)] [background-size:36px_36px]" />
          <div className="absolute -right-24 -top-20 h-80 w-80 rounded-full bg-primary/25 blur-3xl" />
          <div className="container-page relative py-12 sm:py-16 lg:py-20">
            <Link
              to="/resources/business-playbook"
              onClick={() => trackLink('back_to_business_playbook', '/resources/business-playbook')}
              className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-white/75 transition-colors hover:text-white motion-reduce:transition-none"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back to the Business Playbook
            </Link>

            <div className="mt-8 grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(24rem,0.95fr)] lg:items-center">
              <div className="min-w-0">
                <div className="inline-flex max-w-full items-start gap-2 whitespace-normal rounded-2xl border border-white/15 bg-white/10 px-3.5 py-2 text-sm font-semibold leading-relaxed text-white/90 backdrop-blur sm:items-center sm:rounded-full">
                  <Truck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary sm:mt-0" />
                  <span>For established food-truck and catering operators</span>
                </div>
                <h1 className="mt-6 max-w-4xl font-display text-4xl font-bold leading-[1.04] tracking-tight sm:text-5xl lg:text-6xl">
                  Food-truck dessert add-ons, compared by operating fit
                </h1>
                <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/75">
                  Compare robotic cotton candy, baked treats, fried desserts, frozen desserts,
                  and fresh fruit by what they make your team store, power, prep, move, clean,
                  and staff—not by a generic “best dessert” ranking.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <Button asChild size="xl" className="min-h-12 max-w-full whitespace-normal px-5 text-center sm:px-8">
                    <a href="#comparison-criteria">
                      Compare the operating work <ArrowRight aria-hidden="true" className="ml-2 h-5 w-5" />
                    </a>
                  </Button>
                  <Button asChild variant="outline" size="xl" className="min-h-12 max-w-full whitespace-normal border-white/30 bg-transparent px-5 text-center text-white hover:bg-white/10 hover:text-white sm:px-8">
                    <Link
                      to={MOBILE_SETUP_FIT_CHECKER_PATH}
                      onClick={() => trackLink('hero_check_mobile_setup', MOBILE_SETUP_FIT_CHECKER_PATH)}
                    >
                      Check a cotton-candy setup
                    </Link>
                  </Button>
                </div>
                <p className="mt-4 max-w-3xl text-sm leading-relaxed text-white/55">
                  Original Bloomjoy analysis, not a popularity, demand, profit, margin, payback,
                  permit, or guaranteed-speed ranking. Your menu, equipment, venue, insurer, and
                  jurisdiction control the final answer.
                </p>
              </div>

              <div className="relative mx-auto w-full max-w-xl lg:mx-0 lg:justify-self-end">
                <div className="overflow-hidden rounded-[1.75rem] border border-white/15 bg-[#fffaf5] text-foreground shadow-2xl shadow-black/25">
                  <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Operator comparison ticket</p>
                      <p className="mt-1 font-display text-xl font-bold">Five categories. Thirteen operating questions.</p>
                    </div>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <SlidersHorizontal aria-hidden="true" className="h-5 w-5" />
                    </span>
                  </div>
                  <div className="divide-y divide-border px-5 sm:px-6">
                    {dessertOptions.map((option) => {
                      const Icon = dessertIcons[option.id];
                      return (
                        <div key={option.id} className="flex items-center gap-3 py-3.5">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1d2722] text-primary">
                            <Icon aria-hidden="true" className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground">{option.shortName}</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{option.positioning}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-start gap-3 bg-[#1d2722] px-5 py-4 text-white sm:px-6">
                    <Scale aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    <p className="text-sm leading-relaxed text-white/70">
                      The useful question is not “Which dessert wins?” It is “Which operating
                      obligation fits the truck we already run?”
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-background py-10 sm:py-12">
          <div className="container-page">
            <div className="grid gap-4 lg:grid-cols-3">
              {postureGuidance.map(({ posture, title, body }) => (
                <div key={posture} className="rounded-2xl border border-border bg-muted/15 p-5">
                  <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${postureClasses[posture]}`}>
                    {comparisonPostureLabels[posture]}
                  </span>
                  <h2 className="mt-4 font-display text-xl font-bold text-foreground">{title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 p-5 text-amber-950">
              <CircleHelp aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
              <p className="text-sm leading-relaxed">
                These are comparison prompts, not engineering, food-safety, fire-code, vehicle,
                insurance, or legal conclusions. “Potential advantage” can disappear when the
                recipe or equipment changes; “heavier obligation” can be workable when the
                existing operation already supports it.
              </p>
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-muted/20 py-12 sm:py-16">
          <div className="container-page">
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-primary">The five operating models</p>
            <h2 className="mt-3 max-w-4xl font-display text-3xl font-bold text-foreground sm:text-4xl">
              Start with what each category asks the operator to become good at.
            </h2>
            <p className="mt-4 max-w-3xl leading-relaxed text-muted-foreground">
              A category can be simple in one menu and demanding in another. These profiles name
              the most important fit condition and the tradeoff to investigate before comparing
              equipment or prices.
            </p>
            <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
              {dessertOptions.map((option) => {
                const Icon = dessertIcons[option.id];
                return (
                  <article key={option.id} className="flex h-full min-w-0 flex-col rounded-3xl border border-border bg-background p-5 shadow-sm">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <h3 className="mt-5 font-display text-xl font-bold text-foreground">{option.name}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{option.positioning}</p>
                    <div className="mt-5 border-t border-border pt-4">
                      <p className="text-xs font-bold uppercase tracking-[0.1em] text-sage">Likely fit when</p>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{option.likelyFit}</p>
                    </div>
                    <div className="mt-4 border-t border-border pt-4">
                      <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#8b3e32]">Watch first</p>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{option.watch}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="comparison-criteria" className="scroll-mt-24 border-b border-border bg-background py-12 sm:py-16">
          <div className="container-page">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.14em] text-primary">Criterion-by-criterion comparison</p>
                <h2 className="mt-3 max-w-4xl font-display text-3xl font-bold text-foreground sm:text-4xl">
                  Thirteen questions that expose the operating tradeoff
                </h2>
                <p className="mt-4 max-w-3xl leading-relaxed text-muted-foreground">
                  Each card is independently readable on a phone. No hidden score rolls these
                  judgments into a winner, because an operator may care far more about power or
                  staff than visual draw.
                </p>
              </div>
              <nav aria-label="Comparison criterion shortcuts" className="rounded-2xl border border-border bg-muted/15 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Jump to a question</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {dessertComparisonCriteria.map((criterion, index) => (
                    <a key={criterion.id} href={`#criterion-${criterion.id}`} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border bg-background px-3 text-xs font-bold text-foreground transition-colors hover:border-primary hover:text-primary motion-reduce:transition-none">
                      <span className="sr-only">{criterion.title}: </span>{index + 1}
                    </a>
                  ))}
                </div>
              </nav>
            </div>

            <div className="mt-8 grid gap-6 xl:grid-cols-2">
              {dessertComparisonCriteria.map((criterion, criterionIndex) => (
                <article key={criterion.id} id={`criterion-${criterion.id}`} className="scroll-mt-24 overflow-hidden rounded-3xl border border-border bg-background shadow-sm">
                  <div className="border-b border-border bg-[#fff8f2] p-5 sm:p-6">
                    <div className="flex items-start gap-4">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#1d2722] text-sm font-bold text-primary">{criterionIndex + 1}</span>
                      <div className="min-w-0">
                        <h3 className="font-display text-2xl font-bold text-foreground">{criterion.title}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{criterion.question}</p>
                      </div>
                    </div>
                  </div>
                  <div className="divide-y divide-border px-5 sm:px-6">
                    {criterion.rows.map((row) => {
                      const option = dessertOptions.find((candidate) => candidate.id === row.dessert);
                      if (!option) return null;
                      const Icon = dessertIcons[row.dessert];
                      return (
                        <div key={row.dessert} className="py-5">
                          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
                                <Icon aria-hidden="true" className="h-4 w-4" />
                              </span>
                              <p className="font-semibold text-foreground">{option.shortName}</p>
                            </div>
                            <span className={`inline-flex w-fit shrink-0 rounded-full border px-3 py-1 text-xs font-bold ${postureClasses[row.posture]}`}>
                              {comparisonPostureLabels[row.posture]}
                            </span>
                          </div>
                          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:pl-12">{row.summary}</p>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-[#fff8f2] py-12 sm:py-16">
          <div className="container-page">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] lg:items-start">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.14em] text-primary">Honest cotton-candy fit</p>
                <h2 className="mt-3 font-display text-3xl font-bold text-foreground sm:text-4xl">
                  Cotton candy is a distinct experience—not the automatic answer.
                </h2>
                <p className="mt-4 leading-relaxed text-muted-foreground">
                  It can remove cold storage and frying from the core dessert workflow while
                  adding a machine, electrical, staff, cleaning, weather, and movement plan. That
                  exchange is useful only when it fits the operation you already run.
                </p>
                <Button asChild variant="outline" size="lg" className="mt-6 min-h-11 max-w-full whitespace-normal text-center">
                  <Link to={FOOD_TRUCK_SOLUTION_PATH} onClick={() => trackLink('review_food_truck_solution', FOOD_TRUCK_SOLUTION_PATH)}>
                    Review the mobile machine path <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-3xl border border-sage/25 bg-background p-5">
                  <BadgeCheck aria-hidden="true" className="h-6 w-6 text-sage" />
                  <h3 className="mt-4 font-display text-xl font-bold text-foreground">Stronger when</h3>
                  <ul className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
                    {[
                      'The goal is a visible made-to-order service moment.',
                      'A cold chain and fryer are poor additions to the current menu.',
                      'A trained staffed service window and reviewed electrical plan are workable.',
                    ].map((item) => <li key={item} className="flex gap-2"><Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-sage" /><span>{item}</span></li>)}
                  </ul>
                </div>
                <div className="rounded-3xl border border-amber-300/60 bg-background p-5">
                  <ClipboardCheck aria-hidden="true" className="h-6 w-6 text-amber-700" />
                  <h3 className="mt-4 font-display text-xl font-bold text-foreground">Mixed when</h3>
                  <ul className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
                    {[
                      'Placement, complete load, service flow, or weather response remains open.',
                      'Mini manual stick feeding may compete with the core line.',
                      'The team needs model-specific transport and load-in confirmation.',
                    ].map((item) => <li key={item} className="flex gap-2"><CircleHelp aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" /><span>{item}</span></li>)}
                  </ul>
                </div>
                <div className="rounded-3xl border border-[#d9a79e] bg-background p-5">
                  <AlertTriangle aria-hidden="true" className="h-6 w-6 text-[#8b3e32]" />
                  <h3 className="mt-4 font-display text-xl font-bold text-foreground">Poor fit when</h3>
                  <ul className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
                    {[
                      'No exact machine space or complete-load plan can be made workable.',
                      'The service must be unattended or depend on a guaranteed serving rate.',
                      'The plan requires Bloomjoy to approve a generator, vehicle installation, venue, or permit.',
                    ].map((item) => <li key={item} className="flex gap-2"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#8b3e32]" /><span>{item}</span></li>)}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-background py-12 sm:py-16">
          <div className="container-page">
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-primary">Three decision paths</p>
            <h2 className="mt-3 max-w-4xl font-display text-3xl font-bold text-foreground sm:text-4xl">
              Leave with a next step—not a category score.
            </h2>
            <div className="mt-8 grid gap-5 lg:grid-cols-3">
              <article className="rounded-3xl border border-sage/25 bg-sage-light/50 p-6">
                <Sparkles aria-hidden="true" className="h-6 w-6 text-sage" />
                <h3 className="mt-4 font-display text-2xl font-bold text-foreground">Likely cotton-candy fit</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  You want a staffed visual service, can review exact machine space and total load,
                  and do not need Bloomjoy to make an outside approval.
                </p>
                <Button asChild className="mt-6 min-h-11 max-w-full whitespace-normal text-center">
                  <Link to={MOBILE_SETUP_FIT_CHECKER_PATH} onClick={() => trackLink('decision_path_check_setup', MOBILE_SETUP_FIT_CHECKER_PATH)}>
                    Check the setup <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </article>
              <article className="rounded-3xl border border-amber-300/60 bg-amber-50/70 p-6">
                <Gauge aria-hidden="true" className="h-6 w-6 text-amber-700" />
                <h3 className="mt-4 font-display text-2xl font-bold text-foreground">Uncertain fit</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  One or more space, power, staff, weather, transport, or local questions are open.
                  Resolve the owners of those decisions before treating a machine as workable.
                </p>
                <Button asChild variant="outline" className="mt-6 min-h-11 max-w-full whitespace-normal text-center">
                  <Link to={MOBILE_SETUP_GUIDE_PATH} onClick={() => trackLink('decision_path_setup_guide', MOBILE_SETUP_GUIDE_PATH)}>
                    Use the setup guide
                  </Link>
                </Button>
              </article>
              <article className="rounded-3xl border border-[#d9a79e] bg-[#fff3f0] p-6">
                <Store aria-hidden="true" className="h-6 w-6 text-[#8b3e32]" />
                <h3 className="mt-4 font-display text-2xl font-bold text-foreground">Another dessert fits better</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  A grab-and-go product, an existing reviewed cook line, or an existing cold chain
                  may fit the truck more cleanly than adding a robotic machine.
                </p>
                <a href="#comparison-criteria" className="mt-6 inline-flex min-h-11 items-center font-semibold text-[#8b3e32] underline decoration-[#8b3e32]/40 underline-offset-4 hover:decoration-[#8b3e32]">
                  Recheck the operator criteria
                </a>
              </article>
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-muted/20 py-12 sm:py-16">
          <div className="container-page">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-start">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.14em] text-primary">Method and sources</p>
                <h2 className="mt-3 font-display text-3xl font-bold text-foreground sm:text-4xl">
                  Inspect the judgment before using it.
                </h2>
                <p className="mt-4 leading-relaxed text-muted-foreground">
                  Bloomjoy created the comparison framework from a reviewed operator brief and
                  its published machine facts. Authoritative sources inform food-safety,
                  frozen-storage, mobile-facility, and cooking-fire questions. They do not make one
                  universal operating plan or replace your current local requirements.
                </p>
                <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-5">
                  <p className="font-semibold text-foreground">What is analysis versus source?</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    The advantage/confirm/heavier labels are Bloomjoy’s original comparative
                    analysis. Machine facts come from Bloomjoy product pages. Food-safety and
                    fire-code links identify questions to validate—not a permit conclusion.
                  </p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {dessertComparisonSources.map((source) => {
                  const isExternal = source.url.startsWith('http');
                  const content = (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.1em] text-primary">{source.owner}</p>
                          <h3 className="mt-2 font-display text-lg font-bold text-foreground">{source.label}</h3>
                        </div>
                        <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{source.use}</p>
                    </>
                  );

                  return isExternal ? (
                    <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="rounded-2xl border border-border bg-background p-5 transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-sm motion-reduce:transition-none">
                      {content}
                    </a>
                  ) : (
                    <Link key={source.url} to={source.url} onClick={() => trackLink('source_review_machine_facts', source.url)} className="rounded-2xl border border-border bg-background p-5 transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-sm motion-reduce:transition-none">
                      {content}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-background py-12 sm:py-16">
          <div className="container-page">
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-primary">Continue the buyer journey</p>
            <h2 className="mt-3 max-w-4xl font-display text-3xl font-bold text-foreground sm:text-4xl">
              Compare the category, then verify the machine and the setup.
            </h2>
            <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
              {relatedLinks.map((item) => (
                <Link key={item.href} to={item.href} onClick={() => trackLink(`related_${item.eyebrow.toLowerCase().replaceAll(' ', '_')}`, item.href)} className="group flex h-full min-w-0 flex-col rounded-3xl border border-border bg-background p-5 transition-[transform,border-color,box-shadow] hover:-translate-y-1 hover:border-primary/50 hover:shadow-elevated motion-reduce:transform-none motion-reduce:transition-none">
                  <p className="text-xs font-bold uppercase tracking-[0.1em] text-primary">{item.eyebrow}</p>
                  <h3 className="mt-3 font-display text-xl font-bold text-foreground group-hover:text-primary">{item.title}</h3>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                  <span className="mt-5 inline-flex min-h-11 items-center font-semibold text-foreground">Open guide <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" /></span>
                </Link>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3 text-sm font-semibold">
              {[
                ['/machines/mini', 'Mini Machine'],
                ['/machines/commercial-robotic-machine', 'Commercial Machine'],
                ['/machines/micro', 'Micro Machine'],
                ['/resources/business-playbook/payback-planner', 'Payback Scenario Planner'],
                ['/resources/business-playbook/mini-micro-event-catering-business-guide', 'Event and catering startup guide'],
              ].map(([href, label]) => (
                <Link key={href} to={href} onClick={() => trackLink(`supporting_${label.toLowerCase().replaceAll(' ', '_')}`, href)} className="inline-flex min-h-11 items-center rounded-full border border-border bg-muted/20 px-4 text-foreground transition-colors hover:border-primary hover:text-primary motion-reduce:transition-none">
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#1d2722] py-12 text-white sm:py-16">
          <div className="container-page">
            <div className="grid gap-8 rounded-[2rem] border border-white/15 bg-white/5 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <div className="flex items-center gap-2 text-primary">
                  <ChefHat aria-hidden="true" className="h-5 w-5" />
                  <p className="text-sm font-bold uppercase tracking-[0.14em]">If cotton candy survives the comparison</p>
                </div>
                <h2 className="mt-3 max-w-3xl font-display text-3xl font-bold sm:text-4xl">
                  Carry a clear setup screen into the next conversation.
                </h2>
                <p className="mt-4 max-w-3xl leading-relaxed text-white/70">
                  Use the checker first. If the setup remains worth exploring, Bloomjoy can review
                  a Commercial quote with categorical mobile context. Mini and Micro stay on their
                  product purchase paths; the comparison does not change that policy.
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row lg:flex-col">
                <Button asChild size="xl" className="min-h-12 max-w-full whitespace-normal px-5 text-center sm:px-8">
                  <Link to={MOBILE_SETUP_FIT_CHECKER_PATH} onClick={() => trackLink('final_check_mobile_setup', MOBILE_SETUP_FIT_CHECKER_PATH)}>
                    Check your setup <ArrowRight aria-hidden="true" className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="min-h-11 max-w-full whitespace-normal border-white/30 bg-transparent text-center text-white hover:bg-white/10 hover:text-white">
                  <Link to={foodTruckDessertAddOnsQuotePath} onClick={() => trackLink('final_request_commercial_quote', foodTruckDessertAddOnsQuotePath)}>
                    Request a Commercial quote
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
