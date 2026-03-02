import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Layout } from '@/components/layout/Layout';
import { ProductImageGallery } from '@/components/products/ProductImageGallery';
import { trackEvent } from '@/lib/analytics';
import { MACHINE_NAMES } from '@/lib/machineNames';
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
                $10,000
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Price target, configurable based on requirements</p>

              <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
                Full-size commercial robotic cotton candy machine designed for high-throughput venues. Automated stick dispensing, complex pattern capabilities, and built for continuous operation.
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
                  Or{' '}
                  <button className="font-medium text-primary hover:underline">
                    Buy now
                  </button>{' '}
                  (placeholder checkout)
                </p>
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
                  <img src={commercialMenu64} alt="Commercial machine 64-pattern menu chart" className="h-full w-full object-contain p-2" />
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
                  <img src={commercialCerts} alt="Commercial machine certification documents snapshot" className="h-full w-full object-contain p-2" />
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
                    className="mx-auto max-h-[85vh] w-auto max-w-full object-contain"
                  />
                )}
              </div>
            </DialogContent>
          </Dialog>

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
                    Onboarding assistance, best-practice guidance, translation/escalation support. Available during US business hours (Mon–Fri, 9am–5pm EST). Not a 24/7 service.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
