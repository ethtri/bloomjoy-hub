import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { renderRefundGiftCardEmail } from './refund-gift-card-email.ts';

const input = { customerName: 'Synthetic Friend', value: 1500, currency: 'USD', code: 'TEST-SWEET-15',
  expiresAt: '2027-09-30T23:59:59Z', eligibleLocations: ['Bloomjoy Test Mall'],
  redemptionInstructions: 'Enter your code on the gift card screen at the machine.' };

Deno.test('gift card essential details are equally readable in HTML and plain text without images', () => {
  const email = renderRefundGiftCardEmail(input);
  for (const detail of ['$15.00', input.code, input.eligibleLocations[0], 'September 30, 2027', 'One use only', 'any unused value', input.redemptionInstructions]) {
    assertEquals(email.html.includes(detail), true);
    assertEquals(email.text.includes(detail), true);
  }
  assertEquals(email.html.includes('<img'), false);
  assertEquals(email.html.includes('href='), false);
});
Deno.test('email escapes customer text and cannot send incomplete redemption facts', () => {
  const email = renderRefundGiftCardEmail({ ...input, customerName: '<script>test</script>', code: 'TEST<&>' });
  assertEquals(email.html.includes('<script>'), false);
  assertEquals(email.html.includes('TEST&lt;&amp;&gt;'), true);
  assertThrows(() => renderRefundGiftCardEmail({ ...input, redemptionInstructions: '' }));
  assertThrows(() => renderRefundGiftCardEmail({ ...input, eligibleLocations: [] }));
});

Deno.test('Spanish preference keeps bilingual terms and the same redemption code', () => {
  const email = renderRefundGiftCardEmail({ ...input, customerLocale: 'es' });
  for (const detail of ['Un solo uso', 'One use only', 'Úsala en', 'Use at', 'UTC', input.code, input.redemptionInstructions]) {
    assertEquals(email.html.includes(detail), true);
    assertEquals(email.text.includes(detail), true);
  }
  assertEquals(renderRefundGiftCardEmail({ ...input, customerLocale: 'unknown' }).text, renderRefundGiftCardEmail(input).text);
});
