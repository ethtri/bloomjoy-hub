import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Calculator,
  Check,
  Clock,
  Gauge,
  Plug,
  Ruler,
  ShieldCheck,
  Sparkles,
  Video,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Layout } from '@/components/layout/Layout';
import { ProductImageGallery } from '@/components/products/ProductImageGallery';
import { trackEvent } from '@/lib/analytics';
import { trackBuyerFlowPlaybookLinkClick } from '@/lib/businessPlaybookAnalytics';
import { MACHINE_NAMES } from '@/lib/machineNames';
import { miniMachineFaqs } from '@/lib/seoRoutes';
import miniMain from '@/assets/real/mini-main.webp';
import miniGallery1 from '@/assets/real/mini-gallery-1.webp';
import miniGallery2 from '@/assets/real/mini-gallery-2.webp';
import miniGallery3 from '@/assets/real/mini-gallery-3.webp';

const miniImages = [
  { src: miniMain, alt: 'Mini machine main view' },
  { src: miniGallery1, alt: 'Mini machine product design and pattern samples' },
  { src: miniGallery2, alt: 'Mini machine full-size specifications' },
  { src: miniGallery3, alt: 'Mini machine technical specifications' },
];

const miniFitNotes = [
  'Portable footprint for operators who do not need the full commercial cabinet.',
  'Most complex patterns are supported, but stick handling remains manual.',
  'Best for mobile setups, smaller venues, and buyer trials where space is a constraint.',
];

const miniPlanningNotes = [
  'Mini is available now at a $4,000 baseline machine price.',
  'Shipping and final configuration are confirmed during quote review.',
  'Use the quote form to confirm venue fit, operator handoff, and opening supplies.',
];

const specHighlights = [
  { label: 'Cycle Guidance', value: '~90s per candy', icon: Clock },
  { label: 'Planning Capacity', value: '~40/hour', icon: Gauge },
  { label: 'Footprint', value: '430 x 555 mm', icon: Ruler },
  { label: 'Height', value: '1582 mm', icon: Ruler },
  { label: 'Weight', value: '83.9 kg', icon: Ruler },
  { label: 'Power', value: '110V/220V', icon: Plug },
];

const technicalSpecs = [
  { item: 'Dimensions (W x D x H)', value: '430 x 555 x 1582 mm' },
  { item: 'Machine Weight', value: '83.9 kg' },
  { item: 'Rated Voltage', value: 'AC 110V/220V' },
  { item: 'Maximum Power', value: '2400W' },
  { item: 'Standby Power', value: '100W' },
  { item: 'Pattern / Flavor Support', value: '18 flower patterns / 4 flavors' },
  { item: 'Owner-Provided Cycle Guidance', value: '~90 seconds per candy' },
  { item: 'Planning Capacity', value: '~40 candies/hour machine-cycle capacity before staff and customer-flow effects' },
];

const proofClips = [
  {
    title: 'Real operation cycle',
    description:
      'A public Mini operation clip so buyers can see the machine rhythm, movement, and output style before a quote call.',
    src: '/media/mini/mini-operation-proof.mp4',
    poster: '/media/mini/mini-operation-poster.jpg',
  },
  {
    title: 'Manual stick handoff',
    description:
      'Close chamber footage showing the manual stick path and finished-serving handoff area inside the Mini cabinet.',
    src: '/media/mini/mini-manual-stick-handoff.mp4',
    poster: '/media/mini/mini-manual-stick-handoff-poster.jpg',
  },
  {
    title: 'Compact operation close-up',
    description:
      'A short close-up of Mini running in a compact setup so teams can evaluate cabinet access, motion, and guest-facing feel.',
    src: '/media/mini/mini-compact-operation-closeup.mp4',
    poster: '/media/mini/mini-compact-operation-closeup-poster.jpg',
  },
];

const throughputNotes = [
  'Plan from roughly one candy every 90 seconds, or about 40 candies per hour of machine-cycle capacity.',
  'Real serving throughput changes with manual stick feeding, guest/payment flow, pattern choice, staffing, setup, and how much conversation is part of the experience.',
  'For compact or lower-volume environments, quote review should confirm whether the service model is a staffed amenity, scheduled pop-up, or occasional guest surprise.',
];

const compactFitNotes = [
  'Compact cabinet footprint works better for tighter front-of-house or hospitality spaces than the full commercial cabinet.',
  'Mini still needs a real power plan, a stable placement, service access, and a cleaning path that fits the environment.',
  'Because cotton candy creates motion, aroma, and some operating sound, quiet or appointment-based venues should review the clips and confirm guest-experience fit before purchase.',
  'Manual stick feeding means a staff member owns each serving; Mini is not a passive vending placement.',
];

const economicsInputs = [
  'Planned selling price per serving or package',
  'Sugar, paper sticks, packaging, and payment fees',
  'Staffing, setup, cleanup, travel, or site-service time',
  'Opening supplies, accessories, delivery, and operating buffer',
  'Payment hardware such as Square if charging on site; Mini does not include a card reader',
  'Any rent, event fee, venue share, or hospitality program cost',
];

const planningEstimates = [
  {
    label: 'Staffed service pace',
    value: '25-35 servings/hour staffed',
    basis:
      'Planning estimate below the ~40/hour machine-cycle ceiling after manual stick feeding, guest/payment flow, pattern choice, and resets.',
  },
  {
    label: 'Curated service planning',
    value: 'Below staffed event pace',
    basis:
      'Use the 90-second machine cycle as the ceiling, then discount for manual stick handling, guest interaction, payment flow, pattern choice, and resets. Confirm the target service window during quote review.',
  },
  {
    label: 'Initial staff ramp',
    value: 'Plan a practice block',
    basis:
      'Staff should practice setup, stick handling, guest handoff, reset, and close-down with onboarding materials before serving guests.',
  },
  {
    label: 'Daily cleaning/reset',
    value: '5-10 minutes',
    basis:
      'Planning estimate for wipe-down and debris checks around the burner, bowl, output path, and stick-handling surfaces.',
  },
  {
    label: 'Routine maintenance',
    value: '~15 days; 20-30 minutes',
    basis:
      'Manufacturer-platform maintenance rhythm used for Sunze cotton candy machines; confirm Mini-specific steps during onboarding.',
  },
  {
    label: 'Sound and aroma check',
    value: 'Confirm in room',
    basis:
      'Mini has fan, motor, spinner motion, and cotton-candy aroma. Quiet venues should review clips and test placement before purchase.',
  },
];

const servingEconomicsEstimates = [
  {
    label: 'Sugar',
    value: '~$0.15-$0.30 / serving',
    basis: 'Planning range from Bloomjoy sugar pricing and typical small-serving sugar portions.',
  },
  {
    label: 'Paper stick',
    value: '~$0.07 / serving',
    basis: 'Bloomjoy branded sticks are currently priced by the box at 2,000 pieces.',
  },
  {
    label: 'Consumables subtotal',
    value: '~$0.35-$0.50 / serving',
    basis: 'Sugar, stick, and a small buffer for waste or light packaging; excludes labor, venue cost, payment fees, and machine cost.',
  },
  {
    label: 'Payment fees',
    value: 'Often ~3% + fixed fee',
    basis: 'Depends on the operator payment processor and hardware; Mini does not include a card reader.',
  },
  {
    label: 'Price input to model',
    value: '~$7-$10 / serving',
    basis: 'Use as a scenario range, not market advice; the public planner also includes an $8 example input.',
  },
];

const operationalFit = [
  {
    title: 'Staff Training',
    detail:
      'Plan a practice block before serving guests. Bloomjoy Plus adds task-based training, setup guides, maintenance checklists, and the Operator Essentials certificate path.',
    icon: Sparkles,
  },
  {
    title: 'Manual Serving Model',
    detail:
      'Mini does not include automatic stick dispensing. Staff manually feed each stick and should own line flow, guest handoff, and reset between servings.',
    icon: AlertCircle,
  },
  {
    title: 'Cleaning Rhythm',
    detail:
      'Plan a 5-10 minute daily close/reset estimate for wipe-down and debris checks around the burner, bowl, output path, sugar areas, and stick-handling surfaces before the machine is closed or moved.',
    icon: Wrench,
  },
  {
    title: 'Routine Maintenance',
    detail:
      'Use the same planning rhythm as the Commercial Machine for routine maintenance: about every 15 days, usually 20-30 minutes, then confirm Mini-specific details during onboarding.',
    icon: Gauge,
  },
];

const reliabilityNotes = [
  'Mini sits in the same core operating and support family as the Commercial Machine, packaged into a smaller cabinet and manual-stick service model.',
  'Machine warranty coverage follows the same public posture as Commercial: up to 1.5 years, with final terms confirmed during quote and handoff.',
  'Manufacturer support provides 24/7 first-line remote technical support via WeChat for diagnostics, troubleshooting, warranty service, and replacement-part workflow.',
  'Manufacturer remote response timing depends on channel availability, time zone, and issue context; Bloomjoy concierge support helps triage, translate, escalate, and coordinate parts during US business hours.',
  'Common operator checks include dry sugar feed, sugar fill level and cap seal, paper-stick position, output path debris, sugar pickup or sensor areas, and burner/spinner residue.',
  'Replacement-part availability and cost are confirmed case by case after remote diagnosis; Bloomjoy helps keep parts requests tied to the support workflow.',
];

const sourceBasisNotes = [
  'Exact dimensions, weight, power, pattern count, and 90-second cycle guidance come from Bloomjoy Mini materials and owner-provided operating guidance.',
  'Maintenance and support planning uses Sunze public cotton candy machine guidance where it applies to the shared operating family.',
  'Throughput, sound, training, cleaning, and serving-cost assumptions are planning inputs until Bloomjoy has measured Mini field data for a specific setting.',
];

export default function MiniPage() {
  useEffect(() => {
    trackEvent('view_product_mini');
  }, []);

  const handleRequestQuote = () => {
    trackEvent('click_request_quote_mini');
  };

  return (
    <Layout>
      <div className="border-b border-border bg-muted/30">
        <div className="container-page py-3">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/machines" className="hover:text-foreground">Machines</Link>
            <span>/</span>
            <span className="text-foreground">{MACHINE_NAMES.mini}</span>
          </nav>
        </div>
      </div>

      <section className="section-padding">
        <div className="container-page">
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <ProductImageGallery images={miniImages} />
            </div>

            <div>
              <span className="rounded-full bg-sage-light px-3 py-1 text-sm font-semibold text-sage">
                Available Now
              </span>
              <h1 className="mt-4 font-display text-3xl font-bold text-foreground sm:text-4xl">
                Bloomjoy Sweets {MACHINE_NAMES.mini}
              </h1>
              <p className="mt-2 font-display text-3xl font-bold text-primary">
                $4,000
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Baseline machine price; shipping and final configuration are quoted separately.
              </p>

              <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
                Portable robotic cotton candy machine at 1/5 the size of our commercial unit.
                Mini is available now for operators who want Bloomjoy pattern capability in a
                smaller footprint, with quote review used to confirm configuration, shipping, and
                onboarding before finalizing the order.
              </p>

              <div className="mt-6 rounded-lg border border-sage/20 bg-sage-light/40 p-4">
                <p className="font-semibold text-foreground">Performance planning guidance</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Owner-provided operating guidance is roughly one candy every 90 seconds, or about
                  40 candies per hour of machine-cycle capacity before staff pace, manual stick
                  feeding, guest/payment flow, and setup conditions are factored in.
                </p>
              </div>

              <div className="mt-8 space-y-4">
                <Link
                  to="/contact?type=quote&interest=mini&source=%2Fmachines%2Fmini"
                  onClick={handleRequestQuote}
                >
                  <Button variant="hero" size="xl" className="w-full">
                    Request a Quote
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
                <p className="text-center text-sm text-muted-foreground">
                  Mini orders are handled through our quote flow so we can confirm fit, shipping,
                  and operator handoff details before invoicing.
                </p>
              </div>

              <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <p className="font-semibold text-foreground">Thinking events or catering?</p>
                    <Link
                      to="/resources/business-playbook/mini-micro-event-catering-business-guide"
                      onClick={() =>
                        trackBuyerFlowPlaybookLinkClick({
                          surface: 'mini_machine_page',
                          cta: 'mini_event_business_guide',
                          href: '/resources/business-playbook/mini-micro-event-catering-business-guide',
                          machine: MACHINE_NAMES.mini,
                        })
                      }
                      className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                    >
                      Read the Mini event business guide
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <div className="mt-2 grid gap-1">
                      <Link
                        to="/resources/business-playbook/payback-planner"
                        onClick={() =>
                          trackBuyerFlowPlaybookLinkClick({
                            surface: 'mini_machine_page',
                            cta: 'mini_payback_scenario_planner',
                            href: '/resources/business-playbook/payback-planner',
                            machine: MACHINE_NAMES.mini,
                          })
                        }
                        className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                      >
                        Model event payback assumptions
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                      <Link
                        to="/resources/business-playbook/cotton-candy-machine-roi-sales-payback-planning"
                        onClick={() =>
                          trackBuyerFlowPlaybookLinkClick({
                            surface: 'mini_machine_page',
                            cta: 'mini_roi_payback_guide',
                            href: '/resources/business-playbook/cotton-candy-machine-roi-sales-payback-planning',
                            machine: MACHINE_NAMES.mini,
                          })
                        }
                        className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                      >
                        Read the ROI and payback guide
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-10">
                <h3 className="font-display text-lg font-semibold text-foreground">Features</h3>
                <ul className="mt-4 space-y-3">
                  {[
                    'Portable design (1/5 size of commercial)',
                    'Most complex pattern capabilities',
                    'Ideal for mobile operators',
                    'Compact footprint for small venues',
                  ].map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sage-light">
                        <Check className="h-3 w-3 text-sage" />
                      </div>
                      <span className="text-sm text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-8">
                <h3 className="font-display text-lg font-semibold text-foreground">Limitations</h3>
                <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber/20 bg-amber/5 p-4">
                  <AlertCircle className="h-5 w-5 shrink-0 text-amber" />
                  <span className="text-sm text-muted-foreground">
                    No automatic stick dispenser; operator manually feeds each stick per order.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-muted/25 py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-background p-6">
              <h2 className="font-display text-2xl font-bold text-foreground">
                Best Fit
              </h2>
              <ul className="mt-5 space-y-3">
                {miniFitNotes.map((note) => (
                  <li key={note} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sage-light">
                      <Check className="h-3 w-3 text-sage" />
                    </div>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-border bg-background p-6">
              <h2 className="font-display text-2xl font-bold text-foreground">
                Purchase Expectations
              </h2>
              <ul className="mt-5 space-y-3">
                {miniPlanningNotes.map((note) => (
                  <li key={note} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Check className="h-3 w-3 text-primary" />
                    </div>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-background py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
                Specs and Throughput Planning
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                Mini planning details in readable form so buyers do not have to rely on image-only
                sales-sheet specs.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link to="/resources/business-playbook/payback-planner">
                Model the math
                <Calculator className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {specHighlights.map((highlight) => (
              <div key={highlight.label} className="rounded-xl border border-border bg-background p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <highlight.icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {highlight.label}
                    </p>
                    <p className="mt-1 font-display text-xl font-bold text-foreground">
                      {highlight.value}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 overflow-hidden rounded-xl border border-border bg-background">
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <tbody>
                  {technicalSpecs.map((row) => (
                    <tr key={row.item} className="border-b border-border last:border-b-0">
                      <th className="w-[38%] bg-muted/30 px-4 py-3 text-left font-semibold text-foreground">
                        {row.item}
                      </th>
                      <td className="px-4 py-3 text-muted-foreground">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-border bg-muted/25 p-5">
            <h3 className="font-display text-lg font-semibold text-foreground">
              What the 90-second cycle means in practice
            </h3>
            <ul className="mt-4 grid gap-3 lg:grid-cols-3">
              {throughputNotes.map((note) => (
                <li key={note} className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground">
                  <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6 overflow-hidden rounded-xl border border-border bg-background">
            <div className="border-b border-border bg-muted/30 px-4 py-3">
              <h3 className="font-display text-lg font-semibold text-foreground">
                Operating assumptions for quote review
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Use these inputs to size staffing, cleaning, service flow, and placement.
                They are planning assumptions, not guaranteed performance claims.
              </p>
            </div>
            <div className="divide-y divide-border md:hidden">
              {planningEstimates.map((estimate) => (
                <div key={estimate.label} className="px-4 py-4">
                  <div className="text-sm font-semibold text-foreground">
                    {estimate.label}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-foreground">
                    {estimate.value}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {estimate.basis}
                  </p>
                </div>
              ))}
            </div>
            <div className="hidden md:block">
              <table className="min-w-full border-collapse text-sm">
                <tbody>
                  {planningEstimates.map((estimate) => (
                    <tr key={estimate.label} className="border-b border-border last:border-b-0">
                      <th className="w-[30%] bg-muted/20 px-4 py-3 text-left align-top font-semibold text-foreground">
                        {estimate.label}
                      </th>
                      <td className="w-[24%] px-4 py-3 align-top font-semibold text-foreground">
                        {estimate.value}
                      </td>
                      <td className="px-4 py-3 align-top text-muted-foreground">
                        {estimate.basis}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-muted/20 py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              Real-world preview
            </p>
            <h2 className="mt-3 font-display text-2xl font-bold text-foreground sm:text-3xl">
              Public Mini proof clips
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Use these short clips to evaluate service rhythm, manual stick handling, cabinet
              access, and guest-facing motion before the quote conversation.
            </p>
          </div>

          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            {proofClips.map((clip) => (
              <figure
                key={clip.title}
                className="mx-auto w-full max-w-[340px] overflow-hidden rounded-xl border border-border bg-background shadow-sm"
              >
                <div className="mx-auto aspect-[9/16] max-h-[560px] bg-muted lg:max-h-[500px]">
                  <video
                    className="h-full w-full object-contain"
                    controls
                    playsInline
                    preload="none"
                    poster={clip.poster}
                  >
                    <source src={clip.src} type="video/mp4" />
                  </video>
                </div>
                <figcaption className="p-4">
                  <div className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
                    <Video className="h-5 w-5 text-primary" />
                    {clip.title}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {clip.description}
                  </p>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-background py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
            <section className="min-w-0 rounded-xl border border-border bg-background p-6 shadow-sm lg:p-8">
              <h2 className="font-display text-2xl font-bold text-foreground">
                Compact Venue and Hospitality Fit
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Mini can be evaluated for staffed, compact guest-experience settings where
                footprint, service rhythm, and the operating environment matter as much as raw
                throughput.
              </p>
              <ul className="mt-5 space-y-3">
                {compactFitNotes.map((note) => (
                  <li key={note} className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sage-light">
                      <Check className="h-3 w-3 text-sage" />
                    </div>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="min-w-0 rounded-xl border border-border bg-muted/25 p-6 lg:p-8">
              <h2 className="font-display text-2xl font-bold text-foreground">
                Unit-Economics Inputs
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Bloomjoy does not promise ROI, sales volume, or payback dates. Use the public
                planner to pressure-test the assumptions that would need to be true for your
                setting.
              </p>
              <ul className="mt-5 space-y-3">
                {economicsInputs.map((input) => (
                  <li key={input} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Check className="h-3 w-3 text-primary" />
                    </div>
                    <span>{input}</span>
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-6 h-auto w-full whitespace-normal text-center sm:w-auto">
                <Link to="/resources/business-playbook/payback-planner">
                  Open Payback Scenario Planner
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>

              <div className="mt-6 overflow-hidden rounded-xl border border-border bg-background">
                <div className="border-b border-border bg-muted/30 px-4 py-3">
                  <h3 className="font-display text-lg font-semibold text-foreground">
                    Cost and price assumptions to model
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    These are scenario inputs for a worksheet, not market advice or a promise of
                    sales volume, ROI, or payback period.
                  </p>
                </div>
                <div className="divide-y divide-border md:hidden">
                  {servingEconomicsEstimates.map((estimate) => (
                    <div key={estimate.label} className="px-4 py-4">
                      <div className="text-sm font-semibold text-foreground">
                        {estimate.label}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-foreground">
                        {estimate.value}
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {estimate.basis}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="hidden md:block">
                  <table className="min-w-full border-collapse text-sm">
                    <tbody>
                      {servingEconomicsEstimates.map((estimate) => (
                        <tr key={estimate.label} className="border-b border-border last:border-b-0">
                          <th className="w-[28%] bg-muted/20 px-4 py-3 text-left align-top font-semibold text-foreground">
                            {estimate.label}
                          </th>
                          <td className="w-[26%] px-4 py-3 align-top font-semibold text-foreground">
                            {estimate.value}
                          </td>
                          <td className="px-4 py-3 align-top text-muted-foreground">
                            {estimate.basis}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-muted/20 py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="min-w-0">
              <h2 className="font-display text-2xl font-bold text-foreground">
                Operational Fit
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Mini is a smaller, staffed operating model. The day-to-day rhythm should be planned
                before delivery so the machine fits the customer experience and the team operating it.
              </p>
              <div className="mt-6 grid gap-4">
                {operationalFit.map((item) => (
                  <div key={item.title} className="rounded-xl border border-border bg-background p-5 shadow-sm">
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <item.icon className="h-5 w-5" />
                      </span>
                      <div>
                        <h3 className="font-display text-lg font-semibold text-foreground">
                          {item.title}
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                          {item.detail}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="min-w-0 rounded-xl border border-border bg-background p-6 shadow-sm lg:p-8">
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-sage-light text-sage">
                  <ShieldCheck className="h-6 w-6" />
                </span>
                <div>
                  <h2 className="font-display text-2xl font-bold text-foreground">
                    Reliability and Support
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Component, warranty, and support details should be confirmed during quote
                    review, but the public support posture is aligned with the Commercial Machine.
                  </p>
                </div>
              </div>
              <ul className="mt-6 space-y-4">
                {reliabilityNotes.map((note) => (
                  <li key={note} className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sage-light">
                      <Check className="h-3 w-3 text-sage" />
                    </div>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 rounded-lg border border-border bg-muted/25 p-4">
                <h3 className="font-display text-base font-semibold text-foreground">
                  Source and estimate basis
                </h3>
                <ul className="mt-3 space-y-2">
                  {sourceBasisNotes.map((note) => (
                    <li key={note} className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                      <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        </div>
      </section>

      <section id="faq" className="border-t border-border bg-background py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="mx-auto max-w-3xl">
            <h2 className="font-display text-2xl font-bold text-foreground">
              Mini Machine FAQs
            </h2>
            <Accordion
              type="multiple"
              defaultValue={miniMachineFaqs.map((_, index) => `mini-faq-${index}`)}
              className="mt-6"
            >
              {miniMachineFaqs.map((faq, index) => (
                <AccordionItem key={faq.q} value={`mini-faq-${index}`}>
                  <AccordionTrigger className="text-left font-medium">{faq.q}</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>
    </Layout>
  );
}
