import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Check,
  Clipboard,
  ClipboardCheck,
  CloudSun,
  Copy,
  FileCheck2,
  Handshake,
  MapPinned,
  ReceiptText,
  Scale,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
  Utensils,
  Zap,
} from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import {
  FOOD_TRUCK_CATERING_DESSERT_MENU_PATH,
  cateringPackageOutlineText,
  foodTruckCateringDessertMenuQuotePath,
  packageOutlineFields,
  packageStructures,
  proposalSections,
  responsibilityLanes,
} from '@/data/cateringDessertMenu';
import { FOOD_TRUCK_DESSERT_ADD_ONS_PATH } from '@/data/dessertAddOnComparisonContract';
import {
  FOOD_TRUCK_SOLUTION_PATH,
  MOBILE_SETUP_GUIDE_PATH,
} from '@/data/mobileOperatorPages';
import { MOBILE_SETUP_FIT_CHECKER_PATH } from '@/data/mobileSetupFitContract';
import { trackEvent } from '@/lib/analytics';
import { trackBusinessPlaybookCtaClick } from '@/lib/businessPlaybookAnalytics';

const EVENT_BUSINESS_GUIDE_PATH =
  '/resources/business-playbook/mini-micro-event-catering-business-guide';

const sectionIcons = {
  'service-window': CalendarClock,
  'planning-volume': Scale,
  menu: Utensils,
  staffing: Users,
  'travel-load-in': MapPinned,
  'power-setup': Zap,
  'payment-deposit': ReceiptText,
  weather: CloudSun,
  cancellation: Handshake,
  paperwork: FileCheck2,
} satisfies Record<(typeof proposalSections)[number]['id'], typeof CalendarClock>;

const relatedPaths = [
  {
    eyebrow: 'Choose the experience',
    title: 'Compare dessert add-on models',
    body: 'Compare five categories by prep, storage, power, staffing, weather, portability, and catering fit before packaging one.',
    href: FOOD_TRUCK_DESSERT_ADD_ONS_PATH,
  },
  {
    eyebrow: 'Screen machine fit',
    title: 'Food trucks and mobile operators',
    body: 'Review the Bloomjoy machine path, operating patterns, hard stop conditions, and outside-approval boundaries.',
    href: FOOD_TRUCK_SOLUTION_PATH,
  },
  {
    eyebrow: 'Inspect the setup',
    title: 'Mobile setup guide',
    body: 'Work through space, complete load, travel, cleaning, storage, weather, service flow, and local review questions.',
    href: MOBILE_SETUP_GUIDE_PATH,
  },
  {
    eyebrow: 'Get a fit band',
    title: 'Mobile setup fit checker',
    body: 'Turn eight categorical answers into a conservative machine signal and a list of unresolved checks.',
    href: MOBILE_SETUP_FIT_CHECKER_PATH,
  },
] as const;

const trackLink = (cta: string, href: string) =>
  trackBusinessPlaybookCtaClick({
    surface: 'catering_dessert_menu_guide',
    cta,
    href,
  });

export default function FoodTruckCateringDessertMenuPage() {
  const [copyStatus, setCopyStatus] = useState('');

  useEffect(() => {
    trackEvent('view_business_playbook_article', {
      slug: 'food-truck-catering-dessert-menu',
      category: 'events',
      source_page: FOOD_TRUCK_CATERING_DESSERT_MENU_PATH,
    });
  }, []);

  const copyOutline = async () => {
    try {
      await navigator.clipboard.writeText(cateringPackageOutlineText);
      setCopyStatus('Package outline copied.');
      trackLink('copy_package_outline', `${FOOD_TRUCK_CATERING_DESSERT_MENU_PATH}#package-outline`);
    } catch {
      setCopyStatus('Copy is unavailable. Select the outline text below instead.');
    }
  };

  return (
    <Layout>
      <main>
        <section className="relative overflow-hidden bg-[#1d2722] text-white">
          <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:36px_36px]" />
          <div className="absolute -right-24 -top-20 h-80 w-80 rounded-full bg-primary/25 blur-3xl" />
          <div className="container-page relative py-12 sm:py-16 lg:py-20">
            <Link
              to="/resources/business-playbook"
              onClick={() => trackLink('back_to_business_playbook', '/resources/business-playbook')}
              className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-white/75 transition-colors hover:text-white motion-reduce:transition-none"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back to the Business Playbook
            </Link>

            <div className="mt-8 grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(24rem,0.92fr)] lg:items-center">
              <div className="min-w-0">
                <div className="inline-flex max-w-full items-start gap-2 whitespace-normal rounded-2xl border border-white/15 bg-white/10 px-3.5 py-2 text-sm font-semibold leading-relaxed text-white/90 backdrop-blur sm:items-center sm:rounded-full">
                  <Store aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary sm:mt-0" />
                  <span>For established food-truck and catering operators</span>
                </div>
                <h1 className="mt-6 max-w-4xl font-display text-4xl font-bold leading-[1.04] tracking-tight sm:text-5xl lg:text-6xl">
                  Build a food-truck catering dessert package buyers can understand
                </h1>
                <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/75">
                  Turn one clear dessert experience into a proposal-ready scope: service window,
                  planning estimate, menu, staffing, travel, power, terms, weather, and buyer
                  paperwork—without turning an estimate into a promise.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <Button asChild size="xl" className="min-h-12 max-w-full whitespace-normal px-5 text-center sm:px-8">
                    <a href="#package-outline">
                      Use the package outline <ArrowRight aria-hidden="true" className="ml-2 h-5 w-5" />
                    </a>
                  </Button>
                  <Button asChild variant="outline" size="xl" className="min-h-12 max-w-full whitespace-normal border-white/30 bg-transparent px-5 text-center text-white hover:bg-white/10 hover:text-white sm:px-8">
                    <Link
                      to={MOBILE_SETUP_FIT_CHECKER_PATH}
                      onClick={() => trackLink('hero_check_machine_fit', MOBILE_SETUP_FIT_CHECKER_PATH)}
                    >
                      Check machine fit
                    </Link>
                  </Button>
                </div>
                <p className="mt-4 max-w-3xl text-sm leading-relaxed text-white/55">
                  Planning guide and reusable template—not a Bloomjoy catering offer, quote,
                  contract, price recommendation, booking forecast, serving guarantee, throughput
                  promise, earnings claim, insurance interpretation, or legal advice.
                </p>
              </div>

              <div className="relative mx-auto w-full max-w-xl lg:mx-0 lg:justify-self-end">
                <div className="rotate-1 rounded-[1.75rem] border border-white/20 bg-[#fffaf5] p-3 text-foreground shadow-2xl shadow-black/25 sm:p-4">
                  <div className="-rotate-1 overflow-hidden rounded-[1.35rem] border border-border bg-background">
                    <div className="flex items-start justify-between gap-4 border-b border-border bg-[#fff5eb] px-5 py-5 sm:px-6">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Proposal scope card</p>
                        <p className="mt-1 font-display text-xl font-bold">One experience. Clear responsibilities.</p>
                      </div>
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1d2722] text-primary">
                        <ClipboardCheck aria-hidden="true" className="h-5 w-5" />
                      </span>
                    </div>
                    <div className="grid gap-px bg-border sm:grid-cols-2">
                      {[
                        ['Scope', 'What is included?'],
                        ['Timing', 'When is service open?'],
                        ['Estimate', 'What guides planning?'],
                        ['Ownership', 'Who provides what?'],
                        ['Change', 'What reopens scope?'],
                        ['Paperwork', 'What is due when?'],
                      ].map(([label, value]) => (
                        <div key={label} className="bg-background p-4 sm:p-5">
                          <p className="text-xs font-bold uppercase tracking-[0.1em] text-primary">{label}</p>
                          <p className="mt-2 text-sm font-semibold leading-relaxed text-foreground">{value}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-start gap-3 bg-[#1d2722] px-5 py-4 text-white sm:px-6">
                      <ShieldCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                      <p className="text-sm leading-relaxed text-white/70">
                        A useful proposal makes assumptions and decision owners visible before the event day.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-[#fff5eb] py-10 sm:py-12">
          <div className="container-page">
            <div className="grid gap-5 rounded-3xl border border-primary/20 bg-background p-6 shadow-sm lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:p-8">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <BadgeCheck aria-hidden="true" className="h-6 w-6" />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">A different reader job</p>
                <h2 className="mt-2 font-display text-2xl font-bold text-foreground">This guide starts after you already run an operation.</h2>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                  Use it to shape one dessert add-on for buyer proposals. If you are forming a
                  portable event business, choosing initial equipment, or learning booking and
                  event-day basics, the startup guide owns that path.
                </p>
              </div>
              <Link
                to={EVENT_BUSINESS_GUIDE_PATH}
                onClick={() => trackLink('boundary_event_business_guide', EVENT_BUSINESS_GUIDE_PATH)}
                className="inline-flex min-h-11 items-center gap-2 font-semibold text-primary hover:underline"
              >
                Read the startup event guide <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-background py-12 sm:py-16">
          <div className="container-page">
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-primary">Ten scope decisions</p>
            <h2 className="mt-3 max-w-4xl font-display text-3xl font-bold text-foreground sm:text-4xl">
              Write the questions a buyer will otherwise ask at the worst time
            </h2>
            <p className="mt-4 max-w-3xl leading-relaxed text-muted-foreground">
              Each card separates the buyer’s question, the operator’s decision, and the claim
              boundary. The result is a concise scope—not a universal package policy.
            </p>
            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              {proposalSections.map((section) => {
                const Icon = sectionIcons[section.id];
                return (
                  <article key={section.id} id={`scope-${section.id}`} className="scroll-mt-24 overflow-hidden rounded-3xl border border-border bg-background shadow-sm">
                    <div className="flex items-start gap-4 border-b border-border bg-muted/20 p-5 sm:p-6">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#1d2722] text-primary">
                        <Icon aria-hidden="true" className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.1em] text-primary">Scope {section.number}</p>
                        <h3 className="mt-1 font-display text-2xl font-bold text-foreground">{section.label}</h3>
                      </div>
                    </div>
                    <div className="space-y-5 p-5 sm:p-6">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Buyer needs to know</p>
                        <p className="mt-2 font-semibold leading-relaxed text-foreground">{section.buyerQuestion}</p>
                      </div>
                      <div className="border-t border-border pt-5">
                        <p className="text-xs font-bold uppercase tracking-[0.1em] text-primary">Put in the outline</p>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{section.operatorDecision}</p>
                      </div>
                      <div className="rounded-2xl border border-amber-300/60 bg-amber-50 p-4 text-amber-950">
                        <p className="text-xs font-bold uppercase tracking-[0.1em]">Do not imply</p>
                        <p className="mt-2 text-sm leading-relaxed">{section.guardrail}</p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-[#fff8f2] py-12 sm:py-16">
          <div className="container-page">
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-primary">Two planning structures</p>
            <h2 className="mt-3 max-w-4xl font-display text-3xl font-bold text-foreground sm:text-4xl">
              Choose a commercial structure, then write its boundaries
            </h2>
            <p className="mt-4 max-w-3xl leading-relaxed text-muted-foreground">
              Per-serving and fixed-event are ways to organize a proposal. Neither one supplies a
              recommended price, protects margin automatically, or guarantees demand.
            </p>
            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              {packageStructures.map((structure, index) => (
                <article key={structure.id} className="rounded-3xl border border-border bg-background p-6 shadow-sm sm:p-8">
                  <div className="flex items-start justify-between gap-4">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      {index === 0 ? <Clipboard aria-hidden="true" className="h-6 w-6" /> : <ReceiptText aria-hidden="true" className="h-6 w-6" />}
                    </span>
                    <span className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs font-bold text-muted-foreground">Planning structure</span>
                  </div>
                  <h3 className="mt-5 font-display text-2xl font-bold text-foreground">{structure.label}</h3>
                  <p className="mt-3 leading-relaxed text-muted-foreground">{structure.fit}</p>
                  <p className="mt-6 text-xs font-bold uppercase tracking-[0.1em] text-primary">Must define</p>
                  <ul className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
                    {structure.mustDefine.map((item) => (
                      <li key={item} className="flex gap-3">
                        <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-6 rounded-2xl border border-[#d9a79e] bg-[#fff3f0] p-4 text-[#7d392f]">
                    <p className="text-sm leading-relaxed">{structure.caution}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-background py-12 sm:py-16">
          <div className="container-page">
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-primary">Responsibility map</p>
            <h2 className="mt-3 max-w-4xl font-display text-3xl font-bold text-foreground sm:text-4xl">
              Make ownership visible before it becomes an event-day dispute
            </h2>
            <div className="mt-8 grid gap-5 lg:grid-cols-3">
              {responsibilityLanes.map((lane, index) => {
                const Icon = [Store, Users, Handshake][index];
                return (
                  <article key={lane.label} className="rounded-3xl border border-border bg-muted/15 p-6">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1d2722] text-primary">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <h3 className="mt-5 font-display text-2xl font-bold text-foreground">{lane.label}</h3>
                    <ul className="mt-5 space-y-4 text-sm leading-relaxed text-muted-foreground">
                      {lane.items.map((item) => (
                        <li key={item} className="flex gap-3">
                          <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="package-outline" className="scroll-mt-24 border-b border-border bg-[#1d2722] py-12 text-white sm:py-16">
          <div className="container-page">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:items-start">
              <div className="lg:sticky lg:top-24">
                <p className="text-sm font-bold uppercase tracking-[0.14em] text-primary">Reusable package outline</p>
                <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">
                  Copy the structure. Replace every assumption.
                </h2>
                <p className="mt-4 leading-relaxed text-white/70">
                  This template is intentionally blank. It is not a Bloomjoy package, offer,
                  contract, quote, price, policy, or performance promise. Your operation supplies
                  the facts and terms; appropriate advisors review the decisions that need them.
                </p>
                <Button type="button" size="lg" onClick={copyOutline} className="mt-6 min-h-11 max-w-full whitespace-normal text-center">
                  <Copy aria-hidden="true" className="mr-2 h-4 w-4" /> Copy package outline
                </Button>
                <p aria-live="polite" className="mt-3 min-h-6 text-sm text-white/70">{copyStatus}</p>
              </div>

              <div className="overflow-hidden rounded-[1.75rem] border border-white/15 bg-[#fffaf5] text-foreground shadow-2xl shadow-black/20">
                <div className="flex items-start justify-between gap-4 border-b border-border bg-[#fff1e4] px-5 py-5 sm:px-7">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Working template</p>
                    <h3 className="mt-1 font-display text-2xl font-bold">Food-truck catering dessert package</h3>
                  </div>
                  <Sparkles aria-hidden="true" className="h-6 w-6 shrink-0 text-primary" />
                </div>
                <div className="grid gap-px bg-border sm:grid-cols-2">
                  {packageOutlineFields.map(([label, prompt]) => (
                    <div key={label} className="min-w-0 bg-background p-5 sm:p-6">
                      <p className="text-xs font-bold uppercase tracking-[0.1em] text-primary">{label}</p>
                      <p className="mt-3 break-words text-sm leading-relaxed text-muted-foreground">{prompt}</p>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border bg-[#fff1e4] px-5 py-5 sm:px-7">
                  <p className="text-sm font-semibold leading-relaxed text-[#7d392f]">
                    Template only. A planning estimate stays an estimate; package wording does not
                    certify equipment fit, local approval, coverage, servings, throughput, booking,
                    revenue, margin, or event conditions.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="machine-fit" className="scroll-mt-24 border-b border-border bg-background py-12 sm:py-16">
          <div className="container-page">
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-primary">Machine-fit next step</p>
            <h2 className="mt-3 max-w-4xl font-display text-3xl font-bold text-foreground sm:text-4xl">
              Package the experience only after the operation remains plausible
            </h2>
            <p className="mt-4 max-w-3xl leading-relaxed text-muted-foreground">
              A clean proposal cannot repair an unresolved space, power, service, transport,
              weather, or approval problem. Move through the path that matches what is still open.
            </p>
            <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {relatedPaths.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => trackLink(`related_${item.eyebrow.toLowerCase().replaceAll(' ', '_')}`, item.href)}
                  className="group flex h-full min-w-0 flex-col rounded-3xl border border-border bg-background p-5 transition-[transform,border-color,box-shadow] hover:-translate-y-1 hover:border-primary/50 hover:shadow-elevated motion-reduce:transform-none motion-reduce:transition-none"
                >
                  <p className="text-xs font-bold uppercase tracking-[0.1em] text-primary">{item.eyebrow}</p>
                  <h3 className="mt-3 font-display text-xl font-bold text-foreground group-hover:text-primary">{item.title}</h3>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                  <span className="mt-5 inline-flex min-h-11 items-center font-semibold text-foreground">
                    Open guide <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" />
                  </span>
                </Link>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap gap-3 text-sm font-semibold">
              {[
                ['/machines/mini', 'Mini Machine'],
                ['/machines/micro', 'Micro Machine'],
                ['/resources/business-playbook/payback-planner', 'Payback Scenario Planner'],
                [EVENT_BUSINESS_GUIDE_PATH, 'Startup event business guide'],
              ].map(([href, label]) => (
                <Link
                  key={href}
                  to={href}
                  onClick={() => trackLink(`supporting_${label.toLowerCase().replaceAll(' ', '_')}`, href)}
                  className="inline-flex min-h-11 items-center rounded-full border border-border bg-muted/20 px-4 text-foreground transition-colors hover:border-primary hover:text-primary motion-reduce:transition-none"
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#fff5eb] py-12 sm:py-16">
          <div className="container-page">
            <div className="grid gap-8 rounded-[2rem] border border-primary/20 bg-background p-6 shadow-sm sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <div className="flex items-center gap-2 text-primary">
                  <Sparkles aria-hidden="true" className="h-5 w-5" />
                  <p className="text-sm font-bold uppercase tracking-[0.14em]">When cotton candy remains the fit</p>
                </div>
                <h2 className="mt-3 max-w-3xl font-display text-3xl font-bold text-foreground sm:text-4xl">
                  Carry the scope into a machine-fit conversation
                </h2>
                <p className="mt-4 max-w-3xl leading-relaxed text-muted-foreground">
                  Use the categorical checker before the quote. If the setup remains worth
                  exploring, Bloomjoy can review a Commercial quote with mobile-food source
                  context. Mini and Micro remain on their product purchase paths.
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row lg:flex-col">
                <Button asChild size="xl" className="min-h-12 max-w-full whitespace-normal px-5 text-center sm:px-8">
                  <Link
                    to={MOBILE_SETUP_FIT_CHECKER_PATH}
                    onClick={() => trackLink('final_check_machine_fit', MOBILE_SETUP_FIT_CHECKER_PATH)}
                  >
                    Check your setup <ArrowRight aria-hidden="true" className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="min-h-11 max-w-full whitespace-normal text-center">
                  <Link
                    to={foodTruckCateringDessertMenuQuotePath}
                    onClick={() => trackLink('final_request_commercial_quote', foodTruckCateringDessertMenuQuotePath)}
                  >
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
