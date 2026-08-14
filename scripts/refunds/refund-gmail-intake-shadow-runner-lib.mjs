import { createHash, randomBytes } from 'node:crypto';

export const REFUND_INTAKE_SHADOW_PROJECT_REF = 'ygbzkgxktzqsiygjlqyg';
export const REFUND_INTAKE_SHADOW_REPOSITORY = 'ethtri/bloomjoy-hub';
export const REFUND_INTAKE_SHADOW_LIVE_CONFIRMATION =
  'RUN_ONE_OWNER_CONTROLLED_GMAIL_INTAKE_SHADOW';
export const REFUND_INTAKE_SHADOW_CLEANUP_COMMITMENT =
  'ENABLE_REVIEWED_RETENTION_BEFORE_EARLIEST_VERIFY_AFTER_LATEST_OR_PURGE_AT_DUE';
export const REFUND_INTAKE_SHADOW_RETENTION_POLICY_VERSION =
  'refund_gmail_retention_v1';
export const REFUND_INTAKE_SHADOW_SAFE_START_AT =
  '2999-01-01T00:00:00.000Z';
export const REFUND_INTAKE_SHADOW_FRESH_LOOKBACK_MS = 5 * 60 * 1000;
export const REFUND_INTAKE_SHADOW_ZERO_DIGEST = '0'.repeat(64);

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ROUTE_CLASSES = new Set([
  'assigned_managers',
  'operations_fallback',
  'unassigned_owner_ops_queue',
]);
const SAFE_PHASES = new Set([
  'preflight_passed',
  'dry_run_passed',
  'intake_opened',
  'intake_posted',
  'intake_closed',
  'postflight_classified',
]);

export class RefundGmailIntakeShadowRunnerError extends Error {
  constructor(code) {
    super('Refund Gmail intake-only shadow runner failed closed.');
    this.name = 'RefundGmailIntakeShadowRunnerError';
    this.code = code;
  }
}

const fail = (code) => {
  throw new RefundGmailIntakeShadowRunnerError(code);
};

export const sha256Hex = (value) =>
  createHash('sha256').update(value).digest('hex');

const exactBoolean = (value, expected) =>
  (value === true || value === false) && value === expected;

export const validateRefundGmailIntakeShadowRunnerConfig = (config) => {
  if (!['dry-run', 'live'].includes(config?.mode)) fail('mode_invalid');
  if (config.retentionPolicyVersion !== REFUND_INTAKE_SHADOW_RETENTION_POLICY_VERSION) {
    fail('retention_policy_version_invalid');
  }
  if (
    config.projectRef !== REFUND_INTAKE_SHADOW_PROJECT_REF ||
    config.confirmProjectRef !== REFUND_INTAKE_SHADOW_PROJECT_REF
  ) fail('project_not_confirmed');
  if (
    !SHA256_PATTERN.test(config.expectedShadowLabelDigest ?? '') ||
    config.confirmShadowLabelDigest !== config.expectedShadowLabelDigest
  ) fail('shadow_label_digest_not_confirmed');
  if (
    !SHA256_PATTERN.test(config.ownerSenderDigest ?? '') ||
    config.ownerSenderDigest === REFUND_INTAKE_SHADOW_ZERO_DIGEST ||
    config.confirmOwnerSenderDigest !== config.ownerSenderDigest
  ) fail('owner_sender_digest_not_confirmed');
  if (typeof config.managementToken !== 'string' || config.managementToken.length < 20) {
    fail('management_token_missing');
  }
  if (typeof config.syncSecret !== 'string' || config.syncSecret.length < 20) {
    fail('sync_secret_missing');
  }
  if (typeof config.anonKey !== 'string' || config.anonKey.length < 20) {
    fail('anon_key_missing');
  }
  if (typeof config.ownerUserJwt !== 'string' || config.ownerUserJwt.length < 20) {
    fail('owner_jwt_missing');
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 30_000 || config.timeoutMs > 240_000) {
    fail('timeout_invalid');
  }
  if (config.mode === 'live' && config.liveConfirmation !== REFUND_INTAKE_SHADOW_LIVE_CONFIRMATION) {
    fail('live_not_confirmed');
  }
  if (
    config.mode === 'live' &&
    config.cleanupCommitment !== REFUND_INTAKE_SHADOW_CLEANUP_COMMITMENT
  ) fail('cleanup_commitment_missing');
  return config;
};

const requireDatabasePreflight = (value) => {
  if (
    value?.databaseOwnerSession !== true ||
    value?.activeProofAuthorizationCount !== 0 ||
    value?.unresolvedGmailOutboundCount !== 0 ||
    value?.unresolvedFirstContactCount !== 0 ||
    value?.automaticCustomerContactEnabled !== false ||
    value?.gptTriageEnabled !== false ||
    value?.gptAutoSendEnabled !== false ||
    value?.officialActionsEnabled !== false ||
    value?.activeOfficialAuthorizationCount !== 0 ||
    value?.pendingStepUpIntentCount !== 0 ||
    value?.nayaxResolutionEnabled !== false ||
    value?.nayaxOperatorCount !== 0 ||
    value?.nayaxResolutionIntentCount !== 0 ||
    value?.unresolvedNayaxProviderAttemptCount !== 0 ||
    value?.retentionPolicyHealthy !== true ||
    value?.attachmentsEnabled !== false ||
    value?.scannerEnabled !== false ||
    value?.payloadRedacted !== true
  ) fail('database_preflight_invalid');
};

const requireSharedOperationalState = (state) => {
  if (
    state?.edge?.automaticCustomerContactEnabled !== false ||
    state?.edge?.automationEnabled !== false ||
    state?.edge?.managerAgingEnabled !== false ||
    state?.edge?.gmailRetentionEnabled !== false ||
    state?.edge?.attachmentScannerEnabled !== false ||
    state?.edge?.gptTriageEnabled !== false ||
    state?.edge?.nayaxExecutionEnabled !== false ||
    state?.edge?.nayaxDryRun !== true ||
    state?.edge?.nayaxKillSwitch !== true ||
    state?.edge?.nayaxProviderContractConfirmed !== false ||
    state?.edge?.nayaxSponsorGoNoGo !== false ||
    state?.github?.gmailSyncEnabled !== false ||
    state?.github?.gmailRetentionEnabled !== false ||
    state?.github?.automationSweepEnabled !== false ||
    state?.github?.gptTriageSyncEnabled !== false ||
    state?.release?.productionAligned !== true ||
    state?.release?.backupCompletedFresh !== true ||
    state?.release?.officialActionsEnabled !== false ||
    state?.release?.nayaxProviderAdapterEnabled !== false
  ) fail('operational_preflight_invalid');
};

const requireLabelBoundary = (state, config) => {
  const productionDigest = state?.edge?.productionLabelDigest;
  const shadowDigest = state?.edge?.shadowLabelDigest;
  if (
    !SHA256_PATTERN.test(productionDigest ?? '') ||
    shadowDigest !== config.expectedShadowLabelDigest ||
    productionDigest === shadowDigest
  ) fail('shadow_label_boundary_invalid');
};

export const requireRefundGmailIntakeShadowState = (
  state,
  config,
  { intakeEnabled, mode, startAt, ownerSenderDigest, runKeyDigest },
) => {
  requireSharedOperationalState(state);
  requireLabelBoundary(state, config);
  if (
    !exactBoolean(state.edge.intakeEnabled, intakeEnabled) ||
    state.edge.gmailEnabled !== false ||
    state.edge.gmailRetentionEnabled !== false ||
    state.edge.firstContactMode !== mode ||
    state.edge.startAtDigest !== sha256Hex(startAt) ||
    state.edge.maxThreads !== 1 ||
    state.edge.ownerSenderSecretDigest !== sha256Hex(ownerSenderDigest) ||
    state.edge.runKeySecretDigest !== sha256Hex(runKeyDigest)
  ) fail('intake_gate_state_invalid');
};

const requireEdgeSuccess = (result) => {
  if (
    result?.status !== 'succeeded' ||
    result?.payloadRedacted !== true ||
    result?.threadsScanned !== 1 ||
    result?.messagesSeen !== 2 ||
    result?.messagesCreated !== 2 ||
    result?.messagesDeduplicated !== 0 ||
    result?.messagesFailed !== 0 ||
    result?.attachmentsQuarantined !== 0 ||
    result?.customerInboundMessages !== 1 ||
    result?.providerSentMailboxMessages !== 1 ||
    result?.mailboxAcknowledgementObserved !== true ||
    result?.firstContactShadowed !== 1 ||
    result?.firstContactSent !== 0 ||
    result?.firstContactFailed !== 0 ||
    result?.firstContactReconciliationOutstanding !== 0 ||
    result?.outboundReconciliationFailed !== 0 ||
    result?.outboundReconciliationOutstanding !== 0 ||
    result?.managerNoticeShadowed !== 1 ||
    result?.managerNoticeSentEvents !== 0
  ) fail('edge_aggregate_invalid');
};

const ZERO_EFFECT_FIELDS = [
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
  'nayaxProviderAttemptDelta',
];

const hasZeroEffects = (postflight) =>
  ZERO_EFFECT_FIELDS.every((key) => postflight?.[key] === 0);

export const classifyRefundGmailIntakeShadowPostflight = (
  postflight,
  { edgeConfirmed },
) => {
  if (
    postflight?.databaseOwnerSession !== true ||
    postflight?.activeProofAuthorizationCount !== 0 ||
    postflight?.unresolvedGmailOutboundCount !== 0 ||
    postflight?.unresolvedFirstContactCount !== 0 ||
    postflight?.hubOutboundOperationDelta !== 0 ||
    postflight?.caseDeliveryMessageDelta !== 0 ||
    postflight?.firstContactPendingOrSentDelta !== 0 ||
    postflight?.managerNoticeOutboundAttemptDelta !== 0 ||
    postflight?.nayaxProviderAttemptDelta !== 0
  ) return 'partial_incident';

  const noEffect =
    [0, 1].includes(postflight.runCount) &&
    (postflight.runCount === 0 || ['failed', 'suppressed'].includes(postflight.runStatus)) &&
    hasZeroEffects(postflight);
  if (noEffect) return edgeConfirmed ? 'partial_incident' : 'no_effect';

  const earliestRetentionDueAt = Date.parse(postflight.earliestRetentionDueAt ?? '');
  const latestRetentionDueAt = Date.parse(postflight.latestRetentionDueAt ?? '');
  const complete =
    postflight.runCount === 1 &&
    postflight.triggerSource === 'intake_shadow' &&
    postflight.runStatus === 'succeeded' &&
    postflight.threadsScanned === 1 &&
    postflight.messagesSeen === 2 &&
    postflight.messagesCreated === 2 &&
    postflight.messagesFailed === 0 &&
    postflight.exactNoticeCount === 1 &&
    postflight.exactThreadMessageCount === 2 &&
    postflight.exactCustomerInboundCount === 1 &&
    postflight.exactProviderSentMailboxCount === 1 &&
    postflight.gmailMessageDelta === 2 &&
    postflight.customerInboundDelta === 1 &&
    postflight.providerSentMailboxDelta === 1 &&
    postflight.refundCaseDelta === 1 &&
    postflight.attachmentDelta === 0 &&
    postflight.firstContactShadowedDelta === 1 &&
    postflight.managerNoticeShadowedDelta === 1 &&
    postflight.noticeLedgerDelta === 1 &&
    postflight.ownerManageableCaseCount === 1 &&
    postflight.caseSource === 'gmail' &&
    postflight.caseStatus === 'draft' &&
    postflight.caseAutomationState === 'customer_replied' &&
    ROUTE_CLASSES.has(postflight.routeClass) &&
    Number.isFinite(earliestRetentionDueAt) &&
    Number.isFinite(latestRetentionDueAt) &&
    earliestRetentionDueAt > Date.now() &&
    latestRetentionDueAt >= earliestRetentionDueAt;
  return complete ? 'complete_exact' : 'partial_incident';
};

const emit = (logger, phase, detail = {}) => {
  if (!SAFE_PHASES.has(phase)) fail('unsafe_log_phase');
  const result = {
    phase,
    ok: phase !== 'postflight_classified' || detail.classification === 'complete_exact',
    payloadRedacted: true,
  };
  for (const key of [
    'threadsScanned',
    'messagesSeen',
    'messagesCreated',
    'customerInboundMessages',
    'providerSentMailboxMessages',
    'managerNoticeShadowed',
    'gmailMessageDelta',
    'refundCaseDelta',
    'managerNoticeShadowedDelta',
  ]) {
    if (Number.isSafeInteger(detail[key])) result[key] = detail[key];
  }
  if (['no_effect', 'complete_exact', 'partial_incident', 'outcome_unknown'].includes(
    detail.classification,
  )) {
    result.classification = detail.classification;
    result.replayAllowed = false;
    result.durableStateRequiresManualReconciliation = true;
  }
  if (ROUTE_CLASSES.has(detail.routeClass)) result.routeClass = detail.routeClass;
  if (detail.ownerManageableCaseCount === 1) result.ownerManageableCaseCount = 1;
  for (const key of ['earliestRetentionDueAt', 'latestRetentionDueAt']) {
    if (typeof detail[key] === 'string' && Number.isFinite(Date.parse(detail[key]))) {
      result[key] = detail[key];
    }
  }
  logger(result);
};

const normalizeError = (error, fallback) =>
  error instanceof RefundGmailIntakeShadowRunnerError
    ? error
    : new RefundGmailIntakeShadowRunnerError(fallback);

const isClosedState = (state, config) => {
  try {
    requireRefundGmailIntakeShadowState(state, config, {
      intakeEnabled: false,
      mode: 'disabled',
      startAt: REFUND_INTAKE_SHADOW_SAFE_START_AT,
      ownerSenderDigest: REFUND_INTAKE_SHADOW_ZERO_DIGEST,
      runKeyDigest: REFUND_INTAKE_SHADOW_ZERO_DIGEST,
    });
    return true;
  } catch {
    return false;
  }
};

const conclusivelyClose = async ({ control, config }) => {
  let closeAttempts = 0;
  let closeError = null;
  try {
    closeAttempts += 1;
    await control.safeClose();
  } catch (error) {
    closeError = error;
  }
  let state;
  try {
    state = await control.readState();
  } catch {
    state = null;
  }
  if (!state || !isClosedState(state, config)) {
    try {
      closeAttempts += 1;
      await control.safeClose();
    } catch (error) {
      closeError = error;
    }
    try {
      state = await control.readState();
    } catch (error) {
      throw normalizeError(error, 'intake_safe_close_read_failed');
    }
  }
  if (!isClosedState(state, config)) {
    throw normalizeError(closeError, 'intake_safe_close_failed');
  }
  return closeAttempts;
};

export const executeRefundGmailIntakeShadow = async ({
  config,
  clients,
  logger = () => {},
  signal,
  now = () => Date.now(),
  runKeyFactory = () => randomBytes(32).toString('hex'),
}) => {
  validateRefundGmailIntakeShadowRunnerConfig(config);
  const { database, control, edge, identity } = clients;
  const before = await database.preflight({ signal });
  requireDatabasePreflight(before);
  const initialState = await control.readState({ signal });
  requireRefundGmailIntakeShadowState(initialState, config, {
    intakeEnabled: false,
    mode: 'disabled',
    startAt: REFUND_INTAKE_SHADOW_SAFE_START_AT,
    ownerSenderDigest: REFUND_INTAKE_SHADOW_ZERO_DIGEST,
    runKeyDigest: REFUND_INTAKE_SHADOW_ZERO_DIGEST,
  });
  emit(logger, 'preflight_passed');

  if (config.mode === 'dry-run') {
    emit(logger, 'dry_run_passed');
    return { ok: true, mode: 'dry-run', payloadRedacted: true };
  }

  const entropy = runKeyFactory();
  if (!/^[a-f0-9]{64}$/u.test(entropy)) fail('run_key_generation_failed');
  const runKey = `owner-intake-shadow:${entropy}`;
  const runKeyDigest = sha256Hex(runKey);
  const ownerUserId = await identity.getOwnerUserId({ signal });
  if (!UUID_PATTERN.test(ownerUserId ?? '')) fail('owner_identity_invalid');
  const nowMs = now();
  if (!Number.isFinite(nowMs)) fail('clock_invalid');
  const freshStartAt = new Date(nowMs - REFUND_INTAKE_SHADOW_FRESH_LOOKBACK_MS).toISOString();
  let primaryError = null;
  let cleanupError = null;
  let edgeConfirmed = false;
  let postflight = null;
  let classification = 'outcome_unknown';

  try {
    signal?.throwIfAborted?.();
    await control.openIntake({
      freshStartAt,
      ownerSenderDigest: config.ownerSenderDigest,
      runKeyDigest,
      signal,
    });
    const openState = await control.readState({ signal });
    requireRefundGmailIntakeShadowState(openState, config, {
      intakeEnabled: true,
      mode: 'shadow',
      startAt: freshStartAt,
      ownerSenderDigest: config.ownerSenderDigest,
      runKeyDigest,
    });
    emit(logger, 'intake_opened');

    const result = await edge.run({ runKey, signal });
    requireEdgeSuccess(result);
    edgeConfirmed = true;
    emit(logger, 'intake_posted', result);
  } catch (error) {
    primaryError = normalizeError(
      signal?.aborted && signal.reason ? signal.reason : error,
      signal?.aborted ? 'intake_interrupted' : 'intake_execution_failed',
    );
  } finally {
    try {
      await conclusivelyClose({ control, config });
      emit(logger, 'intake_closed');
    } catch (error) {
      cleanupError = normalizeError(error, 'intake_safe_close_failed');
    }

    try {
      postflight = await database.postflight({ before, runKey, ownerUserId });
      classification = classifyRefundGmailIntakeShadowPostflight(postflight, {
        edgeConfirmed,
      });
      emit(logger, 'postflight_classified', { ...postflight, classification });
      if (classification === 'partial_incident') {
        cleanupError ??= new RefundGmailIntakeShadowRunnerError('intake_partial_incident');
      }
    } catch (error) {
      classification = 'outcome_unknown';
      emit(logger, 'postflight_classified', { classification });
      cleanupError ??= normalizeError(error, 'intake_postflight_failed');
    }
  }

  if (cleanupError) throw cleanupError;
  if (classification === 'no_effect') {
    throw primaryError ?? new RefundGmailIntakeShadowRunnerError('intake_no_effect');
  }
  if (classification !== 'complete_exact') fail('intake_partial_incident');
  return {
    ok: true,
    mode: 'live',
    classification,
    messagesSeen: postflight.messagesSeen,
    mailboxAcknowledgementObserved: true,
    managerNoticeShadowed: postflight.managerNoticeShadowedDelta,
    routeClass: postflight.routeClass,
    ownerManageableCaseCount: postflight.ownerManageableCaseCount,
    ownerManageableCase: true,
    earliestRetentionDueAt: postflight.earliestRetentionDueAt,
    latestRetentionDueAt: postflight.latestRetentionDueAt,
    retentionCleanupObligation:
      'enable_reviewed_recurring_before_earliest_and_verify_after_latest_or_manual_purge_at_each_due',
    cleanupCommitment: true,
    durableStateRequiresManualReconciliation: true,
    replayAllowed: false,
    payloadRedacted: true,
  };
};

export const runWithTimeout = async ({ timeoutMs, signal, run }) => {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new RefundGmailIntakeShadowRunnerError('intake_timeout')),
    timeoutMs,
  );
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
};
