import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Cable,
  Check,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  FileCheck2,
  MapPinned,
  Printer,
  RotateCcw,
  Ruler,
  ShieldCheck,
  Store,
  Truck,
  Wrench,
} from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { trackBusinessPlaybookCtaClick } from '@/lib/businessPlaybookAnalytics';
import {
  FOOD_TRUCK_SOLUTION_PATH,
  MOBILE_SETUP_GUIDE_PATH,
  mobileMachineFacts,
  mobileSetupChecklist,
} from '@/data/mobileOperatorPages';

const setupQuotePath =
  '/contact?type=quote&source=%2Fresources%2Fbusiness-playbook%2Ffood-truck-mobile-setup-guide&use=mobile-food';

const responsibilityBoundaries = [
  {
    icon: FileCheck2,
    owner: 'Bloomjoy quote review',
    scope: 'Published model facts, intended service model, supply path, and open questions.',
  },
  {
    icon: Wrench,
    owner: 'Manufacturer instructions',
    scope: 'Model-specific installation, handling, operation, maintenance, and approved environment.',
  },
  {
    icon: Cable,
    owner: 'Qualified professionals',
    scope: 'Electrical system, vehicle engineering, mounting/securing, and other licensed work.',
  },
  {
    icon: Building2,
    owner: 'Venue, insurer & local authority',
    scope: 'Site acceptance, insurance, fire/food rules, permits, and enforcement-agency approval.',
  },
];

const stopConditions = [
  'The exact machine does not fit the measured space, access route, service clearance, or guest flow.',
  'The complete electrical load and approved source have not been reviewed for the planned operating conditions.',
  'Transport orientation or securing depends on an improvised method rather than model-specific and qualified guidance.',
  'The plan assumes indoor equipment, sugar, or electronics are approved for weather or humidity without evidence.',
  'A Mini service model has no trained person assigned to manual stick feeding and guest flow.',
  'Local, venue, insurer, manufacturer, electrical, or vehicle questions remain unresolved where their approval is required.',
];

const trackLink = (cta: string, href: string) =>
  trackBusinessPlaybookCtaClick({ surface: 'mobile_setup_guide', cta, href });

export default function MobileFoodSetupGuidePage() {
  const [reviewed, setReviewed] = useState<Set<string>>(() => new Set());
  const [copyStatus, setCopyStatus] = useState('');
  const completedCount = reviewed.size;
  const remainingCount = mobileSetupChecklist.length - completedCount;

  const toggleItem = (id: string, checked: boolean) => {
    setReviewed((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setCopyStatus('');
  };

  const copyChecklistSummary = async () => {
    const lines = mobileSetupChecklist.map((item) =>
      `${reviewed.has(item.id) ? '[reviewed]' : '[unresolved]'} ${item.title} — ${item.owner}`
    );
    const summary = [
      'Bloomjoy mobile setup pre-quote checklist',
      `${completedCount} of ${mobileSetupChecklist.length} categories reviewed.`,
      'Checked means reviewed, not approved or certified.',
      '',
      ...lines,
      '',
      `Source: https://www.bloomjoyusa.com${MOBILE_SETUP_GUIDE_PATH}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(summary);
      setCopyStatus('Checklist summary copied.');
    } catch {
      setCopyStatus('Copy was unavailable. Use Print checklist instead.');
    }
  };

  const resetChecklist = () => {
    setReviewed(new Set());
    setCopyStatus('Checklist reset.');
  };

  return (
    <Layout>
      <article>
        <header className="relative overflow-hidden border-b border-border bg-[#fff8f2]">
          <div className="absolute right-0 top-0 h-full w-1/3 bg-[radial-gradient(circle_at_top_right,rgba(246,114,162,0.22),transparent_65%)]" />
          <div className="container-page relative py-12 sm:py-16 lg:py-20">
            <div className="grid gap-8 lg:grid-cols-[1fr_18rem] lg:items-end">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-primary">
                  <Link to="/resources/business-playbook" className="hover:underline">Business Playbook</Link>
                  <span aria-hidden="true">/</span>
                  <span>Mobile operations field guide</span>
                </div>
                <h1 className="mt-5 max-w-4xl font-display text-4xl font-bold leading-[1.06] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                  Food-truck cotton candy setup: what to confirm before the quote
                </h1>
                <p className="mt-6 max-w-3xl text-lg leading-relaxed text-muted-foreground">
                  Qualify a truck, concession trailer, cart, or adjacent event station without
                  treating voltage, wattage, weight, or the phrase “mobile food facility” as an
                  engineering or permit decision.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Button asChild size="lg">
                    <a href="#pre-quote-checklist">Start the pre-quote checklist <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" /></a>
                  </Button>
                  <Button asChild variant="outline" size="lg">
                    <Link to={FOOD_TRUCK_SOLUTION_PATH} onClick={() => trackLink('back_to_food_truck_solution', FOOD_TRUCK_SOLUTION_PATH)}>
                      Review mobile machine fit
                    </Link>
                  </Button>
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Review posture</p>
                <dl className="mt-4 space-y-4 text-sm">
                  <div>
                    <dt className="font-semibold text-foreground">Last reviewed</dt>
                    <dd className="mt-1 text-muted-foreground">August 9, 2026</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-foreground">Facts</dt>
                    <dd className="mt-1 text-muted-foreground">Current Bloomjoy product pages and approved machine claim matrix.</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-foreground">Regulatory posture</dt>
                    <dd className="mt-1 text-muted-foreground">Examples only; confirm the rules and terms used in your jurisdiction.</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        </header>

        <section className="border-b border-border bg-[#1d2722] py-8 text-white">
          <div className="container-page">
            <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <AlertTriangle aria-hidden="true" className="h-6 w-6" />
              </span>
              <div>
                <h2 className="font-display text-xl font-bold">The number on the data plate is the beginning of the question.</h2>
                <p className="mt-1 text-sm leading-relaxed text-white/70">Watts do not approve a generator. Weight does not approve a mount. Dimensions do not prove service access. A product category does not approve a permit.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="py-12 sm:py-16 lg:py-20">
          <div className="container-page">
            <div className="grid gap-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
              <aside className="lg:sticky lg:top-24 lg:self-start">
                <nav aria-label="Guide sections" className="rounded-2xl border border-border bg-background p-4 shadow-sm">
                  <p className="px-2 text-xs font-bold uppercase tracking-[0.14em] text-primary">In this guide</p>
                  <div className="mt-3 grid">
                    {[
                      ['#placement-model', '1. Placement model'],
                      ['#model-facts', '2. Verified model facts'],
                      ['#pre-quote-checklist', '3. Readiness checklist'],
                      ['#decision-boundaries', '4. Who confirms what'],
                      ['#stop-confirm', '5. Stop and confirm'],
                      ['#sources', '6. Sources'],
                    ].map(([href, label]) => (
                      <a key={href} href={href} className="min-h-10 rounded-lg px-2 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-primary">{label}</a>
                    ))}
                  </div>
                </nav>
              </aside>

              <div className="min-w-0 space-y-16">
                <section id="placement-model" className="scroll-mt-24">
                  <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">1 / Placement model</p>
                  <h2 className="mt-3 font-display text-3xl font-bold text-foreground">Installed and adjacent setups create different questions.</h2>
                  <p className="mt-4 max-w-3xl text-lg leading-relaxed text-muted-foreground">Choose the physical model before comparing machines. Neither path is universally safer, easier, or locally approved.</p>
                  <div className="mt-7 grid gap-5 md:grid-cols-2">
                    <div className="rounded-3xl border border-border bg-[#fff8f2] p-6">
                      <Truck aria-hidden="true" className="h-7 w-7 text-primary" />
                      <h3 className="mt-5 font-display text-2xl font-bold text-foreground">Installed in the vehicle or trailer</h3>
                      <p className="mt-3 leading-relaxed text-muted-foreground">Measure doors, interior footprint, height, operator access, service panels, cleaning path, guest line, and every concurrent load. Get model-specific guidance for transport orientation and qualified review for securing and vehicle work.</p>
                      <p className="mt-4 rounded-xl bg-background p-3 text-sm font-semibold text-foreground">Do not derive mounting safety from machine weight.</p>
                    </div>
                    <div className="rounded-3xl border border-border bg-sage-light/50 p-6">
                      <Store aria-hidden="true" className="h-7 w-7 text-sage" />
                      <h3 className="mt-5 font-display text-2xl font-bold text-foreground">Adjacent pop-up or event station</h3>
                      <p className="mt-3 leading-relaxed text-muted-foreground">Plan stable placement, an approved power route, cable protection, weather response, protected sugar and sticks, staff handoff, payment/line flow, cleaning, and load-in from the vehicle.</p>
                      <p className="mt-4 rounded-xl bg-background p-3 text-sm font-semibold text-foreground">Separate from the vehicle does not mean approved for outdoors.</p>
                    </div>
                  </div>
                </section>

                <section id="model-facts" className="scroll-mt-24">
                  <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">2 / Verified model facts</p>
                  <h2 className="mt-3 font-display text-3xl font-bold text-foreground">Use only the facts each product page actually publishes.</h2>
                  <div className="mt-7 grid gap-5">
                    {mobileMachineFacts.map((machine) => (
                      <article key={machine.id} className="rounded-3xl border border-border bg-background p-6 shadow-sm">
                        <div className="grid gap-5 lg:grid-cols-[14rem_1fr]">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">{machine.signal}</p>
                            <h3 className="mt-2 font-display text-2xl font-bold text-foreground">{machine.name}</h3>
                            <p className="mt-2 text-sm font-semibold text-muted-foreground">{machine.posture}</p>
                            <Link to={machine.href} onClick={() => trackLink(`open_${machine.id}_source_page`, machine.href)} className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-bold text-primary hover:underline">Open product source <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
                          </div>
                          <div>
                            <ul className="grid gap-3 sm:grid-cols-2">
                              {machine.facts.map((fact) => (
                                <li key={fact} className="flex gap-2.5 rounded-xl bg-muted/35 p-3 text-sm leading-relaxed text-muted-foreground">
                                  <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                  {fact}
                                </li>
                              ))}
                            </ul>
                            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-950">{machine.caveat}</p>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                <section id="pre-quote-checklist" className="scroll-mt-24">
                  <div className="rounded-[2rem] border border-border bg-[#fff8f2] p-5 shadow-sm sm:p-8">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                      <div>
                        <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">3 / Interactive pre-quote checklist</p>
                        <h2 className="mt-3 font-display text-3xl font-bold text-foreground">Turn unknowns into named questions.</h2>
                        <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">Check a category only after you have reviewed it and identified its owner. A check is not Bloomjoy, manufacturer, professional, venue, or regulatory approval.</p>
                      </div>
                      <div className="rounded-2xl border border-border bg-background px-5 py-4 text-center shadow-sm" aria-live="polite">
                        <p className="font-display text-3xl font-bold text-primary">{completedCount}/{mobileSetupChecklist.length}</p>
                        <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">categories reviewed</p>
                      </div>
                    </div>

                    <div className="mt-7 space-y-3">
                      {mobileSetupChecklist.map((item, index) => {
                        const checked = reviewed.has(item.id);
                        return (
                          <label key={item.id} htmlFor={`setup-${item.id}`} className={`grid cursor-pointer gap-3 rounded-2xl border p-4 transition sm:grid-cols-[auto_1fr_auto] sm:items-start ${checked ? 'border-primary/35 bg-primary/5' : 'border-border bg-background hover:border-primary/30'}`}>
                            <Checkbox id={`setup-${item.id}`} checked={checked} onCheckedChange={(value) => toggleItem(item.id, value === true)} className="mt-1 h-5 w-5" />
                            <span>
                              <span className="block font-display text-lg font-bold text-foreground">{index + 1}. {item.title}</span>
                              <span className="mt-1.5 block text-sm leading-relaxed text-muted-foreground">{item.prompt}</span>
                            </span>
                            <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground sm:max-w-44 sm:text-right">{item.owner}</span>
                          </label>
                        );
                      })}
                    </div>

                    <div className="mt-6 rounded-2xl bg-[#1d2722] p-5 text-white" aria-live="polite">
                      <div className="flex items-start gap-3">
                        {remainingCount === 0 ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> : <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />}
                        <div>
                          <p className="font-display text-lg font-bold">{remainingCount === 0 ? 'All categories reviewed—not automatically approved.' : `${remainingCount} ${remainingCount === 1 ? 'category remains' : 'categories remain'} unresolved.`}</p>
                          <p className="mt-1 text-sm leading-relaxed text-white/70">Bring checked facts and unresolved questions to the quote conversation. Do not include private financials or customer data.</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                      <Button type="button" variant="outline" onClick={copyChecklistSummary} className="min-h-11">
                        <Clipboard aria-hidden="true" className="mr-2 h-4 w-4" /> Copy summary
                      </Button>
                      <Button type="button" variant="outline" onClick={() => window.print()} className="min-h-11">
                        <Printer aria-hidden="true" className="mr-2 h-4 w-4" /> Print checklist
                      </Button>
                      <Button type="button" variant="ghost" onClick={resetChecklist} className="min-h-11">
                        <RotateCcw aria-hidden="true" className="mr-2 h-4 w-4" /> Reset
                      </Button>
                      {copyStatus && <p role="status" className="self-center text-sm font-semibold text-muted-foreground">{copyStatus}</p>}
                    </div>
                  </div>
                </section>

                <section id="decision-boundaries" className="scroll-mt-24">
                  <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">4 / Decision boundaries</p>
                  <h2 className="mt-3 font-display text-3xl font-bold text-foreground">Know who can answer each question.</h2>
                  <div className="mt-7 grid gap-4 sm:grid-cols-2">
                    {responsibilityBoundaries.map(({ icon: Icon, owner, scope }) => (
                      <div key={owner} className="rounded-2xl border border-border bg-background p-5 shadow-sm">
                        <Icon aria-hidden="true" className="h-6 w-6 text-primary" />
                        <h3 className="mt-4 font-display text-xl font-bold text-foreground">{owner}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{scope}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/5 p-5">
                    <div className="flex items-start gap-3">
                      <ShieldCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                      <p className="text-sm leading-relaxed text-foreground"><strong>“Mobile food facility” is jurisdiction-specific language.</strong> A term or approval path used in California or one county is not a nationwide classification. Ask the enforcement agency that actually governs your operation.</p>
                    </div>
                  </div>
                </section>

                <section id="stop-confirm" className="scroll-mt-24 rounded-[2rem] bg-[#8b3e32] p-6 text-white sm:p-8">
                  <p className="text-sm font-bold uppercase tracking-[0.16em] text-white/65">5 / Stop and confirm</p>
                  <h2 className="mt-3 font-display text-3xl font-bold">Do not move to a quote as though these are solved.</h2>
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    {stopConditions.map((condition) => (
                      <div key={condition} className="flex gap-3 rounded-2xl border border-white/15 bg-black/10 p-4">
                        <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#ffd0df]" />
                        <p className="text-sm leading-relaxed text-white/85">{condition}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section id="sources" className="scroll-mt-24">
                  <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">6 / Sources and update posture</p>
                  <h2 className="mt-3 font-display text-3xl font-bold text-foreground">Verify against the current source before acting.</h2>
                  <p className="mt-4 max-w-3xl leading-relaxed text-muted-foreground">Machine facts come from current Bloomjoy product pages. The regulatory links below illustrate decision boundaries; they are not a substitute for current local requirements or professional advice.</p>
                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <a href="https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?article=&chapter=10.&division=104.&lawCode=HSC&part=7.&title=" target="_blank" rel="noreferrer" className="group rounded-2xl border border-border bg-background p-5 transition hover:border-primary/40 hover:shadow-sm">
                      <MapPinned aria-hidden="true" className="h-6 w-6 text-primary" />
                      <h3 className="mt-4 font-display text-xl font-bold text-foreground group-hover:text-primary">California Retail Food Code, Chapter 10</h3>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">One state example showing mobile-food terminology and enforcement-agency/equipment review.</p>
                      <span className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-primary">Open official source <ExternalLink aria-hidden="true" className="h-4 w-4" /></span>
                    </a>
                    <a href="https://www.fda.gov/media/164194/download" target="_blank" rel="noreferrer" className="group rounded-2xl border border-border bg-background p-5 transition hover:border-primary/40 hover:shadow-sm">
                      <Ruler aria-hidden="true" className="h-6 w-6 text-primary" />
                      <h3 className="mt-4 font-display text-xl font-bold text-foreground group-hover:text-primary">2022 FDA Food Code</h3>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">A model-code reference; confirm state and local adoption and current requirements separately.</p>
                      <span className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-primary">Open official source <ExternalLink aria-hidden="true" className="h-4 w-4" /></span>
                    </a>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-border bg-[#1d2722] py-12 text-white sm:py-16">
          <div className="container-page">
            <div className="grid min-w-0 gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="min-w-0">
                <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Ready for a bounded review?</p>
                <h2 className="mt-3 max-w-3xl font-display text-3xl font-bold sm:text-4xl">Bring your setup facts and unresolved questions—not a claim that the setup is already approved.</h2>
                <p className="mt-4 max-w-2xl leading-relaxed text-white/70">Bloomjoy can review machine fit and the information needed for a useful quote. Final electrical, vehicle, manufacturer, venue, insurance, and regulatory decisions stay with the appropriate owner.</p>
              </div>
              <Button asChild size="xl" className="min-h-12 max-w-full whitespace-normal px-5 text-center sm:w-fit sm:px-8">
                <Link to={setupQuotePath} onClick={() => trackLink('request_setup_review_quote', setupQuotePath)}>
                  Request a machine-fit quote <ArrowRight aria-hidden="true" className="ml-2 h-5 w-5" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </article>
    </Layout>
  );
}
