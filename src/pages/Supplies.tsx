import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronDown, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import sugarProduct from '@/assets/real/sugar-product.jpg';
import sticksProduct from '@/assets/real/sticks-product.jpg';
import { useAuth } from '@/contexts/auth-context';
import { trackEvent } from '@/lib/analytics';
import { useCart } from '@/lib/cart';
import { getCheckoutStatus, startBlankSticksCheckout } from '@/lib/stripeCheckout';
import {
  BLANK_STICKS_ADDRESS_TYPE_OPTIONS,
  CUSTOM_STICKS_FIRST_ORDER_PLATE_FEE,
  MAX_STICKS_BOXES_PER_CHECKOUT,
  STICKS_PIECES_PER_BOX,
  STICKS_PRICE_PER_BOX,
  STICK_SIZE_OPTIONS,
  type BlankSticksAddressType,
  type StickSize,
  formatBlankSticksShippingSummary,
  getBlankSticksAddressTypeLabel,
  normalizeStickBoxCount,
} from '@/lib/sticks';
import {
  BULK_SUGAR_PRESETS_KG,
  DEFAULT_BULK_SUGAR_KG,
  MAX_SUGAR_KG_TOTAL,
  NON_MEMBER_SUGAR_PRICE_PER_KG,
  PLUS_MEMBER_SUGAR_PRICE_PER_KG,
  SUGAR_COLOR_OPTIONS,
  type SugarMix,
  type SugarSku,
  buildEqualSugarSplit,
  createEmptySugarMix,
  getSugarColorBreakdown,
  getSugarMixTotalKg,
  getSugarPricePerKg,
  updateSugarMixQuantity,
} from '@/lib/sugar';
import { cn } from '@/lib/utils';

const getSugarName = (color: string, flavor: string) =>
  `Premium Cotton Candy Sugar - ${color} (${flavor}) (1KG)`;

type SelectedStickSize = StickSize | '';
type SelectedBlankAddressType = BlankSticksAddressType | '';
type SupplyOrderMode = 'sugar' | 'sticks' | 'custom';

const SUPPLY_ORDER_MODES: SupplyOrderMode[] = ['sugar', 'sticks', 'custom'];

const hasStickSize = (value: SelectedStickSize): value is StickSize => value !== '';
const hasBlankAddressType = (
  value: SelectedBlankAddressType
): value is BlankSticksAddressType => value !== '';

const isSupplyOrderMode = (value: string | null): value is SupplyOrderMode =>
  !!value && SUPPLY_ORDER_MODES.includes(value as SupplyOrderMode);

const resolveSupplyOrderMode = (value: string | null): SupplyOrderMode =>
  isSupplyOrderMode(value) ? value : 'sugar';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  currency: 'USD',
  maximumFractionDigits: 0,
  style: 'currency',
});

const numberFormatter = new Intl.NumberFormat('en-US');

const formatCurrency = (value: number): string => currencyFormatter.format(value);
const formatNumber = (value: number): string => numberFormatter.format(value);

const orderOptions: Array<{
  value: SupplyOrderMode;
  title: string;
  eyebrow: string;
  summary: string;
  image: string;
  imageAlt: string;
}> = [
  {
    value: 'sugar',
    title: 'Sugar',
    eyebrow: 'Cart checkout',
    summary: 'Start from a 400 KG equal split and adjust only if needed.',
    image: sugarProduct,
    imageAlt: 'Premium Cotton Candy Sugar bags',
  },
  {
    value: 'sticks',
    title: 'Bloomjoy Branded Sticks',
    eyebrow: 'Direct checkout',
    summary: 'Order standard branded sticks by machine size and box count.',
    image: sticksProduct,
    imageAlt: 'Bloomjoy branded cotton candy sticks',
  },
  {
    value: 'custom',
    title: 'Custom Sticks',
    eyebrow: 'Coming soon',
    summary: 'Payment-first custom artwork checkout is in preparation.',
    image: sticksProduct,
    imageAlt: 'Custom cotton candy sticks artwork reference',
  },
];

export default function SuppliesPage() {
  const { user, loading: isAuthLoading } = useAuth();
  const { addItem, items } = useCart();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedOrderMode = resolveSupplyOrderMode(searchParams.get('order'));
  const hasMemberSupplyPricing = Boolean(user?.hasSupplyDiscount);
  const sugarPricePerKg = getSugarPricePerKg(hasMemberSupplyPricing);
  const [targetTotalKg, setTargetTotalKg] = useState(DEFAULT_BULK_SUGAR_KG);
  const [sticksBoxCount, setSticksBoxCount] = useState(1);
  const [stickSize, setStickSize] = useState<SelectedStickSize>('');
  const [blankAddressType, setBlankAddressType] = useState<SelectedBlankAddressType>('');
  const [startingBlankCheckout, setStartingBlankCheckout] = useState(false);
  const [showSugarMix, setShowSugarMix] = useState(false);
  const [sugarMix, setSugarMix] = useState<SugarMix>(() =>
    buildEqualSugarSplit(DEFAULT_BULK_SUGAR_KG)
  );

  useEffect(() => {
    trackEvent('view_supplies');
  }, []);

  useEffect(() => {
    const rawOrderMode = searchParams.get('order');
    if (!rawOrderMode || isSupplyOrderMode(rawOrderMode)) return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('order', 'sugar');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const sticksCheckoutStatus = searchParams.get('sticksCheckout');
    if (!sticksCheckoutStatus) return;

    if (sticksCheckoutStatus === 'cancel') {
      toast.info('Bloomjoy branded sticks checkout canceled. No payment was collected.');
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('sticksCheckout');
      nextParams.delete('session_id');
      nextParams.set('order', 'sticks');
      setSearchParams(nextParams, { replace: true });
      return;
    }

    const sessionId = searchParams.get('session_id');
    if (sticksCheckoutStatus !== 'return' || !sessionId) {
      toast.error('We could not verify this sticks checkout return.');
      return;
    }

    let cancelled = false;
    void getCheckoutStatus(sessionId)
      .then((status) => {
        if (cancelled) return;
        if (status.paymentStatus === 'paid' && status.orderType === 'blank_sticks') {
          toast.success(
            'Payment confirmed. Your Bloomjoy branded stick order is ready for fulfillment.'
          );
          return;
        }
        toast.info('Payment is not yet confirmed. Bloomjoy has not started fulfillment.');
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : 'Checkout could not be verified.');
      })
      .finally(() => {
        if (cancelled) return;
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('sticksCheckout');
        nextParams.delete('session_id');
        nextParams.set('order', 'sticks');
        setSearchParams(nextParams, { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [searchParams, setSearchParams]);

  const mixTotalKg = getSugarMixTotalKg(sugarMix);
  const mixTotalCost = mixTotalKg * sugarPricePerKg;
  const cartSugarBreakdown = getSugarColorBreakdown(items);
  const cartSugarTotalKg = getSugarMixTotalKg(cartSugarBreakdown);
  const normalizedStickBoxCount = normalizeStickBoxCount(sticksBoxCount);
  const selectOrderMode = (mode: SupplyOrderMode) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('order', mode);
    setSearchParams(nextParams);
  };

  const updateColorQuantity = (sku: SugarSku, rawValue: number) => {
    setSugarMix((currentMix) => updateSugarMixQuantity(currentMix, sku, rawValue));
  };

  const handlePreset = (presetKg: number) => {
    setTargetTotalKg(presetKg);
    setSugarMix(buildEqualSugarSplit(presetKg));
  };

  const updateStickBoxCount = (rawValue: number) => {
    setSticksBoxCount(normalizeStickBoxCount(rawValue));
  };

  const handleAddSugarMixToCart = () => {
    if (mixTotalKg <= 0) {
      toast.error('Set sugar quantities before adding to cart.');
      return;
    }
    SUGAR_COLOR_OPTIONS.forEach((option) => {
      const quantity = sugarMix[option.sku];
      if (quantity <= 0) return;
      addItem(
        {
          sku: option.sku,
          name: getSugarName(option.color, option.flavor),
          price: sugarPricePerKg,
          type: 'supply',
        },
        quantity
      );
    });
    trackEvent('add_to_cart', {
      sku: 'sugar-bulk-mix',
      quantity: mixTotalKg,
      sugar_white_kg: sugarMix['sugar-white-1kg'],
      sugar_blue_kg: sugarMix['sugar-blue-1kg'],
      sugar_orange_kg: sugarMix['sugar-orange-1kg'],
      sugar_red_kg: sugarMix['sugar-red-1kg'],
    });
    toast.success(`Added ${mixTotalKg} KG sugar mix to cart.`);
  };

  const handleStartBlankCheckout = async () => {
    if (!hasStickSize(stickSize)) {
      toast.error('Select the machine size before starting Bloomjoy branded sticks checkout.');
      return;
    }
    if (!hasBlankAddressType(blankAddressType)) {
      toast.error('Select business or residential delivery before checkout.');
      return;
    }
    setStartingBlankCheckout(true);
    try {
      trackEvent('click_buy_sticks', { variant: 'blank_checkout', boxes: normalizedStickBoxCount });
      trackEvent('start_checkout', { checkout_type: 'blank_sticks', boxes: normalizedStickBoxCount });
      const checkoutUrl = await startBlankSticksCheckout(
        { boxCount: normalizedStickBoxCount, stickSize, addressType: blankAddressType },
        window.location.origin
      );
      window.location.assign(checkoutUrl);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Unable to start Bloomjoy branded sticks checkout.'
      );
      setStartingBlankCheckout(false);
    }
  };

  return (
    <Layout>
      <section className="border-b border-border bg-background py-8 sm:py-10">
        <div className="container-page">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="font-display text-4xl font-bold text-foreground sm:text-5xl">
              Cotton Candy Machine Sugar and Paper Sticks
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              Order Bloomjoy cotton candy sugar and branded paper sticks, or preview the upcoming
              payment-first custom sticks flow.
            </p>
          </div>

          <div
            aria-label="Choose supplies order type"
            className="mt-7 grid gap-3 md:grid-cols-3"
            role="group"
          >
            {orderOptions.map((option) => {
              const isSelected = selectedOrderMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => selectOrderMode(option.value)}
                  className={cn(
                    'group flex min-h-32 gap-4 rounded-lg border bg-background p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                    isSelected
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border text-muted-foreground hover:border-primary/60 hover:text-foreground'
                  )}
                >
                  <img
                    src={option.image}
                    alt={option.imageAlt}
                    width={160}
                    height={160}
                    loading="lazy"
                    decoding="async"
                    className="h-20 w-20 flex-none rounded-lg bg-muted object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                      {option.eyebrow}
                    </span>
                    <span className="mt-1 block text-base font-semibold text-foreground">
                      {option.title}
                    </span>
                    <span className="mt-1 block text-sm leading-5">{option.summary}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-8 sm:py-12">
        <div className="container-page">
          {selectedOrderMode === 'sugar' && (
            <div className="mx-auto max-w-5xl">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="min-w-0 space-y-5">
                  <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.12em] text-primary">
                        Sugar
                      </p>
                      <h2 className="mt-2 font-display text-3xl font-bold text-foreground">
                        Build a bulk sugar mix
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                        Start with a shipment size, keep the equal split, or open the color mix
                        only when you need a different breakdown.
                      </p>
                    </div>
                    <div className="text-left sm:text-right" aria-live="polite">
                      <p className="font-display text-2xl font-bold text-primary">
                        {formatCurrency(sugarPricePerKg)}
                        <span className="text-base font-normal text-muted-foreground"> / KG</span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {isAuthLoading
                          ? 'Checking member pricing...'
                          : hasMemberSupplyPricing
                            ? 'Member pricing is active.'
                            : `Standard pricing. Plus Customers and Corporate Partners pay ${formatCurrency(
                                PLUS_MEMBER_SUGAR_PRICE_PER_KG
                              )}/KG.`}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-background p-4 sm:p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-foreground">
                          Choose Shipment Size
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          400 KG is the default packaging-friendly order.
                        </p>
                      </div>
                      <div className="flex flex-col gap-2 sm:items-end">
                        <Label
                          htmlFor="sugar-total-target"
                          className="text-xs uppercase tracking-[0.12em] text-muted-foreground"
                        >
                          Total Target (KG)
                        </Label>
                        <div className="flex gap-2">
                          <Input
                            id="sugar-total-target"
                            name="sugar_total_target_kg"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={MAX_SUGAR_KG_TOTAL}
                            value={targetTotalKg}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              setTargetTotalKg(
                                Number.isFinite(value)
                                  ? Math.min(MAX_SUGAR_KG_TOTAL, Math.max(0, Math.floor(value)))
                                  : 0
                              );
                            }}
                            className="h-10 w-32 text-right"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setSugarMix(buildEqualSugarSplit(targetTotalKg))}
                          >
                            Apply Split
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {BULK_SUGAR_PRESETS_KG.map((presetKg) => (
                        <Button
                          key={presetKg}
                          type="button"
                          variant={targetTotalKg === presetKg ? 'default' : 'outline'}
                          onClick={() => handlePreset(presetKg)}
                        >
                          {presetKg} KG
                        </Button>
                      ))}
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                          Total Sugar
                        </p>
                        <p className="mt-1 text-xl font-semibold text-foreground">
                          {formatNumber(mixTotalKg)} KG
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/20 p-3">
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                          1KG Bags
                        </p>
                        <p className="mt-1 text-xl font-semibold text-foreground">
                          {formatNumber(mixTotalKg)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/20 p-3">
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                          Subtotal
                        </p>
                        <p className="mt-1 text-xl font-semibold text-foreground">
                          {formatCurrency(mixTotalCost)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                      <Button
                        type="button"
                        className="w-full sm:w-auto"
                        onClick={handleAddSugarMixToCart}
                        disabled={mixTotalKg <= 0}
                      >
                        <ShoppingCart className="mr-2 h-4 w-4" aria-hidden="true" />
                        Add Sugar Mix to Cart
                      </Button>
                      <Button asChild variant="outline" className="w-full sm:w-auto">
                        <Link to="/cart">
                          View Cart
                          <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                        </Link>
                      </Button>
                    </div>

                    {cartSugarTotalKg > 0 && (
                      <p className="mt-3 text-sm text-muted-foreground">
                        Sugar currently in cart: {formatNumber(cartSugarTotalKg)} KG
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg border border-border bg-background">
                    <button
                      type="button"
                      aria-expanded={showSugarMix}
                      aria-controls="sugar-color-mix"
                      onClick={() => setShowSugarMix((current) => !current)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left text-sm font-semibold text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      Customize Color Mix
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 flex-none transition-transform',
                          showSugarMix && 'rotate-180'
                        )}
                        aria-hidden="true"
                      />
                    </button>
                    {showSugarMix && (
                      <div id="sugar-color-mix" className="border-t border-border p-4">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setSugarMix(buildEqualSugarSplit(targetTotalKg))}
                          >
                            Equal Split
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setSugarMix(createEmptySugarMix())}
                          >
                            Clear Mix
                          </Button>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {SUGAR_COLOR_OPTIONS.map((option) => {
                            const cartQuantity = cartSugarBreakdown[option.sku];
                            return (
                              <div
                                key={option.sku}
                                className="rounded-lg border border-border bg-muted/10 p-3"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <Label
                                      htmlFor={`sugar-mix-${option.sku}`}
                                      className="font-semibold text-foreground"
                                    >
                                      {option.color}{' '}
                                      <span className="font-normal text-muted-foreground">
                                        ({option.flavor})
                                      </span>
                                    </Label>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      In cart: {formatNumber(cartQuantity)} KG
                                    </p>
                                  </div>
                                  <Input
                                    id={`sugar-mix-${option.sku}`}
                                    name={`sugar_mix_${option.sku}`}
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    value={sugarMix[option.sku]}
                                    onChange={(event) =>
                                      updateColorQuantity(option.sku, Number(event.target.value))
                                    }
                                    className="h-10 w-24 text-right"
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <aside className="rounded-lg border border-border bg-muted/10 p-3">
                  <img
                    src={sugarProduct}
                    alt="Premium Cotton Candy Sugar"
                    width={360}
                    height={270}
                    loading="lazy"
                    decoding="async"
                    className="aspect-[4/3] w-full rounded-lg bg-background object-cover"
                  />
                  <div className="mt-4 space-y-3 text-sm">
                    <div>
                      <p className="font-semibold text-foreground">Pricing</p>
                      <p className="text-muted-foreground">
                        Public {formatCurrency(NON_MEMBER_SUGAR_PRICE_PER_KG)}/KG; Plus{' '}
                        {formatCurrency(PLUS_MEMBER_SUGAR_PRICE_PER_KG)}/KG.
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">Color Options</p>
                      <p className="text-muted-foreground">White, blue, orange, and red.</p>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          )}

          {selectedOrderMode === 'sticks' && (
            <div className="mx-auto max-w-5xl">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="min-w-0 space-y-5">
                  <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.12em] text-primary">
                        Bloomjoy Branded Sticks
                      </p>
                      <h2 className="mt-2 font-display text-3xl font-bold text-foreground">
                        Order standard paper sticks
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                        Pay securely online for any box quantity. Orders of 5 or more boxes ship
                        free.
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="font-display text-2xl font-bold text-primary">
                        {formatCurrency(STICKS_PRICE_PER_BOX)}
                        <span className="text-base font-normal text-muted-foreground">
                          {' '}
                          / box
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatNumber(STICKS_PIECES_PER_BOX)} pieces per box
                        {isAuthLoading
                          ? ' / Checking member pricing...'
                          : hasMemberSupplyPricing
                            ? ' / Member pricing applies at checkout.'
                            : ' / Plus Customers and Corporate Partners receive member pricing when signed in.'}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-background p-4 sm:p-5">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                          Minimum
                        </p>
                        <p className="mt-1 font-semibold text-foreground">1 box</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                          Shipping
                        </p>
                        <p className="mt-1 font-semibold text-foreground">5+ boxes ship free</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                          Order Path
                        </p>
                        <p className="mt-1 font-semibold text-foreground">
                          Direct checkout
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-background p-4 sm:p-5">
                    <div>
                      <Label className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                        Machine Size
                      </Label>
                      <RadioGroup
                        name="stick_size"
                        value={stickSize}
                        onValueChange={(value) => setStickSize(value as SelectedStickSize)}
                        className="mt-2 grid gap-3 sm:grid-cols-2"
                      >
                        {STICK_SIZE_OPTIONS.map((option) => (
                          <label
                            key={option.value}
                            htmlFor={`stick-size-${option.value}`}
                            className={cn(
                              'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                              stickSize === option.value
                                ? 'border-primary bg-primary/5'
                                : 'border-border bg-background hover:border-primary/60'
                            )}
                          >
                            <RadioGroupItem
                              id={`stick-size-${option.value}`}
                              value={option.value}
                              className="mt-1"
                            />
                            <span>
                              <span className="block font-semibold text-foreground">
                                {option.label}
                              </span>
                              <span className="block text-sm text-muted-foreground">
                                {option.detail}
                              </span>
                            </span>
                          </label>
                        ))}
                      </RadioGroup>
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
                      <div>
                        <Label
                          htmlFor="branded-sticks-boxes"
                          className="text-xs uppercase tracking-[0.12em] text-muted-foreground"
                        >
                          Boxes
                        </Label>
                        <Input
                          id="branded-sticks-boxes"
                          name="branded_sticks_boxes"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={MAX_STICKS_BOXES_PER_CHECKOUT}
                          value={sticksBoxCount}
                          onChange={(event) => updateStickBoxCount(Number(event.target.value))}
                          className="mt-1 h-10 w-full text-right"
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                          <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                            Stick Subtotal
                          </p>
                          <p className="mt-1 text-xl font-semibold text-foreground">
                            {formatCurrency(normalizedStickBoxCount * STICKS_PRICE_PER_BOX)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/20 p-3">
                          <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                            Total Pieces
                          </p>
                          <p className="mt-1 text-xl font-semibold text-foreground">
                            {formatNumber(normalizedStickBoxCount * STICKS_PIECES_PER_BOX)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5">
                      <Label className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                        Delivery Location Type
                      </Label>
                      <RadioGroup
                        name="delivery_location_type"
                        value={blankAddressType}
                        onValueChange={(value) =>
                          setBlankAddressType(value as SelectedBlankAddressType)
                        }
                        className="mt-2 grid gap-3 sm:grid-cols-2"
                      >
                        {BLANK_STICKS_ADDRESS_TYPE_OPTIONS.map((option) => (
                          <label
                            key={option.value}
                            htmlFor={`stick-address-${option.value}`}
                            className={cn(
                              'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                              blankAddressType === option.value
                                ? 'border-primary bg-primary/5'
                                : 'border-border bg-background hover:border-primary/60'
                            )}
                          >
                            <RadioGroupItem
                              id={`stick-address-${option.value}`}
                              value={option.value}
                              className="mt-1"
                            />
                            <span>
                              <span className="block font-semibold text-foreground">
                                {option.label}
                              </span>
                              <span className="block text-sm text-muted-foreground">
                                {formatCurrency(option.shippingRatePerBox)}/box for 1-4 boxes
                              </span>
                            </span>
                          </label>
                        ))}
                      </RadioGroup>
                    </div>

                    <div className="mt-5 rounded-lg border border-border bg-muted/20 p-4 text-sm">
                      {hasBlankAddressType(blankAddressType) ? (
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div>
                            <p className="text-muted-foreground">Shipping</p>
                            <p className="font-semibold text-foreground">
                              {formatBlankSticksShippingSummary(
                                normalizedStickBoxCount,
                                blankAddressType
                              )}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Location</p>
                            <p className="font-semibold text-foreground">
                              {getBlankSticksAddressTypeLabel(blankAddressType)}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Next Step</p>
                            <p className="font-semibold text-foreground">
                              Secure checkout
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-muted-foreground">
                          Select the delivery location type to see the shipping estimate and next
                          step.
                        </p>
                      )}
                    </div>

                    <Button
                      type="button"
                      onClick={handleStartBlankCheckout}
                      className="mt-5 w-full sm:w-auto"
                      disabled={startingBlankCheckout}
                    >
                      {startingBlankCheckout
                        ? 'Redirecting…'
                        : 'Checkout Bloomjoy Branded Sticks'}
                    </Button>
                  </div>
                </div>

                <aside className="rounded-lg border border-border bg-muted/10 p-3">
                  <img
                    src={sticksProduct}
                    alt="Bloomjoy branded cotton candy sticks"
                    width={360}
                    height={270}
                    loading="lazy"
                    decoding="async"
                    className="aspect-[4/3] w-full rounded-lg bg-background object-cover"
                  />
                  <div className="mt-4 space-y-3 text-sm">
                    <div>
                      <p className="font-semibold text-foreground">Standard Size Options</p>
                      <p className="text-muted-foreground">
                        Commercial/Full and Mini machine sticks are available.
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">Cart Rule</p>
                      <p className="text-muted-foreground">
                        Branded stick orders use direct Stripe checkout for every box quantity.
                      </p>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          )}

          {selectedOrderMode === 'custom' && (
            <div className="mx-auto max-w-5xl">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="min-w-0 space-y-5">
                  <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.12em] text-primary">
                        Custom Sticks
                      </p>
                      <h2 className="mt-2 font-display text-3xl font-bold text-foreground">
                        Payment-first checkout coming soon
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                        Custom sticks are temporarily unavailable while we finish a checkout that
                        collects the correct plate fee, shipping, tax, and payment before proofing.
                      </p>
                    </div>
                    <span className="inline-flex w-fit rounded-full bg-muted px-3 py-1 text-sm font-semibold text-muted-foreground">
                      Not yet available
                    </span>
                  </div>

                  <div className="rounded-lg border border-border bg-background p-4 sm:p-5">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                          Packaging
                        </p>
                        <p className="mt-1 font-semibold text-foreground">
                          {formatNumber(STICKS_PIECES_PER_BOX)} pieces / box
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                          First Order Fee
                        </p>
                        <p className="mt-1 font-semibold text-foreground">
                          {formatCurrency(CUSTOM_STICKS_FIRST_ORDER_PLATE_FEE)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                          Order Path
                        </p>
                        <p className="mt-1 font-semibold text-foreground">Pay first</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-background p-4 sm:p-5">
                    <h3 className="font-display text-lg font-semibold text-foreground">
                      Why checkout is paused
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      The first custom order includes a {formatCurrency(CUSTOM_STICKS_FIRST_ORDER_PLATE_FEE)}
                      {' '}plate fee and requires artwork proofing. We will reopen this item only when
                      the complete amount can be paid online before the fulfillment team is notified.
                    </p>
                  </div>
                </div>

                <aside className="rounded-lg border border-border bg-muted/10 p-3">
                  <img
                    src={sticksProduct}
                    alt="Custom cotton candy sticks"
                    width={360}
                    height={270}
                    loading="lazy"
                    decoding="async"
                    className="aspect-[4/3] w-full rounded-lg bg-background object-cover"
                  />
                  <div className="mt-4 space-y-3 text-sm">
                    <div>
                      <p className="font-semibold text-foreground">Proofing</p>
                      <p className="text-muted-foreground">
                        Artwork upload and proofing will be part of the payment-first order flow.
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">Availability</p>
                      <p className="text-muted-foreground">
                        No unpaid request form is available while checkout is being completed.
                      </p>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="border-t border-border bg-muted/25 py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div>
              <h2 className="font-display text-2xl font-bold text-foreground">
                Supplies for robotic cotton candy operators
              </h2>
              <p className="mt-3 max-w-3xl text-muted-foreground">
                Bloomjoy supplies are organized around the recurring machine-buyer needs that
                usually happen after machine selection: sugar replenishment and Bloomjoy branded
                sticks, with custom sticks returning after payment-first checkout is complete.
              </p>
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-border bg-background p-5">
                  <h3 className="font-display text-lg font-semibold text-foreground">
                    Bulk sugar
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Build a white, blue, orange, and red sugar mix. Standard pricing is $10/KG;
                    Plus member pricing is $8/KG when membership is active.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-background p-5">
                  <h3 className="font-display text-lg font-semibold text-foreground">
                    Paper sticks
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Bloomjoy branded sticks are sold by box with 2,000 pieces per box and size
                    options for Commercial/Full and Mini machines.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-background p-5">
                  <h3 className="font-display text-lg font-semibold text-foreground">
                    Custom sticks
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Custom sticks are temporarily unavailable until checkout can collect the
                    first-order plate fee, shipping, tax, and full payment before proofing.
                  </p>
                </div>
              </div>
            </div>

            <aside className="rounded-lg border border-border bg-background p-5">
              <h2 className="font-display text-xl font-semibold text-foreground">
                Machine buyer note
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                If you are still selecting a machine, start with the machine comparison page before
                ordering supplies so the stick size and opening sugar volume match your launch plan.
              </p>
              <Link
                to="/machines"
                className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
              >
                Compare machines
                <ArrowRight className="h-4 w-4" />
              </Link>
            </aside>
          </div>
        </div>
      </section>
    </Layout>
  );
}
