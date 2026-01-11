import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Layout } from '@/components/layout/Layout';
import { trackEvent } from '@/lib/analytics';
import heroMachine from '@/assets/hero-machine.jpg';

export default function CommercialRoboticPage() {
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
            <Link to="/products" className="hover:text-foreground">Products</Link>
            <span>/</span>
            <span className="text-foreground">Commercial Robotic Machine</span>
          </nav>
        </div>
      </div>

      <section className="section-padding">
        <div className="container-page">
          <div className="grid gap-12 lg:grid-cols-2">
            {/* Image */}
            <div>
              <div className="aspect-square overflow-hidden rounded-2xl bg-muted shadow-elevated-lg">
                <img
                  src={heroMachine}
                  alt="Bloomjoy Sweets Robotic Cotton Candy Machine"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>

            {/* Details */}
            <div>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                Most Popular
              </span>
              <h1 className="mt-4 font-display text-3xl font-bold text-foreground sm:text-4xl">
                Bloomjoy Sweets Robotic Cotton Candy Machine
              </h1>
              <p className="mt-2 font-display text-3xl font-bold text-primary">
                $10,000
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Price target, configurable based on requirements</p>

              <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
                Full-size commercial robotic cotton candy machine designed for high-throughput venues. Automated stick dispensing, complex pattern capabilities, and built for continuous operation.
              </p>

              <div className="mt-8 space-y-4">
                <Link to="/contact" onClick={handleRequestQuote}>
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
                    <strong className="font-semibold text-foreground">Sunze (Manufacturer):</strong>{' '}
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
