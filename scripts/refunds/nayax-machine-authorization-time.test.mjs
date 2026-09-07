import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNayaxMachineAuthorizationTime } from '../../supabase/functions/_shared/nayax-machine-authorization-time.mjs';
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
test('invalid calendars, guessed formats, whitespace and unsafe zones are rejected', () => {
  for (const value of [null, '2026-02-29T13:17:08', '2026-02-30T13:17:08Z', '2026-04-31T13:17:08',
    '2026-08-26T24:00:00Z', '2026-08-26T13:60:00', '2026-08-26T13:17:60', '2026-08-26T13:17:08+15:00',
    '2026-08-26T13:17:08+14:01', '2026-08-26 13:17:08', '2026-08-26T13:17:08Z ', '2026-08-26']) {
    assert.throws(() => parseNayaxMachineAuthorizationTime(value));
  }
});
