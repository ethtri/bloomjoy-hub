import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildRefundGmailIntakeShadowConfig,
  loadRefundGmailIntakeShadowEnvironment,
  parseRefundGmailIntakeShadowArgs,
  parseRefundGmailIntakeShadowEnvFile,
} from './refund-gmail-intake-shadow-runner-config.mjs';
import {
  classifyRefundGmailIntakeShadowPostflight,
  executeRefundGmailIntakeShadow,
  REFUND_INTAKE_SHADOW_CLEANUP_COMMITMENT,
  REFUND_INTAKE_SHADOW_INITIALIZE_CONFIRMATION,
  REFUND_INTAKE_SHADOW_LIVE_CONFIRMATION,
  REFUND_INTAKE_SHADOW_PROJECT_REF,
  REFUND_INTAKE_SHADOW_RETENTION_POLICY_VERSION,
  REFUND_INTAKE_SHADOW_SAFE_START_AT,
  REFUND_INTAKE_SHADOW_ZERO_DIGEST,
  RefundGmailIntakeShadowRunnerError,
  runWithTimeout,
  sha256Hex,
} from './refund-gmail-intake-shadow-runner-lib.mjs';

const SHADOW_DIGEST = sha256Hex('Label_owner_shadow');
const PRODUCTION_DIGEST = sha256Hex('Label_production');
const OWNER_SENDER_DIGEST = sha256Hex('owner.synthetic@example.test');
const OWNER_USER_ID = 'a1000000-0000-4000-8000-000000000001';

const config = (overrides = {}) => ({
  mode: 'live',
  retentionPolicyVersion: REFUND_INTAKE_SHADOW_RETENTION_POLICY_VERSION,
  projectRef: REFUND_INTAKE_SHADOW_PROJECT_REF,
  confirmProjectRef: REFUND_INTAKE_SHADOW_PROJECT_REF,
  expectedShadowLabelDigest: SHADOW_DIGEST,
  confirmShadowLabelDigest: SHADOW_DIGEST,
  ownerSenderDigest: OWNER_SENDER_DIGEST,
  confirmOwnerSenderDigest: OWNER_SENDER_DIGEST,
  managementToken: 'management-token-private-value',
  syncSecret: 'sync-secret-private-value',
  anonKey: 'anonymous-key-private-value',
  ownerUserJwt: 'owner-jwt-private-value',
  liveConfirmation: REFUND_INTAKE_SHADOW_LIVE_CONFIRMATION,
  cleanupCommitment: REFUND_INTAKE_SHADOW_CLEANUP_COMMITMENT,
  timeoutMs: 480_000,
  ...overrides,
});

const databasePreflight = () => ({
  databaseOwnerSession: true,
  activeProofAuthorizationCount: 0,
  unresolvedGmailOutboundCount: 0,
  unresolvedFirstContactCount: 0,
  automaticCustomerContactEnabled: false,
  gptTriageEnabled: false,
  gptAutoSendEnabled: false,
  officialActionsEnabled: false,
  activeOfficialAuthorizationCount: 0,
  pendingStepUpIntentCount: 0,
  nayaxResolutionEnabled: false,
  nayaxOperatorCount: 0,
  nayaxResolutionIntentCount: 0,
  nayaxProviderAttemptCount: 3,
  unresolvedNayaxProviderAttemptCount: 0,
  retentionPolicyHealthy: true,
  attachmentsEnabled: false,
  scannerEnabled: false,
  payloadRedacted: true,
  snapshot: {
    refundCases: 20,
    gmailMessages: 30,
    customerInbound: 18,
    providerSentMailbox: 2,
    attachments: 0,
    hubOutboundOperations: 4,
    caseDeliveryMessages: 4,
    firstContactShadowed: 3,
    firstContactPendingOrSent: 0,
    managerNoticeShadowed: 0,
    managerNoticeOutboundAttempts: 7,
    noticeLedger: 0,
    cleanupObligations: 0,
    nayaxProviderAttempts: 3,
  },
});

const state = ({
  intakeEnabled = false,
  firstContactMode = 'disabled',
  startAt = REFUND_INTAKE_SHADOW_SAFE_START_AT,
  ownerSenderDigest = REFUND_INTAKE_SHADOW_ZERO_DIGEST,
  runKeyDigest = REFUND_INTAKE_SHADOW_ZERO_DIGEST,
} = {}) => ({
  edge: {
    intakeEnabled,
    gmailEnabled: false,
    firstContactMode,
    startAtDigest: sha256Hex(startAt),
    maxThreads: 1,
    productionLabelDigest: PRODUCTION_DIGEST,
    shadowLabelDigest: SHADOW_DIGEST,
    ownerSenderSecretDigest: sha256Hex(ownerSenderDigest),
    runKeySecretDigest: sha256Hex(runKeyDigest),
    automaticCustomerContactEnabled: false,
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

const edgeSuccess = () => ({
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
});

const completePostflight = (overrides = {}) => ({
  databaseOwnerSession: true,
  activeProofAuthorizationCount: 0,
  unresolvedGmailOutboundCount: 0,
  unresolvedFirstContactCount: 0,
  runCount: 1,
  triggerSource: 'intake_shadow',
  runStatus: 'succeeded',
  runFinishedAt: '2026-08-14T12:10:10.000Z',
  threadsScanned: 1,
  messagesSeen: 2,
  messagesCreated: 2,
  messagesFailed: 0,
  exactNoticeCount: 1,
  exactFirstContactOperationCount: 1,
  exactFirstContactEventCount: 1,
  exactActionEventCount: 1,
  cleanupObligationCount: 1,
  cleanupAssignedOwnerRole: 'refund_operations_owner',
  cleanupStatus: 'assigned',
  exactThreadMessageCount: 2,
  exactCustomerInboundCount: 1,
  exactProviderSentMailboxCount: 1,
  refundCaseDelta: 1,
  gmailMessageDelta: 2,
  customerInboundDelta: 1,
  providerSentMailboxDelta: 1,
  attachmentDelta: 0,
  hubOutboundOperationDelta: 0,
  caseDeliveryMessageDelta: 0,
  firstContactShadowedDelta: 1,
  firstContactPendingOrSentDelta: 0,
  managerNoticeShadowedDelta: 1,
  managerNoticeOutboundAttemptDelta: 0,
  noticeLedgerDelta: 1,
  cleanupObligationDelta: 1,
  nayaxProviderAttemptDelta: 0,
  ownerManageableCaseCount: 1,
  caseSource: 'gmail',
  caseStatus: 'draft',
  caseAutomationState: 'customer_replied',
  routeClass: 'assigned_managers',
  earliestRetentionDueAt: '2998-01-01T00:00:00.000Z',
  latestRetentionDueAt: '2998-01-02T00:00:00.000Z',
  ...overrides,
});

const noEffectPostflight = (overrides = {}) => ({
  databaseOwnerSession: true,
  activeProofAuthorizationCount: 0,
  unresolvedGmailOutboundCount: 0,
  unresolvedFirstContactCount: 0,
  runCount: 0,
  runStatus: null,
  runFinishedAt: null,
  ...Object.fromEntries([
    'refundCaseDelta',
    'gmailMessageDelta',
    'customerInboundDelta',
    'providerSentMailboxDelta',
    'attachmentDelta',
    'hubOutboundOperationDelta',
    'caseDeliveryMessageDelta',
    'firstContactShadowedDelta',
    'firstContactPendingOrSentDelta',
    'managerNoticeShadowedDelta',
    'managerNoticeOutboundAttemptDelta',
    'noticeLedgerDelta',
    'cleanupObligationDelta',
    'nayaxProviderAttemptDelta',
  ].map((key) => [key, 0])),
  ...overrides,
});

const harness = ({
  edgeResult = edgeSuccess(),
  edgeError,
  preflight = databasePreflight(),
  postflight = completePostflight(),
  postflightSequence,
  postflightError,
  initialState,
  closeBehaviors = [],
  postCloseReadBehaviors = [],
} = {}) => {
  const calls = [];
  let currentState = initialState ?? state();
  let closeIndex = 0;
  let postCloseReadIndex = 0;
  let postflightIndex = 0;
  const clients = {
    database: {
      async preflight() {
        calls.push('database.preflight');
        return preflight;
      },
      async postflight({ runKey, ownerUserId }) {
        calls.push('database.postflight');
        assert.match(runKey, /^owner-intake-shadow:[a-f0-9]{64}$/u);
        assert.equal(ownerUserId, OWNER_USER_ID);
        if (postflightError) throw postflightError;
        return postflightSequence
          ? postflightSequence[Math.min(postflightIndex++, postflightSequence.length - 1)]
          : postflight;
      },
    },
    identity: {
      async getOwnerUserId() {
        calls.push('identity.getOwnerUserId');
        return OWNER_USER_ID;
      },
    },
    control: {
      async initializeClosed({ shadowLabelId }) {
        calls.push('control.initializeClosed');
        assert.equal(sha256Hex(shadowLabelId), SHADOW_DIGEST);
        currentState = state();
      },
      async readState() {
        calls.push('control.readState');
        if (
          closeIndex > 0 &&
          postCloseReadBehaviors[postCloseReadIndex++] === 'throw'
        ) throw new Error('private read response');
        return currentState;
      },
      async openIntake({ freshStartAt, ownerSenderDigest, runKeyDigest }) {
        calls.push('control.openIntake');
        currentState = state({
          intakeEnabled: true,
          firstContactMode: 'shadow',
          startAt: freshStartAt,
          ownerSenderDigest,
          runKeyDigest,
        });
      },
      async safeClose() {
        calls.push('control.safeClose');
        const behavior = closeBehaviors[closeIndex++] ?? 'closed';
        if (behavior === 'closed' || behavior === 'closed_throw') currentState = state();
        if (behavior.endsWith('throw')) throw new Error('private close response');
      },
    },
    edge: {
      async run() {
        calls.push('edge.run');
        if (edgeError) throw edgeError;
        return edgeResult;
      },
    },
  };
  return { calls, clients };
};

const execute = (sample, overrides = {}) =>
  (() => {
    let clockMs = Date.parse('2026-08-14T12:10:00.000Z');
    return executeRefundGmailIntakeShadow({
    config: config(),
    clients: sample.clients,
    now: () => Date.parse('2026-08-14T12:10:00.000Z'),
    clock: () => clockMs,
    sleep: async (delayMs) => { clockMs += delayMs; },
    reconciliationBoundMs: 5,
    stablePollIntervalMs: 1,
    runKeyFactory: () => 'a'.repeat(64),
    ...overrides,
    });
  })();

test('dry-run performs only aggregate/control reads with zero identity, mutation, or Edge POST', async () => {
  const sample = harness();
  const result = await executeRefundGmailIntakeShadow({
    config: config({ mode: 'dry-run', liveConfirmation: '', cleanupCommitment: '' }),
    clients: sample.clients,
  });
  assert.deepEqual(result, { ok: true, mode: 'dry-run', payloadRedacted: true });
  assert.deepEqual(sample.calls, ['database.preflight', 'control.readState']);
});

test('owner initialization seeds and re-proves only the closed state before any database or Gmail call', async () => {
  const sample = harness();
  const result = await executeRefundGmailIntakeShadow({
    config: config({
      mode: 'initialize',
      initialShadowLabelId: 'Label_owner_shadow',
      initializeConfirmation: REFUND_INTAKE_SHADOW_INITIALIZE_CONFIRMATION,
    }),
    clients: sample.clients,
  });
  assert.deepEqual(result, {
    ok: true,
    mode: 'initialize',
    payloadRedacted: true,
  });
  assert.deepEqual(sample.calls, [
    'control.initializeClosed',
    'control.readState',
  ]);
});

test('live success binds run authorization, records exact evidence, and closes once', async () => {
  const sample = harness();
  const logs = [];
  const result = await execute(sample, { logger: (entry) => logs.push(entry) });
  assert.deepEqual(result, {
    ok: true,
    mode: 'live',
    effectsClassification: 'complete_exact',
    gatesConclusivelyClosed: true,
    gateState: 'closed',
    messagesSeen: 2,
    mailboxAcknowledgementObserved: true,
    managerNoticeShadowed: 1,
    routeClass: 'assigned_managers',
    ownerManageableCaseCount: 1,
    ownerManageableCase: true,
    earliestRetentionDueAt: '2998-01-01T00:00:00.000Z',
    latestRetentionDueAt: '2998-01-02T00:00:00.000Z',
    retentionCleanupObligation:
      'enable_reviewed_recurring_before_earliest_and_verify_after_latest_or_manual_purge_at_each_due',
    cleanupCommitment: true,
    durableStateCreated: true,
    durableStateRequiresManualReconciliation: false,
    retentionCleanupRequired: true,
    emergencyIndependentGateVerificationRequired: false,
    replayAllowed: false,
    payloadRedacted: true,
  });
  assert.deepEqual(sample.calls, [
    'database.preflight',
    'control.readState',
    'identity.getOwnerUserId',
    'control.openIntake',
    'control.readState',
    'edge.run',
    'control.safeClose',
    'control.readState',
    'database.postflight',
    'database.postflight',
    'control.readState',
  ]);
  assert.equal(JSON.stringify(logs).includes('private'), false);
});

test('one-message Edge shape is a HOLD with no ingestion and no retry', async () => {
  const sample = harness({
    edgeResult: { ...edgeSuccess(), messagesSeen: 1, messagesCreated: 1 },
    postflight: noEffectPostflight(),
  });
  await assert.rejects(execute(sample), (error) => error.code === 'edge_aggregate_invalid');
  assert.equal(sample.calls.filter((call) => call === 'edge.run').length, 1);
  assert.equal(sample.calls.filter((call) => call === 'control.safeClose').length, 1);
});

test('an ambiguous Edge response reconciles a complete exact DB run without replay', async () => {
  const sample = harness({ edgeError: new Error('private timeout response') });
  const result = await execute(sample);
  assert.equal(result.effectsClassification, 'complete_exact');
  assert.equal(sample.calls.filter((call) => call === 'edge.run').length, 1);
});

test('post-close reconciliation waits through delayed run start and delayed finish without replay', async () => {
  for (const postflightSequence of [
    [noEffectPostflight(), completePostflight(), completePostflight()],
    [
      completePostflight({ runStatus: 'running', runFinishedAt: null }),
      completePostflight(),
      completePostflight(),
    ],
    [
      completePostflight({ exactNoticeCount: 0 }),
      completePostflight(),
      completePostflight(),
    ],
  ]) {
    const sample = harness({
      edgeError: new Error('private timeout response'),
      postflightSequence,
    });
    assert.equal((await execute(sample)).effectsClassification, 'complete_exact');
    assert.equal(sample.calls.filter((call) => call === 'edge.run').length, 1);
    assert.ok(sample.calls.filter((call) => call === 'database.postflight').length >= 3);
  }
});

test('a dispatched run cannot become no_effect until the full quiescence bound passes', async () => {
  const sample = harness({
    edgeError: new Error('private timeout response'),
    postflight: noEffectPostflight(),
  });
  await assert.rejects(execute(sample), (error) => error.code === 'intake_execution_failed');
  assert.ok(sample.calls.filter((call) => call === 'database.postflight').length >= 7);
  assert.equal(sample.calls.filter((call) => call === 'edge.run').length, 1);
});

test('a nonterminal run at the reviewed bound is outcome_unknown and cannot replay', async () => {
  const sample = harness({
    edgeError: new Error('private timeout response'),
    postflight: completePostflight({ runStatus: 'running', runFinishedAt: null }),
  });
  const logs = [];
  await assert.rejects(
    execute(sample, { logger: (entry) => logs.push(entry) }),
    (error) => error.code === 'intake_reconciliation_timeout',
  );
  assert.equal(logs.at(-1).effectsClassification, 'outcome_unknown');
  assert.equal(logs.at(-1).replayAllowed, false);
  assert.equal(sample.calls.filter((call) => call === 'edge.run').length, 1);
});

test('an ambiguous Edge response with zero effect fails safely and is never replayed', async () => {
  const sample = harness({
    edgeError: new Error('private timeout response'),
    postflight: noEffectPostflight(),
  });
  await assert.rejects(
    execute(sample),
    (error) => error.code === 'intake_execution_failed' && !error.message.includes('private'),
  );
  assert.equal(sample.calls.filter((call) => call === 'edge.run').length, 1);
});

test('any partial DB effect is an incident even when Edge failed ambiguously', async () => {
  const sample = harness({
    edgeError: new Error('private timeout response'),
    postflight: noEffectPostflight({ refundCaseDelta: 1 }),
  });
  const logs = [];
  await assert.rejects(
    execute(sample, { logger: (entry) => logs.push(entry) }),
    (error) => error.code === 'intake_partial_incident',
  );
  assert.deepEqual(logs.at(-1), {
    phase: 'postflight_classified',
    ok: false,
    payloadRedacted: true,
    gmailMessageDelta: 0,
    refundCaseDelta: 1,
    managerNoticeShadowedDelta: 0,
    effectsClassification: 'partial_incident',
    gatesConclusivelyClosed: true,
    gateState: 'closed',
    replayAllowed: false,
    durableStateCreated: true,
    durableStateRequiresManualReconciliation: true,
    retentionCleanupRequired: true,
    emergencyIndependentGateVerificationRequired: false,
  });
});

test('an unreadable postflight emits outcome_unknown before failing without replay', async () => {
  const sample = harness({ postflightError: new Error('private database response') });
  const logs = [];
  await assert.rejects(
    execute(sample, { logger: (entry) => logs.push(entry) }),
    (error) => error.code === 'intake_postflight_failed',
  );
  assert.deepEqual(logs.at(-1), {
    phase: 'postflight_classified',
    ok: false,
    payloadRedacted: true,
    effectsClassification: 'outcome_unknown',
    gatesConclusivelyClosed: true,
    gateState: 'closed',
    replayAllowed: false,
    durableStateCreated: false,
    durableStateRequiresManualReconciliation: true,
    retentionCleanupRequired: false,
    emergencyIndependentGateVerificationRequired: false,
  });
  assert.equal(sample.calls.filter((call) => call === 'edge.run').length, 1);
});

test('a replay-shaped claimed-false response never gets a second Edge POST', async () => {
  const sample = harness({
    edgeResult: { status: 'succeeded', claimed: false, payloadRedacted: true },
    postflight: noEffectPostflight({ runCount: 1, runStatus: 'suppressed' }),
  });
  await assert.rejects(execute(sample), RefundGmailIntakeShadowRunnerError);
  assert.equal(sample.calls.filter((call) => call === 'edge.run').length, 1);
});

test('safe-close throw still reads state and needs no recovery when already closed', async () => {
  const sample = harness({ closeBehaviors: ['closed_throw'] });
  const result = await execute(sample);
  assert.equal(result.ok, true);
  assert.equal(sample.calls.filter((call) => call === 'control.safeClose').length, 1);
});

test('safe-close throw while open performs one bounded idempotent recovery and reread', async () => {
  const sample = harness({ closeBehaviors: ['open_throw', 'closed'] });
  const result = await execute(sample);
  assert.equal(result.ok, true);
  assert.equal(sample.calls.filter((call) => call === 'control.safeClose').length, 2);
  assert.equal(sample.calls.filter((call) => call === 'control.readState').length, 5);
});

test('safe-close never exits without conclusive closed state', async () => {
  const sample = harness({ closeBehaviors: ['open_throw', 'open_throw'] });
  await assert.rejects(execute(sample), (error) => error.code === 'intake_safe_close_failed');
  assert.equal(sample.calls.filter((call) => call === 'control.safeClose').length, 2);
});

test('unknown state after close timeout gets one recovery close and a conclusive reread', async () => {
  const sample = harness({
    closeBehaviors: ['open_throw', 'closed'],
    postCloseReadBehaviors: ['throw', 'ok'],
  });
  assert.equal((await execute(sample)).ok, true);
  assert.equal(sample.calls.filter((call) => call === 'control.safeClose').length, 2);
});

test('two failed post-close reads fail after exactly two close attempts', async () => {
  const sample = harness({
    closeBehaviors: ['open_throw', 'closed'],
    postCloseReadBehaviors: ['throw', 'throw'],
  });
  const logs = [];
  await assert.rejects(
    execute(sample, { logger: (entry) => logs.push(entry) }),
    (error) => error.code === 'intake_safe_close_read_failed',
  );
  assert.equal(sample.calls.filter((call) => call === 'control.safeClose').length, 2);
  assert.equal(sample.calls.filter((call) => call === 'control.readState').length, 5);
  assert.deepEqual(logs.at(-1), {
    phase: 'postflight_classified',
    ok: false,
    payloadRedacted: true,
    threadsScanned: 1,
    messagesSeen: 2,
    messagesCreated: 2,
    refundCaseDelta: 1,
    gmailMessageDelta: 2,
    managerNoticeShadowedDelta: 1,
    effectsClassification: 'complete_exact',
    gatesConclusivelyClosed: false,
    gateState: 'unknown',
    replayAllowed: false,
    durableStateCreated: true,
    durableStateRequiresManualReconciliation: false,
    retentionCleanupRequired: true,
    emergencyIndependentGateVerificationRequired: true,
    routeClass: 'assigned_managers',
    ownerManageableCaseCount: 1,
    earliestRetentionDueAt: '2998-01-01T00:00:00.000Z',
    latestRetentionDueAt: '2998-01-02T00:00:00.000Z',
  });
  assert.equal(JSON.stringify(logs).includes('private'), false);
});

test('unresolved delivery blocks before identity, secret mutation, or Gmail OAuth', async () => {
  const sample = harness({
    preflight: { ...databasePreflight(), unresolvedGmailOutboundCount: 1 },
  });
  await assert.rejects(execute(sample), (error) => error.code === 'database_preflight_invalid');
  assert.deepEqual(sample.calls, ['database.preflight']);
});

test('an active official authorization blocks before intake opens', async () => {
  const sample = harness({
    preflight: { ...databasePreflight(), activeOfficialAuthorizationCount: 1 },
  });
  await assert.rejects(execute(sample), RefundGmailIntakeShadowRunnerError);
  assert.deepEqual(sample.calls, ['database.preflight']);
});

test('historical terminal Nayax attempts do not block but any new attempt delta fails', async () => {
  const safe = harness();
  assert.equal((await execute(safe)).ok, true);
  const unsafe = harness({
    postflight: completePostflight({ nayaxProviderAttemptDelta: 1 }),
  });
  await assert.rejects(execute(unsafe), (error) => error.code === 'intake_partial_incident');
});

test('wrong shadow label or nonzero closed authorization digest blocks before mutation', async () => {
  for (const initialState of [
    { ...state(), edge: { ...state().edge, shadowLabelDigest: sha256Hex('other') } },
    state({ ownerSenderDigest: OWNER_SENDER_DIGEST }),
  ]) {
    const sample = harness({ initialState });
    await assert.rejects(execute(sample), RefundGmailIntakeShadowRunnerError);
    assert.deepEqual(sample.calls, ['database.preflight', 'control.readState']);
  }
});

test('retention worker must remain disabled in both closed and live states', async () => {
  const unsafeState = state();
  unsafeState.edge.gmailRetentionEnabled = true;
  const sample = harness({ initialState: unsafeState });
  await assert.rejects(execute(sample), RefundGmailIntakeShadowRunnerError);
  assert.deepEqual(sample.calls, ['database.preflight', 'control.readState']);
});

test('postflight requires owner visibility, exact queue state, and a retention due date', () => {
  for (const postflight of [
    completePostflight({ ownerManageableCaseCount: 0 }),
    completePostflight({ caseAutomationState: 'submitted' }),
    completePostflight({ exactNoticeCount: 0 }),
    completePostflight({ exactThreadMessageCount: 1 }),
    completePostflight({ earliestRetentionDueAt: null }),
    completePostflight({ latestRetentionDueAt: null }),
  ]) {
    assert.equal(
      classifyRefundGmailIntakeShadowPostflight(postflight, { edgeConfirmed: true }),
      'partial_incident',
    );
  }
});

test('live config requires the fixed retention cleanup commitment before any client call', async () => {
  const sample = harness();
  await assert.rejects(
    executeRefundGmailIntakeShadow({
      config: config({ cleanupCommitment: '' }),
      clients: sample.clients,
    }),
    (error) => error.code === 'cleanup_commitment_missing',
  );
  assert.deepEqual(sample.calls, []);
});

test('retention policy must be the exact local v1 contract before any client call', async () => {
  const sample = harness();
  await assert.rejects(
    executeRefundGmailIntakeShadow({
      config: config({ retentionPolicyVersion: 'refund_gmail_retention_v2' }),
      clients: sample.clients,
    }),
    (error) => error.code === 'retention_policy_version_invalid',
  );
  assert.deepEqual(sample.calls, []);
});

test('CLI dry-run and live config map the exact retention policy from private env only', () => {
  const parsed = parseRefundGmailIntakeShadowEnvFile([
    `REFUND_GMAIL_INTAKE_SHADOW_PROJECT_REF=${REFUND_INTAKE_SHADOW_PROJECT_REF}`,
    `REFUND_GMAIL_INTAKE_SHADOW_RETENTION_POLICY_VERSION=${REFUND_INTAKE_SHADOW_RETENTION_POLICY_VERSION}`,
  ].join('\n'));
  for (const mode of ['dry-run', 'live']) {
    const args = parseRefundGmailIntakeShadowArgs(['--mode', mode, '--timeout-seconds', '480']);
    const built = buildRefundGmailIntakeShadowConfig({ ...args, env: parsed });
    assert.equal(built.mode, mode);
    assert.equal(built.timeoutMs, 480_000);
    assert.equal(
      built.retentionPolicyVersion,
      REFUND_INTAKE_SHADOW_RETENTION_POLICY_VERSION,
    );
  }
  assert.throws(
    () => parseRefundGmailIntakeShadowArgs(['--sender', 'private@example.test']),
    (error) => error.code === 'unsupported_argument',
  );
});

test('private env files must be absolute and outside the repository', () => {
  assert.throws(
    () => loadRefundGmailIntakeShadowEnvironment('relative.env', {}),
    (error) => error.code === 'env_file_path_invalid',
  );
  assert.throws(
    () => loadRefundGmailIntakeShadowEnvironment(
      path.join(process.cwd(), 'private-intake.env'),
      {},
    ),
    (error) => error.code === 'env_file_path_invalid',
  );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'refund-intake-shadow-'));
  const envPath = path.join(directory, 'private.env');
  try {
    fs.writeFileSync(envPath, 'REFUND_GMAIL_INTAKE_SHADOW_PROJECT_REF=private\n');
    assert.equal(
      loadRefundGmailIntakeShadowEnvironment(envPath, {})
        .REFUND_GMAIL_INTAKE_SHADOW_PROJECT_REF,
      'private',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('timeout aborts the one attempt with a generic error', async () => {
  await assert.rejects(
    runWithTimeout({
      timeoutMs: 5,
      run: (signal) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    }),
    (error) => error.code === 'intake_timeout',
  );
});
