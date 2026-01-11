import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Zap, Shield, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Layout } from '@/components/layout/Layout';
import { trackEvent } from '@/lib/analytics';
import heroMachine from '@/assets/hero-machine.jpg';

const productCards = [
  {
    title: 'Commercial Robotic Machine',
    price: '$10,000',
    description: 'Full-size commercial unit with automatic stick dispensing and complex pattern capabilities.',
    href: '/products/commercial-robotic-machine',
    badge: 'Most Popular',
  },
  {
    title: 'Mini',
    price: '$4,000',
    description: 'Portable at 1/5 the size. Most complex patterns supported. Manual stick feeding.',
    href: '/products/mini',
    badge: 'Coming Soon',
  },
  {
    title: 'Micro',
    price: '$400',
    description: 'Entry-level machine for basic shapes. Perfect for low-volume applications.',
    href: '/products/micro',
    badge: null,
  },
];

const trustPoints = [
  { icon: Zap, text: '5+ years operational experience' },
  { icon: Shield, text: 'Operating across ~12 states' },
  { icon: Package, text: 'Official Sunze manufacturer relationship' },
];

export default function HomePage() {
  useEffect(() => {
    trackEvent('view_home');
  }, []);

  return (
    <Layout>
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-cream to-background">
        <div className="container-page section-padding">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="flex flex-col justify-center">
              <h1 className="font-display text-4xl font-bold leading-tight text-foreground sm:text-5xl lg:text-6xl">
                Robotic cotton candy that runs like an{' '}
                <span className="text-primary">operation.</span>
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
                Commercial-grade robotic cotton candy machines and premium supplies. Built for operators who demand consistency, throughput, and reliable support.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <Link to="/contact">
                  <Button variant="hero" size="xl">
                    Request a Quote
                    <ArrowRight className="ml-1 h-5 w-5" />
                  </Button>
                </Link>
                <Link to="/supplies">
                  <Button variant="hero-outline" size="xl">
                    Shop Supplies
                  </Button>
                </Link>
              </div>
            </div>
            <div className="relative">
              <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-muted shadow-elevated-lg">
                <img
                  src={heroMachine}
                  alt="Bloomjoy Sweets Robotic Cotton Candy Machine"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Product Cards */}
      <section className="section-padding">
        <div className="container-page">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
              Choose Your Machine
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
              From full commercial operations to entry-level setups, we have a solution that fits.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {productCards.map((product) => (
              <Link
                key={product.title}
                to={product.href}
                className="group card-elevated p-6 transition-all hover:-translate-y-1"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-display text-xl font-semibold text-foreground group-hover:text-primary">
                      {product.title}
                    </h3>
                    <p className="mt-1 font-display text-2xl font-bold text-primary">
                      {product.price}
                    </p>
                  </div>
                  {product.badge && (
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                      {product.badge}
                    </span>
                  )}
                </div>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  {product.description}
                </p>
                <div className="mt-6 flex items-center text-sm font-semibold text-primary">
                  Learn more
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Supplies Callout */}
      <section className="bg-muted/50 section-padding">
        <div className="container-page">
          <div className="card-elevated flex flex-col items-center gap-6 p-8 text-center md:flex-row md:text-left lg:p-12">
            <div className="flex-1">
              <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
                Premium Sugar, Engineered for Consistent Spins
              </h2>
              <p className="mt-3 text-muted-foreground">
                Optimized granularity. Dust-free formula. Quality controlled for our robotic machines. Starting at $8/kg.
              </p>
            </div>
            <Link to="/supplies">
              <Button size="lg">
                Shop Supplies
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Plus Membership */}
      <section className="section-padding">
        <div className="container-page">
          <div className="rounded-2xl bg-foreground p-8 text-background lg:p-12">
            <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
              <div>
                <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                  Bloomjoy Plus
                </span>
                <h2 className="mt-4 font-display text-3xl font-bold sm:text-4xl">
                  Onboarding + Playbooks + Concierge
                </h2>
                <p className="mt-4 text-lg text-muted">
                  Get up and running faster with guided onboarding, training resources, and concierge support from the Bloomjoy team.
                </p>
                <Link to="/plus" className="mt-6 inline-block">
                  <Button variant="hero" size="lg">
                    Learn About Plus
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
              <div className="space-y-4">
                {[
                  'Onboarding checklist & WeChat setup assistance',
                  'Training library access with video guides',
                  'Member community access',
                  'Concierge support (triage, best-practices, escalation)',
                ].map((benefit) => (
                  <div key={benefit} className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary">
                      <Check className="h-4 w-4 text-primary-foreground" />
                    </div>
                    <span className="text-muted">{benefit}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="bg-muted/50 section-padding">
        <div className="container-page text-center">
          <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
            Built on Experience
          </h2>
          <div className="mx-auto mt-10 grid max-w-3xl gap-8 md:grid-cols-3">
            {trustPoints.map((point) => (
              <div key={point.text} className="flex flex-col items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <point.icon className="h-6 w-6 text-primary" />
                </div>
                <span className="text-sm font-medium text-foreground">{point.text}</span>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-sm text-muted-foreground">
            We maintain a direct relationship with Sunze, the manufacturer. They provide 24/7 technical support via WeChat. Bloomjoy provides onboarding guidance, best-practice playbooks, and concierge escalation.
          </p>
        </div>
      </section>

      {/* CTA Section */}
      <section className="section-padding">
        <div className="container-page text-center">
          <h2 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
            Ready to Get Started?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
            Whether you're exploring options or ready to purchase, we're here to help.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link to="/contact">
              <Button variant="hero" size="xl">
                Request a Quote
              </Button>
            </Link>
            <Link to="/resources">
              <Button variant="hero-outline" size="xl">
                Learn More
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
