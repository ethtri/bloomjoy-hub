import { deliverRefundContactOwnerClaim } from './refund-contact-owner-delivery.ts';
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const claim = () => ({ claimed: true, claimKind: 'customer_contact_owner_needed', requiredRefundActionsVersion: 1,
  actionId: '12810000-0000-4000-8000-000000000001', claimToken: '12810000-0000-4000-8000-000000000002',
  caseId: '12810000-0000-4000-8000-000000000003', recipients: ['operations@example.invalid'], routeFingerprint: 'a'.repeat(64),
  publicReference: 'RF-SYNTHETIC-1', machineLabel: 'Synthetic machine', payloadRedacted: true });

Deno.test('owner exception sends one purpose-specific message only after current route and quiet authorization', async () => {
  for (const allowed of [true, false]) {
    const calls: string[] = []; let sends = 0;
    const result = await deliverRefundContactOwnerClaim({ claim: claim(), caseUrl: id => `https://app.example.invalid/refunds?case=${id}`,
      client: { rpc: (name, args) => {
        calls.push(name);
        if (name === 'service_mark_refund_contact_owner_provider_started') {
          assert(JSON.stringify(args.p_recipients) === JSON.stringify(claim().recipients), 'Actual recipients are bound at provider boundary');
          return Promise.resolve({ data: allowed, error: null });
        }
        return Promise.resolve({ data: true, error: null });
      } }, sendEmail: async message => {
        sends++;
        assert(calls[0] === 'service_mark_refund_contact_owner_provider_started', 'Current authority before provider');
        assert(message.subject.startsWith('Customer contact needs an owner:'), 'Truthful Ops purpose');
        assert(message.text.includes('refund decision is saved') && !/approve or deny|Zelle|gift-card value|unsubscribe|Reminder:/.test(message.text), 'No new decision, money or reminder claim');
        assert((message.html.match(/<a href=/g) ?? []).length === 1, 'One case navigation action');
        assert(message.idempotencyKey === 'refund_manager_12810000000040008000000000000001', 'Existing durable action key');
        return { providerMessageId: 'synthetic-owner-notice' };
      } });
    assert(result === (allowed ? 'sent' : 'stale') && sends === (allowed ? 1 : 0), 'Stale route or quiet hours cannot send');
  }
});

Deno.test('owner exception ambiguity settles the existing unknown hold without a fresh attempt', async () => {
  let sends = 0; const outcomes: unknown[] = [];
  try {
    await deliverRefundContactOwnerClaim({ claim: claim(), caseUrl: id => `https://app.example.invalid/refunds?case=${id}`,
      client: { rpc: (name, args) => { if (name === 'service_complete_refund_manager_notification') outcomes.push(args.p_outcome); return Promise.resolve({ data: true, error: null }); } },
      sendEmail: () => { sends++; throw new Error('synthetic unknown transport'); } });
  } catch { /* Expected durable unknown hold. */ }
  assert(sends === 1 && outcomes.join() === 'delivery_unknown', 'No blind retry');
});

Deno.test('owner exception rejects legacy claims and private content before provider access', async () => {
  for (const invalid of [{ ...claim(), requiredRefundActionsVersion: 2 }, { ...claim(), customerEmail: 'private@example.invalid' }]) {
    let calls = 0; let rejected = false;
    try { await deliverRefundContactOwnerClaim({ claim: invalid, caseUrl: () => 'https://app.example.invalid/refunds',
      client: { rpc: () => { calls++; return Promise.resolve({ data: true, error: null }); } }, sendEmail: () => { throw new Error('must not send'); } }); }
    catch { rejected = true; }
    assert(rejected && calls === 0, 'Unsafe claim has no provider-side effects');
  }
});
