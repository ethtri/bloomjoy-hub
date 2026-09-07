/// <reference lib="deno.ns" />

import { formatRefundMachineLocation } from './refundMachineLabel.ts';

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, received ${actual}`);
};

Deno.test('refund machine summaries do not repeat a delimiter-bounded location', () => {
  assertEquals(
    formatRefundMachineLocation('Colorado Mills', 'Colorado Mills — Cotton Candy'),
    'Colorado Mills — Cotton Candy',
    'location prefix',
  );
  assertEquals(
    formatRefundMachineLocation('Colorado Mills', 'Cotton Candy at Colorado Mills'),
    'Cotton Candy at Colorado Mills',
    'location suffix',
  );
  assertEquals(
    formatRefundMachineLocation('Mall Atrium', 'Cotton Candy 01'),
    'Mall Atrium - Cotton Candy 01',
    'distinct location and machine',
  );
  assertEquals(
    formatRefundMachineLocation('Mall', 'Small Machine'),
    'Mall - Small Machine',
    'partial word is not a location match',
  );
  assertEquals(
    formatRefundMachineLocation('Colorado Mills', 'Bloomjoy at Colorado Mills entrance'),
    'Colorado Mills - Bloomjoy at Colorado Mills entrance',
    'middle phrase is not treated as the published location prefix or suffix',
  );
  assertEquals(
    formatRefundMachineLocation('Unmapped Arcade', 'Cotton Candy 03'),
    'Cotton Candy 03',
    'placeholder location',
  );
});
