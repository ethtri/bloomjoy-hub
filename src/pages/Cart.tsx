import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, ArrowRight, ShoppingBag, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Layout } from '@/components/layout/Layout';
import { useCart, type CartItem } from '@/lib/cart';
import { trackEvent } from '@/lib/analytics';
import { startStorefrontCheckout } from '@/lib/stripeCheckout';
import { parseOrderQuantity } from '@/lib/commerceQuantity';
import { claimPaidCartReturn, rememberCheckoutCart } from '@/lib/checkoutReturn';
import { useCheckoutReturn } from '@/hooks/useCheckoutReturn';
import { CheckoutReturnNotice } from '@/components/commerce/CheckoutReturnNotice';
import sugarProduct from '@/assets/real/sugar-product.jpg';
import microProduct from '@/assets/real/micro-main.webp';
import {
  SUGAR_COLOR_OPTIONS,
  getSugarColorBreakdown,
  getSugarPricePerKg,
  isSugarSku,
} from '@/lib/sugar';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import { isMicroCheckoutEnabled } from '@/lib/commerceAvailability';

export default function CartPage() {
  const { user } = useAuth();
  const { items, addItem, updateQuantity, removeItem, clearCart } = useCart();
  const hasMemberSupplyPricing = Boolean(user?.hasSupplyDiscount);
  const sugarPricePerKg = getSugarPricePerKg(hasMemberSupplyPricing);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});
  const [removedItem, setRemovedItem] = useState<CartItem | null>(null);
  const [retainedCart, setRetainedCart] = useState(false);
  const handledReturn = useRef<string | null>(null);
  const checkoutReturn = useCheckoutReturn('cart', (sessionId) => {
    if (handledReturn.current === sessionId) return;
    handledReturn.current = sessionId;
    try {
      const action = claimPaidCartReturn(sessionId, items, window.localStorage);
      if (action === 'clear') clearCart();
      else {
        setRetainedCart(items.length > 0 || action === 'retain');
        void useCart.persist.rehydrate();
      }
    } catch {
      // If browser storage is unavailable, retain the cart rather than risk clearing
      // a newer order when this verified return is revisited.
      setRetainedCart(items.length > 0);
    }
  });
  const hasIncompleteQuantity = items.some((item) =>
    quantityDrafts[item.sku] !== undefined && parseOrderQuantity(quantityDrafts[item.sku]) === null
  );
  const hasUnresolvedReturn = checkoutReturn.state.status === 'pending' || checkoutReturn.state.status === 'error';
  const sugarBreakdown = getSugarColorBreakdown(items);
  const hasMicroMachine = items.some((item) => item.sku === 'micro');
  const hasUnavailableMicro = hasMicroMachine && !isMicroCheckoutEnabled;
  const sugarTotalKg = Object.values(sugarBreakdown).reduce((sum, quantity) => sum + quantity, 0);
  const getDisplayUnitPrice = (sku: string, fallbackPrice: number) =>
    isSugarSku(sku) ? sugarPricePerKg : fallbackPrice;
  const displayTotal = items.reduce(
    (sum, item) => sum + getDisplayUnitPrice(item.sku, item.price) * item.quantity,
    0
  );

  const handleRemove = (item: CartItem) => {
    setRemovedItem(item);
    removeItem(item.sku);
    setQuantityDrafts((current) => {
      const next = { ...current };
      delete next[item.sku];
      return next;
    });
    trackEvent('remove_from_cart', { sku: item.sku, quantity: item.quantity });
  };

  const removalNotice = removedItem && (
    <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
      <span>Removed {removedItem.name}.</span>
      <Button variant="outline" onClick={() => { addItem(removedItem, removedItem.quantity); setRemovedItem(null); }}>
        <Undo2 aria-hidden="true" className="h-4 w-4" /> Undo
      </Button>
    </div>
  );

  const handleCheckout = async () => {
    if (hasIncompleteQuantity || hasUnresolvedReturn) return;
    trackEvent('start_checkout');

    if (hasUnavailableMicro) {
      toast.error('Micro is not available to order yet. Remove it to continue with supplies.');
      return;
    }

    if (items.some((item) => !isSugarSku(item.sku) && item.sku !== 'micro')) {
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
      try {
        rememberCheckoutCart(checkoutUrl, items, window.localStorage);
      } catch {
        // Checkout remains available; an unassociated return will preserve the cart.
      }
      window.location.assign(checkoutUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start checkout.';
      toast.error(message);
      setIsCheckingOut(false);
    }
  };

  if (checkoutReturn.state.status === 'paid' || checkoutReturn.state.status === 'checking') {
    return (
      <Layout>
        <section className="section-padding">
          <div className="container-page max-w-3xl">
            <h1 className="mb-6 font-display text-3xl font-bold">Your order</h1>
            <CheckoutReturnNotice state={checkoutReturn.state} onRetry={checkoutReturn.retry} onDismiss={checkoutReturn.dismiss} hasCart cartRetained={retainedCart} />
          </div>
        </section>
      </Layout>
    );
  }

  if (items.length === 0) {
    return (
      <Layout>
        <section className="section-padding">
          <div className="container-page">
            {removalNotice}
            {checkoutReturn.state.status !== 'none' && <div className="mb-8"><CheckoutReturnNotice state={checkoutReturn.state} onRetry={checkoutReturn.retry} onDismiss={checkoutReturn.dismiss} hasCart /></div>}
            <div className="mx-auto max-w-lg text-center">
              <ShoppingBag className="mx-auto h-16 w-16 text-muted-foreground/50" />
              <h1 className="mt-6 font-display text-2xl font-bold text-foreground">
                Your cart is empty
              </h1>
              <p className="mt-2 text-muted-foreground">
                Shop available sugar supplies to continue.
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

          <div className="mt-5">{removalNotice}</div>
          {checkoutReturn.state.status !== 'none' && <div className="mt-5"><CheckoutReturnNotice state={checkoutReturn.state} onRetry={checkoutReturn.retry} onDismiss={checkoutReturn.dismiss} hasCart /></div>}

          <div className="mt-8 grid gap-8 lg:grid-cols-3">
            {/* Cart Items */}
            <div className="lg:col-span-2">
              {hasUnavailableMicro && (
                <div className="mb-4 rounded-lg border border-amber/30 bg-amber/5 p-4 text-sm text-muted-foreground">
                  Micro is not available to order yet. Remove it to continue with your supplies.
                </div>
              )}
              <div className="divide-y divide-border rounded-xl border border-border bg-card">
                {items.map((item) => (
                  <div
                    key={item.sku}
                    className="grid grid-cols-[4rem_minmax(0,1fr)] gap-4 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-center"
                  >
                    <div className="h-16 w-16 overflow-hidden rounded-lg bg-muted">
                      {isSugarSku(item.sku) || item.sku === 'micro'
                        ? <img src={item.sku === 'micro' ? microProduct : sugarProduct} alt="" width={64} height={64} className="h-full w-full object-contain" />
                        : <ShoppingBag aria-hidden="true" className="m-4 h-8 w-8 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0">
                      <h2 className="break-words font-semibold text-foreground">{item.name}</h2>
                      <p className="text-sm text-muted-foreground">
                        ${getDisplayUnitPrice(item.sku, item.price).toFixed(2)} {isSugarSku(item.sku) ? 'per 1 KG bag' : 'each'}
                      </p>
                      <Button variant="ghost" size="sm" className="mt-1 h-11 px-0 text-muted-foreground hover:text-destructive" onClick={() => handleRemove(item)} aria-label={`Remove ${item.name} from cart`}>
                        <Trash2 aria-hidden="true" className="h-4 w-4" /> Remove
                      </Button>
                    </div>
                    <div className="col-span-2 flex items-end justify-between gap-4 sm:contents">
                    <div className="min-w-0">
                      <label htmlFor={`quantity-${item.sku}`} className="mb-1.5 block text-xs text-muted-foreground">{isSugarSku(item.sku) ? 'Quantity (KG)' : 'Quantity'}</label>
                      <Input
                        id={`quantity-${item.sku}`}
                        aria-label={`Quantity for ${item.name}`}
                        name={`quantity-${item.sku}`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={quantityDrafts[item.sku] ?? item.quantity}
                        aria-invalid={quantityDrafts[item.sku] !== undefined && parseOrderQuantity(quantityDrafts[item.sku]) === null}
                        aria-describedby={quantityDrafts[item.sku] !== undefined && parseOrderQuantity(quantityDrafts[item.sku]) === null ? `quantity-${item.sku}-error` : undefined}
                        onChange={(event) => {
                          const draft = event.target.value;
                          setQuantityDrafts((current) => ({ ...current, [item.sku]: draft }));
                          const value = parseOrderQuantity(draft);
                          if (value !== null) updateQuantity(item.sku, value);
                        }}
                        className="h-11 w-24 text-right"
                      />
                      {quantityDrafts[item.sku] !== undefined && parseOrderQuantity(quantityDrafts[item.sku]) === null && <p id={`quantity-${item.sku}-error`} className="mt-1 max-w-40 text-xs text-destructive">Enter a whole number of 1 or more, or choose Remove.</p>}
                    </div>
                    <p className="text-right font-semibold text-foreground sm:w-20">
                      ${(
                        getDisplayUnitPrice(item.sku, item.price) * item.quantity
                      ).toFixed(2)}
                    </p>
                    </div>
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
                      {hasUnavailableMicro
                        ? 'Not available yet'
                        : hasMicroMachine
                          ? 'Shown at checkout'
                          : 'No charge'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax</span>
                    <span className="text-muted-foreground">Shown at checkout</span>
                  </div>
                </div>
                <div className="mt-4 border-t border-border pt-4">
                  <div className="flex justify-between">
                    <span className="font-semibold text-foreground">
                      Estimated total before tax
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
                  disabled={isCheckingOut || hasUnavailableMicro || hasIncompleteQuantity || hasUnresolvedReturn}
                >
                  {isCheckingOut ? 'Redirecting…' : 'Checkout'}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                {hasIncompleteQuantity && <p role="status" className="mt-3 text-sm text-destructive">Complete the highlighted quantities to update your order and continue.</p>}
                {hasUnresolvedReturn && <p className="mt-3 text-sm text-muted-foreground">Check your previous payment above, or choose “Review cart” before starting another checkout.</p>}
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
