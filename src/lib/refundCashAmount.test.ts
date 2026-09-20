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

Deno.test('cash review amount uses an exact selected-sale amount when it is available', () => {
  assertEquals(resolveCashReviewAmountCents(1250, 1400, true), 1400, 'selected sale should replace estimate');
});

Deno.test('cash review amount does not expose an estimate while a durable selected sale is loading', () => {
  assertEquals(resolveCashReviewAmountCents(1250, undefined, true), null, 'bound sale should wait for its exact amount');
});

Deno.test('cash review amount keeps the estimate nonblocking when no sale is bound', () => {
  assertEquals(resolveCashReviewAmountCents(1250, undefined, false), 1250, 'no-link review should use estimate');
});
