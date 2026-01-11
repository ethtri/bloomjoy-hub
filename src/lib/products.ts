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
    name: 'Bloomjoy Sweets Robotic Cotton Candy Machine',
    type: 'machine',
    price: 10000,
    description: 'Full-size commercial robotic cotton candy machine designed for high-throughput venues. Automated stick dispensing, complex pattern capabilities, and built for continuous operation.',
    shortDescription: 'Full-size commercial robotic machine for high-volume venues',
    features: [
      'Automatic stick dispensing',
      'Complex pattern capabilities',
      'High throughput for events and venues',
      'Built for continuous commercial operation',
      'Sunze 24/7 technical support via WeChat',
      'Bloomjoy concierge onboarding assistance'
    ],
    ctaType: 'quote',
    inStock: true,
  },
  'mini': {
    sku: 'mini',
    name: 'Bloomjoy Sweets Mini',
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
    name: 'Bloomjoy Sweets Micro',
    type: 'machine',
    price: 400,
    description: 'Entry-level robotic cotton candy machine for basic shapes. Perfect for home use or low-volume applications.',
    shortDescription: 'Entry-level machine for basic shapes',
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
  'sugar-1kg': {
    sku: 'sugar-1kg',
    name: 'Premium Cotton Candy Sugar',
    type: 'supply',
    price: 8,
    description: 'Optimized granularity, dust-free formula for consistent spins. Resealable 1KG bags for freshness and easy storage.',
    shortDescription: '1KG resealable bag, dust-free, consistent performance',
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
    name: 'Cotton Candy Sticks',
    type: 'supply',
    price: 12,
    description: 'Plain cotton candy sticks, pack of 100. Compatible with all Bloomjoy machines.',
    shortDescription: 'Pack of 100 plain sticks',
    features: [
      'Compatible with all Bloomjoy machines',
      'Food-grade materials',
      '100 sticks per pack'
    ],
    ctaType: 'buy',
    inStock: true,
  },
};

export const machines = Object.values(products).filter((p) => p.type === 'machine');
export const supplies = Object.values(products).filter((p) => p.type === 'supply');
