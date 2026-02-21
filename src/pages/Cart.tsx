import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, Plus, Minus, ArrowRight, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Layout } from '@/components/layout/Layout';
import { useCart } from '@/lib/cart';
import { trackEvent } from '@/lib/analytics';
import { startSugarCheckout } from '@/lib/stripeCheckout';
import { SUGAR_COLOR_OPTIONS, SUGAR_PRICE_PER_KG, getSugarColorBreakdown, isSugarSku } from '@/lib/sugar';
import { toast } from 'sonner';

export default function CartPage() {
  const { items, updateQuantity, removeItem, getTotal, clearCart } = useCart();
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const sugarBreakdown = getSugarColorBreakdown(items);
  const sugarTotalKg = Object.values(sugarBreakdown).reduce((sum, quantity) => sum + quantity, 0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutStatus = params.get('checkout');
    if (!checkoutStatus) return;

    if (checkoutStatus === 'success') {
      toast.success('Thanks! Your order is being processed.');
      clearCart();
    }

    if (checkoutStatus === 'cancel') {
      toast.info('Checkout canceled.');
    }

    window.history.replaceState({}, '', '/cart');
  }, [clearCart]);

  const handleCheckout = async () => {
    trackEvent('start_checkout');

    if (items.some((item) => item.type !== 'supply')) {
      toast.error('Checkout currently supports sugar only. Remove machines to continue.');
      return;
    }

    if (items.some((item) => !isSugarSku(item.sku))) {
      toast.error('Checkout currently supports sugar only. Remove non-sugar items to continue.');
      return;
    }

    if (items.length === 0) {
      toast.error('Add sugar to your cart to continue.');
      return;
    }

    try {
      setIsCheckingOut(true);
      const checkoutUrl = await startSugarCheckout(items, window.location.origin);
      window.location.assign(checkoutUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start checkout.';
      toast.error(message);
      setIsCheckingOut(false);
    }
  };

  if (items.length === 0) {
    return (
      <Layout>
        <section className="section-padding">
          <div className="container-page">
            <div className="mx-auto max-w-lg text-center">
              <ShoppingBag className="mx-auto h-16 w-16 text-muted-foreground/50" />
              <h1 className="mt-6 font-display text-2xl font-bold text-foreground">
                Your cart is empty
              </h1>
              <p className="mt-2 text-muted-foreground">
                Add some supplies or machines to get started.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-4">
                <Link to="/supplies">
                  <Button>Shop Supplies</Button>
                </Link>
                <Link to="/machines">
                  <Button variant="outline">View Machines</Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </Layout>
    );
  }

  return (
    <Layout>
      <section className="section-padding">
        <div className="container-page">
          <h1 className="font-display text-3xl font-bold text-foreground">Your Cart</h1>

          <div className="mt-8 grid gap-8 lg:grid-cols-3">
            {/* Cart Items */}
            <div className="lg:col-span-2">
              <div className="divide-y divide-border rounded-xl border border-border bg-card">
                {items.map((item) => (
                  <div key={item.sku} className="flex items-center gap-4 p-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted">
                      <ShoppingBag className="h-8 w-8 text-muted-foreground/50" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-foreground">{item.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        ${item.price.toFixed(2)} each
                      </p>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-border p-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => updateQuantity(item.sku, item.quantity - 1)}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="w-8 text-center font-semibold">{item.quantity}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => updateQuantity(item.sku, item.quantity + 1)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                      <Input
                        type="number"
                        min={0}
                        value={item.quantity}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          updateQuantity(
                            item.sku,
                            Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
                          );
                        }}
                        className="h-8 w-20 text-right"
                      />
                    </div>
                    <p className="w-20 text-right font-semibold text-foreground">
                      ${(item.price * item.quantity).toFixed(2)}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => removeItem(item.sku)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Order Summary */}
            <div>
              <div className="card-elevated p-6">
                <h2 className="font-display text-lg font-semibold text-foreground">
                  Order Summary
                </h2>
                {sugarTotalKg > 0 && (
                  <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <p className="text-sm font-semibold text-foreground">Sugar Mix</p>
                    <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                      {SUGAR_COLOR_OPTIONS.map((option) => {
                        const quantity = sugarBreakdown[option.sku];
                        if (quantity <= 0) {
                          return null;
                        }
                        return (
                          <div key={option.sku} className="flex justify-between">
                            <span>
                              {option.color} ({option.flavor})
                            </span>
                            <span>{quantity} KG</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-2 border-t border-primary/20 pt-2 text-sm">
                      <div className="flex justify-between text-foreground">
                        <span>Total sugar</span>
                        <span className="font-semibold">{sugarTotalKg} KG</span>
                      </div>
                      <div className="mt-1 flex justify-between text-muted-foreground">
                        <span>1KG bags</span>
                        <span>{sugarTotalKg} bags</span>
                      </div>
                      <div className="mt-1 flex justify-between text-foreground">
                        <span>Sugar subtotal</span>
                        <span className="font-semibold">
                          ${(sugarTotalKg * SUGAR_PRICE_PER_KG).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium text-foreground">${getTotal().toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Shipping</span>
                    <span className="text-muted-foreground">Calculated at checkout</span>
                  </div>
                </div>
                <div className="mt-4 border-t border-border pt-4">
                  <div className="flex justify-between">
                    <span className="font-semibold text-foreground">Total</span>
                    <span className="font-display text-xl font-bold text-primary">
                      ${getTotal().toFixed(2)}
                    </span>
                  </div>
                </div>
                <Button
                  variant="hero"
                  size="lg"
                  className="mt-6 w-full"
                  onClick={handleCheckout}
                  disabled={isCheckingOut}
                >
                  {isCheckingOut ? 'Redirecting...' : 'Checkout'}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  Secure checkout powered by Stripe
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
