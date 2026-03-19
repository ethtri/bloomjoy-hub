export const STICKS_SKU_PLAIN = 'sticks-plain';
export const STICKS_SKU_CUSTOM = 'sticks-custom';
export const STICKS_PRICE_PER_BOX = 130;
export const STICKS_PIECES_PER_BOX = 2000;
export const CUSTOM_STICKS_FIRST_ORDER_PLATE_FEE = 750;
export const BLANK_STICKS_BUSINESS_SHIPPING_PER_BOX = 35;
export const BLANK_STICKS_RESIDENTIAL_SHIPPING_PER_BOX = 40;
export const BLANK_STICKS_FREE_SHIPPING_BOX_THRESHOLD = 5;

export const STICK_SIZE_OPTIONS = [
  {
    value: 'commercial_10x300',
    label: 'Commercial / Full Machine',
    detail: '10mm x 300mm paper sticks',
  },
  {
    value: 'mini_10x220',
    label: 'Mini Machine',
    detail: '10mm x 220mm paper sticks',
  },
] as const;

export type StickSize = (typeof STICK_SIZE_OPTIONS)[number]['value'];

export const BLANK_STICKS_ADDRESS_TYPE_OPTIONS = [
  {
    value: 'business',
    label: 'Business address',
    shippingRatePerBox: BLANK_STICKS_BUSINESS_SHIPPING_PER_BOX,
  },
  {
    value: 'residential',
    label: 'Residential address',
    shippingRatePerBox: BLANK_STICKS_RESIDENTIAL_SHIPPING_PER_BOX,
  },
] as const;

export type BlankSticksAddressType =
  (typeof BLANK_STICKS_ADDRESS_TYPE_OPTIONS)[number]['value'];

export type StickVariant = 'plain' | 'custom';

export const normalizeStickBoxCount = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.floor(value));
};

export const shouldUseBlankSticksDirectCheckout = (boxCount: number): boolean =>
  normalizeStickBoxCount(boxCount) >= BLANK_STICKS_FREE_SHIPPING_BOX_THRESHOLD;

export const getStickSizeOption = (stickSize: StickSize) =>
  STICK_SIZE_OPTIONS.find((option) => option.value === stickSize);

export const getStickSizeLabel = (stickSize: StickSize): string => {
  const option = getStickSizeOption(stickSize);
  return option ? `${option.label} (${option.detail})` : stickSize;
};

export const getBlankSticksAddressTypeOption = (
  addressType: BlankSticksAddressType
) =>
  BLANK_STICKS_ADDRESS_TYPE_OPTIONS.find((option) => option.value === addressType);

export const getBlankSticksAddressTypeLabel = (
  addressType: BlankSticksAddressType
): string => {
  const option = getBlankSticksAddressTypeOption(addressType);
  return option?.label ?? addressType;
};

export const getBlankSticksShippingRatePerBox = (
  addressType: BlankSticksAddressType
): number =>
  getBlankSticksAddressTypeOption(addressType)?.shippingRatePerBox ??
  BLANK_STICKS_RESIDENTIAL_SHIPPING_PER_BOX;

export const getBlankSticksShippingTotal = (
  boxCount: number,
  addressType: BlankSticksAddressType
): number => {
  const normalizedBoxCount = normalizeStickBoxCount(boxCount);

  if (shouldUseBlankSticksDirectCheckout(normalizedBoxCount)) {
    return 0;
  }

  return normalizedBoxCount * getBlankSticksShippingRatePerBox(addressType);
};

export const formatBlankSticksShippingSummary = (
  boxCount: number,
  addressType: BlankSticksAddressType
): string => {
  const normalizedBoxCount = normalizeStickBoxCount(boxCount);

  if (shouldUseBlankSticksDirectCheckout(normalizedBoxCount)) {
    return 'Free shipping (5+ boxes)';
  }

  const perBoxRate = getBlankSticksShippingRatePerBox(addressType);
  const total = getBlankSticksShippingTotal(normalizedBoxCount, addressType);

  return `$${total} estimated shipping total ($${perBoxRate}/box)`;
};
