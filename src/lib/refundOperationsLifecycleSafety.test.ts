import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { applyRefundLifecycleSafety } from './refundOperationsLifecycleSafety.ts';

Deno.test('malformed lifecycle is localized without overriding authoritative action capability', () => {
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
      canPerformOfficialAction: true,
      canSelectNayaxCandidate: true,
      officialActionBlockReason: null,
    },
    invalidLifecycle: true,
  });
});

Deno.test('malformed lifecycle does not fabricate action capability fields', () => {
  const result = applyRefundLifecycleSafety({
    id: 'case-without-capability',
    lifecycle: { schemaVersion: 'unsupported_lifecycle_version' },
  });

  assertEquals(result, {
    refundCase: {
      id: 'case-without-capability',
      lifecycle: null,
    },
    invalidLifecycle: true,
  });
});

Deno.test('missing lifecycle is not reported as a malformed contract', () => {
  const result = applyRefundLifecycleSafety({ id: 'case-2', lifecycle: null });
  assertEquals(result.invalidLifecycle, false);
  assertEquals(result.refundCase.lifecycle, null);
});
