import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, Plus, Minus, ArrowRight, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Layout } from '@/components/layout/Layout';
import { useCart } from '@/lib/cart';
import { trackEvent } from '@/lib/analytics';
import { getCheckoutStatus, startStorefrontCheckout } from '@/lib/stripeCheckout';
import {
  SUGAR_COLOR_OPTIONS,
  getSugarColorBreakdown,
  getSugarPricePerKg,
  isSugarSku,
} from '@/lib/sugar';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import { isMicroCheckoutEnabled, isMiniCheckoutEnabled } from '@/lib/commerceAvailability';

export default function CartPage() {
  const { user } = useAuth();
  const { items, updateQuantity, removeItem, clearCart } = useCart();
  const hasMemberSupplyPricing = Boolean(user?.hasSupplyDiscount);
  const sugarPricePerKg = getSugarPricePerKg(hasMemberSupplyPricing);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const sugarBreakdown = getSugarColorBreakdown(items);
  const hasMicroMachine = items.some((item) => item.sku === 'micro');
  const hasUnavailableMicro = hasMicroMachine && !isMicroCheckoutEnabled;
  const hasMiniMachine = items.some((item) => item.sku === 'mini');
  const hasUnavailableMini = hasMiniMachine && !isMiniCheckoutEnabled;
  const hasInvalidMiniCart = hasMiniMachine && (items.length !== 1 || items[0].quantity !== 1);
  const sugarTotalKg = Object.values(sugarBreakdown).reduce((sum, quantity) => sum + quantity, 0);
  const getDisplayUnitPrice = (sku: string, fallbackPrice: number) =>
    isSugarSku(sku) ? sugarPricePerKg : sku === 'mini' ? 4000 : fallbackPrice;
  const displayTotal = items.reduce(
    (sum, item) => sum + getDisplayUnitPrice(item.sku, item.price) * item.quantity,
    0
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutStatus = params.get('checkout');
    if (!checkoutStatus) return;

    if (checkoutStatus === 'cancel') {
      toast.info('Checkout canceled. Your cart has been kept.');
      window.history.replaceState({}, '', '/cart');
      return;
    }

    const sessionId = params.get('session_id');
    if (checkoutStatus !== 'return' || !sessionId) {
      toast.error('We could not verify this checkout return. Your cart has been kept.');
      window.history.replaceState({}, '', '/cart');
      return;
    }

    let cancelled = false;
    void getCheckoutStatus(sessionId)
      .then((status) => {
        if (cancelled) return;
        const isStorefrontOrder = ['sugar', 'micro_machine', 'mini_machine', 'mixed'].includes(status.orderType);
        if (status.paymentStatus === 'paid' && isStorefrontOrder) {
          clearCart();
          toast.success('Payment confirmed. Your order confirmation will arrive by email.');
          return;
        }
        toast.info('Payment is not yet confirmed. Your cart has been kept.');
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(
          error instanceof Error
            ? `${error.message} Your cart has been kept.`
            : 'Checkout could not be verified. Your cart has been kept.'
        );
      })
      .finally(() => {
        if (!cancelled) window.history.replaceState({}, '', '/cart');
      });

    return () => {
      cancelled = true;
    };
  }, [clearCart]);

  const handleCheckout = async () => {
    trackEvent('start_checkout');

    if (hasUnavailableMicro) {
      toast.error('Micro checkout is pending a shipping decision. Remove it to continue.');
      return;
    }

    if (hasUnavailableMini || hasInvalidMiniCart) {
      toast.error(hasUnavailableMini ? 'Mini checkout is not available yet. Remove it to continue.' : 'Check out one Mini Machine at a time, separately from other products.');
      return;
    }

    if (items.some((item) => !isSugarSku(item.sku) && !['micro', 'mini'].includes(item.sku))) {
      toast.error('Remove unavailable items before checkout.');
      return;
    }

    if (items.length === 0) {
      toast.error('Add an item to your cart to continue.');
      return;
    }

    try {
      setIsCheckingOut(true);
      const checkoutUrl = await startStorefrontCheckout(items, window.location.origin);
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
                Browse machines and supplies to continue shopping.
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
              {(hasUnavailableMini || hasInvalidMiniCart) && (
                <div role="status" className="mb-4 rounded-lg border border-amber/30 bg-amber/5 p-4 text-sm text-muted-foreground">
                  {hasUnavailableMini ? 'Mini checkout is not available yet. Remove it to check out other items.' : 'Check out one Mini Machine at a time. Remove the other items to continue, or remove Mini and purchase it separately.'}
                </div>
              )}
              {hasUnavailableMicro && (
                <div className="mb-4 rounded-lg border border-amber/30 bg-amber/5 p-4 text-sm text-muted-foreground">
                  Micro checkout is pending an executive shipping decision. Remove the Micro
                  Machine to check out other available items.
                </div>
              )}
              <div className="divide-y divide-border rounded-xl border border-border bg-card">
                {items.map((item) => (
                  <div
                    key={item.sku}
                    className="grid gap-4 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] sm:items-center"
                  >
                    <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted">
                      <ShoppingBag className="h-8 w-8 text-muted-foreground/50" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold text-foreground">{item.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        ${getDisplayUnitPrice(item.sku, item.price).toFixed(2)} each
                      </p>
                    </div>
                    <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-border p-1 sm:w-auto sm:flex-nowrap">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => updateQuantity(item.sku, item.quantity - 1)}
                        aria-label={`Decrease quantity for ${item.name}`}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="w-8 text-center font-semibold">{item.quantity}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => updateQuantity(item.sku, item.quantity + 1)}
                        disabled={item.sku === 'mini'}
                        aria-label={`Increase quantity for ${item.name}`}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                      <Input
                        aria-label={`Quantity for ${item.name}`}
                        name={`quantity-${item.sku}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={item.sku === 'mini' ? 1 : undefined}
                        value={item.quantity}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          updateQuantity(
                            item.sku,
                            Number.isFinite(value) ? Math.max(0, Math.min(item.sku === 'mini' ? 1 : Infinity, Math.floor(value))) : 0
                          );
                        }}
                        className="h-8 min-w-0 flex-1 text-right sm:w-20 sm:flex-none"
                      />
                    </div>
                    <p className="text-right font-semibold text-foreground sm:w-20">
                      ${(
                        getDisplayUnitPrice(item.sku, item.price) * item.quantity
                      ).toFixed(2)}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => removeItem(item.sku)}
                      aria-label={`Remove ${item.name} from cart`}
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
                          ${(sugarTotalKg * sugarPricePerKg).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                {sugarTotalKg > 0 && (
                  <p className="mt-4 text-xs text-muted-foreground">
                    {hasMemberSupplyPricing
                      ? 'Member supply pricing is applied at $8/KG.'
                      : 'Standard sugar pricing is applied at $10/KG. Plus Customers and Corporate Partners pay $8/KG.'}
                  </p>
                )}
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium text-foreground">${displayTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Shipping</span>
                    <span className="text-muted-foreground">
                      {hasUnavailableMicro || hasUnavailableMini
                        ? 'Decision pending'
                        : hasMicroMachine || hasMiniMachine
                          ? 'Shown at checkout'
                          : 'No charge'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax</span>
                    <span className="text-muted-foreground">Calculated by Stripe</span>
                  </div>
                </div>
                <div className="mt-4 border-t border-border pt-4">
                  <div className="flex justify-between">
                    <span className="font-semibold text-foreground">
                      Subtotal before shipping and tax
                    </span>
                    <span className="font-display text-xl font-bold text-primary">
                      ${displayTotal.toFixed(2)}
                    </span>
                  </div>
                </div>
                <Button
                  variant="hero"
                  size="lg"
                  className="mt-6 w-full"
                  onClick={handleCheckout}
                  disabled={isCheckingOut || hasUnavailableMicro || hasUnavailableMini || hasInvalidMiniCart}
                >
                  {isCheckingOut ? 'Redirecting…' : 'Checkout'}
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
