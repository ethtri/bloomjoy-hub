import {
  CUSTOM_STICKS_FIRST_ORDER_PLATE_FEE,
  STICKS_PIECES_PER_BOX,
  STICKS_PRICE_PER_BOX,
} from '@/lib/sticks';

export interface Product {
  sku: string;
  name: string;
  type: 'machine' | 'supply';
  price: number;
  description: string;
  shortDescription: string;
  features: string[];
  limitations?: string[];
  ctaType: 'quote' | 'buy' | 'waitlist';
  inStock: boolean;
  image?: string;
}

export const products: Record<string, Product> = {
  'commercial-robotic': {
    sku: 'commercial-robotic',
    name: 'Bloomjoy Sweets Commercial Machine',
    type: 'machine',
    price: 6250,
    description: 'Full-size commercial robotic cotton candy machine designed for high-throughput venues. Automated stick dispensing, complex pattern capabilities, and built for continuous operation. Commercial-only custom wrap is available and finalized offline with the Bloomjoy design team.',
    shortDescription: 'Full-size commercial robotic machine for high-volume venues, from $6,250 base',
    features: [
      'Automatic stick dispensing',
      'Complex pattern capabilities',
      'High throughput for events and venues',
      'Built for continuous commercial operation',
      'Commercial wrap options: standard Bloomjoy wrap or custom wrap',
      'Manufacturer 24/7 technical support via WeChat',
      'Bloomjoy concierge onboarding assistance'
    ],
    ctaType: 'quote',
    inStock: true,
  },
  'mini': {
    sku: 'mini',
    name: 'Bloomjoy Sweets Mini Machine',
    type: 'machine',
    price: 4000,
    description: 'Portable robotic cotton candy machine at 1/5 the size of our commercial unit. Capable of most complex patterns while fitting in smaller spaces.',
    shortDescription: 'Portable robotic machine, 1/5 the size, complex patterns',
    features: [
      'Portable design (1/5 size of commercial)',
      'Most complex pattern capabilities',
      'Ideal for mobile operators',
      'Compact footprint for small venues'
    ],
    limitations: [
      'No automatic stick dispenser—operator manually feeds each stick'
    ],
    ctaType: 'waitlist',
    inStock: false,
  },
  'micro': {
    sku: 'micro',
    name: 'Bloomjoy Sweets Micro Machine',
    type: 'machine',
    price: 2200,
    description: 'Entry-level robotic cotton candy machine for basic shapes. Perfect for home use or low-volume applications.',
    shortDescription: 'Entry-level machine for basic shapes, $2,200',
    features: [
      'Affordable entry point',
      'Simple operation',
      'Compact size'
    ],
    limitations: [
      'Basic shapes only—not suitable for complex patterns'
    ],
    ctaType: 'buy',
    inStock: true,
  },
  'sugar-white-1kg': {
    sku: 'sugar-white-1kg',
    name: 'Premium Cotton Candy Sugar - White (Milk)',
    type: 'supply',
    price: 8,
    description: 'Optimized granularity, dust-free formula for consistent spins. Resealable 1KG bags for freshness and easy storage.',
    shortDescription: 'White (milk) flavor, 1KG resealable bag',
    features: [
      'Optimized granularity for robotic machines',
      'Dust-free formula',
      'Consistent spin performance',
      'Resealable 1KG bags',
      'Quality controlled production'
    ],
    ctaType: 'buy',
    inStock: true,
  },
  'sugar-blue-1kg': {
    sku: 'sugar-blue-1kg',
    name: 'Premium Cotton Candy Sugar - Blue (Blueberry)',
    type: 'supply',
    price: 8,
    description: 'Optimized granularity, dust-free formula for consistent spins. Resealable 1KG bags for freshness and easy storage.',
    shortDescription: 'Blue (blueberry) flavor, 1KG resealable bag',
    features: [
      'Optimized granularity for robotic machines',
      'Dust-free formula',
      'Consistent spin performance',
      'Resealable 1KG bags',
      'Quality controlled production'
    ],
    ctaType: 'buy',
    inStock: true,
  },
  'sugar-orange-1kg': {
    sku: 'sugar-orange-1kg',
    name: 'Premium Cotton Candy Sugar - Orange',
    type: 'supply',
    price: 8,
    description: 'Optimized granularity, dust-free formula for consistent spins. Resealable 1KG bags for freshness and easy storage.',
    shortDescription: 'Orange flavor, 1KG resealable bag',
    features: [
      'Optimized granularity for robotic machines',
      'Dust-free formula',
      'Consistent spin performance',
      'Resealable 1KG bags',
      'Quality controlled production'
    ],
    ctaType: 'buy',
    inStock: true,
  },
  'sugar-red-1kg': {
    sku: 'sugar-red-1kg',
    name: 'Premium Cotton Candy Sugar - Red (Strawberry)',
    type: 'supply',
    price: 8,
    description: 'Optimized granularity, dust-free formula for consistent spins. Resealable 1KG bags for freshness and easy storage.',
    shortDescription: 'Red (strawberry) flavor, 1KG resealable bag',
    features: [
      'Optimized granularity for robotic machines',
      'Dust-free formula',
      'Consistent spin performance',
      'Resealable 1KG bags',
      'Quality controlled production'
    ],
    ctaType: 'buy',
    inStock: true,
  },
  'sticks-plain': {
    sku: 'sticks-plain',
    name: 'Blank Cotton Candy Sticks',
    type: 'supply',
    price: STICKS_PRICE_PER_BOX,
    description:
      'Plain paper sticks, 2000 pieces per box. Available in Commercial/Full 10mm x 300mm and Mini 10mm x 220mm sizes.',
    shortDescription: `${STICKS_PIECES_PER_BOX} plain paper sticks per box`,
    features: [
      'Compatible with all Bloomjoy machines',
      'Food-grade materials',
      '10mm x 300mm and 10mm x 220mm sizes',
      `${STICKS_PIECES_PER_BOX} sticks per box`
    ],
    ctaType: 'buy',
    inStock: true,
  },
  'sticks-custom': {
    sku: 'sticks-custom',
    name: 'Custom Logo Cotton Candy Sticks',
    type: 'supply',
    price: STICKS_PRICE_PER_BOX,
    description:
      'Custom logo/image paper sticks, 2000 pieces per box. Artwork proofing is required before fulfillment and the first custom order adds a plate fee.',
    shortDescription: `${STICKS_PIECES_PER_BOX} custom paper sticks per box`,
    features: [
      'Compatible with all Bloomjoy machines',
      'Custom logo/image branding support',
      '10mm x 300mm and 10mm x 220mm sizes',
      `${STICKS_PIECES_PER_BOX} sticks per box`,
      `$${CUSTOM_STICKS_FIRST_ORDER_PLATE_FEE} first-order plate fee`
    ],
    ctaType: 'buy',
    inStock: true,
  },
};

export const machines = Object.values(products).filter((p) => p.type === 'machine');
export const supplies = Object.values(products).filter((p) => p.type === 'supply');
