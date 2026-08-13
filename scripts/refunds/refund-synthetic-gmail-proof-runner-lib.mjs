import { createHash, randomBytes } from 'node:crypto';

export const REFUND_PRODUCTION_PROJECT_REF = 'ygbzkgxktzqsiygjlqyg';
export const REFUND_REPOSITORY = 'ethtri/bloomjoy-hub';
export const REFUND_SYNTHETIC_PROOF_MESSAGE_TYPE = 'status_update';
export const REFUND_SYNTHETIC_PROOF_PREPARE_CONFIRMATION =
  'PREPARE_ONE_OWNER_CONTROLLED_SYNTHETIC_GMAIL_SEND';
export const REFUND_SYNTHETIC_PROOF_SUMMARY_CONFIRMATION =
  'READ_REDACTED_SYNTHETIC_GMAIL_PROOF';
export const REFUND_SYNTHETIC_PROOF_CLOSE_CONFIRMATION =
  'CLOSE_SYNTHETIC_GMAIL_PROOF_WINDOW';
export const REFUND_SYNTHETIC_PROOF_LIVE_CONFIRMATION =
  'RUN_ONE_OWNER_CONTROLLED_SYNTHETIC_GMAIL_PROOF';
export const DIRECT_POSTGRES_DATABASE_ADAPTER = 'direct-postgres';
export const MANAGEMENT_API_OWNER_DATABASE_ADAPTER = 'management-api-owner';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SAFE_PHASES = new Set([
  'preflight_passed',
  'prepared',
  'gmail_enabled',
  'send_confirmed',
  'gmail_disabled',
  'summary_read',
  'authorization_closed',
  'teardown_verified',
  'dry_run_passed',
]);

export class SyntheticGmailProofRunnerError extends Error {
  constructor(code, message = 'Synthetic Gmail proof runner failed closed.') {
    super(message);
    this.name = 'SyntheticGmailProofRunnerError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new SyntheticGmailProofRunnerError(code, message);
};

const isBoolean = (value) => value === true || value === false;

export const evaluateBackupHealth = (
  payload,
  { nowMs = Date.now(), maxAgeMs = 36 * 60 * 60 * 1000 } = {},
) => {
  if (!Array.isArray(payload?.backups) || !Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs)) {
    return false;
  }
  const backups = payload.backups
    .map((backup) => ({
      status: typeof backup?.status === 'string' ? backup.status.toUpperCase() : '',
      insertedAtMs: Date.parse(backup?.inserted_at ?? ''),
    }))
    .filter((backup) => Number.isFinite(backup.insertedAtMs))
    .sort((left, right) => right.insertedAtMs - left.insertedAtMs);
  const latest = backups[0];
  if (!latest) return false;
  const ageMs = nowMs - latest.insertedAtMs;
  return latest.status === 'COMPLETED' && ageMs >= 0 && ageMs <= maxAgeMs;
};

export const sha256Hex = (value) =>
  createHash('sha256').update(value).digest('hex');

export const validateSyntheticGmailProofConfig = (config) => {
  if (!['dry-run', 'live'].includes(config?.mode)) {
    fail('invalid_mode', 'Mode must be dry-run or live.');
  }
  if (
    !PROJECT_REF_PATTERN.test(config.projectRef ?? '') ||
    config.projectRef !== REFUND_PRODUCTION_PROJECT_REF ||
    config.confirmProjectRef !== config.projectRef
  ) {
    fail('project_not_confirmed', 'The exact production project must be confirmed.');
  }
  if (!UUID_PATTERN.test(config.caseId ?? '') || config.confirmCaseId !== config.caseId) {
    fail('case_not_confirmed', 'The exact private refund case must be confirmed.');
  }
  const databaseAdapter = config.databaseAdapter ?? DIRECT_POSTGRES_DATABASE_ADAPTER;
  if (
    ![
      DIRECT_POSTGRES_DATABASE_ADAPTER,
      MANAGEMENT_API_OWNER_DATABASE_ADAPTER,
    ].includes(databaseAdapter)
  ) {
    fail('database_adapter_invalid', 'The database adapter is not approved.');
  }
  if (databaseAdapter === MANAGEMENT_API_OWNER_DATABASE_ADAPTER) {
    if ((config.databaseUrl ?? '') !== '') {
      fail('database_url_forbidden', 'The Management API adapter does not accept a database URL.');
    }
  } else {
    if (typeof config.databaseUrl !== 'string' || !config.databaseUrl.startsWith('postgres')) {
      fail('database_url_missing', 'A private database-owner connection is required.');
    }
    let databaseUrl;
    try {
      databaseUrl = new URL(config.databaseUrl);
    } catch {
      fail('database_url_invalid', 'The database-owner connection is malformed.');
    }
    if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
      fail('database_url_invalid', 'The database-owner connection must use PostgreSQL.');
    }
    let databaseUsername;
    try {
      databaseUsername = decodeURIComponent(databaseUrl.username);
    } catch {
      fail('database_url_invalid', 'The database-owner connection is malformed.');
    }
    const directDatabaseHost = `db.${config.projectRef}.supabase.co`;
    const poolerDatabaseHost =
      /^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(databaseUrl.hostname) &&
      databaseUsername === `postgres.${config.projectRef}`;
    const databaseProjectBound =
      databaseUrl.hostname === directDatabaseHost || poolerDatabaseHost;
    if (!databaseProjectBound) {
      fail('database_project_mismatch', 'The database connection is not bound to the exact project.');
    }
  }
  if (typeof config.managementToken !== 'string' || config.managementToken.length < 20) {
    fail('management_token_missing', 'The private Supabase management token is required.');
  }
  if (typeof config.anonKey !== 'string' || config.anonKey.length < 20) {
    fail('anon_key_missing', 'The project publishable or anon key is required.');
  }
  if (!JWT_PATTERN.test(config.userAccessToken ?? '')) {
    fail('user_token_missing', 'A private authenticated portal-user token is required.');
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 30_000 || config.timeoutMs > 240_000) {
    fail('invalid_timeout', 'Timeout must be between 30 and 240 seconds.');
  }
  if (
    config.mode === 'live' &&
    config.liveConfirmation !== REFUND_SYNTHETIC_PROOF_LIVE_CONFIRMATION
  ) {
    fail('live_not_confirmed', 'The exact one-message live confirmation is required.');
  }
  return config;
};

const requirePreflight = (preflight) => {
  if (preflight?.databaseOwnerSession !== true) {
    fail('database_owner_required', 'Database-owner session check failed.');
  }
  if (preflight?.activeAuthorizationCount !== 0) {
    fail('existing_authorization', 'An existing proof authorization must be closed first.');
  }
  if (preflight?.unresolvedGmailOutboundCount !== 0) {
    fail('unresolved_gmail_outbound', 'Existing unresolved Gmail outbound must be zero.');
  }
  if (
    preflight?.eligibleCaseCount !== 1 ||
    preflight?.threadCount !== 1 ||
    preflight?.attachmentCount !== 0 ||
    preflight?.managerRouteResolved !== true ||
    !Number.isInteger(preflight?.managerCount) ||
    preflight.managerCount < 1 ||
    preflight.managerCount > 3
  ) {
    fail('case_not_eligible', 'The exact private case is not eligible for the proof.');
  }
  if (preflight?.automaticCustomerContactEnabled !== false) {
    fail('database_customer_contact_enabled', 'Database automatic customer contact must remain off.');
  }
  if (preflight?.gptTriageEnabled !== false || preflight?.gptAutoSendEnabled !== false) {
    fail('database_gpt_enabled', 'Database GPT processing and auto-send must remain off.');
  }
  if (preflight?.attachmentQuarantineApproved !== false) {
    fail('database_attachments_enabled', 'Attachment handling must remain off.');
  }
};

const requireDatabaseTeardown = (preflight) => {
  if (
    preflight?.databaseOwnerSession !== true ||
    preflight?.activeAuthorizationCount !== 0 ||
    preflight?.unresolvedGmailOutboundCount !== 0 ||
    preflight?.automaticCustomerContactEnabled !== false ||
    preflight?.gptTriageEnabled !== false ||
    preflight?.gptAutoSendEnabled !== false ||
    preflight?.attachmentQuarantineApproved !== false
  ) {
    fail('database_teardown_invalid', 'Database proof and customer-contact gates are not fail-closed.');
  }
};

const requireAuthorizedIdentity = (identity) => {
  if (identity?.authenticated !== true || identity?.canManageCase !== true) {
    fail('case_manager_identity_required', 'The authenticated user cannot manage the exact case.');
  }
};

export const requireAllOperationalGatesOff = (state, { allowGmail = false } = {}) => {
  const edge = state?.edge ?? {};
  const github = state?.github ?? {};
  const release = state?.release ?? {};
  const exactBoolean = (value, expected) => isBoolean(value) && value === expected;
  if (!exactBoolean(edge.gmailEnabled, allowGmail)) {
    fail('gmail_gate_state_invalid', `Gmail must be ${allowGmail ? 'on' : 'off'} at this phase.`);
  }
  if (
    edge.automaticCustomerContactEnabled !== false ||
    !['disabled', 'off', 'absent'].includes(edge.firstContactMode) ||
    edge.automationEnabled !== false ||
    edge.managerAgingEnabled !== false ||
    edge.gmailRetentionEnabled !== false ||
    edge.attachmentScannerEnabled !== false ||
    edge.gptTriageEnabled !== false ||
    edge.nayaxExecutionEnabled !== false ||
    edge.nayaxDryRun !== true ||
    edge.nayaxKillSwitch !== true ||
    edge.nayaxProviderContractConfirmed !== false ||
    edge.nayaxSponsorGoNoGo !== false
  ) {
    fail('edge_gate_state_invalid', 'An unrelated production Edge gate is not fail-closed.');
  }
  if (
    github.gmailSyncEnabled !== false ||
    github.gmailRetentionEnabled !== false ||
    github.automationSweepEnabled !== false ||
    github.gptTriageSyncEnabled !== false
  ) {
    fail('schedule_gate_state_invalid', 'A refund Gmail, automation, retention, or GPT schedule is enabled.');
  }
  if (
    release.productionAligned !== true ||
    release.backupCompletedFresh !== true ||
    release.officialActionsEnabled !== false ||
    release.nayaxProviderAdapterEnabled !== false
  ) {
    fail('release_gate_state_invalid', 'The reviewed production release boundary is not exact and fail-closed.');
  }
};

const requirePreparedAuthorization = (prepared, preflight) => {
  if (
    prepared?.prepared !== true ||
    !UUID_PATTERN.test(prepared?.authorizationId ?? '') ||
    prepared?.messageType !== REFUND_SYNTHETIC_PROOF_MESSAGE_TYPE ||
    prepared?.payloadRedacted !== true ||
    prepared?.expectedManagerCount !== preflight.managerCount
  ) {
    fail('prepare_result_invalid', 'The database-owner preparation result was not the exact redacted contract.');
  }
  const expiresAt = Date.parse(prepared.expiresAt ?? '');
  const remainingMs = expiresAt - Date.now();
  if (!Number.isFinite(expiresAt) || remainingMs < 15_000 || remainingMs > 300_000) {
    fail('prepare_expiry_invalid', 'The proof authorization does not have a safe short expiry.');
  }
};

const requireSendResult = (sent) => {
  if (
    sent?.sent !== true ||
    sent?.status !== 'sent' ||
    sent?.messageType !== REFUND_SYNTHETIC_PROOF_MESSAGE_TYPE ||
    sent?.transport !== 'gmail_thread'
  ) {
    fail('send_not_confirmed', 'The one-shot Gmail reply was not confirmed by the reviewed endpoint.');
  }
};

const requireSummary = (summary, { sendConfirmed }) => {
  const exactDeltas =
    summary?.globalCaseMessageDelta === 1 &&
    summary?.globalGmailOutboundDelta === 1 &&
    summary?.caseMessageDelta === 1 &&
    summary?.caseGmailOutboundDelta === 1 &&
    summary?.caseAttachmentDelta === 0;
  const exactRoute =
    summary?.proofMessageSent === true &&
    summary?.proofGmailSent === true &&
    summary?.originalThreadPreserved === true &&
    summary?.managerRoutePreserved === true &&
    summary?.senderIsInfo === true &&
    summary?.recipientPreserved === true &&
    summary?.unresolvedDeliveryCount === 0;
  if (
    summary?.prepared !== true ||
    summary?.payloadRedacted !== true ||
    (sendConfirmed && (summary?.proofPassed !== true || !exactDeltas || !exactRoute))
  ) {
    fail('postflight_not_proven', 'Redacted postflight did not prove the exact one-message outcome.');
  }
};

const emit = (logger, phase, detail = {}) => {
  if (!SAFE_PHASES.has(phase)) fail('unsafe_log_phase', 'Unsafe runner log phase.');
  const allowed = {
    phase,
    ok: true,
    payloadRedacted: true,
  };
  for (const key of [
    'eligibleCaseCount',
    'threadCount',
    'attachmentCount',
    'managerCount',
    'globalCaseMessageDelta',
    'globalGmailOutboundDelta',
    'caseMessageDelta',
    'caseGmailOutboundDelta',
    'caseAttachmentDelta',
    'unresolvedDeliveryCount',
    'activeAuthorizationCount',
    'unresolvedGmailOutboundCount',
    'proofPassed',
  ]) {
    if (typeof detail[key] === 'number' || typeof detail[key] === 'boolean') {
      allowed[key] = detail[key];
    }
  }
  logger(allowed);
};

const normalizeError = (error, fallbackCode) =>
  error instanceof SyntheticGmailProofRunnerError
    ? error
    : new SyntheticGmailProofRunnerError(fallbackCode);

const ensureGmailDisabled = async ({ control, config }) => {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await control.setGmailEnabled(false, { projectRef: config.projectRef });
      const state = await control.readState({ projectRef: config.projectRef });
      requireAllOperationalGatesOff(state);
      return state;
    } catch (error) {
      lastError = error;
    }
  }
  throw normalizeError(lastError, 'gmail_disable_failed');
};

export const executeSyntheticGmailProof = async ({
  config,
  clients,
  logger = () => {},
  signal,
  tokenFactory = () => randomBytes(32).toString('base64url'),
}) => {
  validateSyntheticGmailProofConfig(config);
  const { database, identity, control, edge } = clients;
  const preflight = await database.preflight({ caseId: config.caseId, signal });
  requirePreflight(preflight);
  const identityState = await identity.preflight({
    projectRef: config.projectRef,
    caseId: config.caseId,
    anonKey: config.anonKey,
    userAccessToken: config.userAccessToken,
    signal,
  });
  requireAuthorizedIdentity(identityState);
  const initialState = await control.readState({ projectRef: config.projectRef, signal });
  requireAllOperationalGatesOff(initialState);
  emit(logger, 'preflight_passed', preflight);

  if (config.mode === 'dry-run') {
    emit(logger, 'dry_run_passed', preflight);
    return { ok: true, mode: 'dry-run', proofPassed: false, payloadRedacted: true };
  }

  const rawRunToken = tokenFactory();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(rawRunToken)) {
    fail('token_generation_failed', 'The in-process one-shot token is invalid.');
  }
  const runTokenDigest = sha256Hex(rawRunToken);
  let authorizationId = null;
  let prepared = false;
  let sendConfirmed = false;
  let primaryError = null;
  let cleanupError = null;
  let summary = null;
  let gmailDisabled = false;

  try {
    signal?.throwIfAborted?.();
    const preparedResult = await database.prepare({
      caseId: config.caseId,
      runTokenDigest,
      confirmation: REFUND_SYNTHETIC_PROOF_PREPARE_CONFIRMATION,
      signal,
    });
    requirePreparedAuthorization(preparedResult, preflight);
    signal?.throwIfAborted?.();
    authorizationId = preparedResult.authorizationId;
    prepared = true;
    emit(logger, 'prepared', { managerCount: preparedResult.expectedManagerCount });

    await control.setGmailEnabled(true, { projectRef: config.projectRef, signal });
    signal?.throwIfAborted?.();
    const enabledState = await control.readState({ projectRef: config.projectRef, signal });
    requireAllOperationalGatesOff(enabledState, { allowGmail: true });
    emit(logger, 'gmail_enabled');

    signal?.throwIfAborted?.();
    const sendResult = await edge.send({
      projectRef: config.projectRef,
      caseId: config.caseId,
      anonKey: config.anonKey,
      userAccessToken: config.userAccessToken,
      runToken: rawRunToken,
      messageType: REFUND_SYNTHETIC_PROOF_MESSAGE_TYPE,
      signal,
    });
    requireSendResult(sendResult);
    sendConfirmed = true;
    emit(logger, 'send_confirmed');
  } catch (error) {
    primaryError = normalizeError(
      signal?.aborted && signal.reason ? signal.reason : error,
      signal?.aborted ? 'proof_interrupted' : 'proof_execution_failed',
    );
  } finally {
    try {
      await ensureGmailDisabled({ control, config });
      gmailDisabled = true;
      emit(logger, 'gmail_disabled');
    } catch (error) {
      cleanupError = normalizeError(error, 'gmail_disable_failed');
    }

    if (!authorizationId && prepared !== true) {
      try {
        authorizationId = await database.findActiveAuthorizationId({ caseId: config.caseId });
      } catch {
        // The later active-count verification remains the fail-closed evidence.
      }
    }

    if (authorizationId) {
      try {
        summary = await database.summary({
          authorizationId,
          confirmation: REFUND_SYNTHETIC_PROOF_SUMMARY_CONFIRMATION,
        });
        requireSummary(summary, { sendConfirmed });
        emit(logger, 'summary_read', summary);
      } catch (error) {
        cleanupError ??= normalizeError(error, 'postflight_failed');
      }

      if (gmailDisabled) {
        try {
          const closed = await database.close({
            authorizationId,
            confirmation: REFUND_SYNTHETIC_PROOF_CLOSE_CONFIRMATION,
          });
          if (
            closed?.closed !== true ||
            closed?.activeAuthorizationCount !== 0 ||
            closed?.payloadRedacted !== true
          ) {
            fail('authorization_close_failed', 'The proof authorization did not close cleanly.');
          }
          emit(logger, 'authorization_closed', closed);
        } catch (error) {
          cleanupError ??= normalizeError(error, 'authorization_close_failed');
        }
      }
    }

    try {
      const finalPreflight = await database.preflight({ caseId: config.caseId });
      const finalState = await control.readState({ projectRef: config.projectRef });
      requireAllOperationalGatesOff(finalState);
      requireDatabaseTeardown(finalPreflight);
      emit(logger, 'teardown_verified', finalPreflight);
    } catch (error) {
      cleanupError ??= normalizeError(error, 'teardown_verification_failed');
    }
  }

  if (cleanupError) throw cleanupError;
  if (primaryError) throw primaryError;
  if (!sendConfirmed || summary?.proofPassed !== true) {
    fail('proof_not_complete', 'The exact one-message proof did not complete.');
  }
  return { ok: true, mode: 'live', proofPassed: true, payloadRedacted: true };
};

export const runWithTimeout = async ({ timeoutMs, signal, run }) => {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(
    () => controller.abort(new SyntheticGmailProofRunnerError('proof_timeout')),
    timeoutMs,
  );
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromParent);
  }
};
