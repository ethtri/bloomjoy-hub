/// <reference lib="deno.ns" />
import { assertEquals } from 'jsr:@std/assert@1';
import { buildRefundCustomerStatusDemo } from './refundCustomerStatusDemo.ts';
import { getRefundCustomerStatusCopy, refundCustomerLifecycleStages } from './refundCustomerStatus.ts';
import { spanishRefundStatusCopy } from './refundCustomerStatusSpanish.ts';
import { getRefundCompletionContactPresentation } from './refundCompletionContact.ts';

Deno.test('Spanish status preserves all lifecycle stages and next expectations', () => {
  for (const stage of refundCustomerLifecycleStages) {
    const lifecycle = buildRefundCustomerStatusDemo(stage);
    const english = getRefundCustomerStatusCopy(lifecycle);
    const spanish = spanishRefundStatusCopy(lifecycle, english);
    assertEquals(spanish.milestone, english.milestone);
    assertEquals(spanish.title === english.title, false);
    assertEquals(spanish.nextExpectation === english.nextExpectation, false);
  }
});

Deno.test('Spanish completion translates canonical contact facts without collapsing delivery outcomes', () => {
  const details = new Set<string>();
  for (const state of ['none', 'failed', 'delivery_unconfirmed', 'sent', 'delivered', 'pending', 'bounced', 'complained'] as const) {
    const lifecycle = { ...buildRefundCustomerStatusDemo('refund_confirmed'), messageState: { state, payloadRedacted: true as const } };
    const spanish = spanishRefundStatusCopy(lifecycle, getRefundCustomerStatusCopy(lifecycle));
    assertEquals(spanish.detail.includes('undefined'), false);
    assertEquals(/Nayax|4 días|reembolso completo/.test(spanish.detail), false);
    const canonical = getRefundCompletionContactPresentation(lifecycle);
    if (canonical.state !== 'pending') details.add(spanish.detail);
  }
  assertEquals(details.size, 7);
});
