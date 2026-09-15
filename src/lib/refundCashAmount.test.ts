import { resolveCashReviewAmountCents } from './refundCashAmount.ts';

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, received ${actual}`);
};

Deno.test('cash review amount keeps an omitted evidence value on the manual estimate path', () => {
  assertEquals(resolveCashReviewAmountCents(1250, undefined), 1250, 'omitted evidence should use estimate');
});

Deno.test('cash review amount keeps explicit unavailable evidence distinct from the estimate', () => {
  assertEquals(resolveCashReviewAmountCents(1250, null), null, 'explicit unavailable evidence should stay unavailable');
});
