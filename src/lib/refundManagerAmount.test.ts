/// <reference lib="deno.ns" />
import { parseManagerRefundAmount, roundedManagerGiftAmount, resolveManagerRefundAmountDraft } from './refundManagerAmount.ts';

Deno.test('Manager can approve $10 of a $30 purchase and cannot exceed the selected charge', () => {
  if (parseManagerRefundAmount('10.00', 3000) !== 1000) throw new Error('Partial amount was lost');
  for (const value of ['30.01', '0', '-1', '1.005', '1e2', 'abc']) {
    if (parseManagerRefundAmount(value, 3000) !== null) throw new Error(`Invalid approval amount: ${value}`);
  }
});

Deno.test('Changing the selected purchase resets the default; clearing a draft never restores the full refund', () => {
  const draft = { key: 'case:transaction-a', value: '10' };
  if (resolveManagerRefundAmountDraft(draft, draft.key, 3000).cents !== 1000) throw new Error('Partial draft lost');
  if (resolveManagerRefundAmountDraft(draft, 'case:transaction-b', 2000).cents !== 2000) throw new Error('New purchase retained stale amount');
  if (resolveManagerRefundAmountDraft({ ...draft, value: '' }, draft.key, 3000).cents !== null) throw new Error('Blank draft fell back to full refund');
});

Deno.test('Gift rounding preserves the $25 review boundary and uses the affected portion', () => {
  if (roundedManagerGiftAmount(1000) !== 1000) throw new Error('Missing $10 item must stay $10');
  if (roundedManagerGiftAmount(2500) !== 2500) throw new Error('$25 must stay $25');
  if (roundedManagerGiftAmount(2501) !== 3000) throw new Error('Over $25 must round to $30');
});
