#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { Webhook } from 'svix';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [migration, shared, messageSend, operations, refundsPage, databaseTest] =
  await Promise.all([
    read('supabase/migrations/20260901070000_refund_transactional_delivery_truth.sql'),
    read('supabase/functions/_shared/refund-transactional-delivery.ts'),
    read('supabase/functions/refund-case-message-send/index.ts'),
    read('src/lib/refundOperations.ts'),
    read('src/pages/admin/Refunds.tsx'),
    read('supabase/tests/refund_transactional_delivery_truth.sql'),
  ]);

for (const token of [
  'refund_transactional_delivery_events',
  'service_mark_refund_transactional_delivery_attempt',
  'service_bind_refund_transactional_delivery',
  'service_record_refund_transactional_delivery_event',
  'refund_transactional_delivery_v1',
  'review_delivery_no_resend',
  'paymentReplayAllowed',
]) {
  assert.ok(migration.includes(token), `Migration is missing ${token}.`);
}
assert.ok(
  /revoke all on table public\.refund_transactional_delivery_events\r?\n  from service_role/.test(migration),
  'Provider delivery events must remain private behind security-definer RPCs.'
);
assert.ok(
  !/refund_transactional_delivery_events\s*\([^)]*(payload|recipient|subject|body)/is.test(migration),
  'The provider event ledger must not persist webhook payload or customer content.'
);
assert.ok(
  migration.includes("when 'complained' then 6") &&
    migration.includes('refund_transactional_delivery_state_rank'),
  'Out-of-order events require a monotonic terminal-state rank.'
);

assert.ok(shared.includes('sha256Hex') && shared.includes('payloadRedacted'));
assert.ok(messageSend.includes('new Webhook(secret).verify(rawBody'));
assert.ok(messageSend.includes('service_record_refund_transactional_delivery_event'));
const webhookHandler = messageSend.slice(
  messageSend.indexOf('const handleTransactionalDeliveryWebhook'),
  messageSend.indexOf('serve(async')
);
assert.ok(!webhookHandler.includes('sendRefundTransactionalEmail('));
assert.ok(!webhookHandler.includes('nayax-card-refund'));

// Exercise the actual HTTP handler with the installed signature library. Svix
// 2.2 verifies signatures without returning the decoded JSON payload.
const sharedJavaScript = ts.transpileModule(shared, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { parseRefundTransactionalDeliveryWebhook, sha256Hex } = await import(
  `data:text/javascript;base64,${Buffer.from(sharedJavaScript).toString('base64')}`
);
const secret = 'whsec_c3ludGhldGljX3JlZnVuZF93ZWJob29rX3Rlc3Q=';
const signer = new Webhook(secret);
const rpcCalls = [];
const handlerJavaScript = ts.transpileModule(webhookHandler, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const handleWebhook = vm.runInNewContext(`${handlerJavaScript}\nhandleTransactionalDeliveryWebhook`, {
  Webhook,
  Deno: { env: { get: (name) => name === 'RESEND_REFUND_WEBHOOK_SECRET' ? secret : undefined } },
  supabase: { rpc: async (name, args) => {
    rpcCalls.push({ name, args });
    return { data: { payloadRedacted: true, matched: true, applied: true }, error: null };
  } },
  jsonResponse: (body, status = 200) => Response.json(body, { status }),
  parseRefundTransactionalDeliveryWebhook,
  sha256Hex,
  console,
});
const eventId = 'synthetic-refund-delivery-event';
const signedRequest = (body, { at = new Date(), mutate = (value) => value, headers = {} } = {}) => {
  const signature = signer.sign(eventId, at, body);
  return new Request('https://example.test/refund-webhook', {
    method: 'POST',
    headers: {
      'svix-id': eventId,
      'svix-timestamp': String(Math.floor(at.getTime() / 1000)),
      'svix-signature': signature,
      ...headers,
    },
    body: mutate(body),
  });
};
const deliveredBody = JSON.stringify({
  type: 'email.delivered', created_at: '2026-09-03T00:00:00Z',
  data: { email_id: 'synthetic_delivery_123' },
});
for (const options of [
  { headers: { 'svix-signature': '' } },
  { headers: { 'svix-signature': 'v1,invalid' } },
  { mutate: (body) => `${body} ` },
  { at: new Date(Date.now() - 3_600_000) },
]) {
  assert.equal((await handleWebhook(signedRequest(deliveredBody, options))).status, 401);
}
assert.equal((await handleWebhook(signedRequest('{invalid json'))).status, 400);
assert.equal((await handleWebhook(signedRequest(JSON.stringify({ type: 'email.delivered', data: {} })))).status, 400);
const unsupported = await handleWebhook(signedRequest(JSON.stringify({ type: 'refund.release_auth_probe', data: {} })));
assert.equal(unsupported.status, 200, 'A correctly signed unsupported event must be ignored after verification.');
assert.deepEqual(await unsupported.json(), { accepted: true, tracked: false, payloadRedacted: true });
assert.equal(rpcCalls.length, 0, 'Invalid and unsupported events must not reach the delivery ledger.');
const delivered = await handleWebhook(signedRequest(deliveredBody));
assert.equal(delivered.status, 200, 'A correctly signed delivery event must reach the ledger.');
assert.deepEqual(await delivered.json(), { accepted: true, tracked: true, duplicate: false, matched: true, applied: true, payloadRedacted: true });
assert.equal(rpcCalls.length, 1);
assert.equal(rpcCalls[0].name, 'service_record_refund_transactional_delivery_event');
assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls[0].args)), {
  p_event_key_digest: await sha256Hex(eventId),
  p_provider_message_id: 'synthetic_delivery_123',
  p_delivery_state: 'delivered',
  p_event_at: '2026-09-03T00:00:00.000Z',
});

assert.ok(operations.includes("transactionalDeliveryContractVersion?: 'refund_transactional_delivery_v1'"));
assert.ok(operations.includes('requireRefundTransactionalDeliveryCase'));
for (const label of [
  'Accepted by provider',
  'Delivered',
  'Delivery delayed',
  'Bounced',
  'Complaint reported',
  'Delivery unknown',
]) {
  assert.ok(refundsPage.includes(label), `Manager UI is missing ${label}.`);
}
assert.ok(refundsPage.includes('isNeedsActionCase'));
assert.ok(refundsPage.includes('do not resend the message or retry a payment blindly'));

assert.ok(databaseTest.includes('select plan(20)'));
assert.ok(databaseTest.includes('Webhook-before-bind evidence is retained'));
assert.ok(databaseTest.includes('Delivery events create no message replay and no payment attempt'));
assert.ok(databaseTest.includes('Internal/test classification suppresses direct provider delivery attempts'));

console.log('Refund transactional delivery validator passed.');
