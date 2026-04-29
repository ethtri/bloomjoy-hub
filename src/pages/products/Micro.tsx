import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, BookOpen, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Layout } from '@/components/layout/Layout';
import { ProductImageGallery } from '@/components/products/ProductImageGallery';
import { trackEvent } from '@/lib/analytics';
import { MACHINE_NAMES } from '@/lib/machineNames';
import microMain from '@/assets/real/micro-main.webp';
import microGallery1 from '@/assets/real/micro-gallery-1.webp';
import microGallery2 from '@/assets/real/micro-gallery-2.webp';
import microGallery3 from '@/assets/real/micro-gallery-3.webp';
import microGallery4 from '@/assets/real/micro-gallery-4.webp';
import microGallery5 from '@/assets/real/micro-gallery-5.webp';

const microImages = [
  { src: microMain, alt: 'Micro machine main view' },
  { src: microGallery1, alt: 'Micro machine product highlight' },
  { src: microGallery2, alt: 'Micro machine action shot with pink cotton candy' },
  { src: microGallery3, alt: 'Micro machine action shot with blue cotton candy' },
  { src: microGallery4, alt: 'Micro machine dimensions' },
  { src: microGallery5, alt: 'Micro machine diagram' },
];

const microFitNotes = [
  'Compact entry point for low-volume cotton candy applications.',
  'Appropriate when basic shapes are enough and complex pattern capability is not required.',
  'Useful for buyers who want to validate robotic cotton candy demand before moving upmarket.',
];

const microPlanningNotes = [
  'Micro is listed at $2,200 before shipping and final configuration.',
  'Orders remain quote-led so Bloomjoy can confirm fit, delivery, and operator expectations.',
  'Operators should plan for sugar and paper-stick supplies through the Bloomjoy supplies flow.',
];

export default function MicroPage() {
  useEffect(() => {
    trackEvent('view_product_micro');
  }, []);

  const handleQuoteRequest = () => {
    trackEvent('click_quote_micro');
  };

  return (
    <Layout>
      {/* Breadcrumb */}
      <div className="border-b border-border bg-muted/30">
        <div className="container-page py-3">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/machines" className="hover:text-foreground">Machines</Link>
            <span>/</span>
            <span className="text-foreground">{MACHINE_NAMES.micro}</span>
          </nav>
        </div>
      </div>

      <section className="section-padding">
        <div className="container-page">
          <div className="grid gap-12 lg:grid-cols-2">
            {/* Image */}
            <div>
              <ProductImageGallery images={microImages} />
            </div>

            {/* Details */}
            <div>
              <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
                Bloomjoy Sweets {MACHINE_NAMES.micro}
              </h1>
              <p className="mt-2 font-display text-3xl font-bold text-primary">
                $2,200
              </p>

              <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
                Entry-level robotic cotton candy machine for basic shapes. Perfect for home use or low-volume applications.
              </p>

              <div className="mt-8 space-y-4">
                <Button asChild variant="hero" size="xl" className="w-full">
                  <Link
                    to="/contact?type=quote&interest=micro&source=/machines/micro"
                    onClick={handleQuoteRequest}
                  >
                    Request a Quote
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button asChild variant="hero-outline" size="lg" className="w-full">
                  <Link to="/supplies">
                    Reorder Sugar
                  </Link>
                </Button>
              </div>

              <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <p className="font-semibold text-foreground">Starting small?</p>
                    <Link
                      to="/resources/business-playbook/commercial-vending-vs-event-catering"
                      className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                    >
                      Compare vending, events, and Micro fit
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
                    'Affordable entry point',
                    'Simple operation',
                    'Compact size',
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

              {/* Limitations */}
              <div className="mt-8">
                <h3 className="font-display text-lg font-semibold text-foreground">Limitations</h3>
                <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber/20 bg-amber/5 p-4">
                  <AlertCircle className="h-5 w-5 shrink-0 text-amber" />
                  <span className="text-sm text-muted-foreground">
                    Basic shapes only - not suitable for complex patterns.
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
                {microFitNotes.map((note) => (
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
                {microPlanningNotes.map((note) => (
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
    </Layout>
  );
}
