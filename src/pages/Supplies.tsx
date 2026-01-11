import { useEffect } from 'react';
import { ShoppingCart, Plus, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Layout } from '@/components/layout/Layout';
import { trackEvent } from '@/lib/analytics';
import { useCart } from '@/lib/cart';
import { supplies } from '@/lib/products';
import { toast } from 'sonner';
import sugarProduct from '@/assets/sugar-product.jpg';

export default function SuppliesPage() {
  const { addItem, items, updateQuantity } = useCart();

  useEffect(() => {
    trackEvent('view_supplies');
  }, []);

  const handleAddToCart = (sku: string, name: string, price: number) => {
    trackEvent('add_to_cart', { sku, price });
    addItem({ sku, name, price, type: 'supply' });
    toast.success(`${name} added to cart!`);
  };

  const getItemQuantity = (sku: string) => {
    const item = items.find((i) => i.sku === sku);
    return item?.quantity || 0;
  };

  return (
    <Layout>
      {/* Hero */}
      <section className="bg-gradient-to-b from-cream to-background section-padding">
        <div className="container-page text-center">
          <h1 className="font-display text-4xl font-bold text-foreground sm:text-5xl">
            Supplies
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Premium cotton candy sugar and sticks, optimized for Bloomjoy machines.
          </p>
        </div>
      </section>

      {/* Products */}
      <section className="section-padding">
        <div className="container-page">
          <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
            {/* Sugar */}
            <div className="card-elevated overflow-hidden">
              <div className="aspect-square overflow-hidden bg-muted">
                <img
                  src={sugarProduct}
                  alt="Premium Cotton Candy Sugar"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="p-6">
                <h2 className="font-display text-xl font-semibold text-foreground">
                  Premium Cotton Candy Sugar
                </h2>
                <p className="mt-1 font-display text-2xl font-bold text-primary">
                  $8 <span className="text-base font-normal text-muted-foreground">/ 1KG bag</span>
                </p>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  Optimized granularity, dust-free formula for consistent spins. Resealable 1KG bags for freshness and easy storage. Quality controlled production.
                </p>
                <ul className="mt-4 space-y-2">
                  {[
                    'Optimized granularity for robotic machines',
                    'Dust-free formula',
                    'Consistent spin performance',
                  ].map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <div className="mt-6">
                  {getItemQuantity('sugar-1kg') > 0 ? (
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 rounded-lg border border-border p-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => updateQuantity('sugar-1kg', getItemQuantity('sugar-1kg') - 1)}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="w-8 text-center font-semibold">{getItemQuantity('sugar-1kg')}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => updateQuantity('sugar-1kg', getItemQuantity('sugar-1kg') + 1)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                      <span className="text-sm text-muted-foreground">in cart</span>
                    </div>
                  ) : (
                    <Button onClick={() => handleAddToCart('sugar-1kg', 'Premium Cotton Candy Sugar (1KG)', 8)} className="w-full">
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      Add to Cart
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Sticks */}
            <div className="card-elevated overflow-hidden">
              <div className="flex aspect-square items-center justify-center bg-muted">
                <div className="text-center text-muted-foreground">
                  <Package className="mx-auto h-16 w-16 opacity-50" />
                  <p className="mt-4 text-sm">Cotton Candy Sticks</p>
                </div>
              </div>
              <div className="p-6">
                <h2 className="font-display text-xl font-semibold text-foreground">
                  Cotton Candy Sticks
                </h2>
                <p className="mt-1 font-display text-2xl font-bold text-primary">
                  $12 <span className="text-base font-normal text-muted-foreground">/ 100 pack</span>
                </p>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  Plain cotton candy sticks, pack of 100. Compatible with all Bloomjoy machines.
                </p>
                <ul className="mt-4 space-y-2">
                  {[
                    'Compatible with all Bloomjoy machines',
                    'Food-grade materials',
                    '100 sticks per pack',
                  ].map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <div className="mt-6">
                  {getItemQuantity('sticks-plain') > 0 ? (
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 rounded-lg border border-border p-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => updateQuantity('sticks-plain', getItemQuantity('sticks-plain') - 1)}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="w-8 text-center font-semibold">{getItemQuantity('sticks-plain')}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => updateQuantity('sticks-plain', getItemQuantity('sticks-plain') + 1)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                      <span className="text-sm text-muted-foreground">in cart</span>
                    </div>
                  ) : (
                    <Button onClick={() => handleAddToCart('sticks-plain', 'Cotton Candy Sticks (100 pack)', 12)} className="w-full">
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      Add to Cart
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}

function Package(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}
