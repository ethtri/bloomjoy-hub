import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { servers } from './fixtures/gift-card-edge-serve.ts';

// Actual intake handler and Supabase SDK against loopback-only synthetic HTTP.
// No live case, customer message, provider lookup or financial operation.
const machineId = '0bcc055d-122f-4d30-aca4-2648a4f0516a';
const caseId = 'a1888000-0000-4000-8000-000000000002';
const threadId = 'a1888000-0000-4000-8000-000000000003';
const locationId = 'a1888000-0000-4000-8000-000000000004';
const purchaseError = 'The reported purchase time cannot be after Bloomjoy received the request';
const originalReceipt = Date.parse('2026-09-01T23:00:00Z');
const requests: { path: string; method: string; body: Record<string, unknown> }[] = [];
const unexpected: string[] = [];
let mode: 'boundary' | 'unavailable' | 'immutable' | 'internal' | 'timezone_unavailable' = 'boundary';
let previousClock = false;
let persistedFingerprint: string | null = null;
let persistedIdentity: string | null = null;
let createCount = 0;
const caseRow = { id: caseId, public_reference: 'RF-SYNTHETIC-INTAKE', status: 'needs_review',
  correlation_status: 'needs_nayax', gmail_thread_id: threadId };
const json = (value: unknown, status = 200) => Response.json(value, { status });
const db = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: () => {} }, async (req) => {
  const path = new URL(req.url).pathname;
  const body = req.method === 'POST' ? await req.json() : {};
  requests.push({ path, method: req.method, body });
  const name = path.split('/').at(-1);
  if (path.startsWith('/rest/v1/rpc/')) {
    if (name === 'record_public_intake_rate_limit_event') return json(1);
    if (name === 'service_refund_machine_is_public') return json(true);
    if (name === 'refund_intake_timezone') {
      assertEquals(body, { p_machine_id: machineId, p_location_timezone: 'America/Los_Angeles',
        p_manual_enabled: true, p_manual_timezone: 'America/New_York' });
      return mode === 'timezone_unavailable'
        ? json({ code: 'PGRST202', message: 'Synthetic missing migration' }, 404)
        : json(previousClock ? 'America/Los_Angeles' : 'America/New_York');
    }
    if (name === 'service_claim_refund_submission_identity') {
      if (!persistedIdentity) return json({ outcome: 'missing', refundCaseId: null });
      assertEquals(body.p_identity_hash, persistedIdentity);
      return json({ outcome: body.p_payload_fingerprint === persistedFingerprint ? 'match' : 'conflict', refundCaseId: caseId });
    }
    if (name === 'service_refund_gift_card_enabled') return json(false);
    if (name === 'service_begin_refund_manager_notification') return json({ claimed: false });
    if (name === 'service_create_refund_case_from_gmail_contact_form') {
      if (mode === 'unavailable') return json(null);
      if (mode === 'immutable') return json({ code: 'P4625', message: 'The original customer request receipt is immutable' }, 400);
      if (mode === 'internal') return json({ code: 'XX000', message: 'Private internal detail' }, 500);
      const values = body.p_case_values;
      assertEquals(values.incidentTimezone, previousClock ? 'America/Los_Angeles' : 'America/New_York');
      assertEquals(values.incidentLocalDateTime, `${submission.incidentDate}T${submission.incidentTime}`);
      if (Date.parse(values.incidentAt) > originalReceipt + 60_000) {
        return json({ code: 'P4625', message: purchaseError }, 400);
      }
      createCount += 1;
      persistedFingerprint = values.intakeMeta.submission_payload_fingerprint;
      persistedIdentity = values.intakeMeta.submission_identity_hash;
      return json(caseRow);
    }
  }
  if (path === '/rest/v1/reporting_machines') return json({ id: machineId, machine_label: 'Synthetic reviewed machine',
    machine_type: 'commercial', location_id: locationId, refund_public_display_label: 'Synthetic public machine',
    nayax_manual_portal_enabled: true, nayax_manual_portal_timezone: 'America/New_York',
    reporting_locations: { id: locationId, name: 'Synthetic placeholder', timezone: 'America/Los_Angeles', status: 'active' } });
  if (path === '/rest/v1/refund_machine_qr_codes') return json({ id: locationId, reporting_machine_id: machineId });
  if (path === '/rest/v1/refund_qr_claim_contexts') return json({ id: caseId, opened_at: new Date().toISOString(), expires_at: '2030-01-01T00:00:00Z' });
  if (path === '/rest/v1/refund_cases') return json(caseRow);
  if (path === '/rest/v1/refund_customer_contact_settings') return json({ automatic_customer_contact_enabled: false });
  if (path === '/rest/v1/refund_case_messages') return json(req.method === 'POST' ? { id: caseId } : null);
  if (path === '/rest/v1/refund_case_events') return json(null);
  unexpected.push(`${req.method} ${path}`);
  return json({ code: 'XX000', message: 'Unexpected synthetic request' }, 500);
});
Deno.env.set('SUPABASE_URL', `http://127.0.0.1:${db.addr.port}`);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key');
Deno.env.set('SUPABASE_ANON_KEY', 'synthetic-anon-key');
Deno.env.set('PUBLIC_INTAKE_ABUSE_HASH_SALT', 'synthetic-intake-salt');
Deno.env.set('REFUND_STATUS_LINKS_ENABLED', 'false');
const submission = { machineId, customerEmail: 'synthetic@example.invalid', customerName: 'Synthetic',
  incidentDate: '2026-09-01', incidentTime: '18:30', paymentMethod: 'card', paymentAmount: '5.00',
  cardLast4: '4242', issueCategory: 'charged_no_product', resolutionMethod: 'original_payment',
  emailContextToken: 'a'.repeat(43) };
try {
  await import('../../supabase/functions/refund-case-intake/index.ts');
  const post = async (body: unknown) => {
    const response = await fetch(`http://127.0.0.1:${servers[0].addr.port}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    return { status: response.status, data: await response.json() };
  };
  const success = await post(submission);
  assertEquals(success.status, 200, JSON.stringify(success.data));
  const linked = requests.find((r) => r.path.endsWith('/service_create_refund_case_from_gmail_contact_form'));
  assert(linked);
  assertEquals((linked.body.p_case_values as Record<string, unknown>).incidentAt, '2026-09-01T22:30:00.000Z');
  assertEquals(success.data.refundCase.publicReference, caseRow.public_reference);

  submission.incidentDate = '2026-09-02';
  const later = await post(submission);
  assertEquals(later.status, 400);
  assertEquals(later.data.errorCode, 'refund_purchase_time_after_request');
  assert(later.data.error.includes('If they are correct'));
  assert(!later.data.error.includes('link is no longer available'));

  for (const value of ['unavailable', 'immutable', 'internal'] as const) {
    mode = value;
    const result = await post(submission);
    assertEquals(result.status, value === 'unavailable' ? 409 : 500);
    assertEquals(result.data.errorCode, value === 'unavailable' ? 'refund_email_context_unavailable' : undefined);
    assert(!JSON.stringify(result.data).includes('Private internal detail'));
    assert(!JSON.stringify(result.data).includes('immutable'));
  }
  mode = 'boundary';
  const qr = { action: 'startQrClaim', qrCode: 'synthetic-qr-' + 'a'.repeat(32) };
  assertEquals((await post(qr)).data.qrClaim.machine.locationTimezone, 'America/New_York');

  // A successful earlier-clock submission loses its response, then the exact
  // same browser identity retries after deployment. Recover, never rewrite it.
  submission.incidentDate = '2026-09-01';
  submission.incidentTime = '12:30';
  const replaySubmission = { ...submission, submissionId: 'a1888000-0000-4000-8000-000000000005' };
  previousClock = true;
  assertEquals((await post(replaySubmission)).status, 200);
  const originalFingerprint = persistedFingerprint;
  const originalCreateCount = createCount;
  previousClock = false;
  requests.length = 0;
  assertEquals((await post(replaySubmission)).status, 200);
  assertEquals(createCount, originalCreateCount);
  assertEquals(persistedFingerprint, originalFingerprint);
  const claims = requests.filter((r) => r.path.endsWith('/service_claim_refund_submission_identity'));
  assertEquals(claims.length, 2);
  assert(claims.every((r) => r.body.p_refund_case_id === null));
  assert(!requests.some((r) => r.path.endsWith('/service_create_refund_case_from_gmail_contact_form')));
  const changed = await post({ ...replaySubmission, paymentAmount: '6.00' });
  assertEquals(changed.status, 409);
  assertEquals(changed.data.errorCode, 'refund_submission_identity_conflict');
  assertEquals(createCount, originalCreateCount);
  assertEquals(persistedFingerprint, originalFingerprint);

  requests.length = 0;
  mode = 'timezone_unavailable';
  assertEquals((await post(submission)).status, 500);
  assertEquals((await post(qr)).status, 500);
  assert(!requests.some((r) => r.path.endsWith('/service_create_refund_case_from_gmail_contact_form') ||
    r.path === '/rest/v1/refund_qr_claim_contexts'));
  assertEquals(unexpected, []);
  assert(!requests.some((r) => /refund-attempt|resend|gmail|nayax-card-refund/.test(r.path)));
  console.log('Synthetic actual-handler Norfolk clock, QR, linked-receipt and error contracts passed.');
} finally {
  await Promise.all([...servers, db].map((server) => server.shutdown()));
}
