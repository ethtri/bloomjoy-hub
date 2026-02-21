import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Minus, Package, Plus, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Layout } from '@/components/layout/Layout';
import { trackEvent } from '@/lib/analytics';
import { useCart } from '@/lib/cart';
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
import { toast } from 'sonner';
import sugarProduct from '@/assets/sugar-product.jpg';

const getSugarName = (color: string, flavor: string) =>
  `Premium Cotton Candy Sugar - ${color} (${flavor}) (1KG)`;

export default function SuppliesPage() {
  const { addItem, items, updateQuantity } = useCart();
  const [targetTotalKg, setTargetTotalKg] = useState(DEFAULT_BULK_SUGAR_KG);
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

  const handleAddSticks = () => {
    trackEvent('add_to_cart', { sku: 'sticks-plain', price: 12 });
    addItem(
      {
        sku: 'sticks-plain',
        name: 'Cotton Candy Sticks (100 pack)',
        price: 12,
        type: 'supply',
      },
      1
    );
    toast.success('Cotton Candy Sticks added to cart.');
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

                <div className="mt-6">
                  {getItemQuantity('sticks-plain') > 0 ? (
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 rounded-lg border border-border p-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() =>
                            updateQuantity('sticks-plain', getItemQuantity('sticks-plain') - 1)
                          }
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="w-8 text-center font-semibold">
                          {getItemQuantity('sticks-plain')}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() =>
                            updateQuantity('sticks-plain', getItemQuantity('sticks-plain') + 1)
                          }
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                      <span className="text-sm text-muted-foreground">in cart</span>
                    </div>
                  ) : (
                    <Button onClick={handleAddSticks} className="w-full">
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      Add to Cart
                    </Button>
                  )}
                </div>

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
