import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Cable,
  Check,
  ClipboardCheck,
  Gauge,
  PackageOpen,
  Route,
  Sparkles,
  Store,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { trackBusinessPlaybookCtaClick } from '@/lib/businessPlaybookAnalytics';
import {
  foodTruckQuotePath,
  foodTruckSolutionFaqs,
  MOBILE_SETUP_GUIDE_PATH,
  mobileMachineFacts,
} from '@/data/mobileOperatorPages';
import miniMain from '@/assets/real/mini-main.webp';

const operatingPatterns = [
  {
    icon: Truck,
    title: 'Installed in a truck or trailer',
    body: 'Keeps the experience inside the core operation, but creates the most vehicle-specific questions: measured access, total load, securing, heat, service clearance, and local review.',
    flag: 'Most confirmation required',
  },
  {
    icon: Store,
    title: 'Adjacent pop-up station',
    body: 'Separates the machine from the vehicle and can simplify line flow. It still needs stable placement, approved power, weather planning, protected supplies, cleaning, and staffing.',
    flag: 'Flexible—not automatically approved',
  },
  {
    icon: Sparkles,
    title: 'Catering or booked-event deployment',
    body: 'Treats robotic cotton candy as a staffed visual service window alongside an established mobile-food business. Confirm venue, travel, power, staffing, and reset responsibilities per event.',
    flag: 'Best framed as a service model',
  },
];

const firstQuestions = [
  { icon: Gauge, label: 'Measured space', body: 'Exact model dimensions plus service, cleaning, and line clearance.' },
  { icon: Cable, label: 'Total electrical load', body: 'The machine and every other load that may run at the same time.' },
  { icon: Users, label: 'Service rhythm', body: 'Who takes payment, feeds sticks, watches the line, and pauses service.' },
  { icon: Route, label: 'Movement plan', body: 'Load-in, handling, approved transport orientation, and securing questions.' },
  { icon: PackageOpen, label: 'Reset & storage', body: 'Dry supplies, daily cleaning, debris checks, waste, and restocking.' },
  { icon: ClipboardCheck, label: 'Outside approvals', body: 'Manufacturer, electrical, vehicle, venue, insurer, and local questions.' },
];

const noFitSignals = [
  'No measured space for the exact machine, operator access, cleaning, and guest flow.',
  'No approved plan for the machine load within the setup’s complete electrical demand.',
  'The plan depends on Bloomjoy certifying a generator, vehicle mount, securing method, ventilation, outdoor use, or permit.',
  'No trained person is available for a Mini/manual-stick service rhythm.',
  'The decision requires a serving-rate, sales, margin, ROI, or payback guarantee.',
  'Cleaning, protected sugar/stick storage, weather response, or load-in remains unworkable.',
];

const relatedPaths = [
  {
    eyebrow: 'Pre-quote field guide',
    title: 'Check the physical and operating setup',
    body: 'Work through space, power, load-in, transport, environment, cleaning, service flow, and local questions.',
    href: MOBILE_SETUP_GUIDE_PATH,
  },
  {
    eyebrow: 'Interactive planning',
    title: 'Compare the broader machine path',
    body: 'Use the cost-only Machine Fit + Startup Budget Planner without sharing exact private assumptions.',
    href: '/resources/business-playbook/planner',
  },
  {
    eyebrow: 'Established event service',
    title: 'Review the event and catering operating guide',
    body: 'See the staffing, booking, supply, and event-day rhythm owned by Bloomjoy’s existing catering guide.',
    href: '/resources/business-playbook/mini-micro-event-catering-business-guide',
  },
];

const trackLink = (cta: string, href: string) =>
  trackBusinessPlaybookCtaClick({ surface: 'food_truck_solution', cta, href });

export default function FoodTrucksSolutionPage() {
  return (
    <Layout>
      <section className="relative overflow-hidden bg-[#1d2722] text-white">
        <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:36px_36px]" />
        <div className="absolute -right-24 -top-20 h-80 w-80 rounded-full bg-primary/25 blur-3xl" />
        <div className="container-page relative py-12 sm:py-16 lg:py-20">
          <div className="grid min-w-0 gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
            <div className="min-w-0">
              <div className="inline-flex max-w-full items-start gap-2 whitespace-normal rounded-2xl border border-white/15 bg-white/10 px-3.5 py-2 text-sm font-semibold leading-relaxed text-white/90 backdrop-blur sm:items-center sm:rounded-full">
                <Truck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary sm:mt-0" />
                <span>For food trucks, concession trailers &amp; mobile caterers</span>
              </div>
              <h1 className="mt-6 max-w-3xl font-display text-4xl font-bold leading-[1.03] tracking-tight sm:text-5xl lg:text-6xl">
                Add a visual dessert without guessing at fit.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/75">
                Mini is the first Bloomjoy model to evaluate for compact, staffed service.
                Commercial needs a larger reviewed setup. In either case, start with measured
                space, the complete electrical load, and the service rhythm—not a revenue promise.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="xl" className="min-h-12 max-w-full whitespace-normal px-5 text-center shadow-lg shadow-primary/20 sm:px-8">
                  <Link to={foodTruckQuotePath} onClick={() => trackLink('request_machine_fit_quote', foodTruckQuotePath)}>
                    Request a machine-fit quote
                    <ArrowRight aria-hidden="true" className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="xl" className="min-h-12 max-w-full whitespace-normal border-white/30 bg-transparent px-5 text-center text-white hover:bg-white/10 hover:text-white sm:px-8">
                  <Link to={MOBILE_SETUP_GUIDE_PATH} onClick={() => trackLink('check_mobile_setup', MOBILE_SETUP_GUIDE_PATH)}>
                    Check your setup
                  </Link>
                </Button>
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/55">
                Bloomjoy reviews published machine facts and your intended operating model. We do
                not certify vehicle installations, generators, ventilation, outdoor use, or permits.
              </p>
            </div>

            <div className="relative mx-auto w-full max-w-lg lg:mx-0 lg:justify-self-end">
              <div className="absolute -left-4 top-10 hidden h-[82%] w-px border-l border-dashed border-primary/60 sm:block" />
              <div className="overflow-hidden rounded-[1.75rem] border border-white/15 bg-[#fffaf5] text-foreground shadow-2xl shadow-black/25">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Mobile fit dispatch</p>
                    <p className="mt-1 font-display text-xl font-bold">Start with Mini. Confirm the setup.</p>
                  </div>
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <BadgeCheck aria-hidden="true" className="h-5 w-5" />
                  </span>
                </div>
                <div className="grid gap-0 sm:grid-cols-[0.9fr_1.1fr]">
                  <div className="flex min-h-56 items-center justify-center bg-white p-5">
                    <img
                      src={miniMain}
                      alt="Bloomjoy Mini Machine shown as the first model to evaluate for staffed mobile service"
                      width={430}
                      height={555}
                      fetchpriority="high"
                      decoding="async"
                      className="max-h-64 w-full object-contain"
                    />
                  </div>
                  <div className="space-y-3 border-t border-border p-5 sm:border-l sm:border-t-0">
                    {[
                      ['Likely path', 'Mini / staffed service'],
                      ['First constraint', 'Space + total load'],
                      ['Required next step', 'Setup-specific review'],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl border border-border bg-background p-3.5">
                        <p className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
                      </div>
                    ))}
                    <div className="flex items-start gap-2 rounded-xl bg-[#1d2722] p-3.5 text-white">
                      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <p className="text-xs leading-relaxed text-white/75">Not every truck or trailer can support the machine, access, power, and cleaning plan.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-[#fffaf5] py-10 sm:py-12">
        <div className="container-page">
          <div className="grid gap-6 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">The fast answer</p>
              <h2 className="mt-3 font-display text-3xl font-bold text-foreground">Plausible for some mobile operators. Never automatic.</h2>
              <p className="mt-4 leading-relaxed text-muted-foreground">
                The strongest first use case is a trained operator adding a defined dessert service
                window to an established operation. The machine still needs its own space, power,
                movement, storage, cleaning, and line-flow plan.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {firstQuestions.map(({ icon: Icon, label, body }) => (
                <div key={label} className="rounded-2xl border border-border bg-background p-4 shadow-sm">
                  <Icon aria-hidden="true" className="h-5 w-5 text-primary" />
                  <h3 className="mt-3 font-display text-lg font-bold text-foreground">{label}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16 lg:py-20">
        <div className="container-page">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Three operating patterns</p>
            <h2 className="mt-3 font-display text-3xl font-bold text-foreground sm:text-4xl">Choose the model before you choose the machine.</h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              “Mobile” can mean permanently installed, deployed beside the vehicle, or brought to
              booked events. Each pattern changes what must be confirmed.
            </p>
          </div>
          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            {operatingPatterns.map(({ icon: Icon, title, body, flag }, index) => (
              <article key={title} className="group relative overflow-hidden rounded-3xl border border-border bg-background p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-elevated">
                <span className="absolute right-5 top-5 font-display text-5xl font-bold text-muted/70">0{index + 1}</span>
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Icon aria-hidden="true" className="h-6 w-6" />
                </span>
                <h3 className="mt-8 max-w-[16rem] font-display text-2xl font-bold text-foreground">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
                <p className="mt-6 border-t border-border pt-4 text-xs font-bold uppercase tracking-[0.12em] text-primary">{flag}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-muted/20 py-12 sm:py-16 lg:py-20">
        <div className="container-page">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Machine path</p>
              <h2 className="mt-3 font-display text-3xl font-bold text-foreground sm:text-4xl">Compare facts, not the word “compact.”</h2>
              <p className="mt-4 text-lg leading-relaxed text-muted-foreground">Published dimensions and power help frame questions. They do not approve a generator, mounting method, vehicle, or service plan.</p>
            </div>
            <Link to="/machines" onClick={() => trackLink('compare_all_machines', '/machines')} className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-primary hover:underline">
              Compare all machine pages <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-8 grid gap-5 xl:grid-cols-3">
            {mobileMachineFacts.map((machine) => (
              <article key={machine.id} className="flex h-full flex-col rounded-3xl border border-border bg-background p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">{machine.signal}</p>
                    <h3 className="mt-2 font-display text-2xl font-bold text-foreground">{machine.name}</h3>
                  </div>
                  <BadgeCheck aria-hidden="true" className="h-5 w-5 text-primary" />
                </div>
                <p className="mt-3 text-sm font-semibold text-foreground">{machine.posture}</p>
                <ul className="mt-5 space-y-3">
                  {machine.facts.map((fact) => (
                    <li key={fact} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                      <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {fact}
                    </li>
                  ))}
                </ul>
                <p className="mt-5 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">{machine.caveat}</p>
                <Link to={machine.href} onClick={() => trackLink(`view_${machine.id}_details`, machine.href)} className="mt-auto inline-flex min-h-11 items-end gap-2 pt-6 text-sm font-bold text-primary hover:underline">
                  Review {machine.name} facts <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#8b3e32] py-12 text-white sm:py-16">
        <div className="container-page">
          <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr]">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-white/65">When this is not a fit</p>
              <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">Stop conditions are part of a good quote.</h2>
              <p className="mt-4 leading-relaxed text-white/75">A useful fit conversation should be willing to say “not yet” or “not this setup.”</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {noFitSignals.map((signal) => (
                <div key={signal} className="flex gap-3 rounded-2xl border border-white/15 bg-black/10 p-4">
                  <X aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#ffd0df]" />
                  <p className="text-sm leading-relaxed text-white/85">{signal}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16 lg:py-20">
        <div className="container-page">
          <div className="grid gap-10 lg:grid-cols-[1fr_0.8fr]">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Food-truck machine FAQs</p>
              <h2 className="mt-3 font-display text-3xl font-bold text-foreground">Questions to answer before the quote.</h2>
              <Accordion type="single" collapsible className="mt-7 rounded-2xl border border-border px-5">
                {foodTruckSolutionFaqs.map((faq, index) => (
                  <AccordionItem key={faq.q} value={`food-truck-faq-${index}`}>
                    <AccordionTrigger className="text-left font-display text-lg font-bold">{faq.q}</AccordionTrigger>
                    <AccordionContent className="pb-5 leading-relaxed text-muted-foreground">{faq.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
            <aside className="rounded-3xl border border-border bg-[#fffaf5] p-6 sm:p-8">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Keep planning</p>
              <div className="mt-5 space-y-4">
                {relatedPaths.map((item) => (
                  <Link key={item.href} to={item.href} onClick={() => trackLink(item.eyebrow.toLowerCase().replaceAll(' ', '_'), item.href)} className="group block rounded-2xl border border-border bg-background p-4 transition hover:border-primary/50 hover:shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{item.eyebrow}</p>
                    <h3 className="mt-2 font-display text-lg font-bold text-foreground group-hover:text-primary">{item.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                    <span className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-primary">Open <ArrowRight aria-hidden="true" className="h-4 w-4" /></span>
                  </Link>
                ))}
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-[#1d2722] py-12 text-white sm:py-16">
        <div className="container-page">
          <div className="grid min-w-0 gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="min-w-0">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Bring the unresolved questions</p>
              <h2 className="mt-3 max-w-3xl font-display text-3xl font-bold sm:text-4xl">A strong quote starts with the setup you actually plan to run.</h2>
              <p className="mt-4 max-w-2xl leading-relaxed text-white/70">Tell Bloomjoy the setting, region, timing, and machine path you are considering. We’ll review what fits our published evidence and name what still needs outside confirmation.</p>
            </div>
            <Button asChild size="xl" className="min-h-12 max-w-full whitespace-normal px-5 text-center sm:w-fit sm:px-8">
              <Link to={foodTruckQuotePath} onClick={() => trackLink('request_machine_fit_quote_footer', foodTruckQuotePath)}>
                Request a machine-fit quote <ArrowRight aria-hidden="true" className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </Layout>
  );
}
