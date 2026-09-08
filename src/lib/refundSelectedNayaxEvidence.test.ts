/// <reference lib="deno.ns" />

import { assertEquals } from 'jsr:@std/assert@1';
import {
  isSupportedRefundSelectedNayaxMatchExplanation,
  REFUND_SELECTED_NAYAX_MATCH_EXPLANATION_LIMIT,
  REFUND_SELECTED_NAYAX_MATCH_FACTOR_LABEL_LIMIT,
  REFUND_SELECTED_NAYAX_MATCH_FACTOR_LIMIT,
} from './refundSelectedNayaxEvidence.ts';

Deno.test('selected Nayax explanations accept the producer maximum', () => {
  const labels = Array.from(
    { length: REFUND_SELECTED_NAYAX_MATCH_FACTOR_LIMIT },
    () => 'x'.repeat(REFUND_SELECTED_NAYAX_MATCH_FACTOR_LABEL_LIMIT),
  );
  const generatedExplanation = labels.join('; ');

  assertEquals(generatedExplanation.length, REFUND_SELECTED_NAYAX_MATCH_EXPLANATION_LIMIT);
  assertEquals(isSupportedRefundSelectedNayaxMatchExplanation(generatedExplanation), true);
  assertEquals(
    isSupportedRefundSelectedNayaxMatchExplanation(`${generatedExplanation}x`),
    false,
  );
});

Deno.test('selected Nayax explanations accept the demonstrated generated shape', () => {
  const generatedExplanation = [
    'Bloomjoy does not have a reliable original request receipt time for this case; compare the transaction manually',
    'Exact mapped machine and location',
    'Transaction amount differs by $1.50; this may reflect tax or rounding',
    'Nayax recorded Selection 1',
    'Customer-reported purchase time cannot be compared with this provider processing timestamp',
    'No verified machine QR start time is available',
    'Card last four matches',
    'Customer card type is unknown',
    'Currency is USD',
    "Nayax returned this transaction from the machine's Last Sales feed",
  ].join('; ');

  assertEquals(generatedExplanation.length, 525);
  assertEquals(isSupportedRefundSelectedNayaxMatchExplanation(generatedExplanation), true);
  assertEquals(isSupportedRefundSelectedNayaxMatchExplanation('   '), false);
});
