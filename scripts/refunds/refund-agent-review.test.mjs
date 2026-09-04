import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadClient, readPopulation, readCasePacket, readReportHealth, compareReview, paginate, ReviewError } from './refund-agent-review.mjs';

const id = n => `a1111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const now = new Date('2026-09-04T12:00:00Z');
const lifecycle = (stage = 'transaction_confirmed') => ({
  schemaVersion: 'refund_lifecycle_v2', version: 3, stage, stageRank: 30, reasonCode: 'exact_transaction_confirmed', actor: 'manager',
  customerAction: { action: 'none', required: false, requestedFields: [], payloadRedacted: true },
  managerAction: { action: 'refund', owner: 'manager', safeRetryEligible: false, payloadRedacted: true },
  paymentState: 'not_requested', messageState: { state: 'sent', messageType: 'confirmation', lastUpdatedAt: now.toISOString(), payloadRedacted: true },
  classification: 'customer', evidenceState: 'verified',
  locationEvidence: { customerReported: { preserved: true, machineIds: [id(900)], payloadRedacted: true },
    normalized: { locationId: id(901), machineId: id(900), timezone: 'America/New_York', providerAccountKey: 'TEST_ACCOUNT', mappingSource: 'published_inventory', mappingVersion: 1, confidence: 1, authoritative: true, payloadRedacted: true }, payloadRedacted: true },
  lastUpdatedAt: now.toISOString(), publicCopyKey: 'transaction_confirmed', managerNextAction: 'refund', terminal: false,
  managerQueue: { schemaVersion: 'refund_manager_queue_v2', bucket: 'ready_to_pay', label: 'Ready to refund', nextAction: 'refund', safeRetryEligible: false, payloadRedacted: true },
  lookup: { status: 'match_found', safeRetryEligible: false, failureClass: null, lastUpdatedAt: now.toISOString() },
  operations: { required: false, queue: 'Refund Operations', owner: 'Refund Operations', slaMinutes: 60, dueAt: null, safeStage: 'not_started', failureClass: null, nextStep: null }, payloadRedacted: true,
});
const row = n => ({ id: id(n), publicReference: `RF-TEST-${n}`, status: 'needs_review', decision: 'approved', decidedAt: '2026-09-03T12:00:00Z',
  refundAmountCents: 963, decisionReason: 'Private approved purpose', customerEmail: 'private@example.invalid', customerName: 'Do not export',
  officialActionVersion: 5, updatedAt: now.toISOString(), paymentMethod: 'card', paymentAmountCents: 963, cardLast4: '4242',
  customerFactEvidence: { source: 'verified_customer_email', factVersion: 2, changedFields: ['card_last4'], appliedAt: now.toISOString(), payloadRedacted: true },
  lifecycle: lifecycle(), selectedNayaxTransaction: { transactionId: '9223372036854775807', saleAmountCents: 963, machineTimezone: 'America/New_York', currencyCode: 'USD', evidenceSource: 'nayax_last_sales' },
  messages: [{ id: id(100 + n), status: 'sent', messageType: 'confirmation', recipientEmail: 'private@example.invalid', sentAt: now.toISOString(), body: 'SECRET_BODY', subject: 'SECRET_SUBJECT', errorMessage: 'Bearer SECRET_TOKEN' }],
  events: [{ id: id(200 + n), eventType: 'nayax_match_selected', createdAt: now.toISOString(), message: 'SECRET_EVENT' }], attachments: [], nayaxLookupCandidates: [],
});

function fixture(rows = [row(1)]) {
  const calls = [];
  const responses = {
    admin_get_refund_operations_overview: { cases: rows, internalTestCases: [] },
    admin_get_refund_gmail_draft_cases: [],
    admin_get_refund_email_queue_states: rows.map(r => ({ caseId: r.id, providerHold: false, providerOutcome: 'not_attempted', actionBlocked: false })),
    admin_get_refund_manual_nayax_context: [],
    get_refund_gmail_health: { status: 'healthy', reportFreshness: null },
  };
  const client = { scope: 'test-scope', async rpc(name, args = {}) {
    calls.push({ name, args });
    if (responses[name] instanceof Error) throw responses[name];
    if (responses[name] !== undefined) return structuredClone(responses[name]);
    if (name === 'admin_get_refund_case_reconciliation') return { caseId: args.p_refund_case_id, actionBlocked: false, reviews: [] };
    if (name === 'admin_get_refund_authoritative_receipt_overview') return { schemaVersion: 'refund_receipt_overview_v1', visible: false };
    if (name === 'admin_get_refund_gmail_case_context') return { connected: true, messages: [{ id: id(300), kind: 'message', direction: 'outbound', status: 'sent', participantRole: 'mailbox', participantTrust: 'verified', managerCcCount: 1, recipientResolutionStatus: 'resolved', body: 'SECRET_GMAIL', subject: 'SECRET_SUBJECT', senderEmail: 'private@example.invalid' }] };
    throw Error(`Unexpected ${name}`);
  } };
  return { client, responses, calls };
}
async function packet(f, n = 1) { return readCasePacket(f.client, await readPopulation(f.client), id(n), now); }

test('complete scoped JSON population reconciles and output pagination loses no cases', async () => {
  const f = fixture(Array.from({ length: 57 }, (_, n) => row(n + 1)));
  f.responses.admin_get_refund_gmail_draft_cases = [row(1)];
  const p = await readPopulation(f.client);
  assert.equal(p.population.customerCount, 57); assert.equal(p.population.overlappingDraftCount, 1);
  const pages = [1, 2, 3].map(n => paginate(p.cases, n, 25));
  assert.deepEqual(pages.map(p => p.rows.length), [25, 25, 7]);
  assert.equal(new Set(pages.flatMap(p => p.rows.map(c => c.row.id))).size, 57); assert.equal(pages[2].hasMore, false);
});

test('incomplete population fails instead of silently claiming a complete queue', async () => {
  const f = fixture(); f.responses.admin_get_refund_email_queue_states.push({ caseId: id(2) });
  await assert.rejects(readPopulation(f.client), /population_not_reconciled/);
});

test('same-time same-amount candidates remain distinct and eligibility changes are review deltas', async () => {
  const c = row(1);
  const evidence = { createdAt: now.toISOString(), expiresAt: '2026-09-04T13:00:00Z', amountCents: 963,
    machineAuthorizationTime: '2026-09-03T12:00:00Z', selectionAllowed: true, oneClickEligible: true };
  c.nayaxLookupCandidates = [{ ...evidence, candidateToken: id(600) }, { ...evidence, candidateToken: id(601) }];
  const f = fixture([c]); const before = await packet(f);
  assert.equal(before.candidates.length, 2); assert.equal(before.candidateEvidence.returnedCount, 2);
  assert.notEqual(before.candidates[0].id, before.candidates[1].id);
  assert.doesNotMatch(JSON.stringify(before), new RegExp(`${id(600)}|${id(601)}|candidateToken`));
  c.nayaxLookupCandidates[0].selectionAllowed = false;
  c.nayaxLookupCandidates[0].oneClickEligible = false;
  const after = await packet(f);
  assert.equal(after.candidates.length, 2);
  assert.equal(compareReview([after], compareReview([before], null, 'scope').snapshot, 'scope').changed.length, 1);
  c.nayaxLookupCandidates.push({ ...c.nayaxLookupCandidates[0], selectionAllowed: true });
  await assert.rejects(packet(f), /candidate_identity_conflict/);
});

test('wrong case cannot call detail RPCs; internal archive stays separate', async () => {
  const f = fixture(); f.responses.admin_get_refund_operations_overview.internalTestCases.push({ id: id(2) });
  f.responses.admin_get_refund_email_queue_states.push({ caseId: id(2) });
  const p = await readPopulation(f.client); const count = f.calls.length;
  await assert.rejects(readCasePacket(f.client, p, id(2)), /case_outside_current_scope/);
  assert.equal(f.calls.length, count); assert.equal(p.population.internalExcluded, 1);
});

test('packet preserves canonical lifecycle and existing approval while stripping body, contacts and capability material', async () => {
  const p = await packet(fixture());
  assert.equal(p.lifecycle.stage, 'transaction_confirmed'); assert.equal(p.nextAction.action, 'refund');
  assert.equal(p.approval.decision, 'approved'); assert.equal(p.approval.refundAmountCents, 963);
  assert.equal(p.selectedPurchase.transactionId, '9223372036854775807');
  assert.equal(p.versions.currentDeterministicFactVersion, null, 'Last customer fact evidence is not necessarily current fact version');
  assert.equal(p.versions.lastAppliedCustomerFactVersion, 2);
  assert.doesNotMatch(JSON.stringify(p), /SECRET_|private@example|Do not export|Private approved purpose/);
});

test('case-evidence identity mismatch fails; wrong account mapping is explicit', async () => {
  const f = fixture();
  f.responses.admin_get_refund_authoritative_receipt_overview = { visible: true, caseId: id(2) };
  await assert.rejects(packet(f), /case_evidence_mismatch/);
  f.responses.admin_get_refund_authoritative_receipt_overview = { visible: true, caseId: id(1), accountScope: 'WRONG_ACCOUNT', providerMachineId: '999', originalTransactionId: 'other', receipt: null };
  const p = await packet(f);
  assert.deepEqual(p.contradictions, ['receipt_original_differs_from_selection', 'receipt_account_differs_from_current_mapping']);
  assert(p.unsupported.includes('numeric_machine_number_inventory'), 'No fake full machine inventory proof');
});

test('pending without attempt remains unknown and never implies a new approval/payment', async () => {
  const c = row(1); c.lifecycle = lifecycle('integrity_hold'); c.lifecycle.paymentState = 'integrity_unknown';
  c.lifecycle.managerAction.action = 'reconcile_lifecycle_integrity'; c.lifecycle.operations.required = true;
  const p = await packet(fixture([c]));
  assert.equal(p.nextAction.action, 'reconcile_lifecycle_integrity'); assert.equal(p.approval.decision, 'approved');
  assert(p.unsupported.includes('all_attempt_generations')); assert.equal(p.receipt.reason, 'not_visible_or_applicable');
});

test('historical generations and partial allocation stay explicitly unsupported, never interpreted as no refund', async () => {
  const f = fixture(); f.responses.admin_get_refund_authoritative_receipt_overview = new ReviewError('read_not_authorized');
  const p = await packet(f);
  assert.equal(p.receipt.available, false); assert.equal(p.receipt.reason, 'read_not_authorized');
  assert(p.unsupported.includes('partial_refund_allocations')); assert(p.unsupported.includes('all_attempt_generations'));
});

test('two cases in one conversation retain separate approval, receipt and message purpose', async () => {
  const f = fixture([row(1), row(2)]); const p = await readPopulation(f.client);
  const [a, b] = await Promise.all([1, 2].map(n => readCasePacket(f.client, p, id(n), now)));
  assert.equal(a.communication.messagesFromCaseThread[0].id, b.communication.messagesFromCaseThread[0].id);
  assert.notEqual(a.communication.messages[0].id, b.communication.messages[0].id);
  assert.equal(a.communication.sharedThreadAllocation, 'thread_membership_is_not_exact_purchase_message_purpose');
  assert.notEqual(a.caseId, b.caseId);
});

test('related claims outside current scope have no identifiers or metadata in output', async () => {
  const f = fixture(); f.responses.admin_get_refund_case_reconciliation = { caseId: id(1), reviews: [{ id: id(450), otherCaseId: id(99), otherPublicReference: 'RF-FOREIGN', otherCustomerEmail: 'foreign@example.invalid' }] };
  const p = await packet(f); assert.equal(p.reconciliation.outsideCurrentScopeCount, 1);
  assert.doesNotMatch(JSON.stringify(p), /RF-FOREIGN|foreign@example|000000000099/);
});

test('duplicate event and attachment are stable; unchanged review emits no changed case', async () => {
  const c = row(1); c.attachments = [{ id: id(500), byteSize: 23, fileName: 'SECRET_NAME', storagePath: 'SECRET_PATH' }];
  const f = fixture([c]); const first = await packet(f); const a = compareReview([first], null, 'scope');
  f.responses.admin_get_refund_operations_overview.cases[0].events.push(c.events[0]);
  f.responses.admin_get_refund_operations_overview.cases[0].attachments.push(c.attachments[0]);
  const b = compareReview([await packet(f)], a.snapshot, 'scope');
  assert.equal(b.changed.length, 0); assert.equal(b.unchangedCount, 1);
  assert.doesNotMatch(JSON.stringify(b.snapshot), /RF-TEST|4242|approved|SECRET/);
  assert.throws(() => compareReview([first], a.snapshot, 'different-actor'), /snapshot_scope_mismatch/);
});

test('changed card/time reply and overdue crossing produce a delta without asking again', async () => {
  const f = fixture(); const first = await packet(f); const snap = compareReview([first], null, 'scope').snapshot;
  const c = f.responses.admin_get_refund_operations_overview.cases[0];
  c.cardLast4 = '9999'; c.incidentAt = '2026-09-04T08:00:00Z'; c.customerFactEvidence.factVersion = 3;
  const changed = await packet(f); assert.equal(compareReview([changed], snap, 'scope').changed.length, 1);
  assert.equal(changed.nextAction.customerAction.action, 'none'); assert.equal(changed.approval.decision, 'approved');
  c.lifecycle.operations.dueAt = '2026-09-04T12:01:00Z';
  const p = await readPopulation(f.client);
  const before = await readCasePacket(f.client, p, id(1), now);
  const after = await readCasePacket(f.client, p, id(1), new Date('2026-09-04T12:02:00Z'));
  assert.equal(compareReview([after], compareReview([before], null, 'scope').snapshot, 'scope').changed.length, 1);
});

test('waiting requires actual sent question and usable current request; internal setup never creates customer work', async () => {
  const c = row(1); c.lifecycle = lifecycle('waiting_on_customer');
  c.lifecycle.customerAction = { required: true, action: 'reply_in_existing_thread', requestedFields: ['card_last4'], payloadRedacted: true };
  const f = fixture([c]); assert.equal((await packet(f)).nextAction.customerAction.action, 'none');
  c.messages[0].messageType = 'more_info'; c.customerCorrection = { state: 'pending', isActive: true, isUsable: true };
  assert.equal((await packet(f)).nextAction.customerAction.action, 'reply_to_existing_request');
  c.messages[0].status = 'failed'; assert.equal((await packet(f)).nextAction.customerAction.action, 'none');
});

test('previously adopted completion stays paid, with unknown accounting date separate', async () => {
  const c = row(1); c.lifecycle = lifecycle('customer_notified'); c.lifecycle.paymentState = 'confirmed';
  c.lifecycle.managerAction.action = 'none';
  const f = fixture([c]); f.responses.admin_get_refund_authoritative_receipt_overview = {
    visible: true, caseId: id(1), accountScope: 'TEST_ACCOUNT', providerMachineId: '123456', originalTransactionId: c.selectedNayaxTransaction.transactionId,
    receipt: { id: id(700), settlementTimePrecision: 'unknown', noticeAdopted: true, noticeSource: 'support_gmail', managerCcVerified: true },
    completionNotice: { body: 'SECRET_COMPLETION', reviewBinding: 'SECRET_BINDING', state: 'sent', messageId: id(701), deliveryState: 'accepted' },
  };
  const p = await packet(f); assert.equal(p.lifecycle.paymentState, 'confirmed'); assert.equal(p.nextAction.action, 'none');
  assert.equal(p.receipt.receipt.noticeAdopted, true); assert.equal(p.receipt.completionNotice.deliveryState, 'accepted');
  assert.doesNotMatch(JSON.stringify(p), /SECRET_COMPLETION|SECRET_BINDING/);
});

test('missing/stale report health remains distinct from refund status and no-refund', async () => {
  const f = fixture(); assert.equal((await readReportHealth(f.client)).delivery, null);
  f.responses.get_refund_gmail_health.reportFreshness = { status: 'needs_review', lastReceivedAt: now.toISOString(), reviewGraceMinutes: 120, secret: 'SECRET_REPORT' };
  const r = await readReportHealth(f.client); assert.equal(r.delivery.status, 'needs_review');
  assert.doesNotMatch(JSON.stringify(r), /SECRET_REPORT/); assert.match(r.limits, /not.*payment gate/);
});

const token = claims => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
test('actual read client rejects broad credentials, wrong origin and unauthenticated server response before RPC', async () => {
  const url = 'https://testproject.supabase.co'; const base = { role: 'authenticated', sub: id(800), iss: `${url}/auth/v1`, exp: Date.now() / 1000 + 3600 };
  const options = { url, publicKey: 'sb_publishable_test', accessToken: token(base), fetchImpl: async () => new Response(JSON.stringify({ id: id(800) })) };
  await assert.rejects(createReadClient({ ...options, accessToken: token({ ...base, role: 'service_role' }) }), /ordinary_user_session_required/);
  await assert.rejects(createReadClient({ ...options, publicKey: 'sb_secret_rejected' }), /public_key_required/);
  await assert.rejects(createReadClient({ ...options, url: 'https://otherproject.supabase.co' }), /ordinary_user_session_required/);
  await assert.rejects(createReadClient({ ...options, fetchImpl: async () => new Response('{}', { status: 401 }) }), /read_not_authorized/);
  const calls = []; const client = await createReadClient({ ...options, fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(url.endsWith('/user') ? { id: id(800) } : [])); } });
  await client.rpc('admin_get_refund_email_queue_states');
  await assert.rejects(client.rpc('admin_queue_refund_receipt_completion'), /read_rpc_not_allowed/);
  await assert.rejects(client.rpc('admin_get_refund_gmail_case_context', { p_refund_case_id: '../other' }), /read_rpc_not_allowed/);
  assert.equal(calls.length, 2); assert(calls.every(c => c.init.redirect === 'error'));
  await createReadClient({ ...options, url: 'https://ygbzkgxktzqsiygjlqyg.supabase.co',
    accessToken: token({ ...base, iss: 'https://auth.bloomjoyusa.com/auth/v1' }) });
  await assert.rejects(createReadClient({ ...options, url: 'https://attacker.example',
    accessToken: token({ ...base, iss: 'https://attacker.example/auth/v1' }) }), /unsupported_project_origin/);
});
