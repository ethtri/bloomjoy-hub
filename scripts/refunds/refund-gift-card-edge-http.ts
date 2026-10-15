import { assertEquals, assert } from 'jsr:@std/assert@1';
import { servers } from './fixtures/gift-card-edge-serve.ts';

// Actual intake/admin handlers and Supabase SDK, synthetic PostgREST/Auth only.
// No provider transport, database secrets, customer mail or financial writes.
const machineId = '81000000-0000-4000-8000-000000000001';
const caseId = '81000000-0000-4000-8000-000000000002';
const poolId = '81000000-0000-4000-8000-000000000003';
const derivedPoolId = '81000000-0000-4000-8000-000000000004';
const offer = { pool_id: poolId, value: 1500, currency: 'USD', eligible_locations: ['Synthetic location'],
  expires_at: '2030-01-01T00:00:00Z', one_use: true, redemption_instructions: 'Enter the synthetic code.' };
const gift = { state: 'issued', value: 1500, currency: 'USD', eligible_locations: offer.eligible_locations,
  expires_at: offer.expires_at, issued_at: new Date().toISOString(), delivery_state: 'queued' };
const requests: { path: string; method: string; body: Record<string, unknown>; authorization: string | null }[] = [];
const unexpected: string[] = [];
let activationError: string | null = null;
let enabled = true, quoteAvailable = true, templateValue = 1500, rpcError: string | null = null;
let reviewException = false;
let denialOutboxVersion: unknown = 1, denialDeliveryState = 'queued', denialState = 'denied';
const json = (data: unknown, status = 200) => Response.json(data, { status });
const db = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: () => {} }, async (req) => {
  const path = new URL(req.url).pathname;
  const body = req.method === 'POST' ? await req.json() : {};
  requests.push({ path, method: req.method, body, authorization: req.headers.get('authorization') });
  if (path === '/auth/v1/user') return json({ id: '81000000-0000-4000-8000-000000000009', email: 'manager@example.invalid', role: 'authenticated', is_anonymous: false });
  if (path.startsWith('/rest/v1/rpc/')) {
    const name = path.split('/').at(-1);
    if (name === 'service_begin_refund_manager_notification') return json({ claimed: false, actionId: caseId, attentionVersion: 1, channel: 'portal_only', deliveryState: 'portal_only' });
    if (name === 'service_refund_gift_card_enabled') return activationError ? json({ code: activationError, message: 'Synthetic activation query failure' }, 404) : json(enabled);
    if (name === 'service_get_refund_gift_card_offer') return json(quoteAvailable ? offer : null);
    if (name === 'service_materialize_refund_gift_card_offer') return json({ ...offer, pool_id: derivedPoolId });
    if (name === 'service_refund_machine_is_public') return json(true);
    if (name === 'record_public_intake_rate_limit_event') return json(1);
    if (name === 'service_accept_refund_gift_card_offer') return json(reviewException ? { ...gift, state: 'manager_review', issued_at: null, value: 9000 } : gift);
    if (name === 'service_issue_refund_status_capability') return json({ issued: true, payloadRedacted: true, capabilityId: caseId, expiresAt: '2030-01-01T00:00:00Z' });
    if (['admin_resend_refund_gift_card', 'admin_decide_refund_gift_card', 'admin_retry_refund_gift_denial_notice'].includes(name ?? '')) {
      if (rpcError) return json({ code: rpcError, message: 'Synthetic denied or unresolved delivery' }, 403);
      if (name === 'admin_decide_refund_gift_card' && body.p_approve === false) return json({ ...gift,
        state: denialState, delivery_state: denialDeliveryState,
        ...(denialOutboxVersion === undefined ? {} : { denial_notice_outbox_version: denialOutboxVersion }) });
      return json(gift);
    }
  }
  if (path === '/rest/v1/reporting_machines') return json({ id: machineId, machine_label: 'Synthetic machine', machine_type: 'commercial',
    location_id: poolId, refund_public_display_label: null, reporting_locations: { id: poolId, name: 'Synthetic location', timezone: 'UTC', status: 'active' } });
  if (path === '/rest/v1/refund_machine_qr_codes') return json({ id: poolId, reporting_machine_id: machineId });
  if (path === '/rest/v1/refund_qr_claim_contexts') return json({ id: caseId, opened_at: new Date().toISOString(), expires_at: '2030-01-01T00:00:00Z' });
  if (path === '/rest/v1/refund_gift_card_pools') return json({ ...offer, id: poolId, face_value_cents: templateValue });
  if (path === '/rest/v1/refund_customer_contact_settings') return json({ automatic_customer_contact_enabled: false });
  if (path === '/rest/v1/refund_case_messages') return json(req.method === 'POST' ? { id: caseId } : { id: caseId, status: 'pending' });
  if (path === '/rest/v1/refund_case_events') return json(null);
  if (path === '/rest/v1/reporting_machine_refund_managers') return json([]);
  if (path === '/rest/v1/refund_cases') return json({ id: caseId, customer_email: 'customer@example.invalid',
    public_reference: 'RF-EDGE-SYNTHETIC', status: 'needs_review', correlation_status: 'not_started' });
  unexpected.push(`${req.method} ${path}`);
  return json({ message: 'Unexpected synthetic fixture request' }, 500);
});
const dbUrl = `http://127.0.0.1:${db.addr.port}`;
Deno.env.set('SUPABASE_URL', dbUrl);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key');
Deno.env.set('SUPABASE_ANON_KEY', 'synthetic-anon-key');
Deno.env.set('REFUND_STATUS_LINKS_ENABLED', 'true');
Deno.env.set('PUBLIC_INTAKE_ABUSE_HASH_SALT', 'synthetic-intake-hash-salt');
const post = async (server: Deno.HttpServer<Deno.NetAddr>, body: unknown, authenticated = false) => {
  const response = await fetch(`http://127.0.0.1:${server.addr.port}`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(authenticated ? { 'x-supabase-auth-token': 'synthetic-manager-token' } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  return { status: response.status, data: await response.json() };
};
try {
  await import('../../supabase/functions/refund-case-intake/index.ts');
  await import('../../supabase/functions/refund-case-admin-update/index.ts');
  const [intake, admin] = servers;
  for (const active of [true, false]) {
    enabled = active; quoteAvailable = active;
    const result = await post(intake, { action: 'giftCardOffer', machineId, amount: '11.00', paymentMethod: 'cash' });
    assertEquals(result.status, 200); assertEquals(result.data.gift_card_enabled, active);
    assertEquals(result.data.offer, active ? offer : null);
  }
  const qr = { action: 'startQrClaim', qrCode: 'synthetic-qr-' + 'a'.repeat(32) };
  enabled = true;
  assertEquals((await post(intake, qr)).data.qrClaim.machine.gift_card_enabled, true);
  activationError = 'PGRST202';
  assertEquals((await post(intake, qr)).data.qrClaim.machine.gift_card_enabled, false);
  activationError = '42501';
  assertEquals((await post(intake, qr)).status, 500);
  activationError = null;
  enabled = true; quoteAvailable = false;
  assertEquals((await post(intake, { action: 'giftCardOffer', machineId, amount: '11.00' })).data, { gift_card_enabled: true, offer: null });
  quoteAvailable = true;
  const submission = { machineId, customerEmail: 'synthetic@example.invalid', issueSummary: 'Synthetic machine issue',
    incidentAt: new Date(Date.now() - 3600000).toISOString(), paymentMethod: 'card', paymentAmount: '11.00', resolutionMethod: 'gift_card',
    giftCardOffer: { poolId, value: 1500, expiresAt: offer.expires_at } };
  const assertNoAmountEffects = () => {
    assert(!requests.some((r) => /service_get_refund_gift_card_offer|service_materialize_refund_gift_card_offer|service_claim_refund_submission|service_accept_refund_gift_card_offer|service_issue_refund_gift_card/.test(r.path)));
    assert(!requests.some((r) => r.path === '/rest/v1/refund_cases' && r.method === 'POST'));
  };
  for (const amount of ['18,50', '18 50', '1,85.00', '1,850,00', '18\t50', '18\u00a050', '18$50', '$$18.50', '1e2', '0x10', '18.505']) {
    requests.length = 0;
    assertEquals((await post(intake, { action: 'giftCardOffer', machineId, amount })).status, 400, `quote ${amount}`);
    assertNoAmountEffects();
    for (const tender of ['cash', 'card']) {
      requests.length = 0;
      assertEquals((await post(intake, { ...submission, paymentMethod: tender, paymentAmount: amount })).status, 400, `intake ${tender} ${amount}`);
      assertNoAmountEffects();
    }
  }
  for (const field of ['cashInsertedAmount', 'expectedChangeAmount']) {
    // Both malformed values would pass the existing cash/change ordering check after unsafe stripping.
    const amounts = field === 'expectedChangeAmount' ? ['0,50', '0 50'] : ['18,50', '18 50'];
    for (const amount of amounts) {
      requests.length = 0;
      assertEquals((await post(intake, { ...submission, paymentMethod: 'cash', issueCategory: 'expected_cash_change',
        cashInsertedAmount: '100.00', expectedChangeAmount: '10.00', [field]: amount })).status, 400);
      assertNoAmountEffects();
    }
  }
  for (const [amount, cents] of [['18', 1800], ['18.50', 1850], ['$18.50', 1850], [' 18.50 ', 1850],
    ['1,850.00', 185000], ['$1,850.00', 185000], [18.5, 1850]] as const) {
    requests.length = 0;
    assertEquals((await post(intake, { action: 'giftCardOffer', machineId, amount })).status, 200);
    assertEquals(requests.find((r) => r.path.endsWith('/service_get_refund_gift_card_offer'))?.body.p_amount_cents, cents);
  }
  for (const amount of ['11', '11.00', '$11.00', ' 11.00 ', 11]) {
    requests.length = 0;
    assertEquals((await post(intake, { ...submission, paymentAmount: amount })).status, 200);
    assertEquals(requests.find((r) => r.path === '/rest/v1/refund_cases' && r.method === 'POST')?.body.payment_amount_cents, 1100);
  }
  for (const tender of ['cash', 'card']) {
    requests.length = 0;
    const result = await post(intake, { ...submission, paymentMethod: tender });
    assertEquals(result.status, 200, JSON.stringify(result.data)); assertEquals(result.data.gift_card.state, 'issued');
    assertEquals(typeof result.data.statusToken, 'string');
    const insert = requests.find((r) => r.path === '/rest/v1/refund_cases' && r.method === 'POST');
    assert(insert); assertEquals(insert.body.gift_card_value_cents, 1500); assertEquals(insert.body.payment_amount_cents, 1100);
    assertEquals(insert.body.payment_method, tender); assertEquals(insert.body.card_last4, null);
    assertEquals(requests.filter((r) => r.path.endsWith('/service_accept_refund_gift_card_offer')).length, 1);
    assert(!requests.some((r) => /nayax|resend|refund_case_messages/.test(r.path)));
  }
  reviewException = true; quoteAvailable = false; requests.length = 0;
  const reviewTerms = await post(intake, { action: 'giftCardOffer', machineId, amount: '90.00', issueCategory: 'expected_cash_change' });
  assertEquals(reviewTerms.status, 200); assertEquals(reviewTerms.data.offer.eligible_locations, offer.eligible_locations);
  assertEquals(reviewTerms.data.offer.one_use, true);
  const cashChange = await post(intake, { ...submission, paymentMethod: 'cash', paymentAmount: '10.00',
    issueCategory: 'expected_cash_change', cashInsertedAmount: '100.00', expectedChangeAmount: '90.00',
    giftCardOffer: undefined, customerLocale: 'es' });
  assertEquals(cashChange.status, 200, JSON.stringify(cashChange.data));
  assertEquals(cashChange.data.gift_card.state, 'manager_review');
  const reviewInsert = requests.find((r) => r.path === '/rest/v1/refund_cases' && r.method === 'POST');
  assert(reviewInsert);
  assertEquals(reviewInsert.body.payment_amount_cents, 1000);
  assertEquals(reviewInsert.body.cash_inserted_amount_cents, 10000);
  assertEquals(reviewInsert.body.expected_change_amount_cents, 9000);
  assertEquals(reviewInsert.body.refund_amount_cents, 0);
  assertEquals(reviewInsert.body.gift_card_value_cents, 9000);
  assertEquals(reviewInsert.body.gift_card_state, 'manager_review');
  assertEquals((reviewInsert.body.intake_meta as Record<string,unknown>).customer_locale, 'es');
  assert(!requests.some((r) => r.path.endsWith('/service_materialize_refund_gift_card_offer')));
  assert(!requests.some((r) => /nayax|resend/.test(r.path)));
  const acknowledgement = requests.find((r) => r.path === '/rest/v1/refund_case_messages' && r.method === 'POST');
  assert(acknowledgement); assertEquals(acknowledgement.body.subject, 'Recibimos su solicitud de tarjeta de regalo de Bloomjoy');
  assert(String(acknowledgement.body.body).includes('Nuestro equipo la está revisando'));
  quoteAvailable = true; reviewException = false;
  requests.length = 0;
  assertEquals((await post(intake, { ...submission, giftCardOffer: { ...submission.giftCardOffer, value: 2000 } })).status, 400);
  assert(!requests.some((r) => r.path === '/rest/v1/refund_cases' && r.method === 'POST'));
  assertEquals((await post(intake, { ...submission, paymentMethod: 'cash', resolutionMethod: 'original_payment' })).status, 400);
  templateValue = 1000; requests.length = 0;
  assertEquals((await post(intake, submission)).status, 200);
  assertEquals(requests.find((r) => r.path.endsWith('/service_accept_refund_gift_card_offer'))?.body.p_pool_id, derivedPoolId);
  assertEquals(requests.filter((r) => r.path.endsWith('/service_materialize_refund_gift_card_offer')).length, 1);
  const recovery = { action: 'resendGiftCard', caseId, intentId: crypto.randomUUID(), customerEmail: 'corrected@example.invalid' };
  requests.length = 0;
  assertEquals((await post(admin, recovery)).status, 401); assertEquals(requests.length, 0);
  assertEquals((await post(admin, recovery, true)).status, 200);
  const resend = requests.find((r) => r.path.endsWith('/admin_resend_refund_gift_card'));
  assert(resend); assertEquals(resend.authorization, 'Bearer synthetic-manager-token');
  assertEquals(resend.body, { p_case_id: caseId, p_intent_id: recovery.intentId, p_email: 'corrected@example.invalid' });
  for (const [code, status] of [['42501', 403], ['P4672', 409]] as const) {
    rpcError = code;
    const held = await post(admin, recovery, true);
    assertEquals(held.status, status);
    if (code === 'P4672') assert(String(held.data.error).includes('existing email send is still being verified'));
  }
  assert(!requests.some((r) => /service_issue_refund_gift_card|service_accept_refund_gift_card_offer|refund_cases/.test(r.path)));
  rpcError = null; requests.length = 0;
  const denial = { action: 'denyGiftCard', caseId, notes: 'Synthetic reason shown to the customer.', customerFacingReasonVersion: 1 };
  for (const version of [undefined, null, '1', 0, false, 2]) {
    requests.length = 0;
    const stale = await post(admin, { ...denial, customerFacingReasonVersion: version }, true);
    assertEquals(stale.status, 409);
    assertEquals(stale.data.error, 'Refresh this page to review the customer-facing reason before declining.');
    assert(!requests.some((r) => r.path.startsWith('/rest/')), 'A stale denial page cannot invoke decision RPC or any database/provider mutation');
  }
  requests.length = 0;
  assertEquals((await post(admin, { action: 'approveGiftCard', caseId, notes: '' }, true)).status, 200);
  assertEquals(requests.find((r) => r.path.endsWith('/admin_decide_refund_gift_card'))?.body.p_approve, true,
    'Approval remains available without the denial wording marker');
  requests.length = 0;
  const saved = await post(admin, denial, true);
  assertEquals(saved.status, 200); assertEquals(saved.data.decision_saved, true);
  assertEquals(saved.data.gift_card.state, 'denied');
  assertEquals(saved.data.customer_message, { status: 'queued' });
  assertEquals((await post(admin, denial, true)).status, 200, 'Response-loss replay uses the same atomic RPC');
  assertEquals(requests.filter((r) => r.path.endsWith('/admin_decide_refund_gift_card')).length, 2);
  assert(requests.filter((r) => r.path.endsWith('/admin_decide_refund_gift_card')).every((r) =>
    r.authorization === 'Bearer synthetic-manager-token' && r.body.p_approve === false && r.body.p_notes === denial.notes));
  assert(!requests.some((r) => /refund_case_messages|refund_case_events|refund_cases|service_issue_refund_gift_card/.test(r.path)),
    'Saved denial never performs an inline send or separate message insert after the transaction');
  for (const state of ['queued', 'failed', 'delivery_unknown', 'accepted', 'sent', 'delivered']) {
    denialDeliveryState = state; requests.length = 0;
    const durable = await post(admin, denial, true);
    assertEquals(durable.status, 200); assertEquals(durable.data.customer_message.status, state);
    assert(!requests.some((r) => /refund_case_messages|refund_case_events|refund_cases/.test(r.path)),
      `Durable ${state} never falls back to legacy inline delivery`);
  }
  for (const version of [null, 0, '1', 2]) {
    denialOutboxVersion = version; requests.length = 0;
    assertEquals((await post(admin, denial, true)).data.customer_message.status, 'delivery_unknown');
    assert(!requests.some((r) => /refund_case_messages|refund_cases/.test(r.path)),
      'A present unsupported capability version holds without legacy delivery');
  }
  denialOutboxVersion = undefined; requests.length = 0;
  const oldDatabase = await post(admin, denial, true);
  assertEquals(oldDatabase.status, 200); assertEquals(oldDatabase.data.customer_message.status, 'skipped');
  assert(requests.some((r) => r.path === '/rest/v1/refund_cases'));
  assert(requests.some((r) => r.path === '/rest/v1/refund_case_messages'),
    'Worker/handler-first rollout on old DB retains the existing tracked legacy send helper and its pending-message dedupe');
  for (const version of [undefined, 1]) {
    denialOutboxVersion = version; denialState = 'issued'; requests.length = 0;
    assertEquals((await post(admin, denial, true)).data.customer_message, null);
    assert(!requests.some((r) => /refund_case_messages|refund_cases/.test(r.path)),
      'A losing denial replay never sends a denial on either database contract');
  }
  denialOutboxVersion = 1; denialState = 'denied'; denialDeliveryState = 'queued';
  requests.length = 0;
  const noticeRecovery = { action: 'retryGiftCardDenialNotice', caseId, intentId: crypto.randomUUID(), customerEmail: 'corrected@example.invalid' };
  assertEquals((await post(admin, noticeRecovery, true)).status, 200);
  assertEquals(requests.find((r) => r.path.endsWith('/admin_retry_refund_gift_denial_notice'))?.body,
    { p_case_id: caseId, p_intent_id: noticeRecovery.intentId, p_email: 'corrected@example.invalid' });
  assert(!requests.some((r) => r.path.endsWith('/admin_decide_refund_gift_card')), 'Delivery recovery never repeats the saved decision');
  rpcError = 'P4684';
  const complained = await post(admin, noticeRecovery, true);
  assertEquals(complained.status, 409);
  assertEquals(complained.data.error, 'Email delivery to this address requires manual review. The decision is saved.');
  rpcError = null;
  assertEquals(unexpected, []);
  console.log('Gift-card actual intake/admin HTTP contracts passed with synthetic PostgREST/Auth.');
} finally {
  await Promise.all([...servers, db].map((server) => server.shutdown()));
}
