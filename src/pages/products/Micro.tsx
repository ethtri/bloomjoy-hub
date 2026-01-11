import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Check, AlertCircle, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Layout } from '@/components/layout/Layout';
import { trackEvent } from '@/lib/analytics';
import { useCart } from '@/lib/cart';
import { toast } from 'sonner';
import machineMicro from '@/assets/machine-micro.jpg';

export default function MicroPage() {
  const { addItem } = useCart();

  useEffect(() => {
    trackEvent('view_product_micro');
  }, []);

  const handleBuyNow = () => {
    trackEvent('click_buy_micro');
    addItem({
      sku: 'micro',
      name: 'Bloomjoy Sweets Micro',
      price: 400,
      type: 'machine',
    });
    toast.success('Micro added to cart!');
  };

  return (
    <Layout>
      {/* Breadcrumb */}
      <div className="border-b border-border bg-muted/30">
        <div className="container-page py-3">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/products" className="hover:text-foreground">Products</Link>
            <span>/</span>
            <span className="text-foreground">Micro</span>
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
                  src={machineMicro}
                  alt="Bloomjoy Sweets Micro"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>

            {/* Details */}
            <div>
              <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
                Bloomjoy Sweets Micro
              </h1>
              <p className="mt-2 font-display text-3xl font-bold text-primary">
                $400
              </p>

              <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
                Entry-level robotic cotton candy machine for basic shapes. Perfect for home use or low-volume applications.
              </p>

              <div className="mt-8 space-y-4">
                <Button variant="hero" size="xl" className="w-full" onClick={handleBuyNow}>
                  <ShoppingCart className="mr-2 h-5 w-5" />
                  Add to Cart
                </Button>
                <Link to="/supplies">
                  <Button variant="hero-outline" size="lg" className="w-full">
                    Reorder Sugar
                  </Button>
                </Link>
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
                    Basic shapes only—not suitable for complex patterns.
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
