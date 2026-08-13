import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { installRedactedDatabaseErrorBoundary } from './refund-synthetic-gmail-proof-runner-clients.mjs';
import {
  DIRECT_POSTGRES_DATABASE_ADAPTER,
  MANAGEMENT_API_OWNER_DATABASE_ADAPTER,
  REFUND_PRODUCTION_PROJECT_REF,
  REFUND_SYNTHETIC_PROOF_LIVE_CONFIRMATION,
  SyntheticGmailProofRunnerError,
  evaluateBackupHealth,
  executeSyntheticGmailProof,
  runWithTimeout,
  validateSyntheticGmailProofConfig,
} from './refund-synthetic-gmail-proof-runner-lib.mjs';

const CASE_ID = '81000000-0000-4000-8000-000000000001';
const AUTHORIZATION_ID = '81000000-0000-4000-8000-000000000002';
const TOKEN_SENTINEL = 'owner_private_run_token_never_print_810000';
const USER_TOKEN_SENTINEL = 'header.owner_private_user_jwt.signature';
const MANAGEMENT_TOKEN_SENTINEL = 'owner_private_management_token_810000';
const DATABASE_SECRET_SENTINEL = 'owner-private-database-password-810000';

const baseConfig = (overrides = {}) => ({
  mode: 'live',
  timeoutMs: 120_000,
  projectRef: REFUND_PRODUCTION_PROJECT_REF,
  confirmProjectRef: REFUND_PRODUCTION_PROJECT_REF,
  caseId: CASE_ID,
  confirmCaseId: CASE_ID,
  databaseAdapter: DIRECT_POSTGRES_DATABASE_ADAPTER,
  databaseUrl:
    `postgresql://postgres.${REFUND_PRODUCTION_PROJECT_REF}:${DATABASE_SECRET_SENTINEL}` +
    '@aws-0-us-west-1.pooler.supabase.com/postgres',
  managementToken: MANAGEMENT_TOKEN_SENTINEL,
  anonKey: 'owner_private_publishable_key_810000',
  userAccessToken: USER_TOKEN_SENTINEL,
  liveConfirmation: REFUND_SYNTHETIC_PROOF_LIVE_CONFIRMATION,
  ...overrides,
});

const offState = (gmailEnabled = false) => ({
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

const preflightState = (activeAuthorizationCount = 0) => ({
  databaseOwnerSession: true,
  activeAuthorizationCount,
  unresolvedGmailOutboundCount: 0,
  eligibleCaseCount: 1,
  threadCount: 1,
  attachmentCount: 0,
  managerRouteResolved: true,
  managerCount: 1,
  automaticCustomerContactEnabled: false,
  gptTriageEnabled: false,
  gptAutoSendEnabled: false,
  attachmentQuarantineApproved: false,
});

const successfulSummary = (proofPassed = true) => ({
  prepared: true,
  consumed: proofPassed,
  closed: false,
  expired: false,
  globalCaseMessageDelta: proofPassed ? 1 : 0,
  globalGmailOutboundDelta: proofPassed ? 1 : 0,
  caseMessageDelta: proofPassed ? 1 : 0,
  caseGmailOutboundDelta: proofPassed ? 1 : 0,
  caseAttachmentDelta: 0,
  proofMessageSent: proofPassed,
  proofGmailSent: proofPassed,
  originalThreadPreserved: proofPassed,
  managerRoutePreserved: proofPassed,
  senderIsInfo: proofPassed,
  recipientPreserved: proofPassed,
  unresolvedDeliveryCount: 0,
  proofPassed,
  payloadRedacted: true,
});

const createHarness = (overrides = {}) => {
  const calls = [];
  let gmailEnabled = false;
  let activeAuthorizationCount = 0;
  let sendConfirmed = false;
  let disableFailuresRemaining = overrides.disableFailuresRemaining ?? 0;
  const clients = {
    database: {
      async preflight() {
        calls.push('database.preflight');
        if (overrides.preflightFactory) {
          return overrides.preflightFactory({
            activeAuthorizationCount,
            callCount: calls.filter((call) => call === 'database.preflight').length,
          });
        }
        return overrides.preflight ?? preflightState(activeAuthorizationCount);
      },
      async prepare(input) {
        calls.push('database.prepare');
        activeAuthorizationCount = 1;
        if (overrides.prepare) return await overrides.prepare(input);
        return {
          prepared: true,
          authorizationId: AUTHORIZATION_ID,
          expiresAt: new Date(Date.now() + 240_000).toISOString(),
          expectedManagerCount: 1,
          messageType: 'status_update',
          payloadRedacted: true,
        };
      },
      async findActiveAuthorizationId() {
        calls.push('database.findActiveAuthorizationId');
        return activeAuthorizationCount === 1 ? AUTHORIZATION_ID : null;
      },
      async summary(input) {
        calls.push('database.summary');
        if (overrides.summary) return await overrides.summary(input);
        return successfulSummary(sendConfirmed);
      },
      async close(input) {
        calls.push('database.close');
        if (overrides.close) return await overrides.close(input);
        activeAuthorizationCount = 0;
        return { closed: true, activeAuthorizationCount: 0, payloadRedacted: true };
      },
    },
    identity: {
      async preflight() {
        calls.push('identity.preflight');
        return overrides.identity ?? { authenticated: true, canManageCase: true };
      },
    },
    control: {
      async readState() {
        calls.push('control.readState');
        return overrides.controlState?.(gmailEnabled) ?? offState(gmailEnabled);
      },
      async setGmailEnabled(enabled) {
        calls.push(`control.setGmailEnabled:${enabled}`);
        if (!enabled && disableFailuresRemaining > 0) {
          disableFailuresRemaining -= 1;
          throw new SyntheticGmailProofRunnerError('injected_disable_failure');
        }
        if (enabled && overrides.enableFailure) {
          throw new SyntheticGmailProofRunnerError('injected_enable_failure');
        }
        gmailEnabled = enabled;
      },
    },
    edge: {
      async send(input) {
        calls.push('edge.send');
        if (overrides.send) return await overrides.send(input);
        sendConfirmed = true;
        return {
          sent: true,
          status: 'sent',
          messageType: 'status_update',
          transport: 'gmail_thread',
        };
      },
    },
  };
  return {
    clients,
    calls,
    getState: () => ({ gmailEnabled, activeAuthorizationCount, sendConfirmed }),
  };
};

test('config is pinned to the exact project and case with an exact live confirmation', () => {
  assert.equal(validateSyntheticGmailProofConfig(baseConfig()).caseId, CASE_ID);
  assert.equal(
    validateSyntheticGmailProofConfig(baseConfig({
      databaseAdapter: MANAGEMENT_API_OWNER_DATABASE_ADAPTER,
      databaseUrl: '',
    })).databaseAdapter,
    MANAGEMENT_API_OWNER_DATABASE_ADAPTER,
  );
  assert.equal(
    validateSyntheticGmailProofConfig(
      baseConfig({
        databaseUrl:
          `postgres://postgres:${DATABASE_SECRET_SENTINEL}` +
          `@db.${REFUND_PRODUCTION_PROJECT_REF}.supabase.co/postgres`,
      }),
    ).caseId,
    CASE_ID,
  );
  for (const config of [
    baseConfig({ projectRef: 'a'.repeat(20), confirmProjectRef: 'a'.repeat(20) }),
    baseConfig({ confirmProjectRef: 'a'.repeat(20) }),
    baseConfig({ confirmCaseId: '81000000-0000-4000-8000-000000000003' }),
    baseConfig({ liveConfirmation: '' }),
    baseConfig({ databaseAdapter: 'arbitrary-database-adapter' }),
    baseConfig({
      databaseAdapter: MANAGEMENT_API_OWNER_DATABASE_ADAPTER,
      databaseUrl:
        `postgresql://postgres.${REFUND_PRODUCTION_PROJECT_REF}:${DATABASE_SECRET_SENTINEL}` +
        '@aws-0-us-west-1.pooler.supabase.com/postgres',
    }),
    baseConfig({ databaseUrl: 'postgresql://postgres:secret@localhost/postgres' }),
    baseConfig({
      databaseUrl:
        `postgresql://postgres:${DATABASE_SECRET_SENTINEL}` +
        `@db.${REFUND_PRODUCTION_PROJECT_REF}.supabase.co.attacker.example/postgres`,
    }),
    baseConfig({
      databaseUrl:
        `postgresql://postgres.${REFUND_PRODUCTION_PROJECT_REF}:${DATABASE_SECRET_SENTINEL}` +
        '@attacker-pooler.supabase.com.example/postgres',
    }),
    baseConfig({
      databaseUrl:
        `postgresql://postgres.wrongprojectref000:${DATABASE_SECRET_SENTINEL}` +
        '@aws-0-us-west-1.pooler.supabase.com/postgres',
    }),
    baseConfig({
      databaseUrl:
        `https://postgres.${REFUND_PRODUCTION_PROJECT_REF}:${DATABASE_SECRET_SENTINEL}` +
        '@aws-0-us-west-1.pooler.supabase.com/postgres',
    }),
  ]) {
    assert.throws(() => validateSyntheticGmailProofConfig(config), SyntheticGmailProofRunnerError);
  }
});

test('dry-run performs aggregate preflight only and makes no mutation', async () => {
  const harness = createHarness();
  const logs = [];
  const result = await executeSyntheticGmailProof({
    config: baseConfig({ mode: 'dry-run', liveConfirmation: '' }),
    clients: harness.clients,
    logger: (record) => logs.push(record),
  });
  assert.deepEqual(result, {
    ok: true,
    mode: 'dry-run',
    proofPassed: false,
    payloadRedacted: true,
  });
  assert.deepEqual(harness.calls, [
    'database.preflight',
    'identity.preflight',
    'control.readState',
  ]);
  assert.equal(logs.at(-1).phase, 'dry_run_passed');
});

test('success sends exactly one fixed status update and tears down before close', async () => {
  let sendInput;
  const harness = createHarness({
    send: async (input) => {
      sendInput = input;
      harness.getState().sendConfirmed = true;
      return {
        sent: true,
        status: 'sent',
        messageType: 'status_update',
        transport: 'gmail_thread',
      };
    },
    summary: async () => successfulSummary(true),
  });
  const logs = [];
  const result = await executeSyntheticGmailProof({
    config: baseConfig(),
    clients: harness.clients,
    logger: (record) => logs.push(record),
    tokenFactory: () => TOKEN_SENTINEL,
  });
  assert.equal(result.proofPassed, true);
  assert.deepEqual(
    Object.keys(sendInput).sort(),
    ['anonKey', 'caseId', 'messageType', 'projectRef', 'runToken', 'signal', 'userAccessToken'].sort(),
  );
  assert.equal(sendInput.messageType, 'status_update');
  assert.equal(sendInput.runToken, TOKEN_SENTINEL);
  assert.equal(harness.calls.filter((call) => call === 'edge.send').length, 1);
  assert(
    harness.calls.indexOf('control.setGmailEnabled:false') < harness.calls.indexOf('database.summary'),
    'Gmail must be restored off before postflight',
  );
  assert(
    harness.calls.indexOf('control.setGmailEnabled:false') < harness.calls.indexOf('database.close'),
    'Gmail must be restored off before authorization close',
  );
  assert.deepEqual(harness.getState(), {
    gmailEnabled: false,
    activeAuthorizationCount: 0,
    sendConfirmed: false,
  });
  const serialized = JSON.stringify(logs);
  for (const sentinel of [
    CASE_ID,
    AUTHORIZATION_ID,
    TOKEN_SENTINEL,
    USER_TOKEN_SENTINEL,
    MANAGEMENT_TOKEN_SENTINEL,
    DATABASE_SECRET_SENTINEL,
  ]) {
    assert.doesNotMatch(serialized, new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('preflight blockers reject before prepare, gate change, or send', async () => {
  const cases = [
    { preflight: preflightState(1), code: 'existing_authorization' },
    {
      preflight: { ...preflightState(), unresolvedGmailOutboundCount: 1 },
      code: 'unresolved_gmail_outbound',
    },
    { preflight: { ...preflightState(), eligibleCaseCount: 0 }, code: 'case_not_eligible' },
    { preflight: { ...preflightState(), attachmentCount: 1 }, code: 'case_not_eligible' },
    { preflight: { ...preflightState(), managerRouteResolved: false }, code: 'case_not_eligible' },
    { identity: { authenticated: true, canManageCase: false }, code: 'case_manager_identity_required' },
    {
      controlState: (gmail) => ({
        ...offState(gmail),
        edge: { ...offState(gmail).edge, automaticCustomerContactEnabled: true },
      }),
      code: 'edge_gate_state_invalid',
    },
    {
      controlState: (gmail) => ({
        ...offState(gmail),
        github: { ...offState(gmail).github, gmailSyncEnabled: true },
      }),
      code: 'schedule_gate_state_invalid',
    },
    {
      controlState: (gmail) => ({
        ...offState(gmail),
        release: { ...offState(gmail).release, backupCompletedFresh: false },
      }),
      code: 'release_gate_state_invalid',
    },
  ];
  for (const scenario of cases) {
    const harness = createHarness(scenario);
    await assert.rejects(
      executeSyntheticGmailProof({ config: baseConfig(), clients: harness.clients }),
      (error) => error.code === scenario.code,
    );
    assert(!harness.calls.includes('database.prepare'));
    assert(!harness.calls.includes('edge.send'));
    assert(!harness.calls.some((call) => call.startsWith('control.setGmailEnabled')));
  }
});

test('send rejection is never retried and still disables Gmail, summarizes, and closes', async () => {
  let sendCalls = 0;
  const harness = createHarness({
    send: async () => {
      sendCalls += 1;
      throw new SyntheticGmailProofRunnerError('injected_send_rejection');
    },
  });
  await assert.rejects(
    executeSyntheticGmailProof({
      config: baseConfig(),
      clients: harness.clients,
      tokenFactory: () => TOKEN_SENTINEL,
    }),
    (error) => error.code === 'injected_send_rejection',
  );
  assert.equal(sendCalls, 1);
  assert.equal(harness.getState().gmailEnabled, false);
  assert.equal(harness.getState().activeAuthorizationCount, 0);
  assert(harness.calls.includes('database.summary'));
  assert(harness.calls.includes('database.close'));
});

test('gate enable failure still restores false and closes the authorization', async () => {
  const harness = createHarness({ enableFailure: true });
  await assert.rejects(
    executeSyntheticGmailProof({
      config: baseConfig(),
      clients: harness.clients,
      tokenFactory: () => TOKEN_SENTINEL,
    }),
    (error) => error.code === 'injected_enable_failure',
  );
  assert.equal(harness.getState().gmailEnabled, false);
  assert.equal(harness.getState().activeAuthorizationCount, 0);
  assert(!harness.calls.includes('edge.send'));
});

test('lost prepare response is recovered internally and leaves no authorization open', async () => {
  const harness = createHarness({
    prepare: async () => {
      throw new SyntheticGmailProofRunnerError('prepare_response_lost');
    },
  });
  await assert.rejects(
    executeSyntheticGmailProof({
      config: baseConfig(),
      clients: harness.clients,
      tokenFactory: () => TOKEN_SENTINEL,
    }),
    (error) => error.code === 'prepare_response_lost',
  );
  assert(harness.calls.includes('database.findActiveAuthorizationId'));
  assert(harness.calls.includes('database.close'));
  assert.equal(harness.getState().activeAuthorizationCount, 0);
});

test('transient disable failures retry only teardown, never the send', async () => {
  const harness = createHarness({ disableFailuresRemaining: 2 });
  await executeSyntheticGmailProof({
    config: baseConfig(),
    clients: harness.clients,
    tokenFactory: () => TOKEN_SENTINEL,
  });
  assert.equal(
    harness.calls.filter((call) => call === 'control.setGmailEnabled:false').length,
    3,
  );
  assert.equal(harness.calls.filter((call) => call === 'edge.send').length, 1);
  assert.equal(harness.getState().gmailEnabled, false);
});

test('permanent disable failure leaves the exclusive authorization open and never closes it', async () => {
  const harness = createHarness({ disableFailuresRemaining: 99 });
  await assert.rejects(
    executeSyntheticGmailProof({
      config: baseConfig(),
      clients: harness.clients,
      tokenFactory: () => TOKEN_SENTINEL,
    }),
    (error) => error.code === 'injected_disable_failure',
  );
  assert.equal(harness.calls.filter((call) => call === 'edge.send').length, 1);
  assert(!harness.calls.includes('database.close'));
  assert.equal(harness.getState().activeAuthorizationCount, 1);
});

test('postflight mismatch fails but closes after Gmail is disabled', async () => {
  const harness = createHarness({ summary: async () => successfulSummary(false) });
  await assert.rejects(
    executeSyntheticGmailProof({
      config: baseConfig(),
      clients: harness.clients,
      tokenFactory: () => TOKEN_SENTINEL,
    }),
    (error) => error.code === 'postflight_not_proven',
  );
  assert.equal(harness.getState().gmailEnabled, false);
  assert.equal(harness.getState().activeAuthorizationCount, 0);
});

test('close failure is surfaced with Gmail off and no second send', async () => {
  const harness = createHarness({
    close: async () => {
      throw new SyntheticGmailProofRunnerError('injected_close_failure');
    },
  });
  await assert.rejects(
    executeSyntheticGmailProof({
      config: baseConfig(),
      clients: harness.clients,
      tokenFactory: () => TOKEN_SENTINEL,
    }),
    (error) => error.code === 'injected_close_failure',
  );
  assert.equal(harness.getState().gmailEnabled, false);
  assert.equal(harness.calls.filter((call) => call === 'edge.send').length, 1);
});

test('timeout aborts an in-flight send, never retries, and completes teardown', async () => {
  let sendCalls = 0;
  const harness = createHarness({
    send: async ({ signal }) => {
      sendCalls += 1;
      await new Promise((resolve, reject) => {
        const abort = () => reject(new SyntheticGmailProofRunnerError('injected_abort'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    },
  });
  await assert.rejects(
    runWithTimeout({
      timeoutMs: 25,
      run: (signal) => executeSyntheticGmailProof({
        config: baseConfig(),
        clients: harness.clients,
        signal,
        tokenFactory: () => TOKEN_SENTINEL,
      }),
    }),
    (error) => error.code === 'proof_timeout',
  );
  assert.equal(sendCalls, 1);
  assert.equal(harness.getState().gmailEnabled, false);
  assert.equal(harness.getState().activeAuthorizationCount, 0);
});

test('final database teardown fails if a customer-contact gate changes during the run', async () => {
  const harness = createHarness({
    preflightFactory: ({ activeAuthorizationCount, callCount }) => ({
      ...preflightState(activeAuthorizationCount),
      automaticCustomerContactEnabled: callCount > 1,
    }),
  });
  await assert.rejects(
    executeSyntheticGmailProof({
      config: baseConfig(),
      clients: harness.clients,
      tokenFactory: () => TOKEN_SENTINEL,
    }),
    (error) => error.code === 'database_teardown_invalid',
  );
  assert.equal(harness.getState().gmailEnabled, false);
  assert.equal(harness.getState().activeAuthorizationCount, 0);
});

test('idle database socket error during send cannot crash cleanup or retry the send', async () => {
  const idleClient = new EventEmitter();
  const databaseFailure = installRedactedDatabaseErrorBoundary(idleClient);
  let sendCalls = 0;
  const failIfDatabaseUnavailable = () => {
    if (databaseFailure.failed) {
      throw new SyntheticGmailProofRunnerError('database_connection_failed');
    }
  };
  const harness = createHarness({
    preflightFactory: ({ activeAuthorizationCount, callCount }) => {
      if (callCount > 1) failIfDatabaseUnavailable();
      return preflightState(activeAuthorizationCount);
    },
    summary: async () => {
      failIfDatabaseUnavailable();
      return successfulSummary(true);
    },
    close: async () => {
      failIfDatabaseUnavailable();
    },
    send: async () => {
      sendCalls += 1;
      assert.doesNotThrow(() => idleClient.emit('error', new Error('private_socket_detail')));
      return {
        sent: true,
        status: 'sent',
        messageType: 'status_update',
        transport: 'gmail_thread',
      };
    },
  });
  await assert.rejects(
    executeSyntheticGmailProof({
      config: baseConfig(),
      clients: harness.clients,
      tokenFactory: () => TOKEN_SENTINEL,
    }),
    (error) => error.code === 'database_connection_failed',
  );
  assert.equal(databaseFailure.failed, true);
  assert.equal(sendCalls, 1);
  assert.equal(harness.getState().gmailEnabled, false);
  assert.equal(harness.getState().activeAuthorizationCount, 1);
});

test('backup proof requires the latest backup to be completed and fresh', () => {
  const nowMs = Date.parse('2026-08-13T12:00:00Z');
  assert.equal(
    evaluateBackupHealth(
      { backups: [{ status: 'COMPLETED', inserted_at: '2026-08-13T04:00:00Z' }] },
      { nowMs },
    ),
    true,
  );
  assert.equal(
    evaluateBackupHealth(
      {
        backups: [
          { status: 'COMPLETED', inserted_at: '2026-08-13T04:00:00Z' },
          { status: 'FAILED', inserted_at: '2026-08-13T08:00:00Z' },
        ],
      },
      { nowMs },
    ),
    false,
  );
  assert.equal(
    evaluateBackupHealth(
      { backups: [{ status: 'COMPLETED', inserted_at: '2026-08-11T12:00:00Z' }] },
      { nowMs },
    ),
    false,
  );
  assert.equal(evaluateBackupHealth({ backups: [] }, { nowMs }), false);
});

test('owner interrupt aborts an in-flight send and still completes teardown', async () => {
  const controller = new AbortController();
  let sendCalls = 0;
  const harness = createHarness({
    send: async ({ signal }) => {
      sendCalls += 1;
      setImmediate(() => controller.abort(new SyntheticGmailProofRunnerError('owner_interrupt')));
      await new Promise((resolve, reject) => {
        const abort = () => reject(new SyntheticGmailProofRunnerError('owner_interrupt'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    },
  });
  await assert.rejects(
    runWithTimeout({
      timeoutMs: 120_000,
      signal: controller.signal,
      run: (signal) => executeSyntheticGmailProof({
        config: baseConfig(),
        clients: harness.clients,
        signal,
        tokenFactory: () => TOKEN_SENTINEL,
      }),
    }),
    (error) => error.code === 'owner_interrupt',
  );
  assert.equal(sendCalls, 1);
  assert.equal(harness.getState().gmailEnabled, false);
  assert.equal(harness.getState().activeAuthorizationCount, 0);
});
