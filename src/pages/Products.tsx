import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { trackEvent } from '@/lib/analytics';
import { trackBuyerFlowPlaybookLinkClick } from '@/lib/businessPlaybookAnalytics';
import { MACHINE_NAMES } from '@/lib/machineNames';
import { machineBuyerFaqs } from '@/lib/seoRoutes';
import { isMicroCheckoutEnabled } from '@/lib/commerceAvailability';
import { FOOD_TRUCK_SOLUTION_PATH } from '@/data/mobileOperatorPages';
import { plannerPath } from '@/data/businessPlaybookPlanner';
import commercialMain from '@/assets/real/commercial-main.jpg';
import miniMain from '@/assets/real/mini-main.webp';
import microMain from '@/assets/real/micro-main.webp';

const machineProducts = [
  {
    sku: 'commercial-robotic',
    name: MACHINE_NAMES.commercial,
    price: 'Request a quote',
    description: 'Full-size commercial unit with automatic stick dispensing, complex patterns, and Commercial-only custom wrap via quote.',
    href: '/machines/commercial-robotic-machine',
    image: commercialMain,
    badge: 'Quote available',
  },
  {
    sku: 'mini',
    name: MACHINE_NAMES.mini,
    price: '$4,000',
    description: 'Portable at 1/5 the size, with manual stick feeding. Coming soon.',
    href: '/machines/mini',
    image: miniMain,
    badge: 'Coming Soon',
  },
  {
    sku: 'micro',
    name: MACHINE_NAMES.micro,
    price: '$2,200',
    description: 'Entry-level machine for basic shapes. Perfect for low-volume applications.',
    href: '/machines/micro',
    image: microMain,
    badge: isMicroCheckoutEnabled ? 'Buy Online' : 'Not yet available',
  },
];

const comparisonRows = [
  {
    model: MACHINE_NAMES.commercial,
    href: '/machines/commercial-robotic-machine',
    fit: 'High-traffic venues, retail locations, entertainment sites, and event operations',
    capability: 'Automatic stick dispensing, 64 preset patterns, four sugar colors',
    buyingPath: 'Quote required; final pricing depends on configuration, wrap, shipping, and delivery',
  },
  {
    model: MACHINE_NAMES.mini,
    href: '/machines/mini',
    fit: 'Mobile operators and smaller venues that need a portable footprint',
    capability: 'Manual stick feeding with most complex pattern capabilities',
    buyingPath: 'Coming soon · $4,000 expected price',
  },
  {
    model: MACHINE_NAMES.micro,
    href: '/machines/micro',
    fit: 'Basic-shape, low-volume applications where compact size matters most',
    capability: 'Entry-level robotic cotton candy operation for simple shapes',
    buyingPath: isMicroCheckoutEnabled
      ? 'Order online for $2,200; delivery coordinated after payment'
      : 'Not yet available to order · $2,200 planning price',
  },
];

const buyerSteps = [
  'Compare the commercial, Mini, and Micro machines by venue type, throughput expectations, footprint, and pattern needs.',
  isMicroCheckoutEnabled
    ? 'Buy the available Micro Machine online, or request a quote only for the Commercial Machine.'
    : 'Micro is not yet available to order. Request a Commercial quote to discuss an available machine path.',
  'Allow for supplies, delivery, setup, and local operating requirements in your budget.',
];

export default function ProductsPage() {
  useEffect(() => {
    trackEvent('view_product_commercial_robotic');
  }, []);

  return (
    <Layout>
      {/* Hero */}
      <section className="bg-gradient-to-b from-cream to-background py-8 sm:py-12">
        <div className="container-page text-center">
          <h1 className="font-display text-3xl font-bold text-foreground sm:text-5xl">
            Compare Robotic Cotton Candy Machines
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Find the right fit for your venue, service model, and budget.
          </p>
        </div>
      </section>

      <section className="border-y border-border bg-muted/25 py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="grid gap-8">
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-bold text-foreground">
                Compare at a glance
              </h2>
              <p className="mt-3 max-w-3xl text-muted-foreground">
                Start with how you will serve. Commercial handles sticks automatically; Mini and Micro suit smaller, staffed operations.
              </p>
              <div className="mt-6 grid gap-3 md:hidden">
                {comparisonRows.map((row) => (
                  <article
                    key={row.model}
                    className="rounded-lg border border-border bg-background p-4"
                  >
                    <h3 className="font-display text-lg font-semibold text-foreground">
                      {row.model}
                    </h3>
                    <p className="mt-2 text-sm font-medium text-foreground">{row.buyingPath}</p>
                    <Link to={row.href} className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline">
                      View machine <ArrowRight className="h-4 w-4" />
                    </Link>
                    <dl className="mt-3 grid gap-3 text-sm">
                      <div>
                        <dt className="font-semibold text-foreground">Best fit</dt>
                        <dd className="mt-1 text-muted-foreground">{row.fit}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-foreground">Capability</dt>
                        <dd className="mt-1 text-muted-foreground">{row.capability}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
              <div className="mt-6 hidden overflow-hidden rounded-lg border border-border bg-background md:block">
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
                            <Link to={row.href} className="text-primary hover:underline">{row.model}</Link>
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
            <details className="min-w-0 rounded-lg border border-border bg-background p-5">
              <summary className="cursor-pointer font-display text-lg font-semibold text-foreground">
                What to plan before you buy
              </summary>
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
            </details>
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
              Explore each machine’s photos, operating details, and current availability.
            </p>
          </div>
          <div className="mt-8 grid gap-8 md:grid-cols-3">
            {machineProducts.map((product) => (
              <Link
                key={product.sku}
                to={product.href}
                className="group card-elevated grid grid-cols-[6rem_1fr] overflow-hidden md:block transition-[box-shadow,transform] duration-200 hover:-translate-y-1"
              >
                <div className="overflow-hidden bg-muted md:aspect-square">
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
                <div className="p-4 md:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-2">
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

      <section className="border-b border-border bg-background py-6">
        <div className="container-page">
          <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold text-foreground">
                Still choosing the right machine or business model?
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Start with the cost-only fit planner, then compare operating paths and product details.
              </p>
            </div>
            <div className="grid gap-2 sm:justify-items-end">
              <Link
                to={plannerPath}
                onClick={() =>
                  trackBuyerFlowPlaybookLinkClick({
                    surface: 'machine_listing',
                    cta: 'machine_fit_startup_budget_planner',
                    href: plannerPath,
                    machine: 'undecided',
                  })
                }
                className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
              >
                Find your machine path
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to={FOOD_TRUCK_SOLUTION_PATH}
                onClick={() =>
                  trackBuyerFlowPlaybookLinkClick({
                    surface: 'machine_listing',
                    cta: 'food_truck_machine_fit',
                    href: FOOD_TRUCK_SOLUTION_PATH,
                    machine: 'all',
                  })
                }
                className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
              >
                Compare food-truck machine fit
                <ArrowRight className="h-4 w-4" />
              </Link>
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
              <Link
                to="/resources/business-playbook/payback-planner"
                onClick={() =>
                  trackBuyerFlowPlaybookLinkClick({
                    surface: 'machine_listing',
                    cta: 'payback_scenario_planner',
                    href: '/resources/business-playbook/payback-planner',
                    machine: 'all',
                  })
                }
                className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
              >
                Plan payback scenarios
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
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
              className="mt-6"
            >
              {machineBuyerFaqs.map((faq, index) => (
                <AccordionItem key={faq.q} value={`machine-faq-${index}`}>
                  <AccordionTrigger className="text-left font-medium">{faq.q}</AccordionTrigger>
                  <AccordionContent forceMount className="text-muted-foreground data-[state=closed]:hidden">{faq.a}</AccordionContent>
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
