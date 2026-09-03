import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { parseNayaxRefundVerification } from './nayax-refund-verification.ts';
import { resolveNayaxRefundExecutionConfig } from './nayax-refund-gates.ts';
const expected = { caseId: 'ad400000-0000-4000-8000-000000000001', caseVersion: 5, attemptGeneration: 2,
  transactionId: '6037169004', siteId: 6, amountCents: 800 };
const now = Date.parse('2026-09-03T13:30:00Z');
const evidence = { id: 'ad800000-0000-4000-8000-000000000001', ...expected,
  machineAuthorizationTime: '2026-08-26T13:17:08.123', remainingRefundableAmountCents: 800,
  currencyCode: 'USD', observedAt: '2026-09-03T13:29:00Z', expiresAt: '2026-09-03T13:34:00Z' };
Deno.test('fresh verification preserves machine identity, not the GMT matching clock', () => {
  assertEquals(parseNayaxRefundVerification(evidence, expected, now)?.machineAuthorizationTime, '2026-08-26T13:17:08.123');
});
Deno.test('stale, partial, malformed and cross-case evidence never unlocks execution', () => {
  const invalid = [null, {}, [], { caseId: 'another-case' }, { caseVersion: 4 }, { attemptGeneration: 1 },
    { transactionId: '6037169005' }, { siteId: 4 }, { remainingRefundableAmountCents: 700 },
    { remainingRefundableAmountCents: 0 }, { currencyCode: 'CAD' }, { expiresAt: '2026-09-03T13:30:00Z' },
    { expiresAt: '2026-09-03T14:30:00Z' }, { machineAuthorizationTime: '2026-02-30T13:17:08.123' }];
  for (const change of invalid) {
    const input = change === null || Array.isArray(change) ? change : Object.keys(change).length ? { ...evidence, ...change } : {};
    assertEquals(parseNayaxRefundVerification(input, expected, now), null, JSON.stringify(change));
  }
});
Deno.test('flags alone cannot establish remaining value; verified evidence does not override a pause', () => {
  const flags: Record<string, string> = { NAYAX_REFUND_EXECUTION_KILL_SWITCH: 'false', NAYAX_REFUND_EXECUTION_ENABLED: 'true',
    NAYAX_REFUND_EXECUTION_DRY_RUN: 'false', NAYAX_REFUND_IDEMPOTENCY_SECRET: 'a'.repeat(43),
    NAYAX_REFUND_EXECUTOR_ASSERTION: 'b'.repeat(43), NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED: 'true', NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED: 'true' };
  assertEquals(resolveNayaxRefundExecutionConfig((name) => flags[name]).blocks, ['provider_remaining_value_unverified']);
  assertEquals(resolveNayaxRefundExecutionConfig((name) => flags[name], { remainingValueVerified: true }).blocks, []);
  flags.NAYAX_REFUND_EXECUTION_KILL_SWITCH = 'true';
  assertEquals(resolveNayaxRefundExecutionConfig((name) => flags[name], { remainingValueVerified: true }).blocks, ['kill_switch_active']);
});
