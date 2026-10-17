import { assertEquals } from 'jsr:@std/assert@1';
import { servers } from './fixtures/gift-card-edge-serve.ts';

// Real deployed approval handler + Supabase SDK; synthetic Auth/PostgREST only.
// Loopback-only net permission makes provider or customer transport impossible.
const caseId = '81000000-0000-4000-8000-000000000002';
const requests: { name: string; body: Record<string, unknown>; authorization: string | null }[] = [];
let canView = true, sqlFailure = false;
const db = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: () => {} }, async req => {
  const path = new URL(req.url).pathname;
  if (path === '/auth/v1/user') return Response.json({ id: caseId, email: 'manager@example.invalid' });
  if (path === '/rest/v1/refund_cases') return Response.json({ id: caseId, payment_method: 'card',
    decision: null, official_action_version: 4, matched_nayax_amount_cents: 3000 });
  const body = await req.json();
  const name = path.split('/').at(-1)!;
  requests.push({ name, body, authorization: req.headers.get('authorization') });
  if (name === 'can_manage_refund_case_current_user') return Response.json(canView);
  if (name === 'admin_approve_selected_nayax_refund_for_system_v2') {
    // The existing SQL is independently covered by refund_partial_card_amount.sql.
    // Simulate its rejection to prove Edge never falls back to full approval.
    if (sqlFailure) return Response.json({ code: 'P0001', message: 'Synthetic stale or invalid amount' }, { status: 400 });
    return Response.json({ approved: true, status: 'system_finishing', attemptId: caseId,
      providerCallMade: false, customerMessageCreated: false, payloadRedacted: true });
  }
  throw new Error(`Unexpected synthetic endpoint: ${path}`);
});
Deno.env.set('SUPABASE_URL', `http://127.0.0.1:${db.addr.port}`);
Deno.env.set('SUPABASE_ANON_KEY', 'synthetic-anon-key');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key');
const post = async (amount: unknown, version = 4, authenticated = true) => {
  requests.length = 0;
  const response = await fetch(`http://127.0.0.1:${servers[0].addr.port}`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(authenticated ? { 'x-supabase-auth-token': 'synthetic-manager-token' } : {}) },
    body: JSON.stringify({ operation: 'approve_selected', caseId, expectedOfficialActionVersion: version,
      ...(amount === undefined ? {} : { refundAmountCents: amount }) }) });
  return { status: response.status, data: await response.json() };
};
try {
  await import('../../supabase/functions/nayax-card-refund/index.ts');
  for (const cents of [2000, 2160, 3000, undefined]) {
    assertEquals((await post(cents)).status, 202);
    const approvals = requests.filter(r => r.name.startsWith('admin_approve_'));
    assertEquals(approvals.length, 1);
    assertEquals(approvals[0], { name: 'admin_approve_selected_nayax_refund_for_system_v2',
      body: { p_case_id: caseId, p_expected_case_version: 4, p_refund_amount_cents: cents ?? null },
      authorization: 'Bearer synthetic-manager-token' });
  }
  sqlFailure = true;
  for (const cents of [0, -1, 3001, 1.5]) {
    const result = await post(cents);
    assertEquals(result.status, 409);
    assertEquals(result.data.approved, false);
    assertEquals(requests.filter(r => r.name.startsWith('admin_approve_')).length, 1);
  }
  // Same SQL failure includes stale/decided/unknown-attempt conflicts. There is
  // no execute/v1 fallback, provider call, retry, or extra approval on rejection.
  assertEquals((await post(2000, 5)).status, 409);
  canView = false;
  assertEquals((await post(2000)).status, 403);
  assertEquals(requests.some(r => r.name.startsWith('admin_approve_')), false);
  assertEquals((await post(2000, 4, false)).status, 401);
  assertEquals(requests.length, 0);
  console.log('Saved-card partial approval HTTP: exact cents, authenticated v2 binding, no full-amount fallback.');
} finally {
  await Promise.all(servers.map(server => server.shutdown()));
  await db.shutdown();
}
