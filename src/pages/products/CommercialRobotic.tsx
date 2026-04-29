import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight, AlertCircle, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Layout } from '@/components/layout/Layout';
import { ProductImageGallery } from '@/components/products/ProductImageGallery';
import { trackEvent } from '@/lib/analytics';
import { MACHINE_NAMES } from '@/lib/machineNames';
import { commercialMachineFaqs } from '@/lib/seoRoutes';
import commercialMain from '@/assets/real/commercial-main.jpg';
import commercialGallery1 from '@/assets/real/commercial-gallery-1.webp';
import commercialGallery2 from '@/assets/real/commercial-gallery-2.webp';
import commercialGallery3 from '@/assets/real/commercial-gallery-3.webp';
import commercialCerts from '@/assets/real/commercial-certs.png';
import commercialMenu64 from '@/assets/real/commercial-menu64.jpg';

const commercialImages = [
  { src: commercialMain, alt: 'Commercial robotic machine main view' },
  { src: commercialGallery1, alt: 'Commercial machine product highlight' },
  { src: commercialGallery2, alt: 'Commercial machine diagram view' },
  { src: commercialGallery3, alt: 'Commercial machine size and weight chart' },
];

const operationalHighlights = [
  {
    title: 'Payment Flexibility',
    detail:
      'Supports card-reader integrations plus local bank credit/debit cards and common mobile wallets, based on deployment needs.',
  },
  {
    title: 'Remote Operations Dashboard',
    detail:
      'Monitor sales, machine status, scheduling, and key operational settings from a remote management app.',
  },
  {
    title: 'Maintenance Rhythm',
    detail:
      'Typical routine maintenance is about every 15 days and can be completed in roughly 20-30 minutes.',
  },
  {
    title: 'Consumables',
    detail:
      'Runs on four sugar colors and paper sticks; both are standard items in the Bloomjoy supplies flow.',
  },
  {
    title: 'Warranty + Troubleshooting',
    detail:
      'Up to 1.5-year machine warranty, remote troubleshooting guidance, and replacement-part workflow for faster recovery.',
  },
];

const specHighlights = [
  { label: 'Pattern Library', value: '64 patterns' },
  { label: 'Flavor/Sugar Colors', value: '4 options' },
  { label: 'Candy Cycle Time', value: '70-130s per candy' },
  { label: 'Output Per Full Load', value: '200-250 candies' },
  { label: 'Machine Weight', value: '230kg' },
  { label: 'Display', value: '21.5-inch screen' },
];

const technicalSpecs = [
  { item: 'Power', value: 'AC 110V/220V, 2700W' },
  { item: 'Dimensions (H x W x D)', value: '2001 x 643 x 1315 mm or 2001 x 671 x 1332 mm' },
  { item: 'Weight', value: '230kg' },
  { item: 'Pattern Count', value: '64 preset patterns' },
  { item: 'Per-Candy Production Time', value: '70-130 seconds' },
  { item: 'Total Candies Per Full Material Load', value: '200-250 units' },
  { item: 'Water Refill Frequency', value: 'After approximately every 200 candies produced' },
  { item: 'Screen Size', value: '21.5 inches' },
];

const buyerUseCases = [
  'Entertainment venues and attractions that need a repeatable food-service spectacle.',
  'Retail, mall, and tourism locations where the machine must be visible and easy to operate.',
  'Event operators who want automatic stick dispensing and a deeper pattern menu.',
  'Operators planning branded placements where the Commercial-only custom wrap option matters.',
];

const quoteChecklist = [
  'Target venue type and expected daily or event volume',
  'Delivery location and timing requirements',
  'Preferred payment-reader or local payment needs',
  'Standard Bloomjoy wrap or Commercial-only custom wrap interest',
  'Opening sugar and paper-stick supply needs',
];

export default function CommercialRoboticPage() {
  const [activeDoc, setActiveDoc] = useState<{
    src: string;
    alt: string;
    title: string;
  } | null>(null);

  useEffect(() => {
    trackEvent('view_product_commercial_robotic');
  }, []);

  const handleRequestQuote = () => {
    trackEvent('click_request_quote_commercial');
  };

  return (
    <Layout>
      {/* Breadcrumb */}
      <div className="border-b border-border bg-muted/30">
        <div className="container-page py-3">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/machines" className="hover:text-foreground">Machines</Link>
            <span>/</span>
            <span className="text-foreground">{MACHINE_NAMES.commercial}</span>
          </nav>
        </div>
      </div>

      <section className="section-padding">
        <div className="container-page">
          <div className="grid gap-12 lg:grid-cols-2">
            {/* Image */}
            <div>
              <ProductImageGallery images={commercialImages} />
            </div>

            {/* Details */}
            <div>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                Most Popular
              </span>
              <h1 className="mt-4 font-display text-3xl font-bold text-foreground sm:text-4xl">
                Bloomjoy Sweets {MACHINE_NAMES.commercial}
              </h1>
              <p className="mt-2 font-display text-3xl font-bold text-primary">
                From $6,250
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Base machine price; add-ons and shipping are quoted separately.
              </p>

              <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
                Full-size commercial robotic cotton candy machine designed for high-throughput venues. Automated stick dispensing, complex pattern capabilities, and built for continuous operation. Commercial-only custom wrap is available with final design coordinated offline by the Bloomjoy design team.
              </p>

              <div className="mt-8 space-y-4">
                <Link
                  to="/contact?type=quote&interest=commercial-robotic-machine&source=%2Fmachines%2Fcommercial-robotic-machine"
                  onClick={handleRequestQuote}
                >
                  <Button variant="hero" size="xl" className="w-full">
                    Request a Quote
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
                <p className="text-center text-sm text-muted-foreground">
                  Standard Bloomjoy wrap and Commercial-only custom wrap are both available.
                </p>
                <p className="text-center text-sm text-muted-foreground">
                  Custom wrap artwork is finalized offline with the Bloomjoy design team.
                </p>
              </div>

              <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <p className="font-semibold text-foreground">Planning a location?</p>
                    <Link
                      to="/resources/business-playbook/best-locations-for-cotton-candy-vending-machines"
                      className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                    >
                      Read the Commercial location guide
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>

              {/* Features */}
              <div className="mt-10">
                <h3 className="font-display text-lg font-semibold text-foreground">Features</h3>
                <ul className="mt-4 space-y-3">
                  {[
                    'Automatic stick dispensing',
                    'Complex pattern capabilities',
                    'High throughput for events and venues',
                    'Built for continuous commercial operation',
                    'Wrap options: standard Bloomjoy wrap or Commercial-only custom wrap',
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

              {/* Ideal For */}
              <div className="mt-8">
                <h3 className="font-display text-lg font-semibold text-foreground">Ideal For</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Theme parks, entertainment venues, event operations, high-traffic retail locations, and operators seeking maximum throughput with minimal manual intervention.
                </p>
              </div>
            </div>
          </div>

          {/* Specs and Documentation */}
          <div className="mt-16">
            <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
              Specs and Documentation
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Commercial planning details presented in native, readable format.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {specHighlights.map((highlight) => (
                <div key={highlight.label} className="card-elevated p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {highlight.label}
                  </p>
                  <p className="mt-2 font-display text-2xl font-bold text-foreground">{highlight.value}</p>
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

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div className="card-elevated overflow-hidden p-4">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="font-display text-lg font-semibold text-foreground">Pattern Menu (64)</h3>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveDoc({
                        src: commercialMenu64,
                        alt: 'Commercial machine 64-pattern menu chart',
                        title: 'Pattern Menu (64)',
                      })
                    }
                    className="text-sm font-semibold text-primary hover:underline"
                  >
                    Open full size
                  </button>
                </div>
                <div className="mt-3 aspect-[4/3] overflow-hidden rounded-lg bg-muted">
                  <img
                    src={commercialMenu64}
                    alt="Commercial machine 64-pattern menu chart"
                    width={900}
                    height={675}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-contain p-2"
                  />
                </div>
              </div>

              <div className="card-elevated overflow-hidden p-4">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="font-display text-lg font-semibold text-foreground">Certification Snapshot</h3>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveDoc({
                        src: commercialCerts,
                        alt: 'Commercial machine certification documents snapshot',
                        title: 'Certification Snapshot',
                      })
                    }
                    className="text-sm font-semibold text-primary hover:underline"
                  >
                    Open full size
                  </button>
                </div>
                <div className="mt-3 aspect-[4/3] overflow-hidden rounded-lg bg-muted">
                  <img
                    src={commercialCerts}
                    alt="Commercial machine certification documents snapshot"
                    width={900}
                    height={675}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-contain p-2"
                  />
                </div>
              </div>
            </div>
          </div>

          <Dialog open={Boolean(activeDoc)} onOpenChange={(open) => !open && setActiveDoc(null)}>
            <DialogContent className="max-w-[95vw] border-none bg-transparent p-0 shadow-none">
              <DialogTitle className="sr-only">{activeDoc?.title ?? 'Document Preview'}</DialogTitle>
              <DialogDescription className="sr-only">
                Full-size preview for commercial machine supporting documentation.
              </DialogDescription>
              <div className="rounded-xl bg-background p-3">
                {activeDoc && (
                  <img
                    src={activeDoc.src}
                    alt={activeDoc.alt}
                    width={1200}
                    height={900}
                    decoding="async"
                    className="mx-auto max-h-[85vh] w-auto max-w-full object-contain"
                  />
                )}
              </div>
            </DialogContent>
          </Dialog>

          <div className="mt-16 grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-border bg-background p-6 lg:p-8">
              <h2 className="font-display text-2xl font-bold text-foreground">
                Use Cases
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                The Commercial Machine is the first machine to compare when volume, visual
                presentation, and automatic stick handling matter.
              </p>
              <ul className="mt-5 space-y-3">
                {buyerUseCases.map((useCase) => (
                  <li key={useCase} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sage-light">
                      <Check className="h-3 w-3 text-sage" />
                    </div>
                    <span>{useCase}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-xl border border-border bg-background p-6 lg:p-8">
              <h2 className="font-display text-2xl font-bold text-foreground">
                Quote Prep
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Bring these details into the quote request so Bloomjoy can confirm fit and next
                steps without guessing.
              </p>
              <ul className="mt-5 space-y-3">
                {quoteChecklist.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Check className="h-3 w-3 text-primary" />
                    </div>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* Operational details */}
          <div className="mt-16 rounded-xl border border-border bg-muted/30 p-6 lg:p-8">
            <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
              Operational Details
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Planning notes compiled from the commercial machine FAQ.
            </p>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {operationalHighlights.map((item) => (
                <div key={item.title} className="rounded-lg border border-border bg-background p-4">
                  <p className="font-semibold text-foreground">{item.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.detail}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Certification and payment integration availability can vary by region and final machine configuration; confirm current details during quote review.
            </p>
          </div>

          {/* Support Boundaries */}
          <div className="mt-16 rounded-xl border border-border bg-muted/50 p-6 lg:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber/10">
                <AlertCircle className="h-5 w-5 text-amber" />
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold text-foreground">
                  Support Structure
                </h3>
                <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                  <p>
                    <strong className="font-semibold text-foreground">Manufacturer Support:</strong>{' '}
                    24/7 first-line technical support via WeChat. Direct access to engineering team for machine diagnostics, troubleshooting, and warranty service.
                  </p>
                  <p>
                    <strong className="font-semibold text-foreground">Bloomjoy (Concierge):</strong>{' '}
                    Onboarding assistance, best-practice guidance, translation/escalation support. Available during US business hours (Mon-Fri, 9am-5pm EST). Not a 24/7 service.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <section id="faq" className="mt-16 scroll-mt-24">
            <div className="mx-auto max-w-3xl">
              <h2 className="font-display text-2xl font-bold text-foreground">
                Commercial robotic cotton candy machine FAQs
              </h2>
              <Accordion
                type="multiple"
                defaultValue={commercialMachineFaqs.map((_, index) => `commercial-faq-${index}`)}
                className="mt-6"
              >
                {commercialMachineFaqs.map((faq, index) => (
                  <AccordionItem key={faq.q} value={`commercial-faq-${index}`}>
                    <AccordionTrigger className="text-left font-medium">{faq.q}</AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">{faq.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </section>
        </div>
      </section>
    </Layout>
  );
}
