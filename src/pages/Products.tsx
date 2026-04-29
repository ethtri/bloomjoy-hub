import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { trackEvent } from '@/lib/analytics';
import { trackBuyerFlowPlaybookLinkClick } from '@/lib/businessPlaybookAnalytics';
import { MACHINE_NAMES } from '@/lib/machineNames';
import { machineBuyerFaqs } from '@/lib/seoRoutes';
import commercialMain from '@/assets/real/commercial-main.jpg';
import miniMain from '@/assets/real/mini-main.webp';
import microMain from '@/assets/real/micro-main.webp';

const machineProducts = [
  {
    sku: 'commercial-robotic',
    name: MACHINE_NAMES.commercial,
    price: 'From $6,250',
    description: 'Full-size commercial unit with automatic stick dispensing, complex patterns, and Commercial-only custom wrap via quote.',
    href: '/machines/commercial-robotic-machine',
    image: commercialMain,
    badge: 'Most Popular',
  },
  {
    sku: 'mini',
    name: MACHINE_NAMES.mini,
    price: '$4,000',
    description: 'Portable at 1/5 the size. Most complex patterns supported. Manual stick feeding.',
    href: '/machines/mini',
    image: miniMain,
    badge: 'Available Now',
  },
  {
    sku: 'micro',
    name: MACHINE_NAMES.micro,
    price: '$2,200',
    description: 'Entry-level machine for basic shapes. Perfect for low-volume applications.',
    href: '/machines/micro',
    image: microMain,
    badge: null,
  },
];

const comparisonRows = [
  {
    model: MACHINE_NAMES.commercial,
    fit: 'High-traffic venues, retail locations, entertainment sites, and event operations',
    capability: 'Automatic stick dispensing, 64 preset patterns, four sugar colors',
    buyingPath: 'Quote-led purchase starting from $6,250 before add-ons and shipping',
  },
  {
    model: MACHINE_NAMES.mini,
    fit: 'Mobile operators and smaller venues that need a portable footprint',
    capability: 'Manual stick feeding with most complex pattern capabilities',
    buyingPath: 'Quote-led purchase at $4,000 before shipping and final configuration',
  },
  {
    model: MACHINE_NAMES.micro,
    fit: 'Basic-shape, low-volume applications where compact size matters most',
    capability: 'Entry-level robotic cotton candy operation for simple shapes',
    buyingPath: 'Quote-led purchase at $2,200 before shipping and final configuration',
  },
];

const buyerSteps = [
  'Compare the commercial, Mini, and Micro machines by venue type, throughput expectations, footprint, and pattern needs.',
  'Request a quote with your target location, model, timeline, and supply needs.',
  'Bloomjoy confirms fit, shipping assumptions, support boundaries, and operator handoff before invoicing.',
];

export default function ProductsPage() {
  useEffect(() => {
    trackEvent('view_product_commercial_robotic');
  }, []);

  return (
    <Layout>
      {/* Hero */}
      <section className="bg-gradient-to-b from-cream to-background py-12 sm:py-14 lg:py-16">
        <div className="container-page text-center">
          <h1 className="font-display text-4xl font-bold text-foreground sm:text-5xl">
            Robotic Cotton Candy Machines for Operators
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Compare commercial robotic cotton candy machines by footprint, pattern capability,
            use case, supplies, support, and quote path before you buy.
          </p>
        </div>
      </section>

      <section className="border-b border-border bg-background py-6">
        <div className="container-page">
          <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold text-foreground">
                Still choosing the right business model?
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Read the Bloomjoy Business Playbook before you compare machines by price alone.
              </p>
            </div>
            <Link
              to="/resources/business-playbook/commercial-vending-vs-event-catering"
              onClick={() =>
                trackBuyerFlowPlaybookLinkClick({
                  surface: 'machine_listing',
                  cta: 'compare_vending_and_events',
                  href: '/resources/business-playbook/commercial-vending-vs-event-catering',
                  machine: 'all',
                })
              }
              className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
            >
              Compare vending and events
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Machines */}
      <section className="py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="max-w-3xl">
            <h2 className="font-display text-2xl font-bold text-foreground">
              Choose the machine that fits your operation
            </h2>
            <p className="mt-3 text-muted-foreground">
              Bloomjoy machine purchases are quote-led so we can confirm configuration, shipping,
              onboarding, and support expectations before finalizing the order.
            </p>
          </div>
          <div className="mt-8 grid gap-8 md:grid-cols-3">
            {machineProducts.map((product) => (
              <Link
                key={product.sku}
                to={product.href}
                className="group card-elevated overflow-hidden transition-[box-shadow,transform] duration-200 hover:-translate-y-1"
              >
                <div className="aspect-square overflow-hidden bg-muted">
                  <img
                    src={product.image}
                    alt={product.name}
                    width={520}
                    height={520}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-contain p-3 transition-transform duration-300 group-hover:scale-105"
                  />
                </div>
                <div className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-display text-lg font-semibold text-foreground group-hover:text-primary">
                        {product.name}
                      </h3>
                      <p className="mt-1 font-display text-xl font-bold text-primary">
                        {product.price}
                      </p>
                    </div>
                    {product.badge && (
                      <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                        {product.badge}
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{product.description}</p>
                  <div className="mt-4 flex items-center text-sm font-semibold text-primary">
                    View details
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-muted/25 py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-bold text-foreground">
                Machine buyer comparison
              </h2>
              <p className="mt-3 max-w-3xl text-muted-foreground">
                Use this comparison to narrow the first conversation. Final configuration,
                payment setup, delivery, and operator handoff are confirmed during quote review.
              </p>
              <div className="mt-6 overflow-hidden rounded-lg border border-border bg-background">
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="px-4 py-3 font-semibold text-foreground">Model</th>
                        <th className="px-4 py-3 font-semibold text-foreground">Best fit</th>
                        <th className="px-4 py-3 font-semibold text-foreground">Capability</th>
                        <th className="px-4 py-3 font-semibold text-foreground">Buying path</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonRows.map((row) => (
                        <tr key={row.model} className="border-t border-border">
                          <th className="px-4 py-3 text-left font-semibold text-foreground">
                            {row.model}
                          </th>
                          <td className="px-4 py-3 text-muted-foreground">{row.fit}</td>
                          <td className="px-4 py-3 text-muted-foreground">{row.capability}</td>
                          <td className="px-4 py-3 text-muted-foreground">{row.buyingPath}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <aside className="min-w-0 rounded-lg border border-border bg-background p-5">
              <h3 className="font-display text-lg font-semibold text-foreground">
                Quote expectations
              </h3>
              <ol className="mt-4 space-y-3 text-sm text-muted-foreground">
                {buyerSteps.map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        </div>
      </section>

      <section className="py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="mx-auto max-w-3xl">
            <h2 className="font-display text-2xl font-bold text-foreground">
              Robotic cotton candy machine FAQs
            </h2>
            <Accordion
              type="multiple"
              defaultValue={machineBuyerFaqs.map((_, index) => `machine-faq-${index}`)}
              className="mt-6"
            >
              {machineBuyerFaqs.map((faq, index) => (
                <AccordionItem key={faq.q} value={`machine-faq-${index}`}>
                  <AccordionTrigger className="text-left font-medium">{faq.q}</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">{faq.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      {/* Supplies Callout */}
      <section className="bg-muted/50 py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="card-elevated flex flex-col items-center gap-6 p-8 text-center md:flex-row md:text-left">
            <div className="flex-1">
              <h2 className="font-display text-2xl font-bold text-foreground">
                Need Supplies?
              </h2>
              <p className="mt-2 text-muted-foreground">
                Premium sugar and sticks for all Bloomjoy machines.
              </p>
            </div>
            <Link
              to="/supplies"
              className="inline-flex items-center gap-2 font-semibold text-primary hover:underline"
            >
              Shop Supplies
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
