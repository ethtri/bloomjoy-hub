import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Layout } from '@/components/layout/Layout';
import { ProductImageGallery } from '@/components/products/ProductImageGallery';
import { trackEvent } from '@/lib/analytics';
import { MACHINE_NAMES } from '@/lib/machineNames';
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
    </Layout>
  );
}
