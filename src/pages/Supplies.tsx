import { useEffect, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ShoppingCart, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Layout } from '@/components/layout/Layout';
import { trackEvent } from '@/lib/analytics';
import { useCart } from '@/lib/cart';
import { createLeadSubmission } from '@/lib/leadSubmissions';
import {
  BULK_SUGAR_PRESETS_KG,
  DEFAULT_BULK_SUGAR_KG,
  MAX_SUGAR_KG_TOTAL,
  SUGAR_COLOR_OPTIONS,
  SUGAR_PRICE_PER_KG,
  SugarMix,
  SugarSku,
  buildEqualSugarSplit,
  createEmptySugarMix,
  getSugarColorBreakdown,
  getSugarMixTotalKg,
  updateSugarMixQuantity,
} from '@/lib/sugar';
import {
  ALLOWED_CUSTOM_STICKS_ARTWORK_TYPES,
  MAX_CUSTOM_STICKS_ARTWORK_SIZE_BYTES,
  uploadCustomSticksArtwork,
  validateCustomSticksArtwork,
} from '@/lib/customSticksArtwork';
import { toast } from 'sonner';
import sugarProduct from '@/assets/real/sugar-product.jpg';
import sticksProduct from '@/assets/real/sticks-product.jpg';

const getSugarName = (color: string, flavor: string) =>
  `Premium Cotton Candy Sugar - ${color} (${flavor}) (1KG)`;
const STICKS_SKU_PLAIN = 'sticks-plain';
const STICKS_SKU_CUSTOM = 'sticks-custom';
const STICKS_PRICE_PLAIN = 12;
const STICKS_PRICE_CUSTOM = 14;
type StickVariant = 'plain' | 'custom';

export default function SuppliesPage() {
  const { addItem, items } = useCart();
  const [targetTotalKg, setTargetTotalKg] = useState(DEFAULT_BULK_SUGAR_KG);
  const [sticksBulkPacks, setSticksBulkPacks] = useState(1);
  const [stickVariant, setStickVariant] = useState<StickVariant>('plain');
  const [customArtworkFile, setCustomArtworkFile] = useState<File | null>(null);
  const [customContactName, setCustomContactName] = useState('');
  const [customContactEmail, setCustomContactEmail] = useState('');
  const [customRequestNotes, setCustomRequestNotes] = useState('');
  const [submittingCustomSticks, setSubmittingCustomSticks] = useState(false);
  const [sugarMix, setSugarMix] = useState<SugarMix>(() =>
    buildEqualSugarSplit(DEFAULT_BULK_SUGAR_KG)
  );

  useEffect(() => {
    trackEvent('view_supplies');
  }, []);

  const mixTotalKg = getSugarMixTotalKg(sugarMix);
  const mixTotalCost = mixTotalKg * SUGAR_PRICE_PER_KG;
  const cartSugarBreakdown = getSugarColorBreakdown(items);
  const cartSugarTotalKg = getSugarMixTotalKg(cartSugarBreakdown);

  const getItemQuantity = (sku: string) => {
    const item = items.find((entry) => entry.sku === sku);
    return item?.quantity || 0;
  };
  const currentSticksSku = stickVariant === 'plain' ? STICKS_SKU_PLAIN : STICKS_SKU_CUSTOM;
  const currentSticksPrice = stickVariant === 'plain' ? STICKS_PRICE_PLAIN : STICKS_PRICE_CUSTOM;
  const currentSticksCartQuantity = getItemQuantity(currentSticksSku);

  const updateColorQuantity = (sku: SugarSku, rawValue: number) => {
    setSugarMix((currentMix) => updateSugarMixQuantity(currentMix, sku, rawValue));
  };

  const handleApplyEqualSplit = (totalKg: number) => {
    setSugarMix(buildEqualSugarSplit(totalKg));
  };

  const handlePreset = (presetKg: number) => {
    setTargetTotalKg(presetKg);
    handleApplyEqualSplit(presetKg);
  };
  const updateSticksBulkPacks = (rawValue: number) => {
    setSticksBulkPacks(Number.isFinite(rawValue) ? Math.max(1, Math.floor(rawValue)) : 1);
  };

  const handleAddSugarMixToCart = () => {
    if (mixTotalKg <= 0) {
      toast.error('Set sugar quantities before adding to cart.');
      return;
    }

    SUGAR_COLOR_OPTIONS.forEach((option) => {
      const quantity = sugarMix[option.sku];
      if (quantity <= 0) {
        return;
      }
      addItem(
        {
          sku: option.sku,
          name: getSugarName(option.color, option.flavor),
          price: SUGAR_PRICE_PER_KG,
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

  const handleAddPlainSticks = () => {
    const quantity = Number.isFinite(sticksBulkPacks)
      ? Math.max(1, Math.floor(sticksBulkPacks))
      : 1;
    trackEvent('add_to_cart', { sku: STICKS_SKU_PLAIN, price: STICKS_PRICE_PLAIN, quantity });
    addItem(
      {
        sku: STICKS_SKU_PLAIN,
        name: 'Blank Cotton Candy Sticks (100 pack)',
        price: STICKS_PRICE_PLAIN,
        type: 'supply',
      },
      quantity
    );
    toast.success(`Added ${quantity} blank stick pack${quantity === 1 ? '' : 's'} to cart.`);
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
      const message = error instanceof Error ? error.message : 'Unable to use this artwork file.';
      toast.error(message);
    }
  };

  const handleSubmitCustomSticksRequest = async () => {
    const quantity = Number.isFinite(sticksBulkPacks)
      ? Math.max(1, Math.floor(sticksBulkPacks))
      : 1;

    if (!customContactName.trim()) {
      toast.error('Enter your name so we can confirm your custom sticks request.');
      return;
    }

    if (!customContactEmail.trim()) {
      toast.error('Enter your email so we can follow up with proofing details.');
      return;
    }

    if (!customArtworkFile) {
      toast.error('Upload your logo/image to submit a custom sticks request.');
      return;
    }

    setSubmittingCustomSticks(true);
    try {
      const { publicUrl } = await uploadCustomSticksArtwork(customArtworkFile);

      await createLeadSubmission({
        submissionType: 'procurement',
        name: customContactName.trim(),
        email: customContactEmail.trim().toLowerCase(),
        sourcePage: '/supplies',
        message: [
          'Custom Sticks Request',
          `Requested packs: ${quantity}`,
          `Pack size: 100 sticks`,
          `Pricing basis: $${STICKS_PRICE_CUSTOM} per pack`,
          `Artwork URL: ${publicUrl}`,
          `Artwork file: ${customArtworkFile.name}`,
          `Notes: ${customRequestNotes.trim() || 'None'}`,
        ].join('\n'),
      });

      trackEvent('custom_sticks_request_submitted', {
        sku: STICKS_SKU_CUSTOM,
        quantity,
      });

      toast.success('Custom sticks request submitted. We will follow up with proofing details.');
      setCustomArtworkFile(null);
      setCustomRequestNotes('');
      setSticksBulkPacks(1);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to submit your custom sticks request.';
      toast.error(message);
    } finally {
      setSubmittingCustomSticks(false);
    }
  };

  return (
    <Layout>
      <section className="bg-gradient-to-b from-cream to-background section-padding">
        <div className="container-page text-center">
          <h1 className="font-display text-4xl font-bold text-foreground sm:text-5xl">
            Supplies
          </h1>
          <p className="mx-auto mt-4 max-w-3xl text-lg text-muted-foreground">
            Bulk sugar ordering built for operators. Configure white, blue, orange, and red in
            one flow, including 500KG+ orders.
          </p>
        </div>
      </section>

      <section className="section-padding">
        <div className="container-page">
          <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
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
                  ${SUGAR_PRICE_PER_KG}{' '}
                  <span className="text-base font-normal text-muted-foreground">/ 1KG bag</span>
                </p>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  Pick your mix across all four core colors and place high-volume orders quickly.
                </p>

                <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4">
                  <p className="text-sm font-semibold text-foreground">Bulk Order Builder</p>

                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <div>
                      <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        Total Target (KG)
                      </label>
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

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleApplyEqualSplit(targetTotalKg)}
                    >
                      Equal Split (25% each)
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSugarMix(createEmptySugarMix())}
                    >
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
                        <div
                          key={option.sku}
                          className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-border bg-background p-3"
                        >
                          <div>
                            <p className="font-semibold text-foreground">
                              {option.color}{' '}
                              <span className="text-sm font-normal text-muted-foreground">
                                ({option.flavor})
                              </span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              In cart: {cartQuantity} KG
                            </p>
                          </div>
                          <Input
                            type="number"
                            min={0}
                            value={sugarMix[option.sku]}
                            onChange={(event) =>
                              updateColorQuantity(option.sku, Number(event.target.value))
                            }
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
                    <Button
                      type="button"
                      className="w-full"
                      onClick={handleAddSugarMixToCart}
                      disabled={mixTotalKg <= 0}
                    >
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
                  Common order pattern: equal split across all four colors, then adjust by color as
                  needed.
                </p>
              </div>
            </div>

            <div className="card-elevated overflow-hidden">
              <div className="aspect-square overflow-hidden bg-muted">
                <img
                  src={sticksProduct}
                  alt="Bloomjoy branded cotton candy sticks"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="p-6">
                <h2 className="font-display text-xl font-semibold text-foreground">
                  Cotton Candy Sticks
                </h2>
                <p className="mt-1 font-display text-2xl font-bold text-primary">
                  ${currentSticksPrice}{' '}
                  <span className="text-base font-normal text-muted-foreground">/ pack</span>
                </p>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  Blank sticks are $12 per 100-pack. Custom logo/image sticks are $14 per 100-pack.
                  Compatible with all Bloomjoy machines.
                </p>

                <div className="mt-6 space-y-4">
                  <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/30 p-2">
                    <button
                      type="button"
                      onClick={() => setStickVariant('plain')}
                      className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                        stickVariant === 'plain'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Blank sticks ($12)
                    </button>
                    <button
                      type="button"
                      onClick={() => setStickVariant('custom')}
                      className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                        stickVariant === 'custom'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Custom sticks ($14)
                    </button>
                  </div>

                  <div className="flex items-end gap-3">
                    <div>
                      <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        Packs
                      </label>
                      <Input
                        type="number"
                        min={1}
                        value={sticksBulkPacks}
                        onChange={(event) => updateSticksBulkPacks(Number(event.target.value))}
                        className="mt-1 h-9 w-24 text-right"
                      />
                    </div>
                    {stickVariant === 'plain' ? (
                      <Button onClick={handleAddPlainSticks} className="flex-1">
                        <ShoppingCart className="mr-2 h-4 w-4" />
                        Add to Cart
                      </Button>
                    ) : (
                      <Button
                        onClick={handleSubmitCustomSticksRequest}
                        className="flex-1"
                        disabled={submittingCustomSticks}
                      >
                        {submittingCustomSticks ? 'Submitting...' : 'Submit Custom Request'}
                      </Button>
                    )}
                  </div>

                  {stickVariant === 'custom' && (
                    <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
                      <p className="text-sm text-muted-foreground">
                        Upload a logo/image and we will confirm proofing, production timing, and
                        final order details.
                      </p>

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

                      <div className="grid gap-3 sm:grid-cols-2">
                        <Input
                          placeholder="Contact name"
                          value={customContactName}
                          onChange={(event) => setCustomContactName(event.target.value)}
                        />
                        <Input
                          type="email"
                          placeholder="Email for proofing follow-up"
                          value={customContactEmail}
                          onChange={(event) => setCustomContactEmail(event.target.value)}
                        />
                      </div>

                      <Textarea
                        value={customRequestNotes}
                        onChange={(event) => setCustomRequestNotes(event.target.value)}
                        rows={3}
                        placeholder="Optional notes (brand colors, timeline, quantity split, etc.)"
                      />
                    </div>
                  )}
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Selected stick packs in cart: {currentSticksCartQuantity}
                </p>

                {cartSugarTotalKg > 0 && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Sugar currently in cart: {cartSugarTotalKg} KG
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
