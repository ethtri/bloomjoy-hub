import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNayaxMachineAuthorizationTimeWireValue,
  parseNayaxMachineAuthorizationTime,
} from '../../supabase/functions/_shared/nayax-machine-authorization-time.mjs';
import { buildNayaxRefundRequestBody, buildNayaxRefundApprovalBody } from '../../supabase/functions/_shared/nayax-refund-provider.mjs';
test('Nayax raw machine time and all fractional digits survive both wire bodies unchanged', () => {
  for (const raw of ['2026-08-26T13:17:08.123', '2026-08-26T13:17:08.1234567', '2026-08-26T13:17:08',
    '2026-08-26T13:17:08.123-05:00', '2024-02-29T13:17:08Z']) {
    const input = { transactionId: '6037169004', siteId: 6, machineAuthorizationTime: raw };
    assert.equal(parseNayaxMachineAuthorizationTime(raw), raw);
    const request = buildNayaxRefundRequestBody({ ...input, amountCents: 800, contract: { amountUnit: 'major', refundEmailListMode: 'omit' } });
    const approval = buildNayaxRefundApprovalBody(input);
    assert.equal(request.MachineAuTime, raw);
    assert.equal(approval.MachineAuTime, request.MachineAuTime);
    assert.equal(approval.TransactionId, request.TransactionId);
    assert.equal(approval.SiteId, request.SiteId);
  }
});
test('bound-offset mode preserves the exact raw wall clock and fractional precision', () => {
  for (const input of [
    {
      rawValue: '2026-09-05T12:18:30.48',
      normalizedInstant: '2026-09-05T16:18:30.48Z',
      expected: '2026-09-05T12:18:30.48-04:00',
    },
    {
      rawValue: '2026-09-05T13:47:39.017',
      normalizedInstant: '2026-09-05T20:47:39.017+00:00',
      expected: '2026-09-05T13:47:39.017-07:00',
    },
  ]) {
    assert.equal(buildNayaxMachineAuthorizationTimeWireValue({
      ...input,
      mode: 'source_with_bound_offset',
    }), input.expected);
    assert.equal(buildNayaxMachineAuthorizationTimeWireValue({
      ...input,
      mode: 'exact_source',
    }), input.rawValue);
  }
});
test('bound-offset mode rejects changed instants, precision, non-minute offsets and overflow', () => {
  for (const input of [
    { rawValue: '2026-09-05T12:18:30.48', normalizedInstant: '2026-09-05T16:18:31.48Z' },
    { rawValue: '2026-09-05T12:18:30.48', normalizedInstant: '2026-09-05T16:18:30.4801Z' },
    { rawValue: '2026-09-05T12:18:30.48', normalizedInstant: '2026-09-05T16:18:00.48Z' },
    { rawValue: '2026-09-05T12:18:30.48', normalizedInstant: '2026-09-06T16:18:30.48Z' },
    { rawValue: '2026-09-05T12:18:30.1234567', normalizedInstant: '2026-09-05T16:18:30.1234567Z' },
  ]) {
    assert.throws(() => buildNayaxMachineAuthorizationTimeWireValue({
      ...input,
      mode: 'source_with_bound_offset',
    }));
  }
});
test('invalid calendars, guessed formats, whitespace and unsafe zones are rejected', () => {
  for (const value of [null, '2026-02-29T13:17:08', '2026-02-30T13:17:08Z', '2026-04-31T13:17:08',
    '2026-08-26T24:00:00Z', '2026-08-26T13:60:00', '2026-08-26T13:17:60', '2026-08-26T13:17:08+15:00',
    '2026-08-26T13:17:08+14:01', '2026-08-26 13:17:08', '2026-08-26T13:17:08Z ', '2026-08-26']) {
    assert.throws(() => parseNayaxMachineAuthorizationTime(value));
  }
});
