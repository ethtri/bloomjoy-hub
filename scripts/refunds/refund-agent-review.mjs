import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Execute the existing pure contract validator, including on the CI Node 20 runtime.
const lifecycleSource = await readFile(new URL('../../src/lib/refundLifecycle.ts', import.meta.url), 'utf8');
const lifecycleModule = ts.transpileModule(lifecycleSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { requireRefundLifecycleContract } = await import(`data:text/javascript;base64,${Buffer.from(lifecycleModule).toString('base64')}`);

export const schemaVersion = 'refund_agent_review_v1';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const array = value => Array.isArray(value) ? value : [];
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const unique = rows => [...new Map(rows.map(row => [row.id, row])).values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
const allowed = Object.freeze({
  admin_get_refund_operations_overview: [], admin_get_refund_gmail_draft_cases: [],
  admin_get_refund_email_queue_states: [], admin_get_refund_manual_nayax_context: [],
  admin_get_refund_case_reconciliation: ['p_refund_case_id'],
  admin_get_refund_gmail_case_context: ['p_refund_case_id'],
  admin_get_refund_authoritative_receipt_overview: ['p_case_id'],
  get_refund_gmail_health: [],
});

export class ReviewError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new ReviewError(code); };
function jwtPayload(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); }
  catch { return {}; }
}

/** Only user-supplied ordinary session credentials; never discover or refresh secrets. */
export async function createReadClient({ url, publicKey, accessToken, fetchImpl = fetch }) {
  let origin;
  try { origin = new URL(url); } catch { fail('configuration_required'); }
  // Same reviewed host pair used by scripts/auth-preflight.mjs; no custom URL override.
  const bloomjoyHosts = ['ygbzkgxktzqsiygjlqyg.supabase.co', 'auth.bloomjoyusa.com'];
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
    origin.port || !(origin.protocol === 'https:' && (/^[a-z0-9]+\.supabase\.co$/.test(origin.hostname) || origin.hostname === bloomjoyHosts[1]))) fail('unsupported_project_origin');
  const claims = jwtPayload(accessToken ?? '');
  const issuers = bloomjoyHosts.includes(origin.hostname) ? bloomjoyHosts.map(host => `https://${host}/auth/v1`) : [`${origin.origin}/auth/v1`];
  if (claims.role !== 'authenticated' || !uuid(claims.sub) || claims.is_anonymous === true ||
    !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now() || !issuers.includes(claims.iss)) fail('ordinary_user_session_required');
  if (!(typeof publicKey === 'string' && (publicKey.startsWith('sb_publishable_') || jwtPayload(publicKey).role === 'anon'))) fail('public_key_required');
  const headers = { apikey: publicKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  async function request(path, body) {
    let response;
    try { response = await fetchImpl(`${origin.origin}${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(30000),
    }); } catch { fail('read_transport_failed'); }
    if ([401, 403].includes(response.status)) fail('read_not_authorized');
    if (!response.ok) fail('read_unavailable');
    try { return await response.json(); } catch { fail('invalid_read_response'); }
  }
  const user = await request('/auth/v1/user');
  if (user.id !== claims.sub || user.is_anonymous === true) fail('ordinary_user_session_required');
  return {
    scope: digest({ origin: origin.origin, user: user.id }),
    async rpc(name, args = {}) {
      if (!Object.hasOwn(allowed, name) || JSON.stringify(Object.keys(args).sort()) !== JSON.stringify([...allowed[name]].sort()) ||
        Object.values(args).some(value => !uuid(value))) fail('read_rpc_not_allowed');
      // These audited read RPCs include FOR SHARE; HTTP POST is not payment/write authority.
      return request(`/rest/v1/rpc/${name}`, args);
    },
  };
}

function index(rows, key) {
  if (!Array.isArray(rows)) fail('invalid_population_response');
  const result = new Map();
  for (const row of rows) {
    if (!uuid(row?.[key]) || result.has(row[key])) fail('invalid_population_identity');
    result.set(row[key], row);
  }
  return result;
}

export async function readPopulation(client) {
  const [overview, drafts, queue, manual] = await Promise.all([
    client.rpc('admin_get_refund_operations_overview'), client.rpc('admin_get_refund_gmail_draft_cases'),
    client.rpc('admin_get_refund_email_queue_states'), client.rpc('admin_get_refund_manual_nayax_context'),
  ]);
  const customer = index(overview?.cases, 'id');
  const internal = index(overview?.internalTestCases ?? [], 'id');
  const draftMap = index(drafts, 'id');
  const queueMap = index(queue, 'caseId');
  const manualMap = index(manual, 'caseId');
  if ([...internal.keys()].some(id => customer.has(id) || !queueMap.has(id))) fail('population_not_reconciled');
  let overlaps = 0;
  for (const [id, row] of draftMap) {
    if (internal.has(id)) continue;
    if (customer.has(id)) {
      if (customer.get(id).updatedAt !== row.updatedAt || customer.get(id).status !== row.status) fail('population_changed_during_read');
      overlaps++; continue;
    }
    customer.set(id, row);
  }
  // Independently reconcile the complete JSON aggregate with the existing scoped queue.
  const missing = [...queueMap.keys()].filter(id => !customer.has(id) && !internal.has(id));
  const extra = [...customer.keys()].filter(id => !queueMap.has(id));
  if (missing.length || extra.length) fail('population_not_reconciled');
  const cases = [...customer.values()].map(row => ({ row, queue: queueMap.get(row.id), manual: manualMap.get(row.id) ?? null }));
  return { cases, authorizedIds: new Set(customer.keys()), population: {
    scopedCount: queueMap.size, customerCount: customer.size, internalExcluded: internal.size,
    overviewCount: overview.cases.length, draftCount: drafts.length, overlappingDraftCount: overlaps,
    reconciled: true, sourcePagination: 'complete_json_aggregates',
  } };
}

const messageKeys = ['id', 'messageType', 'status', 'sentAt', 'createdAt', 'deliveryTransport', 'deliveryState', 'deliveryStateUpdatedAt', 'deliveryKind'];
const gmailKeys = ['id', 'direction', 'kind', 'status', 'participantRole', 'participantTrust', 'managerCcCount', 'recipientResolutionStatus', 'receivedAt', 'sentAt', 'contentDeleted'];
const receiptKeys = ['schemaVersion', 'visible', 'caseId', 'expectedCaseVersion', 'attemptId', 'attemptBindingKind', 'accountScope', 'providerMachineId', 'originalTransactionId', 'originalAmountCents', 'currencyCode'];
const receiptDetailKeys = ['id', 'observedAt', 'settlementTimePrecision', 'noticeAdopted', 'noticeSentAt', 'managerCcVerified', 'noticeSource', 'noticeVerification', 'supportThread'];

async function optionalRead(client, name, args) {
  try { return { available: true, data: await client.rpc(name, args) }; }
  catch (error) {
    if (!(error instanceof ReviewError)) throw error;
    return { available: false, reason: error.code };
  }
}

export async function readReportHealth(client) {
  const result = await optionalRead(client, 'get_refund_gmail_health', {});
  return { available: result.available, reason: result.reason ?? null,
    importer: result.available ? pick(result.data, ['status', 'lastRunAt', 'lastSuccessAt', 'lastRunStatus']) : null,
    delivery: result.data?.reportFreshness ? pick(result.data.reportFreshness,
      ['status', 'lastReceivedAt', 'reviewAfter', 'configuredCadenceMinutes', 'reviewGraceMinutes', 'schedulePhaseKnown', 'ownerLabel']) : null,
    limits: 'Stored Gmail receipt time; receiver-header provenance, per-case coverage and provider refund-status semantics are not established by this health signal. Local grace is not a vendor SLA or payment gate.' };
}

export async function readCasePacket(client, population, caseId, now = new Date()) {
  const entry = population.cases.find(item => item.row.id === caseId);
  if (!entry || !population.authorizedIds.has(caseId)) fail('case_outside_current_scope');
  const c = entry.row;
  const [reconciliation, gmail, receipt] = await Promise.all([
    optionalRead(client, 'admin_get_refund_case_reconciliation', { p_refund_case_id: caseId }),
    optionalRead(client, 'admin_get_refund_gmail_case_context', { p_refund_case_id: caseId }),
    optionalRead(client, 'admin_get_refund_authoritative_receipt_overview', { p_case_id: caseId }),
  ]);
  if (reconciliation.available && reconciliation.data.caseId !== caseId) fail('case_evidence_mismatch');
  if (receipt.available && receipt.data.visible && receipt.data.caseId !== caseId) fail('case_evidence_mismatch');
  const lifecycle = c.lifecycle ? requireRefundLifecycleContract(c.lifecycle) : null;
  if (lifecycle?.classification === 'internal_test') fail('case_outside_current_scope');
  const contradictions = [];
  const r = receipt.available && receipt.data.visible ? receipt.data : null;
  const selected = c.selectedNayaxTransaction;
  if (selected && typeof selected.transactionId !== 'string') fail('unsafe_transaction_identity');
  if (r && (typeof r.originalTransactionId !== 'string' || typeof r.providerMachineId !== 'string')) fail('unsafe_transaction_identity');
  if (r && selected && r.originalTransactionId !== selected.transactionId) contradictions.push('receipt_original_differs_from_selection');
  if (r && lifecycle?.locationEvidence.normalized.providerAccountKey && r.accountScope !== lifecycle.locationEvidence.normalized.providerAccountKey) contradictions.push('receipt_account_differs_from_current_mapping');
  if (r?.receipt && lifecycle?.paymentState !== 'confirmed') contradictions.push('receipt_and_lifecycle_disagree');
  if (entry.queue.providerHold && lifecycle && !['outcome_unknown', 'submitted_pending', 'integrity_unknown'].includes(lifecycle.paymentState)) contradictions.push('queue_hold_and_lifecycle_disagree');
  const messages = unique(array(c.messages).map(m => ({ ...pick(m, messageKeys), recipientMatchesCurrentCustomer: typeof m.recipientEmail === 'string' && m.recipientEmail.toLowerCase() === c.customerEmail?.toLowerCase() })));
  const gmailMessages = unique(array(gmail.data?.messages).map(m => pick(m, gmailKeys)));
  const fields = lifecycle?.customerAction.requestedFields ?? [];
  const sentQuestion = messages.some(m => ['more_info', 'no_safe_match'].includes(m.messageType) && m.status === 'sent' && m.sentAt);
  const validWaiting = lifecycle?.customerAction.required === true && fields.length > 0 && sentQuestion &&
    c.customerCorrection?.isActive === true && c.customerCorrection?.isUsable === true;
  if (lifecycle?.customerAction.required && !validWaiting) contradictions.push('customer_wait_evidence_incomplete');
  const correction = c.customerCorrection;
  const related = array(reconciliation.data?.reviews);
  const visibleRelated = related.filter(item => population.authorizedIds.has(item.otherCaseId));
  const due = lifecycle?.operations.dueAt;
  const candidateRows = array(c.nayaxLookupCandidates);
  const candidateMap = new Map();
  for (const item of candidateRows) {
    if (!uuid(item.candidateToken)) fail('invalid_candidate_identity');
    const candidate = {
      // The current contract's token is a distinct evidence identity, never an output capability.
      id: digest({ caseId, candidateToken: item.candidateToken }),
      ...pick(item, ['amountCents', 'currencyCode', 'machineAuthorizationTime', 'expiresAt', 'createdAt',
        'selectionAllowed', 'oneClickEligible', 'recommendationRank', 'isRecommended', 'recommendationState',
        'policyVersion', 'reasonCodes', 'hardExclusions']),
      expired: typeof item.expiresAt === 'string' ? Date.parse(item.expiresAt) <= now.getTime() : null,
    };
    const previousCandidate = candidateMap.get(candidate.id);
    if (previousCandidate && digest(previousCandidate) !== digest(candidate)) fail('candidate_identity_conflict');
    candidateMap.set(candidate.id, candidate);
  }
  const candidates = unique([...candidateMap.values()]);
  return {
    schemaVersion, caseId, publicReference: /^RF-[A-Z0-9-]+$/.test(c.publicReference) ? c.publicReference : null,
    dataIsUntrusted: true, readOnly: true,
    versions: { officialActionVersion: c.officialActionVersion ?? null, lastAppliedCustomerFactVersion: c.customerFactEvidence?.factVersion ?? null,
      currentDeterministicFactVersion: null, lifecycleRevision: lifecycle?.version ?? null, updatedAt: c.updatedAt },
    currentFacts: pick(c, ['incidentAt', 'incidentTimeConfidence', 'incidentTimeResolution', 'paymentMethod', 'paymentAmountCents', 'cardLast4', 'cardLast4Provenance', 'cardNetwork', 'paymentInteraction', 'walletProvider']),
    factProvenance: pick(c.customerFactEvidence, ['source', 'appliedAt', 'changedFields', 'factVersion']),
    correction: correction ? { ...pick(correction, ['state', 'requestedAt', 'respondedAt', 'expiresAt', 'isActive', 'isUsable', 'requestedFields', 'recheckState']),
      answeredFields: Object.keys(correction.answers ?? {}).sort(),
      disputedFields: Object.entries(correction.answers ?? {}).filter(([, a]) => a.disposition === 'cannot_provide').map(([field]) => field).sort(),
    } : null,
    approval: { ...pick(c, ['decision', 'decidedAt', 'refundAmountCents']), reasonDigest: c.decisionReason ? digest(c.decisionReason) : null,
      selectedOriginal: selected?.transactionId ?? null, approverProvenance: 'not_exposed_by_current_overview',
      continuity: c.decision === 'approved' ? 'retain_for_unchanged_exact_purchase_amount_and_purpose' : 'no_current_approval_shown' },
    mapping: lifecycle ? pick(lifecycle.locationEvidence.normalized, ['locationId', 'machineId', 'timezone', 'providerAccountKey', 'mappingSource', 'mappingVersion', 'authoritative']) : null,
    selectedPurchase: selected ? pick(selected, ['transactionId', 'saleAmountCents', 'currencyCode', 'providerAuthorizedAt', 'machineTimezone', 'providerTimeResolution', 'evidenceSource', 'cardLast4', 'cardNetwork', 'paymentInteraction', 'walletProvider']) : null,
    candidates,
    candidateEvidence: { returnedCount: candidateRows.length, distinctCount: candidates.length,
      canonicalCount: c.nayaxLookupSummary?.candidateCount ?? null },
    lifecycle: lifecycle ? { ...pick(lifecycle, ['schemaVersion', 'version', 'stage', 'reasonCode', 'paymentState', 'terminal', 'evidenceState']),
      customerAction: pick(lifecycle.customerAction, ['action', 'required', 'requestedFields']),
      managerAction: pick(lifecycle.managerAction, ['action', 'owner', 'safeRetryEligible']),
      managerQueue: pick(lifecycle.managerQueue, ['schemaVersion', 'bucket', 'nextAction', 'safeRetryEligible', 'customerActionFields']),
      lookup: pick(lifecycle.lookup, ['status', 'safeRetryEligible', 'failureClass', 'lastUpdatedAt']),
      operations: { ...pick(lifecycle.operations, ['required', 'owner', 'dueAt', 'safeStage', 'failureClass', 'nextStep']), overdue: due ? Date.parse(due) <= now.getTime() : null },
    } : null,
    queueEvidence: pick(entry.queue, ['providerHold', 'providerOutcome', 'actionBlocked', 'possibleDuplicate', 'confirmedDuplicate', 'legacyStateReviewRequired']),
    manualContext: pick(entry.manual, ['manualNayaxPortalEnabled', 'manualNayaxEvidenceSelected', 'manualNayaxLocationTimezone', 'reviewedNayaxPortalFallbackKind']),
    receipt: r ? { ...pick(r, receiptKeys), receipt: r.receipt ? pick(r.receipt, receiptDetailKeys) : null,
      completionNotice: r.completionNotice ? pick(r.completionNotice, ['messageId', 'state', 'deliveryState']) : null,
    } : { available: receipt.available, reason: receipt.reason ?? 'not_visible_or_applicable' },
    communication: { messages, gmailAvailable: gmail.available, gmailReason: gmail.reason ?? null,
      connected: gmail.data?.connected === true, messagesFromCaseThread: gmailMessages,
      sharedThreadAllocation: 'thread_membership_is_not_exact_purchase_message_purpose',
      fullContent: 'restricted_existing_mailbox_and_ledger_only' },
    reconciliation: { available: reconciliation.available, actionBlocked: reconciliation.data?.actionBlocked ?? null,
      reviews: unique(visibleRelated.map(item => pick(item, ['id', 'status', 'matchClass', 'reasonCodes', 'policyVersion', 'otherCaseId', 'createdAt', 'resolvedAt']))),
      outsideCurrentScopeCount: related.length - visibleRelated.length },
    events: unique(array(c.events).map(e => pick(e, ['id', 'eventType', 'createdAt']))),
    attachments: unique(array(c.attachments).map(a => pick(a, ['id', 'contentType', 'byteSize', 'uploadedAt']))),
    nextAction: { action: lifecycle?.managerAction.action ?? 'review_missing_canonical_lifecycle', owner: lifecycle?.managerAction.owner ?? 'Refund Operations',
      customerAction: validWaiting ? { action: 'reply_to_existing_request', fields } : { action: 'none', fields: [] },
      executionAuthority: 'read_only_packet_never_authorizes_or_executes_a_payment' },
    contradictions,
    unsupported: ['current_deterministic_fact_version', 'all_attempt_generations', 'partial_refund_allocations', 'per_case_report_coverage_and_generation', 'independently_fetched_remaining_balance', 'original_approval_actor_and_scope_journal', 'numeric_machine_number_inventory'],
  };
}

export function compareReview(packets, previous, scope) {
  if (previous && (previous.schemaVersion !== schemaVersion || previous.scope !== scope)) fail('snapshot_scope_mismatch');
  const fingerprints = Object.fromEntries(packets.map(packet => [packet.caseId, digest(packet)]));
  const changed = packets.filter(packet => previous?.fingerprints?.[packet.caseId] !== fingerprints[packet.caseId]);
  return { changed, removedCount: Object.keys(previous?.fingerprints ?? {}).filter(id => !Object.hasOwn(fingerprints, id)).length,
    snapshot: { schemaVersion, scope, fingerprints }, unchangedCount: packets.length - changed.length };
}

export function paginate(rows, page = 1, pageSize = 25) {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) fail('invalid_page');
  return { page, pageSize, total: rows.length, pages: Math.ceil(rows.length / pageSize), hasMore: page * pageSize < rows.length,
    rows: rows.slice((page - 1) * pageSize, page * pageSize) };
}
