/// <reference lib="deno.ns" />
import { refundCustomerText, refundSpanishCopy } from './refundCustomerCopy.ts';

Deno.test('Spanish customer copy covers the new scenarios, timing, errors and continuation', () => {
  for (const key of ['Received fewer items than I paid for', 'Expected change from a cash payment', 'Cash inserted', 'Change you expected', 'Your request is being reviewed', 'Enter the change you expected.', 'Check refund status']) {
    if (refundCustomerText(key, 'es') === key) throw new Error(`Missing Spanish translation: ${key}`);
    if (refundCustomerText(key, 'en') !== key) throw new Error('English copy changed unexpectedly');
  }
  for (const [english, spanish] of Object.entries(refundSpanishCopy)) {
    if (!spanish.trim() || english === spanish) throw new Error(`Untranslated customer copy: ${english}`);
  }
  if (refundCustomerText(refundCustomerText('Enter the change you expected.', 'es'), 'en') !== 'Enter the change you expected.') throw new Error('Visible validation did not switch back to English');
});
