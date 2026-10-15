/// <reference lib="deno.ns" />
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { parseOrderQuantity } from './commerceQuantity.ts';
import { buildEqualSugarSplit, getSugarColorBreakdown, getSugarMixTotalKg, updateSugarMixQuantity } from './sugar.ts';

Deno.test('a 20 KG edit produces exactly 20 KG and a $200 standard subtotal', () => {
  const quantity = parseOrderQuantity('20', 0, 200_000)!;
  const mix = buildEqualSugarSplit(quantity);
  assertEquals(Object.values(mix), [5, 5, 5, 5]);
  assertEquals(getSugarMixTotalKg(mix), 20);
  assertEquals(getSugarMixTotalKg(mix) * 10, 200);
});

Deno.test('incomplete and invalid cart edits never become deletion quantities', () => {
  for (const draft of ['', ' ', '0', '-1', '1.5', '1e2', 'Infinity', '9007199254740992']) {
    assertEquals(parseOrderQuantity(draft), null, draft);
  }
  assertEquals(parseOrderQuantity('100'), 100);
  assertEquals(parseOrderQuantity('20'), 20);
});

Deno.test('zero is valid for an individual sugar color; existing limits stay explicit', () => {
  assertEquals(parseOrderQuantity('0', 0, 50_000), 0);
  assertEquals(parseOrderQuantity('50000', 0, 50_000), 50_000);
  assertEquals(parseOrderQuantity('50001', 0, 50_000), null);
  assertEquals(parseOrderQuantity('200000', 0, 200_000), 200_000);
  assertEquals(parseOrderQuantity('200001', 0, 200_000), null);
});

Deno.test('custom color edits and odd equal splits always sum to displayed total', () => {
  const mix = buildEqualSugarSplit(21);
  assertEquals(getSugarMixTotalKg(mix), 21);
  assertEquals(getSugarMixTotalKg(updateSugarMixQuantity(mix, 'sugar-white-1kg', 20)), 35);
});

Deno.test('cart summaries retain accepted quantities above the mix configurator per-color limit', () => {
  const breakdown = getSugarColorBreakdown([
    { sku: 'sugar-white-1kg', quantity: 60_000 },
    { sku: 'sugar-1kg', quantity: 10 },
    { sku: 'sugar-blue-1kg', quantity: 5 },
  ]);
  assertEquals(breakdown['sugar-white-1kg'], 60_010);
  assertEquals(getSugarMixTotalKg(breakdown), 60_015);
});
