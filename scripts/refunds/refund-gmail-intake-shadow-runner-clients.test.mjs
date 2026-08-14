import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  createRefundGmailIntakeShadowControlClient,
  createRefundGmailIntakeShadowDatabaseClient,
  createRefundGmailIntakeShadowEdgeClient,
  createRefundGmailIntakeShadowIdentityClient,
  getRefundGmailIntakeShadowOwnerQuerySnapshots,
} from './refund-gmail-intake-shadow-runner-clients.mjs';
import {
  REFUND_INTAKE_SHADOW_PROJECT_REF,
  REFUND_INTAKE_SHADOW_SAFE_START_AT,
  REFUND_INTAKE_SHADOW_ZERO_DIGEST,
  sha256Hex,
} from './refund-gmail-intake-shadow-runner-lib.mjs';

const MANAGEMENT_TOKEN = 'private_management_token_never_print_854';
const SYNC_SECRET = 'private_sync_secret_never_print_854';
const OWNER_JWT = 'header.private_owner_jwt.signature';
const ANON_KEY = 'private_anon_key_never_print_854';
const PRIVATE_RESPONSE = 'private_response_never_print_854';
const OWNER_USER_ID = '85400000-0000-4000-8000-000000000001';
const CLEANUP_TASK_HANDLE = '85400000-0000-4000-8000-000000000002';
const OWNER_EMAIL = 'owner.synthetic@example.test';
const OWNER_SENDER_DIGEST = sha256Hex(OWNER_EMAIL);
const RUN_KEY = `owner-intake-shadow:${'a'.repeat(64)}`;
const DATABASE_ENDPOINT =
  `https://api.supabase.com/v1/projects/${REFUND_INTAKE_SHADOW_PROJECT_REF}/database/query`;

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() {
    return body;
  },
});

const snapshotRow = (offset = 0) => ({
  refund_cases: String(10 + offset),
  gmail_messages: String(20 + offset),
  customer_inbound: String(4 + offset),
  provider_sent_mailbox: String(4 + offset),
  attachments: '0',
  hub_outbound_operations: '0',
  case_delivery_messages: '0',
  first_contact_shadowed: String(2 + offset),
  first_contact_pending_or_sent: '0',
  manager_notice_shadowed: String(2 + offset),
  manager_notice_outbound_attempts: '0',
  notice_ledger: String(2 + offset),
  cleanup_obligations: String(2 + offset),
  nayax_provider_attempts: '7',
});

const preflightRow = (overrides = {}) => ({
  database_owner_session: true,
  gate_allowed: true,
  gate_status: 'authorized',
  armed_dispatch_authorization_count: '0',
  active_proof_authorization_count: '0',
  unresolved_gmail_outbound_count: '0',
  unresolved_first_contact_count: '0',
  automatic_customer_contact_enabled: false,
  gpt_triage_enabled: false,
  gpt_auto_send_enabled: false,
  official_actions_enabled: false,
  active_official_authorization_count: '0',
  pending_step_up_intent_count: '0',
  nayax_resolution_enabled: false,
  nayax_operator_count: '0',
  nayax_resolution_intent_count: '0',
  nayax_provider_attempt_count: '7',
  unresolved_nayax_provider_attempt_count: '0',
  overdue_cleanup_obligation_count: '0',
  retention_policy_healthy: true,
  attachments_enabled: false,
  scanner_enabled: false,
  payload_redacted: true,
  ...snapshotRow(),
  ...overrides,
});

const postflightRow = (overrides = {}) => ({
  database_owner_session: true,
  active_proof_authorization_count: '0',
  unresolved_gmail_outbound_count: '0',
  unresolved_first_contact_count: '0',
  run_count: '1',
  trigger_source: 'intake_shadow',
  run_status: 'succeeded',
  run_started_at: '2026-08-14T20:00:00.000Z',
  run_finished_at: '2026-08-14T20:00:10.000Z',
  dispatch_status: 'consumed',
  threads_scanned: '1',
  messages_seen: '2',
  messages_created: '2',
  messages_failed: '0',
  exact_notice_count: '1',
  exact_first_contact_operation_count: '1',
  exact_first_contact_event_count: '1',
  exact_action_event_count: '1',
  cleanup_obligation_count: '1',
  cleanup_task_handle: CLEANUP_TASK_HANDLE,
  cleanup_assigned_owner_role: 'refund_operations_owner',
  cleanup_status: 'assigned',
  route_class: 'assigned_managers',
  exact_thread_message_count: '2',
  exact_customer_inbound_count: '1',
  exact_provider_sent_mailbox_count: '1',
  owner_manageable_case_count: '1',
  case_source: 'gmail',
  case_status: 'draft',
  case_automation_state: 'customer_replied',
  earliest_retention_due_at: '2998-08-14T00:00:00.000Z',
  latest_retention_due_at: '2998-08-15T00:00:00.000Z',
  ...snapshotRow(1),
  ...overrides,
});

const createDatabase = (fetchImpl, overrides = {}) =>
  createRefundGmailIntakeShadowDatabaseClient({
    projectRef: REFUND_INTAKE_SHADOW_PROJECT_REF,
    confirmProjectRef: REFUND_INTAKE_SHADOW_PROJECT_REF,
    managementToken: MANAGEMENT_TOKEN,
    fetchImpl,
    ...overrides,
  });

test('owner query registry is closed, immutable, parameterized, and semantic SELECT-only', () => {
  const snapshots = getRefundGmailIntakeShadowOwnerQuerySnapshots();
  assert.deepEqual(Object.keys(snapshots), [
    'preflight',
    'authorizeDispatch',
    'closeDispatch',
    'recoverExpiredDispatches',
    'completeDueCleanup',
    'postflight',
  ]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(snapshots).map(([name, operation]) => [
      name,
      createHash('sha256').update(operation.sql).digest('hex'),
    ])),
    {
      preflight: 'aa2cb352348de6b4512167fa0abf4067e2b6eaf8f657772a367a4963d4989e6a',
      authorizeDispatch: '5e8a4950baa2a8cf6e50bd961fe6a2887ec09ac7292d1578f53d1c2a5da3bc41',
      closeDispatch: '69aacf1290242cb3778c51c0ab35accf1ef5037acd19baf4391b6bde9450efb0',
      recoverExpiredDispatches: 'cc3d3d07ea94d7a97c88503014b5e99ff340eb65138b31efc208a55f1152801e',
      completeDueCleanup: '924503166c03490919d789283f4618187ef31501cd621e3a356ffcb515faf2d0',
      postflight: '85eb8f02c76f5191b0b38d5364514b16929d56f9ed9756e61efda504900684cb',
    },
  );
  const mutationPattern =
    /\b(?:alter|analyze|begin|call|checkpoint|cluster|comment|commit|copy|create|deallocate|delete|discard|do|drop|execute|grant|insert|into|listen|lock|merge|move|notify|perform|prepare|reassign|refresh|reindex|reset|revoke|rollback|set|truncate|unlisten|update|vacuum)\b|\b(?:nextval|setval|pg_notify|dblink|lo_import|lo_export)\s*\(/iu;
  for (const operation of Object.values(snapshots)) {
    assert.match(operation.sql, /^\s*(?:with|select)\b/iu);
    assert.doesNotMatch(operation.sql, /;/u);
    assert.doesNotMatch(operation.sql, mutationPattern);
    assert.match(operation.sql, /public\./u);
    assert.match(operation.sql, /pg_catalog\./u);
  }
  assert.equal(snapshots.preflight.parameterCount, 0);
  assert.equal(snapshots.authorizeDispatch.parameterCount, 3);
  assert.equal(snapshots.closeDispatch.parameterCount, 1);
  assert.equal(snapshots.recoverExpiredDispatches.parameterCount, 0);
  assert.equal(snapshots.completeDueCleanup.parameterCount, 1);
  assert.equal(snapshots.postflight.parameterCount, 2);
  assert.match(snapshots.authorizeDispatch.sql, /owner_authorize_refund_gmail_intake_shadow_dispatch/u);
  assert.match(snapshots.closeDispatch.sql, /owner_cancel_refund_gmail_intake_shadow_dispatch/u);
  assert.match(snapshots.recoverExpiredDispatches.sql, /owner_recover_expired_refund_gmail_intake_shadow_dispatches/u);
  assert.match(snapshots.completeDueCleanup.sql, /owner_complete_due_refund_gmail_intake_shadow_cleanup/u);
  assert.match(snapshots.postflight.sql, /run_key = \$1::text/u);
  assert.match(snapshots.postflight.sql, /can_manage_refund_case\(\$2::uuid/u);
  assert.match(
    snapshots.postflight.sql,
    /select cleanup_task_handle::text from exact_cleanup limit 1/u,
  );
  assert.doesNotMatch(snapshots.postflight.sql, /min\(cleanup_task_handle\)/u);
});

test('a stale completed cleanup handle cannot pass while a newer assignment remains', async () => {
  let calls = 0;
  const client = createDatabase(async () => {
    calls += 1;
    return response([{
      database_owner_session: true,
      completed_now: '0',
      assigned_overdue: '0',
      assigned_outstanding: '1',
      task_found: true,
      task_status: 'completed',
      payload_redacted: true,
    }]);
  });
  await assert.rejects(
    client.completeDueCleanup({ cleanupTaskHandle: CLEANUP_TASK_HANDLE }),
    (error) => error.code === 'database_cleanup_completion_failed',
  );
  assert.equal(calls, 1);
});

test('database adapter pins project, owner endpoint, owner-role flag, and parameter arrays', async () => {
  const calls = [];
  const client = createDatabase(async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return response([[
      preflightRow(),
      {
        database_owner_session: true,
        authorized: true,
        status: 'armed',
        payload_redacted: true,
      },
      {
        database_owner_session: true,
        closed: true,
        status: 'consumed',
        payload_redacted: true,
      },
      {
        database_owner_session: true,
        recovered_expired_count: '1',
        armed_authorization_count: '0',
        consumed_running_count: '0',
        payload_redacted: true,
      },
      {
        database_owner_session: true,
        completed_now: '1',
        assigned_overdue: '0',
        assigned_outstanding: '0',
        task_found: true,
        task_status: 'completed',
        payload_redacted: true,
      },
      postflightRow(),
    ][calls.length - 1]]);
  });
  const before = await client.preflight();
  await client.authorizeDispatch({
    runKeyDigest: sha256Hex(RUN_KEY),
    ownerSenderDigest: OWNER_SENDER_DIGEST,
    freshStartAt: '2026-08-14T20:00:00.000Z',
  });
  await client.closeDispatch({ runKeyDigest: sha256Hex(RUN_KEY) });
  await client.recoverExpiredDispatches();
  await client.completeDueCleanup({ cleanupTaskHandle: CLEANUP_TASK_HANDLE });
  const result = await client.postflight({
    before,
    runKey: RUN_KEY,
    ownerUserId: OWNER_USER_ID,
  });

  assert.equal(calls.length, 6);
  assert.deepEqual(calls.map(({ body }) => body.parameters), [
    [],
    [sha256Hex(RUN_KEY), OWNER_SENDER_DIGEST, '2026-08-14T20:00:00.000Z'],
    [sha256Hex(RUN_KEY)],
    [],
    [CLEANUP_TASK_HANDLE],
    [RUN_KEY, OWNER_USER_ID],
  ]);
  for (const call of calls) {
    assert.equal(call.url, DATABASE_ENDPOINT);
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.headers.Authorization, `Bearer ${MANAGEMENT_TOKEN}`);
    assert.equal(call.body.read_only, false);
    assert.deepEqual(Object.keys(call.body).sort(), ['parameters', 'query', 'read_only']);
  }
  assert.equal(before.databaseOwnerSession, true);
  assert.equal(before.nayaxProviderAttemptCount, 7);
  assert.equal(result.refundCaseDelta, 1);
  assert.equal(result.gmailMessageDelta, 1);
  assert.equal(result.customerInboundDelta, 1);
  assert.equal(result.providerSentMailboxDelta, 1);
  assert.equal(result.firstContactShadowedDelta, 1);
  assert.equal(result.managerNoticeShadowedDelta, 1);
  assert.equal(result.noticeLedgerDelta, 1);
  assert.equal(result.cleanupObligationDelta, 1);
  assert.equal(result.exactFirstContactOperationCount, 1);
  assert.equal(result.exactFirstContactEventCount, 1);
  assert.equal(result.exactActionEventCount, 1);
  assert.equal(result.cleanupObligationCount, 1);
  assert.equal(result.cleanupAssignedOwnerRole, 'refund_operations_owner');
  assert.equal(result.cleanupStatus, 'assigned');
  assert.equal(result.nayaxProviderAttemptDelta, 0);
  assert.equal(result.ownerManageableCaseCount, 1);
  assert.equal(result.routeClass, 'assigned_managers');
  assert.equal(result.exactThreadMessageCount, 2);
  assert.equal(result.exactCustomerInboundCount, 1);
  assert.equal(result.exactProviderSentMailboxCount, 1);
});

test('database adapter rejects wrong project before fetch and re-proves owner on every response', async () => {
  let calls = 0;
  assert.throws(
    () => createRefundGmailIntakeShadowDatabaseClient({
      projectRef: REFUND_INTAKE_SHADOW_PROJECT_REF,
      confirmProjectRef: 'lookalike-project-ref',
      managementToken: MANAGEMENT_TOKEN,
      fetchImpl: async () => { calls += 1; },
    }),
    (error) => error.code === 'database_project_not_confirmed',
  );
  assert.equal(calls, 0);
  for (const operation of [
    'preflight', 'authorizeDispatch', 'closeDispatch', 'recoverExpiredDispatches',
    'completeDueCleanup',
    'postflight',
  ]) {
    const client = createDatabase(async () => response([
      operation === 'preflight'
        ? preflightRow({ database_owner_session: false })
        : operation === 'authorizeDispatch'
        ? {
          database_owner_session: false,
          authorized: true,
          status: 'armed',
          payload_redacted: true,
        }
        : operation === 'closeDispatch'
        ? {
          database_owner_session: false,
          closed: true,
          status: 'cancelled',
          payload_redacted: true,
        }
        : operation === 'recoverExpiredDispatches'
        ? {
          database_owner_session: false,
          recovered_expired_count: '1',
          armed_authorization_count: '0',
          consumed_running_count: '0',
          payload_redacted: true,
        }
        : operation === 'completeDueCleanup'
        ? {
          database_owner_session: false,
          completed_now: '1',
          assigned_overdue: '0',
          assigned_outstanding: '0',
          task_found: true,
          task_status: 'completed',
          payload_redacted: true,
        }
        : postflightRow({ database_owner_session: false }),
    ]));
    const invocation = operation === 'preflight'
      ? client.preflight()
      : operation === 'authorizeDispatch'
      ? client.authorizeDispatch({
        runKeyDigest: sha256Hex(RUN_KEY),
        ownerSenderDigest: OWNER_SENDER_DIGEST,
        freshStartAt: '2026-08-14T20:00:00.000Z',
      })
      : operation === 'closeDispatch'
      ? client.closeDispatch({ runKeyDigest: sha256Hex(RUN_KEY) })
      : operation === 'recoverExpiredDispatches'
      ? client.recoverExpiredDispatches()
      : operation === 'completeDueCleanup'
      ? client.completeDueCleanup({ cleanupTaskHandle: CLEANUP_TASK_HANDLE })
      : client.postflight({
        before: { snapshot: snapshotRow() },
        runKey: RUN_KEY,
        ownerUserId: OWNER_USER_ID,
      });
    await assert.rejects(invocation, (error) => error.code === 'database_owner_required');
  }
});

test('database malformed, multirow, 429, 500, rejection, and abort paths are one attempt and redacted', async () => {
  const cases = [
    async () => response({ detail: PRIVATE_RESPONSE }),
    async () => response([preflightRow(), preflightRow()]),
    async () => response({ detail: PRIVATE_RESPONSE }, 429),
    async () => response({ detail: PRIVATE_RESPONSE }, 500),
    async () => { throw new Error(PRIVATE_RESPONSE); },
    async (_url, options) => new Promise((_resolve, reject) => {
      const abort = () => reject(new Error(PRIVATE_RESPONSE));
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    }),
  ];
  for (let index = 0; index < cases.length; index += 1) {
    let calls = 0;
    const controller = new AbortController();
    if (index === cases.length - 1) controller.abort();
    const client = createDatabase(async (...args) => {
      calls += 1;
      return cases[index](...args);
    });
    await assert.rejects(
      client.preflight({ signal: controller.signal }),
      (error) => {
        assert.doesNotMatch(`${error.message}${JSON.stringify(error)}`, /private_/u);
        assert.match(error.code, /^database_(?:query_failed|response_invalid)$/u);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test('postflight rejects malformed input, extra keys, invalid counts, and negative deltas', async () => {
  const client = createDatabase(async () => response([postflightRow()]));
  await assert.rejects(
    client.postflight({ before: {}, runKey: RUN_KEY, ownerUserId: OWNER_USER_ID }),
    (error) => error.code === 'database_postflight_input_invalid',
  );
  for (const row of [
    postflightRow({ unexpected: true }),
    postflightRow({ run_count: 'invalid' }),
    postflightRow({ refund_cases: '9' }),
  ]) {
    const invalid = createDatabase(async () => response([row]));
    await assert.rejects(
      invalid.postflight({
        before: { snapshot: snapshotRow() },
        runKey: RUN_KEY,
        ownerUserId: OWNER_USER_ID,
      }),
      (error) => error.code === 'database_response_invalid',
    );
  }
});

test('control exposes no live secret mutation and initialization is the only POST boundary', async () => {
  const client = createRefundGmailIntakeShadowControlClient({
    projectRef: REFUND_INTAKE_SHADOW_PROJECT_REF,
    managementToken: MANAGEMENT_TOKEN,
    repoRoot: process.cwd(),
    fetchImpl: async () => response({}, 201),
  });
  assert.equal(typeof client.initializeClosed, 'function');
  assert.equal(typeof client.readInitializedClosedState, 'function');
  assert.equal(typeof client.readState, 'function');
  assert.equal('openIntake' in client, false);
  assert.equal('safeClose' in client, false);
});

test('owner initialization writes only the dedicated label and exact closed settings', async () => {
  const writes = [];
  const client = createRefundGmailIntakeShadowControlClient({
    projectRef: REFUND_INTAKE_SHADOW_PROJECT_REF,
    managementToken: MANAGEMENT_TOKEN,
    repoRoot: process.cwd(),
    fetchImpl: async (_url, options) => {
      writes.push(JSON.parse(options.body));
      return response({}, 201);
    },
  });
  await client.initializeClosed({ shadowLabelId: 'Label_owner_shadow' });
  assert.equal(writes.length, 1);
  const initialized = Object.fromEntries(
    writes[0].map(({ name, value }) => [name, value]),
  );
  assert.deepEqual(initialized, {
    REFUND_GMAIL_INTAKE_ENABLED: 'false',
    REFUND_GMAIL_ENABLED: 'false',
    REFUND_GMAIL_RETENTION_ENABLED: 'false',
    REFUND_GMAIL_FIRST_CONTACT_MODE: 'disabled',
    GMAIL_REFUND_START_AT: REFUND_INTAKE_SHADOW_SAFE_START_AT,
    GMAIL_REFUND_MAX_THREADS_PER_RUN: '1',
    GMAIL_REFUND_INTAKE_SHADOW_LABEL_ID: 'Label_owner_shadow',
    REFUND_GMAIL_INTAKE_SHADOW_OWNER_SENDER_SHA256:
      REFUND_INTAKE_SHADOW_ZERO_DIGEST,
    REFUND_GMAIL_INTAKE_SHADOW_RUN_KEY_SHA256:
      REFUND_INTAKE_SHADOW_ZERO_DIGEST,
  });
  await assert.rejects(
    client.initializeClosed({ shadowLabelId: '' }),
    (error) => error.code === 'intake_initialize_input_invalid',
  );
  assert.equal(writes.length, 1);
});

test('identity client uses the exact project endpoint and returns only the private owner UUID', async () => {
  const calls = [];
  const client = createRefundGmailIntakeShadowIdentityClient({
    projectRef: REFUND_INTAKE_SHADOW_PROJECT_REF,
    anonKey: ANON_KEY,
    ownerUserJwt: OWNER_JWT,
    ownerSenderDigest: OWNER_SENDER_DIGEST,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ id: OWNER_USER_ID, email: `  ${OWNER_EMAIL.toUpperCase()}  ` });
    },
  });
  assert.equal(await client.getOwnerUserId(), OWNER_USER_ID);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://${REFUND_INTAKE_SHADOW_PROJECT_REF}.supabase.co/auth/v1/user`);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.apikey, ANON_KEY);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${OWNER_JWT}`);
});

test('identity client rejects a JWT whose normalized email is not the armed owner sender', async () => {
  let calls = 0;
  const client = createRefundGmailIntakeShadowIdentityClient({
    projectRef: REFUND_INTAKE_SHADOW_PROJECT_REF,
    anonKey: ANON_KEY,
    ownerUserJwt: OWNER_JWT,
    ownerSenderDigest: OWNER_SENDER_DIGEST,
    fetchImpl: async () => {
      calls += 1;
      return response({ id: OWNER_USER_ID, email: PRIVATE_RESPONSE });
    },
  });
  await assert.rejects(client.getOwnerUserId(), (error) => {
    assert.equal(error.code, 'owner_identity_failed');
    assert.doesNotMatch(`${error.message}${JSON.stringify(error)}`, /private_/u);
    return true;
  });
  assert.equal(calls, 1);
});

test('edge client sends one fixed intake-shadow POST and returns only the aggregate allowlist', async () => {
  const calls = [];
  const allowed = {
    status: 'succeeded',
    payloadRedacted: true,
    threadsScanned: 1,
    messagesSeen: 2,
    messagesCreated: 2,
    messagesDeduplicated: 0,
    messagesFailed: 0,
    attachmentsQuarantined: 0,
    customerInboundMessages: 1,
    providerSentMailboxMessages: 1,
    mailboxAcknowledgementObserved: true,
    firstContactShadowed: 1,
    firstContactSent: 0,
    firstContactFailed: 0,
    firstContactReconciliationOutstanding: 0,
    outboundReconciliationFailed: 0,
    outboundReconciliationOutstanding: 0,
    managerNoticeShadowed: 1,
    managerNoticeSentEvents: 0,
  };
  const client = createRefundGmailIntakeShadowEdgeClient({
    projectRef: REFUND_INTAKE_SHADOW_PROJECT_REF,
    syncSecret: SYNC_SECRET,
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return response({ ...allowed, privateIdentity: PRIVATE_RESPONSE });
    },
  });
  assert.deepEqual(await client.run({ runKey: RUN_KEY }), allowed);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://${REFUND_INTAKE_SHADOW_PROJECT_REF}.supabase.co/functions/v1/refund-gmail-sync`);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${SYNC_SECRET}`);
  assert.deepEqual(calls[0].body, { runKey: RUN_KEY, trigger: 'intake_shadow' });
});

test('edge rejection and malformed response are one attempt with fixed redacted failures', async () => {
  for (const fetchImpl of [
    async () => response({ detail: PRIVATE_RESPONSE }, 500),
    async () => response(PRIVATE_RESPONSE),
    async () => { throw new Error(PRIVATE_RESPONSE); },
  ]) {
    let calls = 0;
    const client = createRefundGmailIntakeShadowEdgeClient({
      projectRef: REFUND_INTAKE_SHADOW_PROJECT_REF,
      syncSecret: SYNC_SECRET,
      fetchImpl: async (...args) => {
        calls += 1;
        return fetchImpl(...args);
      },
    });
    await assert.rejects(client.run({ runKey: RUN_KEY }), (error) => {
      assert.doesNotMatch(`${error.message}${JSON.stringify(error)}`, /private_/u);
      assert.match(error.code, /^edge_(?:request_failed|request_rejected|response_invalid)$/u);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('secret digests are hashes of values and never the private values themselves', () => {
  assert.notEqual(sha256Hex(MANAGEMENT_TOKEN), MANAGEMENT_TOKEN);
  assert.notEqual(sha256Hex(SYNC_SECRET), SYNC_SECRET);
  assert.match(sha256Hex(MANAGEMENT_TOKEN), /^[a-f0-9]{64}$/u);
});
