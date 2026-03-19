export const SUGAR_PRICE_PER_KG = 8;
export const MAX_SUGAR_KG_PER_COLOR = 50000;
export const MAX_SUGAR_KG_TOTAL = MAX_SUGAR_KG_PER_COLOR * 4;
export const DEFAULT_BULK_SUGAR_KG = 400;
export const BULK_SUGAR_PRESETS_KG = [240, 400, 800] as const;

export const SUGAR_COLOR_OPTIONS = [
  {
    sku: 'sugar-white-1kg',
    color: 'White',
    flavor: 'Milk',
    accentClass: 'bg-slate-100 text-slate-700',
  },
  {
    sku: 'sugar-blue-1kg',
    color: 'Blue',
    flavor: 'Blueberry',
    accentClass: 'bg-blue-100 text-blue-700',
  },
  {
    sku: 'sugar-orange-1kg',
    color: 'Orange',
    flavor: 'Orange',
    accentClass: 'bg-orange-100 text-orange-700',
  },
  {
    sku: 'sugar-red-1kg',
    color: 'Red',
    flavor: 'Strawberry',
    accentClass: 'bg-red-100 text-red-700',
  },
] as const;

export type SugarSku = (typeof SUGAR_COLOR_OPTIONS)[number]['sku'];

export const LEGACY_SUGAR_SKU = 'sugar-1kg';

export const ALL_SUGAR_SKUS = new Set<string>([
  ...SUGAR_COLOR_OPTIONS.map((option) => option.sku),
  LEGACY_SUGAR_SKU,
]);

export type SugarMix = Record<SugarSku, number>;

export interface SugarLineItemLike {
  sku: string;
  quantity: number;
}

const clampKg = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(MAX_SUGAR_KG_PER_COLOR, Math.floor(value));
};

const clampTotalKg = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(MAX_SUGAR_KG_TOTAL, Math.floor(value));
};

const getWhiteSku = () => SUGAR_COLOR_OPTIONS[0].sku;

const resolveSugarSku = (sku: string): SugarSku | null => {
  if (sku === LEGACY_SUGAR_SKU) {
    return getWhiteSku();
  }
  const matched = SUGAR_COLOR_OPTIONS.find((option) => option.sku === sku);
  return matched?.sku ?? null;
};

export const isSugarSku = (sku: string): boolean => ALL_SUGAR_SKUS.has(sku);

export const createEmptySugarMix = (): SugarMix =>
  Object.fromEntries(
    SUGAR_COLOR_OPTIONS.map((option) => [option.sku, 0])
  ) as SugarMix;

export const buildEqualSugarSplit = (totalKg: number): SugarMix => {
  const normalizedTotalKg = clampTotalKg(totalKg);
  const mix = createEmptySugarMix();
  const bucketCount = SUGAR_COLOR_OPTIONS.length;
  const basePerColor = Math.floor(normalizedTotalKg / bucketCount);
  const remainder = normalizedTotalKg % bucketCount;

  SUGAR_COLOR_OPTIONS.forEach((option, index) => {
    mix[option.sku] = basePerColor + (index < remainder ? 1 : 0);
  });

  return mix;
};

export const updateSugarMixQuantity = (
  mix: SugarMix,
  sku: SugarSku,
  quantity: number
): SugarMix => ({
  ...mix,
  [sku]: clampKg(quantity),
});

export const getSugarColorBreakdown = (items: SugarLineItemLike[]): SugarMix => {
  const mix = createEmptySugarMix();

  items.forEach((item) => {
    const resolvedSku = resolveSugarSku(item.sku);
    if (!resolvedSku) {
      return;
    }
    mix[resolvedSku] += clampKg(item.quantity);
  });

  return mix;
};

export const getSugarMixTotalKg = (mix: SugarMix): number =>
  Object.values(mix).reduce((sum, quantity) => sum + quantity, 0);
