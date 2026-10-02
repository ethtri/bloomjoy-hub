import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createNayaxRefundProviderAdapter } from '../../supabase/functions/_shared/nayax-refund-provider.mjs';

test('documented Nayax amount contract sends $10 for a $30 purchase and binds replay', async () => {
  const contract = JSON.parse(fs.readFileSync(new URL('./fixtures/nayax-production-refund-contract.json', import.meta.url)));
  const calls = [];
  const provider = createNayaxRefundProviderAdapter({ contract,
    requestToken: 'synthetic-request-token', approveToken: 'synthetic-approve-token',
    evidence: { caseId: '11111111-1111-4111-8111-111111111111', transactionId: '123456781', siteId: 2,
      amountCents: 1000, currencyCode: 'USD', machineAuthorizationTime: '2026-01-02T13:47:39.017',
      machineAuthorizationTimeInstant: '2026-01-02T13:47:39.017Z',
      machineAuthorizationTimeWire: '2026-01-02T13:47:39.017' },
    fetchImpl: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ Result: 'Refund status updated successfully, but the email could not be sent', Status: 'Partial success' }),
        { status: 200, headers: { 'content-type': 'application/json' } }); },
    onStageEvent: async () => ({ approvalAuthorized: true, journalContractVersion: 'nayax-provider-journal-v3', payloadRedacted: true }),
  });
  const request = { caseId: '11111111-1111-4111-8111-111111111111', amountCents: 1000, currencyCode: 'USD', idempotencyKey: `nayax-refund-${'a'.repeat(64)}` };
  await provider.execute(request);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.RefundAmount, 10);
  assert.equal(calls[0].body.RefundEmailList, '');
  for (const key of ['TransactionId', 'SiteId', 'MachineAuTime']) assert.equal(calls[0].body[key], calls[1].body[key]);
  await assert.rejects(provider.execute({ ...request, amountCents: 3000 }), /frozen/);
  assert.equal(calls.length, 2);
});
