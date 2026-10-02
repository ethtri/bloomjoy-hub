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

Deno.test('correction errors switch both directions without changing their meaning', () => {
  for (const english of [
    'We couldn’t open a fresh update. Your saved response is unchanged. Try again, or use the latest Bloomjoy email for help with this same request.',
    'Choose an answer for each requested detail. You can choose “Not sure / can’t provide” without guessing.',
    'Choose a saved detail to update or confirm. Your earlier answers are already saved.',
    'We couldn’t save this response. Your answers are still here. Try again, or reply to your Bloomjoy email for help with this same request.',
  ]) {
    const spanish = refundCustomerText(english, 'es');
    if (spanish === english || refundCustomerText(spanish, 'en') !== english) {
      throw new Error('Correction error did not switch between English and Spanish');
    }
  }
});
