/// <reference lib="deno.ns" />

import {
  canManagePlusBilling,
  needsPlusBillingAttention,
  needsPlusCheckoutCompletion,
  normalizeMembershipStatus,
} from './membership.ts';

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test('Plus billing recovery statuses stay visible to the account owner', () => {
  for (const status of ['past_due', 'unpaid', 'paused'] as const) {
    assert(canManagePlusBilling(status), `${status} should open billing recovery`);
    assert(needsPlusBillingAttention(status), `${status} should show a warning state`);
  }
});

Deno.test('incomplete Plus starts by resuming Checkout rather than Billing', () => {
  assert(needsPlusCheckoutCompletion('incomplete'), 'incomplete should resume Checkout');
  assert(!canManagePlusBilling('incomplete'), 'incomplete must not open the billing portal');
  assert(!needsPlusBillingAttention('incomplete'), 'incomplete is not an invoice recovery state');
});

Deno.test('ended Plus subscriptions can start a new checkout', () => {
  for (const status of ['canceled', 'incomplete_expired', 'inactive', 'none'] as const) {
    assert(!canManagePlusBilling(status), `${status} should not be treated as a live billing record`);
  }
});

Deno.test('Stripe subscription statuses are not collapsed into none', () => {
  for (const status of [
    'active',
    'trialing',
    'past_due',
    'unpaid',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'paused',
  ] as const) {
    assert(normalizeMembershipStatus(status) === status, `${status} should remain visible`);
  }
});
