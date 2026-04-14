import { useEffect, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ShoppingCart, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import sugarProduct from '@/assets/real/sugar-product.jpg';
import sticksProduct from '@/assets/real/sticks-product.jpg';
import { trackEvent } from '@/lib/analytics';
import { useCart } from '@/lib/cart';
import {
  ALLOWED_CUSTOM_STICKS_ARTWORK_TYPES,
  MAX_CUSTOM_STICKS_ARTWORK_SIZE_BYTES,
  uploadCustomSticksArtwork,
  validateCustomSticksArtwork,
} from '@/lib/customSticksArtwork';
import { createLeadSubmission } from '@/lib/leadSubmissions';
import { startBlankSticksCheckout } from '@/lib/stripeCheckout';
import { useAuth } from '@/contexts/AuthContext';
import { hasPlusAccess } from '@/lib/membership';
import {
  BLANK_STICKS_ADDRESS_TYPE_OPTIONS,
  BLANK_STICKS_FREE_SHIPPING_BOX_THRESHOLD,
  CUSTOM_STICKS_FIRST_ORDER_PLATE_FEE,
  STICKS_PIECES_PER_BOX,
  STICKS_PRICE_PER_BOX,
  STICK_SIZE_OPTIONS,
  type BlankSticksAddressType,
  type StickSize,
  type StickVariant,
  formatBlankSticksShippingSummary,
  getBlankSticksAddressTypeLabel,
  getBlankSticksShippingRatePerBox,
  getBlankSticksShippingTotal,
  getStickSizeLabel,
  normalizeStickBoxCount,
  shouldUseBlankSticksDirectCheckout,
} from '@/lib/sticks';
import {
  BULK_SUGAR_PRESETS_KG,
  DEFAULT_BULK_SUGAR_KG,
  MAX_SUGAR_KG_TOTAL,
  NON_MEMBER_SUGAR_PRICE_PER_KG,
  PLUS_MEMBER_SUGAR_PRICE_PER_KG,
  SUGAR_COLOR_OPTIONS,
  getSugarPricePerKg,
  type SugarMix,
  type SugarSku,
  buildEqualSugarSplit,
  createEmptySugarMix,
  getSugarColorBreakdown,
  getSugarMixTotalKg,
  updateSugarMixQuantity,
} from '@/lib/sugar';

const getSugarName = (color: string, flavor: string) =>
  `Premium Cotton Candy Sugar - ${color} (${flavor}) (1KG)`;

type SelectedStickSize = StickSize | '';
type SelectedBlankAddressType = BlankSticksAddressType | '';

const hasStickSize = (value: SelectedStickSize): value is StickSize => value !== '';
const hasBlankAddressType = (
  value: SelectedBlankAddressType
): value is BlankSticksAddressType => value !== '';

export default function SuppliesPage() {
  const { user, loading: isAuthLoading } = useAuth();
  const { addItem, items } = useCart();
  const hasPlusMembership = hasPlusAccess(user?.membershipStatus);
  const sugarPricePerKg = getSugarPricePerKg(hasPlusMembership);
  const [targetTotalKg, setTargetTotalKg] = useState(DEFAULT_BULK_SUGAR_KG);
  const [sticksBoxCount, setSticksBoxCount] = useState(1);
  const [stickVariant, setStickVariant] = useState<StickVariant>('plain');
  const [stickSize, setStickSize] = useState<SelectedStickSize>('');
  const [blankAddressType, setBlankAddressType] = useState<SelectedBlankAddressType>('');
  const [customArtworkFile, setCustomArtworkFile] = useState<File | null>(null);
  const [sticksContactName, setSticksContactName] = useState('');
  const [sticksContactEmail, setSticksContactEmail] = useState('');
  const [sticksRequestNotes, setSticksRequestNotes] = useState('');
  const [submittingSticksRequest, setSubmittingSticksRequest] = useState(false);
  const [startingBlankCheckout, setStartingBlankCheckout] = useState(false);
  const [sugarMix, setSugarMix] = useState<SugarMix>(() =>
    buildEqualSugarSplit(DEFAULT_BULK_SUGAR_KG)
  );

  useEffect(() => {
    trackEvent('view_supplies');
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sticksCheckoutStatus = params.get('sticksCheckout');
    if (!sticksCheckoutStatus) return;
    if (sticksCheckoutStatus === 'success') {
      toast.success('Thanks! Your Bloomjoy branded stick order is being processed.');
    }
    if (sticksCheckoutStatus === 'cancel') {
      toast.info('Bloomjoy branded sticks checkout canceled.');
    }
    params.delete('sticksCheckout');
    const nextQuery = params.toString();
    window.history.replaceState(
      {},
      '',
      nextQuery ? `${window.location.pathname}?${nextQuery}` : window.location.pathname
    );
  }, []);

  const mixTotalKg = getSugarMixTotalKg(sugarMix);
  const mixTotalCost = mixTotalKg * sugarPricePerKg;
  const cartSugarBreakdown = getSugarColorBreakdown(items);
  const cartSugarTotalKg = getSugarMixTotalKg(cartSugarBreakdown);
  const normalizedStickBoxCount = normalizeStickBoxCount(sticksBoxCount);
  const blankSticksCheckoutEligible =
    stickVariant === 'plain' && shouldUseBlankSticksDirectCheckout(normalizedStickBoxCount);
  const blankSticksShippingTotal =
    stickVariant === 'plain' && hasBlankAddressType(blankAddressType)
      ? getBlankSticksShippingTotal(normalizedStickBoxCount, blankAddressType)
      : null;
  const blankSticksShippingRate =
    stickVariant === 'plain' && hasBlankAddressType(blankAddressType)
      ? getBlankSticksShippingRatePerBox(blankAddressType)
      : null;

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

  const resetStickRequestFields = () => {
    setSticksBoxCount(1);
    setStickSize('');
    setBlankAddressType('');
    setCustomArtworkFile(null);
    setSticksContactName('');
    setSticksContactEmail('');
    setSticksRequestNotes('');
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

  const handleCustomArtworkChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setCustomArtworkFile(null);
      return;
    }
    try {
      validateCustomSticksArtwork(file);
      setCustomArtworkFile(file);
    } catch (error) {
      setCustomArtworkFile(null);
      toast.error(error instanceof Error ? error.message : 'Unable to use this artwork file.');
    }
  };

  const validateSticksContactFields = (): boolean => {
    if (!sticksContactName.trim()) {
      toast.error('Enter your name so we can confirm your sticks request.');
      return false;
    }
    if (!sticksContactEmail.trim()) {
      toast.error('Enter your email so we can follow up with your sticks request.');
      return false;
    }
    return true;
  };

  const handleSubmitBlankSticksRequest = async () => {
    if (!hasStickSize(stickSize)) {
      toast.error('Select the machine size before submitting a Bloomjoy branded sticks request.');
      return;
    }
    if (!hasBlankAddressType(blankAddressType)) {
      toast.error('Select business or residential shipping before submitting.');
      return;
    }
    if (!validateSticksContactFields()) return;
    setSubmittingSticksRequest(true);
    try {
      await createLeadSubmission({
        submissionType: 'procurement',
        name: sticksContactName.trim(),
        email: sticksContactEmail.trim().toLowerCase(),
        sourcePage: '/supplies',
        message: [
          'Bloomjoy Branded Paper Sticks Request',
          `Requested boxes: ${normalizedStickBoxCount}`,
          `Pieces per box: ${STICKS_PIECES_PER_BOX}`,
          `Selected size: ${getStickSizeLabel(stickSize)}`,
          `Per-box price: $${STICKS_PRICE_PER_BOX}`,
          `Selected address type: ${getBlankSticksAddressTypeLabel(blankAddressType)}`,
          `Estimated shipping: $${blankSticksShippingTotal} total ($${blankSticksShippingRate}/box)`,
          `Free-shipping threshold: ${BLANK_STICKS_FREE_SHIPPING_BOX_THRESHOLD}+ boxes`,
          `Notes: ${sticksRequestNotes.trim() || 'None'}`,
        ].join('\n'),
      });
      trackEvent('click_buy_sticks', { variant: 'blank_request', boxes: normalizedStickBoxCount });
      toast.success('Bloomjoy branded sticks request submitted. We will confirm shipping and fulfillment.');
      resetStickRequestFields();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to submit your request.');
    } finally {
      setSubmittingSticksRequest(false);
    }
  };

  const handleStartBlankCheckout = async () => {
    if (!hasStickSize(stickSize)) {
      toast.error('Select the machine size before starting Bloomjoy branded sticks checkout.');
      return;
    }
    if (!hasBlankAddressType(blankAddressType)) {
      toast.error('Select business or residential shipping before checkout.');
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
      toast.error(error instanceof Error ? error.message : 'Unable to start Bloomjoy branded sticks checkout.');
      setStartingBlankCheckout(false);
    }
  };

  const handleSubmitCustomSticksRequest = async () => {
    if (!hasStickSize(stickSize)) {
      toast.error('Select the machine size before submitting a custom sticks request.');
      return;
    }
    if (!validateSticksContactFields()) return;
    if (!customArtworkFile) {
      toast.error('Upload your logo/image to submit a custom sticks request.');
      return;
    }
    setSubmittingSticksRequest(true);
    try {
      const { publicUrl } = await uploadCustomSticksArtwork(customArtworkFile);
      await createLeadSubmission({
        submissionType: 'procurement',
        name: sticksContactName.trim(),
        email: sticksContactEmail.trim().toLowerCase(),
        sourcePage: '/supplies',
        message: [
          'Custom Paper Sticks Request',
          `Requested boxes: ${normalizedStickBoxCount}`,
          `Pieces per box: ${STICKS_PIECES_PER_BOX}`,
          `Selected size: ${getStickSizeLabel(stickSize)}`,
          `Per-box price: $${STICKS_PRICE_PER_BOX}`,
          `First custom order plate fee: $${CUSTOM_STICKS_FIRST_ORDER_PLATE_FEE}`,
          `Shipping note: 1-4 boxes estimate at $35/box business or $40/box residential; ${BLANK_STICKS_FREE_SHIPPING_BOX_THRESHOLD}+ boxes ship free`,
          `Artwork URL: ${publicUrl}`,
          `Artwork file: ${customArtworkFile.name}`,
          `Notes: ${sticksRequestNotes.trim() || 'None'}`,
        ].join('\n'),
      });
      trackEvent('click_buy_sticks', { variant: 'custom_request', boxes: normalizedStickBoxCount });
      toast.success('Custom sticks request submitted. We will follow up with proofing details.');
      resetStickRequestFields();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to submit your request.');
    } finally {
      setSubmittingSticksRequest(false);
    }
  };

  return (
    <Layout>
      <section className="bg-gradient-to-b from-cream to-background section-padding">
        <div className="container-page text-center">
          <h1 className="font-display text-4xl font-bold text-foreground sm:text-5xl">Supplies</h1>
          <p className="mx-auto mt-4 max-w-3xl text-lg text-muted-foreground">
            Bulk sugar ordering built for operator packaging. Configure white, blue, orange, and
            red in one flow with quick presets tuned for 240KG, 400KG, and 800KG shipments.
          </p>
        </div>
      </section>

      <section className="section-padding">
        <div className="container-page">
          <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
            <div className="card-elevated overflow-hidden">
              <div className="aspect-square overflow-hidden bg-muted">
                <img src={sugarProduct} alt="Premium Cotton Candy Sugar" className="h-full w-full object-cover" />
              </div>
              <div className="p-6">
                <h2 className="font-display text-xl font-semibold text-foreground">Premium Cotton Candy Sugar</h2>
                  <p className="mt-1 font-display text-2xl font-bold text-primary">
                  ${sugarPricePerKg}{' '}
                  <span className="text-base font-normal text-muted-foreground">/ 1KG bag</span>
                </p>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  Pick your mix across all four core colors and use packaging-friendly quick presets
                  for the most common shipment sizes. Bloomjoy Plus members pay $
                  {PLUS_MEMBER_SUGAR_PRICE_PER_KG}/KG. Everyone else pays $
                  {NON_MEMBER_SUGAR_PRICE_PER_KG}/KG.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {isAuthLoading
                    ? 'Checking member pricing...'
                    : hasPlusMembership
                      ? 'Plus pricing is active for this session.'
                      : 'Standard pricing is active. Log in with an active Bloomjoy Plus membership to pay $8/KG.'}
                </p>
                <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4">
                  <p className="text-sm font-semibold text-foreground">Bulk Order Builder</p>
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <div>
                      <Label className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Total Target (KG)</Label>
                      <Input
                        type="number"
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
                        className="mt-1 h-9 w-32"
                      />
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setSugarMix(buildEqualSugarSplit(targetTotalKg))}>
                      Equal Split (25% each)
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setSugarMix(createEmptySugarMix())}>
                      Clear
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {BULK_SUGAR_PRESETS_KG.map((presetKg) => (
                      <Button
                        key={presetKg}
                        type="button"
                        variant={targetTotalKg === presetKg ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handlePreset(presetKg)}
                      >
                        {presetKg} KG
                      </Button>
                    ))}
                  </div>
                  <div className="mt-4 space-y-2">
                    {SUGAR_COLOR_OPTIONS.map((option) => {
                      const cartQuantity = cartSugarBreakdown[option.sku];
                      return (
                        <div key={option.sku} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-border bg-background p-3">
                          <div>
                            <p className="font-semibold text-foreground">
                              {option.color}{' '}
                              <span className="text-sm font-normal text-muted-foreground">({option.flavor})</span>
                            </p>
                            <p className="text-xs text-muted-foreground">In cart: {cartQuantity} KG</p>
                          </div>
                          <Input
                            type="number"
                            min={0}
                            value={sugarMix[option.sku]}
                            onChange={(event) => updateColorQuantity(option.sku, Number(event.target.value))}
                            className="h-9 w-24 text-right"
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                    <div className="flex items-center justify-between text-foreground">
                      <span>Total sugar</span>
                      <span className="font-semibold">{mixTotalKg} KG</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-muted-foreground">
                      <span>1KG bags</span>
                      <span>{mixTotalKg} bags</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-foreground">
                      <span>Estimated subtotal</span>
                      <span className="font-semibold">${mixTotalCost.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <Button type="button" className="w-full" onClick={handleAddSugarMixToCart} disabled={mixTotalKg <= 0}>
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      Add Sugar Mix to Cart
                    </Button>
                    <Button asChild variant="outline" className="w-full sm:w-auto">
                      <Link to="/cart">
                        View Cart
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Common order pattern: start from the quick preset that matches your shipment, use
                  equal split, then adjust the color totals as needed.
                </p>
              </div>
            </div>

            <div className="card-elevated overflow-hidden">
              <div className="aspect-square overflow-hidden bg-muted">
                <img src={sticksProduct} alt="Bloomjoy branded cotton candy sticks" className="h-full w-full object-cover" />
              </div>
              <div className="p-6">
                <h2 className="font-display text-xl font-semibold text-foreground">Bloomjoy Paper Sticks</h2>
                <p className="mt-1 font-display text-2xl font-bold text-primary">
                  ${STICKS_PRICE_PER_BOX}{' '}
                  <span className="text-base font-normal text-muted-foreground">/ {STICKS_PIECES_PER_BOX.toLocaleString()}-piece box</span>
                </p>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  Choose Bloomjoy branded or custom paper sticks for Commercial/Full or Mini
                  machines. Custom sticks add a ${CUSTOM_STICKS_FIRST_ORDER_PLATE_FEE}{' '}
                  first-order plate fee.
                </p>
                <div className="mt-6 space-y-4">
                  <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/30 p-2">
                    <button
                      type="button"
                      onClick={() => setStickVariant('plain')}
                      className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                        stickVariant === 'plain' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Bloomjoy branded
                    </button>
                    <button
                      type="button"
                      onClick={() => setStickVariant('custom')}
                      className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                        stickVariant === 'custom' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Custom sticks
                    </button>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <Label className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Minimum Order</Label>
                        <p className="mt-1 text-sm font-semibold text-foreground">1 box</p>
                      </div>
                      <div>
                        <Label className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Packaging</Label>
                        <p className="mt-1 text-sm font-semibold text-foreground">{STICKS_PIECES_PER_BOX.toLocaleString()} pieces / box</p>
                      </div>
                      <div>
                        <Label className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Shipping</Label>
                        <p className="mt-1 text-sm font-semibold text-foreground">5+ boxes ship free</p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Bloomjoy branded sticks ship at $35/box to business addresses or $40/box to
                      residential addresses for orders under {BLANK_STICKS_FREE_SHIPPING_BOX_THRESHOLD} boxes.
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Machine Size</Label>
                    <RadioGroup
                      value={stickSize}
                      onValueChange={(value) => setStickSize(value as SelectedStickSize)}
                      className="mt-2 gap-3"
                    >
                      {STICK_SIZE_OPTIONS.map((option) => (
                        <label
                          key={option.value}
                          htmlFor={`stick-size-${option.value}`}
                          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                            stickSize === option.value ? 'border-primary bg-primary/5' : 'border-border bg-background'
                          }`}
                        >
                          <RadioGroupItem id={`stick-size-${option.value}`} value={option.value} className="mt-1" />
                          <div>
                            <p className="font-semibold text-foreground">{option.label}</p>
                            <p className="text-sm text-muted-foreground">{option.detail}</p>
                          </div>
                        </label>
                      ))}
                    </RadioGroup>
                  </div>
                  <div className="flex items-end gap-3">
                    <div>
                      <Label className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Boxes</Label>
                      <Input
                        type="number"
                        min={1}
                        value={sticksBoxCount}
                        onChange={(event) => updateStickBoxCount(Number(event.target.value))}
                        className="mt-1 h-9 w-24 text-right"
                      />
                    </div>
                    <div className="flex-1 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
                      <div className="flex items-center justify-between text-foreground">
                        <span>Stick subtotal</span>
                        <span className="font-semibold">${(normalizedStickBoxCount * STICKS_PRICE_PER_BOX).toFixed(2)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-muted-foreground">
                        <span>Total pieces</span>
                        <span>{(normalizedStickBoxCount * STICKS_PIECES_PER_BOX).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  {stickVariant === 'plain' && (
                    <>
                      <div>
                        <Label className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Shipping Address Type</Label>
                        <RadioGroup
                          value={blankAddressType}
                          onValueChange={(value) => setBlankAddressType(value as SelectedBlankAddressType)}
                          className="mt-2 gap-3"
                        >
                          {BLANK_STICKS_ADDRESS_TYPE_OPTIONS.map((option) => (
                            <label
                              key={option.value}
                              htmlFor={`stick-address-${option.value}`}
                              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                                blankAddressType === option.value ? 'border-primary bg-primary/5' : 'border-border bg-background'
                              }`}
                            >
                              <RadioGroupItem id={`stick-address-${option.value}`} value={option.value} className="mt-1" />
                              <div>
                                <p className="font-semibold text-foreground">{option.label}</p>
                                <p className="text-sm text-muted-foreground">${option.shippingRatePerBox}/box for 1-4 box orders</p>
                              </div>
                            </label>
                          ))}
                        </RadioGroup>
                      </div>

                      <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm">
                        {hasBlankAddressType(blankAddressType) ? (
                          <>
                            <div className="flex items-center justify-between text-foreground">
                              <span>Shipping</span>
                              <span className="font-semibold">
                                {formatBlankSticksShippingSummary(normalizedStickBoxCount, blankAddressType)}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center justify-between text-muted-foreground">
                              <span>Address type</span>
                              <span>{getBlankSticksAddressTypeLabel(blankAddressType)}</span>
                            </div>
                            <div className="mt-1 flex items-center justify-between text-muted-foreground">
                              <span>Order path</span>
                              <span>{blankSticksCheckoutEligible ? 'Direct checkout' : 'Procurement review'}</span>
                            </div>
                          </>
                        ) : (
                          <p className="text-muted-foreground">
                            Select the shipping address type to see the shipping estimate and
                            checkout path.
                          </p>
                        )}
                      </div>
                    </>
                  )}

                  {(stickVariant === 'custom' || !blankSticksCheckoutEligible) && (
                    <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
                      <p className="text-sm text-muted-foreground">
                        {stickVariant === 'custom'
                          ? `Upload your logo/image and we will confirm proofing, the $${CUSTOM_STICKS_FIRST_ORDER_PLATE_FEE} plate fee, production timing, and final order details.`
                          : `Orders under ${BLANK_STICKS_FREE_SHIPPING_BOX_THRESHOLD} boxes are handled through procurement confirmation so we can verify the final shipment details before fulfillment.`}
                      </p>

                      {stickVariant === 'custom' && (
                        <>
                          <label
                            htmlFor="custom-sticks-artwork"
                            className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary"
                          >
                            <Upload className="h-4 w-4" />
                            {customArtworkFile ? `Selected: ${customArtworkFile.name}` : 'Upload logo/image'}
                          </label>
                          <Input
                            id="custom-sticks-artwork"
                            type="file"
                            accept={ALLOWED_CUSTOM_STICKS_ARTWORK_TYPES.join(',')}
                            onChange={handleCustomArtworkChange}
                            className="hidden"
                          />
                          <p className="text-xs text-muted-foreground">
                            PNG, JPG, or WEBP. Max {Math.floor(MAX_CUSTOM_STICKS_ARTWORK_SIZE_BYTES / (1024 * 1024))}MB.
                          </p>
                        </>
                      )}

                      <div className="grid gap-3 sm:grid-cols-2">
                        <Input
                          placeholder="Contact name"
                          value={sticksContactName}
                          onChange={(event) => setSticksContactName(event.target.value)}
                        />
                        <Input
                          type="email"
                          placeholder="Email for follow-up"
                          value={sticksContactEmail}
                          onChange={(event) => setSticksContactEmail(event.target.value)}
                        />
                      </div>

                      <Textarea
                        value={sticksRequestNotes}
                        onChange={(event) => setSticksRequestNotes(event.target.value)}
                        rows={3}
                        placeholder={
                          stickVariant === 'custom'
                            ? 'Optional notes (brand colors, timeline, quantity split, etc.)'
                            : 'Optional notes (delivery window, location notes, internal PO, etc.)'
                        }
                      />
                    </div>
                  )}

                  {stickVariant === 'plain' ? (
                    <Button
                      onClick={blankSticksCheckoutEligible ? handleStartBlankCheckout : handleSubmitBlankSticksRequest}
                      className="w-full"
                      disabled={submittingSticksRequest || startingBlankCheckout}
                    >
                      {blankSticksCheckoutEligible
                        ? startingBlankCheckout
                          ? 'Redirecting...'
                          : 'Checkout Bloomjoy Branded Sticks'
                        : submittingSticksRequest
                          ? 'Submitting...'
                          : 'Submit Bloomjoy Branded Stick Request'}
                    </Button>
                  ) : (
                    <Button onClick={handleSubmitCustomSticksRequest} className="w-full" disabled={submittingSticksRequest}>
                      {submittingSticksRequest ? 'Submitting...' : 'Submit Custom Request'}
                    </Button>
                  )}

                  <p className="text-sm text-muted-foreground">
                    Bloomjoy branded sticks checkout starts at {BLANK_STICKS_FREE_SHIPPING_BOX_THRESHOLD}{' '}
                    boxes. The shared cart remains sugar-only.
                  </p>

                  {cartSugarTotalKg > 0 && (
                    <p className="text-sm text-muted-foreground">Sugar currently in cart: {cartSugarTotalKg} KG</p>
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
