import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { applyRefundLifecycleSafety } from './refundOperationsLifecycleSafety.ts';

Deno.test('malformed lifecycle keeps the case visible and disables official actions', () => {
  const result = applyRefundLifecycleSafety({
    id: 'case-1',
    lifecycle: {
      schemaVersion: 'refund_lifecycle_v2',
      accountingState: { state: 'pending' },
      managerNextAction: 'refund_operations',
    },
    canPerformOfficialAction: true,
    canSelectNayaxCandidate: true,
    officialActionBlockReason: null,
  });

  assertEquals(result, {
    refundCase: {
      id: 'case-1',
      lifecycle: null,
      canPerformOfficialAction: false,
      canSelectNayaxCandidate: false,
      officialActionBlockReason: 'official_actions_disabled',
    },
    invalidLifecycle: true,
  });
});

Deno.test('missing lifecycle is not reported as a malformed contract', () => {
  const result = applyRefundLifecycleSafety({ id: 'case-2', lifecycle: null });
  assertEquals(result.invalidLifecycle, false);
  assertEquals(result.refundCase.lifecycle, null);
});
