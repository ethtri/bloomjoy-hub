import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  createManagementApiOwnerDatabaseClient,
  getManagementApiOwnerQuerySnapshots,
  MANAGEMENT_API_OWNER_DATABASE_ADAPTER,
} from './refund-synthetic-gmail-proof-management-api.mjs';
import {
  executeSyntheticGmailProof,
  REFUND_PRODUCTION_PROJECT_REF,
  REFUND_SYNTHETIC_PROOF_LIVE_CONFIRMATION,
  SyntheticGmailProofRunnerError,
} from './refund-synthetic-gmail-proof-runner-lib.mjs';

const CASE_ID = '81400000-0000-4000-8000-000000000001';
const USER_ID = '81400000-0000-4000-8000-000000000002';
const AUTHORIZATION_ID = '81400000-0000-4000-8000-000000000003';
const MANAGEMENT_TOKEN_SENTINEL = 'management_private_token_never_print_814000';
const PRIVATE_RESPONSE_SENTINEL = 'private_response_never_print_814000';
const TOKEN_SENTINEL = 'owner_private_run_token_never_print_814000';
const ENDPOINT =
  `https://api.supabase.com/v1/projects/${REFUND_PRODUCTION_PROJECT_REF}/database/query`;

const response = (body, status = 201) => ({
  status,
  async json() {
    return body;
  },
});

const preflightRow = (overrides = {}) => ({
  database_owner_session: true,
  active_authorization_count: '0',
  unresolved_gmail_outbound_count: '0',
  eligible_case_count: '1',
  thread_count: '1',
  attachment_count: '0',
  manager_route_resolved: true,
  manager_count: 2,
  automatic_customer_contact_enabled: false,
  gpt_triage_enabled: false,
  gpt_auto_send_enabled: false,
  attachment_quarantine_approved: false,
  ...overrides,
});

const prepareResult = {
  prepared: true,
  authorizationId: AUTHORIZATION_ID,
  expiresAt: '2026-08-13T12:04:00.000Z',
  expectedManagerCount: 2,
  messageType: 'status_update',
  payloadRedacted: true,
};

const summaryResult = {
  prepared: true,
  proofPassed: true,
  payloadRedacted: true,
};

const closeResult = {
  closed: true,
  activeAuthorizationCount: 0,
  payloadRedacted: true,
};

const executionConfig = {
  mode: 'live',
  timeoutMs: 120_000,
  projectRef: REFUND_PRODUCTION_PROJECT_REF,
  confirmProjectRef: REFUND_PRODUCTION_PROJECT_REF,
  caseId: CASE_ID,
  confirmCaseId: CASE_ID,
  databaseAdapter: MANAGEMENT_API_OWNER_DATABASE_ADAPTER,
  databaseUrl: '',
  managementToken: MANAGEMENT_TOKEN_SENTINEL,
  anonKey: 'owner_private_publishable_key_814000',
  userAccessToken: 'header.owner_private_user_jwt.signature',
  liveConfirmation: REFUND_SYNTHETIC_PROOF_LIVE_CONFIRMATION,
};

const allOffState = (gmailEnabled = false) => ({
  edge: {
    gmailEnabled,
    automaticCustomerContactEnabled: false,
    firstContactMode: 'disabled',
    automationEnabled: false,
    managerAgingEnabled: false,
    gmailRetentionEnabled: false,
    attachmentScannerEnabled: false,
    gptTriageEnabled: false,
    nayaxExecutionEnabled: false,
    nayaxDryRun: true,
    nayaxKillSwitch: true,
    nayaxProviderContractConfirmed: false,
    nayaxSponsorGoNoGo: false,
  },
  github: {
    gmailSyncEnabled: false,
    gmailRetentionEnabled: false,
    automationSweepEnabled: false,
    gptTriageSyncEnabled: false,
  },
  release: {
    productionAligned: true,
    backupCompletedFresh: true,
    officialActionsEnabled: false,
    nayaxProviderAdapterEnabled: false,
  },
});

const successfulExecutionSummary = {
  prepared: true,
  globalCaseMessageDelta: 1,
  globalGmailOutboundDelta: 1,
  caseMessageDelta: 1,
  caseGmailOutboundDelta: 1,
  caseAttachmentDelta: 0,
  proofMessageSent: true,
  proofGmailSent: true,
  originalThreadPreserved: true,
  managerRoutePreserved: true,
  senderIsInfo: true,
  recipientPreserved: true,
  unresolvedDeliveryCount: 0,
  proofPassed: true,
  payloadRedacted: true,
};

const createClient = (fetchImpl, overrides = {}) =>
  createManagementApiOwnerDatabaseClient({
    projectRef: REFUND_PRODUCTION_PROJECT_REF,
    confirmProjectRef: REFUND_PRODUCTION_PROJECT_REF,
    managementToken: MANAGEMENT_TOKEN_SENTINEL,
    fetchImpl,
    ...overrides,
  });

test('adapter is explicit and rejects every non-exact project confirmation', () => {
  assert.equal(MANAGEMENT_API_OWNER_DATABASE_ADAPTER, 'management-api-owner');
  for (const config of [
    {
      projectRef: 'a'.repeat(20),
      confirmProjectRef: 'a'.repeat(20),
      managementToken: MANAGEMENT_TOKEN_SENTINEL,
    },
    {
      projectRef: REFUND_PRODUCTION_PROJECT_REF,
      confirmProjectRef: 'a'.repeat(20),
      managementToken: MANAGEMENT_TOKEN_SENTINEL,
    },
    {
      projectRef: REFUND_PRODUCTION_PROJECT_REF,
      confirmProjectRef: REFUND_PRODUCTION_PROJECT_REF,
      managementToken: '',
    },
  ]) {
    assert.throws(
      () => createManagementApiOwnerDatabaseClient({ ...config, fetchImpl: async () => {} }),
      SyntheticGmailProofRunnerError,
    );
  }
});

test('six fixed operations use the exact endpoint, parameter arrays, and owner-role flags', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, options, body });
    if (body.query.includes('owner_prepare_refund_synthetic_gmail_proof')) {
      return response([{ database_owner_session: true, result: prepareResult }]);
    }
    if (body.query.includes('owner_get_refund_synthetic_gmail_proof_summary')) {
      return response([{ database_owner_session: true, result: summaryResult }]);
    }
    if (body.query.includes('owner_close_refund_synthetic_gmail_proof')) {
      return response([{ database_owner_session: true, result: closeResult }]);
    }
    if (body.query.includes('can_manage_refund_case')) {
      return response([{ database_owner_session: true, allowed: true }]);
    }
    if (body.query.includes('active_authorization_count') && body.query.includes('authorization_id')) {
      return response([{
        database_owner_session: true,
        active_authorization_count: 1,
        authorization_id: AUTHORIZATION_ID,
      }]);
    }
    return response([preflightRow()]);
  };
  const client = createClient(fetchImpl);

  assert.deepEqual(
    Object.keys(client).sort(),
    [
      'canManageCase',
      'close',
      'dispose',
      'findActiveAuthorizationId',
      'preflight',
      'prepare',
      'summary',
    ].sort(),
  );
  await client.preflight({ caseId: CASE_ID });
  await client.canManageCase({ userId: USER_ID, caseId: CASE_ID });
  await client.prepare({ caseId: CASE_ID, runTokenDigest: 'd'.repeat(64), confirmation: 'prepare' });
  await client.findActiveAuthorizationId({ caseId: CASE_ID });
  await client.summary({ authorizationId: AUTHORIZATION_ID, confirmation: 'summary' });
  await client.close({ authorizationId: AUTHORIZATION_ID, confirmation: 'close' });

  assert.equal(calls.length, 6);
  // The Management API uses read_only:true to select a non-owner session. Every
  // operation therefore selects the owner session while read lanes stay fixed SELECTs.
  assert.deepEqual(calls.map(({ body }) => body.read_only), [false, false, false, false, false, false]);
  assert.deepEqual(calls.map(({ body }) => body.parameters), [
    [CASE_ID],
    [USER_ID, CASE_ID],
    [CASE_ID, 'd'.repeat(64), 'prepare'],
    [CASE_ID],
    [AUTHORIZATION_ID, 'summary'],
    [AUTHORIZATION_ID, 'close'],
  ]);
  for (const call of calls) {
    assert.equal(call.url, ENDPOINT);
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.headers.Authorization, `Bearer ${MANAGEMENT_TOKEN_SENTINEL}`);
    assert.deepEqual(Object.keys(call.body).sort(), ['parameters', 'query', 'read_only']);
    assert.match(call.body.query, /database_owner_session/u);
    assert.match(call.body.query, /pg_catalog\.pg_database/u);
    assert.match(call.body.query, /pg_catalog\.pg_get_userbyid/u);
    assert.match(call.body.query, /session_user/u);
    assert.doesNotMatch(call.body.query, /\$\{(?:caseId|userId|authorizationId)/u);
  }
});

test('closed registry pins every full SQL string and semantically read-only lane', () => {
  const snapshots = getManagementApiOwnerQuerySnapshots();
  assert.deepEqual(Object.keys(snapshots), [
    'preflight',
    'canManageCase',
    'prepare',
    'findActiveAuthorizationId',
    'summary',
    'close',
  ]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(snapshots).map(([name, operation]) => [
      name,
      createHash('sha256').update(operation.sql).digest('hex'),
    ])),
    {
      preflight: '9040b5b4eba104f5239e1d5143174e580f6a8db2448e191114e687205d842da8',
      canManageCase: '57fd76027efd76f7097da1290d69944f44ca95d3037340b85c68617521e6ea7b',
      prepare: '174c5440d49cff521dc795f4a280ba4a15d4266cc307104e2f405a255d127026',
      findActiveAuthorizationId:
        'c287cf36f2af415a9acf7e4f83416690640d66ee89302fd8c92cec24115a3b8e',
      summary: 'e03758ac0ce0c85468f2a27784f3cbed82ebaf0e3ac0320a996db51a2851a1e0',
      close: 'd2c8ca79c3480de32fa3ac70333e65a77e1b5458e956f21c70b6e03c2c57382a',
    },
  );
  const readNames = ['preflight', 'canManageCase', 'findActiveAuthorizationId', 'summary'];
  const mutationPattern =
    /\b(?:alter|analyze|begin|call|checkpoint|cluster|comment|commit|copy|create|deallocate|delete|discard|do|drop|execute|grant|insert|into|listen|lock|merge|move|notify|perform|prepare|reassign|refresh|reindex|reset|revoke|rollback|set|truncate|unlisten|update|vacuum)\b|\b(?:nextval|setval|pg_notify|dblink|lo_import|lo_export)\s*\(/iu;
  for (const [name, operation] of Object.entries(snapshots)) {
    assert.equal(operation.managementApiReadOnly, false);
    assert.doesNotMatch(operation.sql, /;/u);
    if (readNames.includes(name)) {
      assert.match(operation.sql, /^\s*(?:with\b|select\b)/iu);
      assert.doesNotMatch(operation.sql, mutationPattern);
    }
  }
});

test('preflight returns only the existing normalized aggregate contract', async () => {
  const client = createClient(async () => response([preflightRow()]));
  assert.deepEqual(await client.preflight({ caseId: CASE_ID }), {
    databaseOwnerSession: true,
    activeAuthorizationCount: 0,
    unresolvedGmailOutboundCount: 0,
    eligibleCaseCount: 1,
    threadCount: 1,
    attachmentCount: 0,
    managerRouteResolved: true,
    managerCount: 2,
    automaticCustomerContactEnabled: false,
    gptTriageEnabled: false,
    gptAutoSendEnabled: false,
    attachmentQuarantineApproved: false,
  });
});

test('every operation re-proves database and session owner before accepting output', async () => {
  const scenarios = [
    ['preflight', [preflightRow({ database_owner_session: false })]],
    ['canManageCase', [{ database_owner_session: false, allowed: true }]],
    ['prepare', [{ database_owner_session: false, result: prepareResult }]],
    ['findActiveAuthorizationId', [{
      database_owner_session: false,
      active_authorization_count: 1,
      authorization_id: AUTHORIZATION_ID,
    }]],
    ['summary', [{ database_owner_session: false, result: summaryResult }]],
    ['close', [{ database_owner_session: false, result: closeResult }]],
  ];
  for (const [method, body] of scenarios) {
    const client = createClient(async () => response(body));
    const input = method === 'preflight' || method === 'findActiveAuthorizationId'
      ? { caseId: CASE_ID }
      : method === 'canManageCase'
      ? { userId: USER_ID, caseId: CASE_ID }
      : method === 'prepare'
      ? { caseId: CASE_ID, runTokenDigest: 'd'.repeat(64), confirmation: 'prepare' }
      : { authorizationId: AUTHORIZATION_ID, confirmation: method };
    await assert.rejects(
      client[method](input),
      (error) => error.code === 'management_database_owner_required',
    );
  }
});

test('malformed, extra-key, multirow, and invalid-count responses fail closed', async () => {
  const invalidBodies = [
    null,
    {},
    [],
    [preflightRow(), preflightRow()],
    [preflightRow({ unexpected: true })],
    [preflightRow({ manager_count: 'not-a-count' })],
    [preflightRow({ manager_route_resolved: 'true' })],
  ];
  for (const body of invalidBodies) {
    const client = createClient(async () => response(body));
    await assert.rejects(
      client.preflight({ caseId: CASE_ID }),
      (error) => error.code === 'management_database_response_invalid',
    );
  }
});

test('find-active is exact-case only and rejects inconsistent cardinality', async () => {
  const calls = [];
  const client = createClient(async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return response([{
      database_owner_session: true,
      active_authorization_count: 0,
      authorization_id: null,
    }]);
  });
  assert.equal(await client.findActiveAuthorizationId({ caseId: CASE_ID }), null);
  assert.deepEqual(calls[0].parameters, [CASE_ID]);
  assert.match(calls[0].query, /proof_authorization\.refund_case_id = \$1::uuid/u);

  for (const row of [
    { database_owner_session: true, active_authorization_count: 0, authorization_id: AUTHORIZATION_ID },
    { database_owner_session: true, active_authorization_count: 1, authorization_id: null },
    { database_owner_session: true, active_authorization_count: 2, authorization_id: AUTHORIZATION_ID },
  ]) {
    const invalidClient = createClient(async () => response([row]));
    await assert.rejects(
      invalidClient.findActiveAuthorizationId({ caseId: CASE_ID }),
      (error) => error.code === 'management_database_response_invalid',
    );
  }
});

test('HTTP 200, 429, and 500 each fail generically without retrying or exposing response details', async () => {
  for (const status of [200, 429, 500]) {
    let calls = 0;
    const client = createClient(async () => {
      calls += 1;
      return response({ detail: PRIVATE_RESPONSE_SENTINEL }, status);
    });
    await assert.rejects(
      client.prepare({ caseId: CASE_ID, runTokenDigest: 'd'.repeat(64), confirmation: 'prepare' }),
      (error) => {
        assert.equal(error.code, 'management_database_prepare_failed');
        assert.doesNotMatch(`${error.message}${JSON.stringify(error)}`, /private_response_never_print/u);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test('network rejection and abort are one attempt with fixed redacted errors', async () => {
  for (const mode of ['reject', 'abort']) {
    let calls = 0;
    const fetchImpl = async (_url, options) => {
      calls += 1;
      if (mode === 'reject') throw new Error(PRIVATE_RESPONSE_SENTINEL);
      await new Promise((resolve, reject) => {
        const abort = () => reject(new Error(PRIVATE_RESPONSE_SENTINEL));
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      });
    };
    const client = createClient(fetchImpl, { requestTimeoutMs: 5 });
    await assert.rejects(
      client.close({ authorizationId: AUTHORIZATION_ID, confirmation: 'close' }),
      (error) => {
        assert.equal(error.code, 'management_database_close_failed');
        assert.doesNotMatch(`${error.message}${JSON.stringify(error)}`, /private_response_never_print/u);
        assert.doesNotMatch(`${error.message}${JSON.stringify(error)}`, /management_private_token/u);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test('malformed successful mutation responses are not retried', async () => {
  for (const method of ['prepare', 'summary', 'close']) {
    let calls = 0;
    const client = createClient(async () => {
      calls += 1;
      return response([{ database_owner_session: true, result: PRIVATE_RESPONSE_SENTINEL }]);
    });
    const input = method === 'prepare'
      ? { caseId: CASE_ID, runTokenDigest: 'd'.repeat(64), confirmation: 'prepare' }
      : { authorizationId: AUTHORIZATION_ID, confirmation: method };
    await assert.rejects(
      client[method](input),
      (error) => error.code === 'management_database_response_invalid',
    );
    assert.equal(calls, 1);
  }
});

test('timed-out prepare is not retried and recovery waits until Gmail is proven off', async () => {
  const calls = [];
  let activeAuthorizationCount = 0;
  let gmailEnabled = false;
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.query.includes('owner_prepare_refund_synthetic_gmail_proof')) {
      calls.push('database.prepare');
      activeAuthorizationCount = 1;
      await new Promise((resolve, reject) => {
        const abort = () => reject(new Error(PRIVATE_RESPONSE_SENTINEL));
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      });
    }
    if (request.query.includes('owner_get_refund_synthetic_gmail_proof_summary')) {
      calls.push('database.summary');
      return response([{
        database_owner_session: true,
        result: { prepared: true, payloadRedacted: true },
      }]);
    }
    if (request.query.includes('owner_close_refund_synthetic_gmail_proof')) {
      calls.push('database.close');
      activeAuthorizationCount = 0;
      return response([{ database_owner_session: true, result: closeResult }]);
    }
    if (request.query.includes('active_authorization_count') && request.query.includes('authorization_id')) {
      calls.push('database.findActiveAuthorizationId');
      return response([{
        database_owner_session: true,
        active_authorization_count: activeAuthorizationCount,
        authorization_id: activeAuthorizationCount === 1 ? AUTHORIZATION_ID : null,
      }]);
    }
    calls.push('database.preflight');
    return response([preflightRow({ active_authorization_count: activeAuthorizationCount })]);
  };
  const database = createClient(fetchImpl, { requestTimeoutMs: 5 });
  const clients = {
    database,
    identity: {
      async preflight() {
        calls.push('identity.preflight');
        return { authenticated: true, canManageCase: true };
      },
    },
    control: {
      async readState() {
        calls.push('control.readState');
        return allOffState(gmailEnabled);
      },
      async setGmailEnabled(enabled) {
        calls.push(`control.setGmailEnabled:${enabled}`);
        gmailEnabled = enabled;
      },
    },
    edge: {
      async send() {
        calls.push('edge.send');
      },
    },
  };

  await assert.rejects(
    executeSyntheticGmailProof({
      config: executionConfig,
      clients,
      tokenFactory: () => TOKEN_SENTINEL,
    }),
    (error) => error.code === 'management_database_prepare_failed',
  );
  assert.equal(calls.filter((call) => call === 'database.prepare').length, 1);
  assert.equal(calls.filter((call) => call === 'edge.send').length, 0);
  assert(
    calls.indexOf('control.setGmailEnabled:false') <
      calls.indexOf('database.findActiveAuthorizationId'),
  );
  assert.equal(gmailEnabled, false);
  assert.equal(activeAuthorizationCount, 0);
});

test('timed-out close remains a failure after Gmail-off even when aggregate teardown is zero', async () => {
  const calls = [];
  let activeAuthorizationCount = 0;
  let gmailEnabled = false;
  let sendCount = 0;
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.query.includes('owner_prepare_refund_synthetic_gmail_proof')) {
      calls.push('database.prepare');
      activeAuthorizationCount = 1;
      return response([{ database_owner_session: true, result: {
        ...prepareResult,
        expiresAt: new Date(Date.now() + 240_000).toISOString(),
      } }]);
    }
    if (request.query.includes('owner_get_refund_synthetic_gmail_proof_summary')) {
      calls.push('database.summary');
      return response([{
        database_owner_session: true,
        result: successfulExecutionSummary,
      }]);
    }
    if (request.query.includes('owner_close_refund_synthetic_gmail_proof')) {
      calls.push('database.close');
      activeAuthorizationCount = 0;
      await new Promise((resolve, reject) => {
        const abort = () => reject(new Error(PRIVATE_RESPONSE_SENTINEL));
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      });
    }
    calls.push('database.preflight');
    return response([preflightRow({ active_authorization_count: activeAuthorizationCount })]);
  };
  const database = createClient(fetchImpl, { requestTimeoutMs: 5 });
  const clients = {
    database,
    identity: {
      async preflight() {
        return { authenticated: true, canManageCase: true };
      },
    },
    control: {
      async readState() {
        return allOffState(gmailEnabled);
      },
      async setGmailEnabled(enabled) {
        calls.push(`control.setGmailEnabled:${enabled}`);
        gmailEnabled = enabled;
      },
    },
    edge: {
      async send() {
        calls.push('edge.send');
        sendCount += 1;
        return {
          sent: true,
          status: 'sent',
          messageType: 'status_update',
          transport: 'gmail_thread',
        };
      },
    },
  };

  await assert.rejects(
    executeSyntheticGmailProof({
      config: executionConfig,
      clients,
      tokenFactory: () => TOKEN_SENTINEL,
    }),
    (error) => error.code === 'management_database_close_failed',
  );
  assert.equal(calls.filter((call) => call === 'database.close').length, 1);
  assert.equal(sendCount, 1);
  assert.equal(gmailEnabled, false);
  assert.equal(activeAuthorizationCount, 0);
});
