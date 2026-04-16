import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { trackEvent } from '@/lib/analytics';
import { MACHINE_NAMES } from '@/lib/machineNames';
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
            Machines
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Commercial-grade robotic cotton candy machines for every scale of operation.
          </p>
        </div>
      </section>

      {/* Machines */}
      <section className="py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <h2 className="font-display text-2xl font-bold text-foreground">Machines</h2>
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
