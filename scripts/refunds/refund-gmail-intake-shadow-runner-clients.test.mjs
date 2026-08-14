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
  nayax_provider_attempts: '7',
});

const preflightRow = (overrides = {}) => ({
  database_owner_session: true,
  gate_allowed: true,
  gate_status: 'authorized',
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
  threads_scanned: '1',
  messages_seen: '2',
  messages_created: '2',
  messages_failed: '0',
  exact_notice_count: '1',
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
  assert.deepEqual(Object.keys(snapshots), ['preflight', 'postflight']);
  assert.deepEqual(
    Object.fromEntries(Object.entries(snapshots).map(([name, operation]) => [
      name,
      createHash('sha256').update(operation.sql).digest('hex'),
    ])),
    {
      preflight: '61f9fdc4af1670cf11b1d81912bc0715a731ce82a9cab927392497eaeeefa996',
      postflight: '9f9aaac9df7b77af9626a836ae0d8ca8e02a5036caa79e244e108997e70b7132',
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
  assert.equal(snapshots.postflight.parameterCount, 2);
  assert.match(snapshots.postflight.sql, /run_key = \$1::text/u);
  assert.match(snapshots.postflight.sql, /can_manage_refund_case\(\$2::uuid/u);
});

test('database adapter pins project, owner endpoint, owner-role flag, and parameter arrays', async () => {
  const calls = [];
  const client = createDatabase(async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return response(calls.length === 1 ? [preflightRow()] : [postflightRow()]);
  });
  const before = await client.preflight();
  const result = await client.postflight({
    before,
    runKey: RUN_KEY,
    ownerUserId: OWNER_USER_ID,
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ body }) => body.parameters), [[], [RUN_KEY, OWNER_USER_ID]]);
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
  for (const operation of ['preflight', 'postflight']) {
    const client = createDatabase(async () => response([
      operation === 'preflight'
        ? preflightRow({ database_owner_session: false })
        : postflightRow({ database_owner_session: false }),
    ]));
    const invocation = operation === 'preflight'
      ? client.preflight()
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

test('control open and safe-close write only the reviewed eight settings with retention and delivery off', async () => {
  const writes = [];
  const client = createRefundGmailIntakeShadowControlClient({
    projectRef: REFUND_INTAKE_SHADOW_PROJECT_REF,
    managementToken: MANAGEMENT_TOKEN,
    repoRoot: process.cwd(),
    fetchImpl: async (url, options) => {
      writes.push({ url, options, body: JSON.parse(options.body) });
      return response({}, 201);
    },
  });
  const ownerDigest = 'b'.repeat(64);
  const runDigest = 'c'.repeat(64);
  const startAt = '2026-08-14T20:00:00.000Z';
  await client.openIntake({ freshStartAt: startAt, ownerSenderDigest: ownerDigest, runKeyDigest: runDigest });
  await client.safeClose();
  assert.equal(writes.length, 2);
  const [open, close] = writes.map(({ body }) => Object.fromEntries(
    body.map(({ name, value }) => [name, value]),
  ));
  assert.deepEqual(Object.keys(open).sort(), Object.keys(close).sort());
  assert.deepEqual(Object.keys(open).sort(), [
    'GMAIL_REFUND_MAX_THREADS_PER_RUN',
    'GMAIL_REFUND_START_AT',
    'REFUND_GMAIL_ENABLED',
    'REFUND_GMAIL_FIRST_CONTACT_MODE',
    'REFUND_GMAIL_INTAKE_ENABLED',
    'REFUND_GMAIL_INTAKE_SHADOW_OWNER_SENDER_SHA256',
    'REFUND_GMAIL_INTAKE_SHADOW_RUN_KEY_SHA256',
    'REFUND_GMAIL_RETENTION_ENABLED',
  ].sort());
  assert.equal(open.REFUND_GMAIL_INTAKE_ENABLED, 'true');
  assert.equal(open.REFUND_GMAIL_ENABLED, 'false');
  assert.equal(open.REFUND_GMAIL_RETENTION_ENABLED, 'false');
  assert.equal(open.REFUND_GMAIL_FIRST_CONTACT_MODE, 'shadow');
  assert.equal(open.GMAIL_REFUND_START_AT, startAt);
  assert.equal(open.GMAIL_REFUND_MAX_THREADS_PER_RUN, '1');
  assert.equal(open.REFUND_GMAIL_INTAKE_SHADOW_OWNER_SENDER_SHA256, ownerDigest);
  assert.equal(open.REFUND_GMAIL_INTAKE_SHADOW_RUN_KEY_SHA256, runDigest);
  assert.equal(close.REFUND_GMAIL_INTAKE_ENABLED, 'false');
  assert.equal(close.REFUND_GMAIL_ENABLED, 'false');
  assert.equal(close.REFUND_GMAIL_RETENTION_ENABLED, 'false');
  assert.equal(close.REFUND_GMAIL_FIRST_CONTACT_MODE, 'disabled');
  assert.equal(close.GMAIL_REFUND_START_AT, REFUND_INTAKE_SHADOW_SAFE_START_AT);
  assert.equal(close.REFUND_GMAIL_INTAKE_SHADOW_OWNER_SENDER_SHA256, REFUND_INTAKE_SHADOW_ZERO_DIGEST);
  assert.equal(close.REFUND_GMAIL_INTAKE_SHADOW_RUN_KEY_SHA256, REFUND_INTAKE_SHADOW_ZERO_DIGEST);
  for (const { url, options } of writes) {
    assert.equal(url, `https://api.supabase.com/v1/projects/${REFUND_INTAKE_SHADOW_PROJECT_REF}/secrets`);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, `Bearer ${MANAGEMENT_TOKEN}`);
  }
});

test('control rejects invalid open inputs before any mutation', async () => {
  let calls = 0;
  const client = createRefundGmailIntakeShadowControlClient({
    projectRef: REFUND_INTAKE_SHADOW_PROJECT_REF,
    managementToken: MANAGEMENT_TOKEN,
    repoRoot: process.cwd(),
    fetchImpl: async () => { calls += 1; },
  });
  for (const input of [
    { freshStartAt: 'invalid', ownerSenderDigest: 'b'.repeat(64), runKeyDigest: 'c'.repeat(64) },
    { freshStartAt: '2026-08-14T20:00:00Z', ownerSenderDigest: REFUND_INTAKE_SHADOW_ZERO_DIGEST, runKeyDigest: 'c'.repeat(64) },
    { freshStartAt: '2026-08-14T20:00:00Z', ownerSenderDigest: 'b'.repeat(64), runKeyDigest: REFUND_INTAKE_SHADOW_ZERO_DIGEST },
  ]) {
    await assert.rejects(client.openIntake(input), (error) => error.code === 'intake_open_input_invalid');
  }
  assert.equal(calls, 0);
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
