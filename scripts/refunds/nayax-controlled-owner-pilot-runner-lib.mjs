import crypto from 'node:crypto';
import { parseNayaxRefundProviderContract } from '../../supabase/functions/_shared/nayax-refund-provider.mjs';

export const NAYAX_CONTROLLED_PILOT_PROJECT_REF = 'ygbzkgxktzqsiygjlqyg';
const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_SECRET = /^[A-Za-z0-9_-]{32,256}$/u;
const EXECUTION_SECRET = /^[A-Za-z0-9_-]{43,256}$/u;
const PRIVATE_WRITE_TOKEN = /^[^\s\x00-\x1f]{20,500}$/u;
const LIVE_CONFIRMATION = 'I_AUTHORIZE_ONE_SELF_OWNED_PROVIDER_ONLY_NAYAX_TRANSACTION_NO_RETRY';
const PROVIDER_EMAIL_CONSENT_CONFIRMATION =
  'I_EXPECT_AND_CONSENT_TO_NAYAX_PROVIDER_EMAIL_FOR_MY_SELF_OWNED_TRANSACTION';
const PRODUCTION_NAYAX_REFUND_BASE_URL = 'https://lynx.nayax.com/operational/v1';
const INITIALIZE_CONFIRMATION =
  'I_INITIALIZE_DEFAULT_OFF_NAYAX_PILOT_SECRETS_AND_RECONCILE_RELEASE_METADATA';
const RETIRE_CONFIRMATION =
  'I_RETIRE_NAYAX_PILOT_WRITE_SECRETS_AND_RECONCILE_RELEASE_METADATA';
const RECOVERY_CONFIRMATION =
  'I_RECOVER_EXPIRED_NAYAX_PILOT_WITH_NO_PROVIDER_REPLAY';
const ACCOUNT_KEY = /^[A-Z0-9_]{1,80}$/u;

export class NayaxControlledPilotRunnerError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'NayaxControlledPilotRunnerError';
    this.code = code;
    this.details = details;
  }
}

export const sha256Hex = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fail = (code, details) => { throw new NayaxControlledPilotRunnerError(code, details); };

export const validateNayaxControlledPilotConfig = (config) => {
  if (!['initialize', 'dry-run', 'live', 'recover', 'retire'].includes(config.mode)) {
    fail('mode_invalid');
  }
  if (config.projectRef !== NAYAX_CONTROLLED_PILOT_PROJECT_REF ||
      config.confirmProjectRef !== NAYAX_CONTROLLED_PILOT_PROJECT_REF) {
    fail('project_not_confirmed');
  }
  if (typeof config.managementToken !== 'string' || config.managementToken.length < 20) {
    fail('private_credentials_missing');
  }
  if (config.mode === 'recover') {
    if (config.recoveryConfirmation !== RECOVERY_CONFIRMATION) {
      fail('recovery_confirmation_missing');
    }
    return Object.freeze({ ...config });
  }
  if (config.mode === 'retire') {
    if (!ACCOUNT_KEY.test(config.accountKey) ||
        config.retireConfirmation !== RETIRE_CONFIRMATION) {
      fail('retire_confirmation_missing');
    }
    return Object.freeze({ ...config });
  }
  if (config.mode !== 'initialize' &&
        (typeof config.anonKey !== 'string' || config.anonKey.length < 20 ||
          typeof config.ownerUserJwt !== 'string' || config.ownerUserJwt.length < 40)) {
    fail('private_credentials_missing');
  }
  if (!SAFE_SECRET.test(config.runnerAssertion) ||
      !ACCOUNT_KEY.test(config.accountKey) ||
      !Number.isInteger(config.expectedAmountCents) || config.expectedAmountCents <= 0 ||
      config.expectedAmountCents > 1_000_000) {
    fail('private_evidence_invalid');
  }
  if (config.mode === 'initialize') {
    if (!PRIVATE_WRITE_TOKEN.test(config.requestWriteToken) ||
        !PRIVATE_WRITE_TOKEN.test(config.approveWriteToken) ||
        !EXECUTION_SECRET.test(config.executorAssertion) ||
        !SHA256.test(config.idempotencySecretDigest) ||
        config.executorAssertionDigest !== sha256Hex(config.executorAssertion) ||
        !UUID.test(config.caseId) || !SHA256.test(config.expectedMachineDigest)) {
      fail('write_credentials_missing');
    }
  } else if (config.requestWriteToken || config.approveWriteToken ||
      config.executorAssertion ||
      !SHA256.test(config.requestWriteTokenDigest) ||
      !SHA256.test(config.approveWriteTokenDigest) ||
      !SHA256.test(config.idempotencySecretDigest) ||
      !SHA256.test(config.executorAssertionDigest)) {
    fail('write_credential_packet_invalid');
  }
  if (config.mode !== 'initialize' &&
      (!SHA256.test(config.ownerEmailDigest) || !UUID.test(config.caseId) ||
        !SHA256.test(config.ownerCaseEvidenceDigest) ||
        !SHA256.test(config.selfCaseAttestationDigest) ||
        !SHA256.test(config.expectedMachineDigest))) {
    fail('private_evidence_invalid');
  }
  if (config.mode !== 'initialize') {
    for (const [name, value] of Object.entries({
      exactCapsConfirmed: config.exactCapsConfirmed,
      providerOnlyConfirmed: config.providerOnlyConfirmed,
      noRetryConfirmed: config.noRetryConfirmed,
    })) {
      if (value !== 'true') fail(`${name}_missing`);
    }
  }
  if (config.mode === 'live' && config.liveConfirmation !== LIVE_CONFIRMATION) {
    fail('live_confirmation_missing');
  }
  const contract = parseNayaxRefundProviderContract(config.providerContractJson);
  if (contract.baseUrl !== PRODUCTION_NAYAX_REFUND_BASE_URL) {
    fail('provider_contract_host_invalid');
  }
  if (contract.providerEmailBehavior === 'owner_consented_expected' &&
      ['initialize', 'live'].includes(config.mode) &&
      config.providerEmailConfirmation !== PROVIDER_EMAIL_CONSENT_CONFIRMATION) {
    fail('provider_email_consent_missing');
  }
  const contractDigest = sha256Hex(config.providerContractJson);
  if (config.writtenContractDigest !== contractDigest) {
    fail('written_contract_digest_mismatch');
  }
  const evidenceDigests = [config.sponsorProofDigest, config.dtmOwnerOperatorProofDigest];
  if (config.mode !== 'initialize') {
    if (evidenceDigests.some((value) => !SHA256.test(value) ||
        [sha256Hex('true'), sha256Hex('false'), '0'.repeat(64), contractDigest].includes(value)) ||
        new Set(evidenceDigests).size !== evidenceDigests.length) {
      fail('private_approval_digest_invalid');
    }
  }
  const requestWriteTokenDigest = config.mode === 'initialize'
    ? sha256Hex(config.requestWriteToken) : config.requestWriteTokenDigest;
  const approveWriteTokenDigest = config.mode === 'initialize'
    ? sha256Hex(config.approveWriteToken) : config.approveWriteTokenDigest;
  const sharedWriteToken = requestWriteTokenDigest === approveWriteTokenDigest;
  if ((contract.writeCredentialMode === 'same_token_explicit') !== sharedWriteToken) {
    fail('write_credential_contract_mismatch');
  }
  if (config.mode === 'initialize' &&
      config.initializeConfirmation !== INITIALIZE_CONFIRMATION) {
    fail('initialize_confirmation_missing');
  }
  return Object.freeze({
    ...config,
    contract,
    contractDigest,
    runnerAssertionDigest: sha256Hex(config.runnerAssertion),
    accountKeyDigest: sha256Hex(
      config.accountKey.trim().toUpperCase().replace(/[^A-Z0-9_]/gu, '_'),
    ),
    sponsorDigest: config.sponsorProofDigest,
    dtmOwnerOperatorProofDigest: config.dtmOwnerOperatorProofDigest,
    requestWriteTokenDigest,
    approveWriteTokenDigest,
  });
};

const number = (value, code = 'database_snapshot_invalid') => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(code);
  return parsed;
};
const boolean = (value, code = 'database_snapshot_invalid') => {
  if (value === true || value === false) return value;
  fail(code);
};

export const validateNayaxControlledPilotOperationalState = (
  state,
  { allowPilotSecretsUninitialized = false } = {},
) => {
  const edge = state?.edge ?? {};
  const github = state?.github ?? {};
  const release = state?.release ?? {};
  if (edge.gmailEnabled !== false ||
      edge.automaticCustomerContactEnabled !== false ||
      !['disabled', 'off', 'absent'].includes(edge.firstContactMode) ||
      edge.automationEnabled !== false || edge.managerAgingEnabled !== false ||
      edge.gmailRetentionEnabled !== false || edge.attachmentScannerEnabled !== false ||
      edge.gptTriageEnabled !== false || edge.nayaxExecutionEnabled !== false ||
      edge.nayaxDryRun !== true || edge.nayaxKillSwitch !== true ||
      edge.nayaxProviderContractConfirmed !== false ||
      edge.nayaxSponsorGoNoGo !== false ||
      (!allowPilotSecretsUninitialized && edge.pilotSecretsAligned !== true) ||
      edge.reportingTokenFallbackStaticallyAbsent !== true) {
    fail('edge_gate_or_pilot_secret_state_invalid');
  }
  if (github.gmailSyncEnabled !== false || github.gmailRetentionEnabled !== false ||
      github.automationSweepEnabled !== false || github.gptTriageSyncEnabled !== false) {
    fail('schedule_gate_state_invalid');
  }
  if (release.productionAligned !== true || release.backupCompletedFresh !== true) {
    fail('release_or_backup_state_invalid');
  }
  return true;
};

export const validateNayaxControlledPilotInitializationPosture = (state) => {
  validateNayaxControlledPilotOperationalState(state, {
    allowPilotSecretsUninitialized: true,
  });
  if (state?.edge?.pilotSecretsAbsent !== true ||
      state?.edge?.idempotencyDigestMatches !== true ||
      state?.edge?.safeBaselineCaps !== true) {
    fail('pilot_initialization_posture_invalid');
  }
  return true;
};

export const validateNayaxControlledPilotInitializationDatabaseState = (row) => {
  if (row?.database_owner_session !== true || row?.payload_redacted !== true ||
      boolean(row.official_actions_enabled) || boolean(row.resolution_enabled) ||
      boolean(row.automatic_customer_contact_enabled) ||
      boolean(row.gpt_triage_enabled) || boolean(row.gpt_auto_send_enabled)) {
    fail('pilot_initialization_database_state_invalid');
  }
  for (const key of [
    'active_proof_authorization_count', 'unresolved_gmail_outbound_count',
    'unresolved_first_contact_count', 'overdue_cleanup_obligation_count',
    'active_official_authorization_count', 'pending_step_up_intent_count',
    'active_provider_caller_count', 'enabled_nayax_machine_count',
    'configured_machine_cap_count', 'unresolved_provider_attempt_count',
    'resolution_operator_count', 'resolution_intent_count',
  ]) {
    if (number(row[key]) !== 0) fail('pilot_initialization_database_state_invalid');
  }
  if (number(row.exact_machine_account_binding_count) !== 1 ||
      !SHA256.test(row.machine_evidence_digest ?? '') ||
      !SHA256.test(row.account_key_digest ?? '')) {
    fail('pilot_initialization_database_state_invalid');
  }
  return true;
};

export const validateNayaxControlledPilotPreflight = ({ config, identity, row }) => {
  if (!identity || !UUID.test(identity.userId) || !SHA256.test(identity.emailDigest) ||
      identity.emailDigest !== config.ownerEmailDigest) fail('owner_identity_mismatch');
  if (row.database_owner_session !== true || row.payload_redacted !== true) {
    fail('database_owner_preflight_invalid');
  }
  const zeros = [
    'pilot_authorization_count', 'pilot_closure_count',
    'unresolved_provider_attempt_count', 'resolution_operator_count',
    'resolution_intent_count', 'active_official_authorization_count',
    'pending_step_up_intent_count',
    'active_proof_authorization_count', 'armed_dispatch_authorization_count',
    'unresolved_gmail_outbound_count', 'unresolved_first_contact_count',
    'nayax_operator_count', 'overdue_cleanup_obligation_count',
    'provider_caller_count', 'enabled_nayax_machine_count',
    'configured_machine_cap_count',
  ];
  for (const key of zeros) if (number(row[key]) !== 0) fail('preflight_not_empty');
  if (boolean(row.official_actions_enabled) || boolean(row.resolution_enabled) ||
      boolean(row.automatic_customer_contact_enabled) || boolean(row.gpt_triage_enabled) ||
      boolean(row.gpt_auto_send_enabled) || boolean(row.attachments_enabled) ||
      boolean(row.scanner_enabled) ||
      number(row.eligible_case_count) !== 1 || number(row.owner_manageable_case_count) !== 1 ||
      number(row.exact_machine_closed_count) !== 1 ||
      number(row.self_owned_email_count) !== 1 ||
      number(row.case_amount_cents) !== config.expectedAmountCents ||
      row.case_evidence_digest !== config.ownerCaseEvidenceDigest ||
      row.self_case_attestation_digest !== config.selfCaseAttestationDigest ||
      row.machine_evidence_digest !== config.expectedMachineDigest ||
      row.account_key_digest !== config.accountKeyDigest ||
      !Number.isSafeInteger(number(row.expected_case_version)) ||
      number(row.expected_case_version) <= 0) {
    fail('preflight_exact_context_mismatch');
  }
  return Object.freeze({
    ownerUserId: identity.userId,
    expectedCaseVersion: number(row.expected_case_version),
    baseline: Object.freeze({
      providerAttempts: number(row.provider_attempt_count),
      customerDeliveries: number(row.customer_delivery_count),
      gmailOutbound: number(row.gmail_outbound_count),
      reportingAdjustments: number(row.reporting_adjustment_count),
      caseStatus: row.case_status ?? 'correlated',
      caseDecision: row.case_decision ?? null,
      caseVersion: number(row.expected_case_version),
    }),
  });
};

export const classifyNayaxControlledPilotPostflight = ({ baseline, row }) => {
  if (!row || row.database_owner_session !== true || row.payload_redacted !== true) {
    return Object.freeze({
      ok: false, effectsClassification: 'outcome_unknown', noReplay: true,
      providerHold: true, manualReconciliationRequired: true,
    });
  }
  const attemptDelta = number(row.provider_attempt_count) - baseline.providerAttempts;
  const deliveryDelta = number(row.customer_delivery_count) - baseline.customerDeliveries;
  const gmailDelta = number(row.gmail_outbound_count) - baseline.gmailOutbound;
  const adjustmentDelta = number(row.reporting_adjustment_count) - baseline.reportingAdjustments;
  const stageCount = number(row.stage_count);
  const commonSafe = deliveryDelta === 0 && gmailDelta === 0 &&
    boolean(row.official_actions_enabled) === false &&
    boolean(row.resolution_enabled) === false &&
    number(row.active_provider_caller_count) === 0 &&
    number(row.enabled_nayax_machine_count) === 0 &&
    number(row.configured_machine_cap_count) === 0;
  if (attemptDelta === 0 && commonSafe && adjustmentDelta === 0 &&
      ['cancelled', 'cancelled_tombstone'].includes(row.pilot_status) &&
      (row.case_status === null || row.case_status === baseline.caseStatus) &&
      (row.case_decision === null || row.case_decision === baseline.caseDecision) &&
      (row.case_version === null || number(row.case_version) === baseline.caseVersion)) {
    return Object.freeze({
      ok: false, effectsClassification: 'no_effect', noReplay: true,
      providerHold: false, manualReconciliationRequired: false,
      providerAttemptCount: 0, customerDeliveryDelta: 0, gmailOutboundDelta: 0,
    });
  }
  const exactSuccess = attemptDelta === 1 && commonSafe && adjustmentDelta === 1 &&
    row.pilot_status === 'consumed' && row.attempt_status === 'succeeded' &&
    row.provider_outcome === 'success' &&
    boolean(row.reconciliation_required) === false && stageCount === 4 &&
    row.stage_sequence === 'request_started,request_result,approve_started,approve_result' &&
    boolean(row.case_completed) === true &&
    boolean(row.reporting_adjustment_present) === true &&
    boolean(row.evidence_reference_safe) === true;
  if (exactSuccess) {
    return Object.freeze({
      ok: true, effectsClassification: 'complete_exact', noReplay: true,
      providerHold: false, manualReconciliationRequired: false,
      providerAttemptCount: 1, requestCount: 1, approvalCount: 1,
      customerDeliveryDelta: 0, gmailOutboundDelta: 0,
      providerOnly: true,
    });
  }
  const terminalRejected = attemptDelta === 1 && commonSafe && adjustmentDelta === 0 &&
    row.pilot_status === 'consumed' && row.attempt_status === 'declined' &&
    row.provider_outcome === 'rejected' &&
    boolean(row.reconciliation_required) === false &&
    ((stageCount === 2 &&
      row.stage_sequence === 'request_started,request_result') ||
     (stageCount === 4 &&
      row.stage_sequence ===
        'request_started,request_result,approve_started,approve_result')) &&
    boolean(row.case_completed) === false &&
    boolean(row.reporting_adjustment_present) === false;
  if (terminalRejected) {
    return Object.freeze({
      ok: false, effectsClassification: 'terminal_rejected', noReplay: true,
      providerHold: false, manualReconciliationRequired: false,
      providerAttemptCount: 1, requestCount: 1,
      approvalCount: stageCount === 4 ? 1 : 0,
      customerDeliveryDelta: 0, gmailOutboundDelta: 0, providerOnly: true,
    });
  }
  return Object.freeze({
    ok: false,
    effectsClassification: attemptDelta === 0 ? 'outcome_unknown' : 'partial_incident',
    noReplay: true, providerHold: true, manualReconciliationRequired: true,
    providerAttemptCount: Math.max(0, attemptDelta),
    customerDeliveryDelta: deliveryDelta,
    gmailOutboundDelta: gmailDelta,
  });
};

export const reconcileNayaxControlledPilot = async ({
  client, authorizationId, baseline, deadlineMs, now = Date.now,
  signal,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) => {
  const waitForNextPoll = async () => {
    if (signal?.aborted) return;
    if (!signal) {
      await sleep(2_000);
      return;
    }
    let onAbort;
    const aborted = new Promise((resolve) => {
      onAbort = resolve;
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([sleep(2_000), aborted]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  };
  let last = null;
  let stableFingerprint = null;
  let stableReads = 0;
  while (now() <= deadlineMs) {
    try {
      last = await client.postflight({ authorizationId });
    } catch {
      // Continue bounded owner reconciliation; never resend the Edge POST.
    }
    if (last) {
      const classified = classifyNayaxControlledPilotPostflight({ baseline, row: last });
      if (classified.effectsClassification === 'complete_exact' ||
          classified.effectsClassification === 'no_effect' ||
          classified.effectsClassification === 'terminal_rejected' ||
          (classified.providerAttemptCount === 1 &&
            ['succeeded', 'declined', 'ambiguous'].includes(last.attempt_status))) {
        const fingerprint = JSON.stringify(last);
        if (fingerprint === stableFingerprint) stableReads += 1;
        else {
          stableFingerprint = fingerprint;
          stableReads = 1;
        }
        if (stableReads >= 2) return classified;
      }
    }
    if (signal?.aborted) break;
    await waitForNextPoll();
    if (signal?.aborted) break;
  }
  return classifyNayaxControlledPilotPostflight({ baseline, row: last });
};

export const sanitizeNayaxControlledPilotError = (error) => ({
  ok: false,
  code: error instanceof NayaxControlledPilotRunnerError
    ? error.code : 'controlled_pilot_failed_closed',
  noReplay: true,
  providerHold: true,
  payloadRedacted: true,
});

const SAFE_FAILURE_DETAIL_KEYS = Object.freeze([
  'providerAttemptCount', 'requestCount', 'approvalCount',
  'consumedAttemptCount', 'providerCallCount', 'providerCallCountStatus',
  'providerHold', 'manualReconciliationRequired',
  'customerDeliveryDelta', 'gmailOutboundDelta', 'noReplay',
]);
const SAFE_PROVIDER_EMAIL_BEHAVIORS = new Set([
  'suppressed_by_written_contract', 'owner_consented_expected',
]);

export const selectNayaxControlledPilotFailureDetails = (details = {}) => ({
  ...Object.fromEntries(SAFE_FAILURE_DETAIL_KEYS
    .filter((key) => typeof details[key] === 'number' ||
      typeof details[key] === 'boolean' || typeof details[key] === 'string')
    .map((key) => [key, details[key]])),
  ...(SAFE_PROVIDER_EMAIL_BEHAVIORS.has(details.providerEmailBehavior)
    ? { providerEmailBehavior: details.providerEmailBehavior }
    : {}),
});

const emit = (logger, phase, detail = {}) => logger({
  phase,
  ok: detail.ok !== false,
  ...(typeof detail.effectsClassification === 'string'
    ? { effectsClassification: detail.effectsClassification }
    : {}),
  ...(typeof detail.gatesConclusivelyClosed === 'boolean'
    ? { gatesConclusivelyClosed: detail.gatesConclusivelyClosed }
    : {}),
  ...(Number.isSafeInteger(detail.cancelledAuthorizationCount)
    ? { cancelledAuthorizationCount: detail.cancelledAuthorizationCount }
    : {}),
  ...(Number.isSafeInteger(detail.disabledMachineCount)
    ? { disabledMachineCount: detail.disabledMachineCount }
    : {}),
  ...(Number.isSafeInteger(detail.revokedCallerCount)
    ? { revokedCallerCount: detail.revokedCallerCount }
    : {}),
  noReplay: true,
  payloadRedacted: true,
});

const recoveryStateClosed = (row) => row?.database_owner_session === true &&
  row?.payload_redacted === true &&
  number(row.armed_authorization_count) === 0 &&
  number(row.unsettled_consumed_count) === 0 &&
  number(row.active_provider_caller_count) === 0 &&
  number(row.enabled_nayax_machine_count) === 0 &&
  number(row.configured_machine_cap_count) === 0 &&
  number(row.durable_closure_count) === 1;

const retirementStateSafe = (row) => row?.database_owner_session === true &&
  row?.payload_redacted === true &&
  number(row.armed_authorization_count) === 0 &&
  number(row.unsettled_consumed_count) === 0 &&
  number(row.active_provider_caller_count) === 0 &&
  number(row.enabled_nayax_machine_count) === 0 &&
  number(row.configured_machine_cap_count) === 0 &&
  number(row.unresolved_provider_attempt_count) === 0 &&
  number(row.durable_closure_count) === 1;

const postflightClosed = (row) => row?.database_owner_session === true &&
  row?.payload_redacted === true &&
  ['cancelled', 'cancelled_tombstone', 'consumed'].includes(row.pilot_status) &&
  number(row.active_provider_caller_count) === 0 &&
  number(row.enabled_nayax_machine_count) === 0 &&
  number(row.configured_machine_cap_count) === 0 &&
  number(row.exact_closure_count) === 1 &&
  row.worker_active === false &&
  (row.pilot_status !== 'consumed' || row.worker_terminal_acknowledged === true);

export const conclusivelyCloseNayaxControlledPilot = async ({
  client, authorizationId,
}) => {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await client.cancel({ authorizationId });
    } catch (error) {
      lastError = error;
    }
    try {
      const row = await client.postflight({ authorizationId });
      if (postflightClosed(row)) return { closed: true, row, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
    }
  }
  throw new NayaxControlledPilotRunnerError('pilot_close_state_unknown', {
    gatesConclusivelyClosed: false,
    emergencyIndependentVerificationRequired: true,
    causeClass: lastError ? 'close_or_readback_failed' : 'state_not_closed',
  });
};

export const executeNayaxControlledPilot = async ({
  config,
  clients,
  logger = () => {},
  signal,
  now = () => Date.now(),
  sleep,
  readFreshTotp,
  authorizationIdFactory = () => crypto.randomUUID(),
}) => {
  const runStartedAtMs = now();
  if (!Number.isFinite(runStartedAtMs)) fail('clock_invalid');
  const validated = validateNayaxControlledPilotConfig(config);

  if (validated.mode === 'initialize') {
    const posture = await clients.readOperationalState({ signal });
    validateNayaxControlledPilotInitializationPosture(posture);
    const databaseState = await clients.initializationState({ signal });
    validateNayaxControlledPilotInitializationDatabaseState(databaseState);
    if (databaseState.machine_evidence_digest !== validated.expectedMachineDigest ||
        databaseState.account_key_digest !== validated.accountKeyDigest) {
      fail('pilot_initialization_machine_account_binding_invalid');
    }
    const result = await clients.initializePilotSecrets({ signal });
    emit(logger, 'initialized_default_off');
    return { ok: true, mode: 'initialize', ...result };
  }
  if (validated.mode === 'retire') {
    let lane = await clients.recoveryState({ signal });
    if (!retirementStateSafe(lane)) {
      if (number(lane?.durable_closure_count) !== 0 ||
          number(lane?.unsettled_consumed_count) !== 0) {
        fail('pilot_retirement_lane_active');
      }
      await clients.recoverExpired({ signal });
      lane = await clients.recoveryState({ signal });
    }
    if (!retirementStateSafe(lane)) fail('pilot_retirement_lane_active');
    const result = await clients.retirePilotSecrets({ signal });
    emit(logger, 'pilot_credentials_retired');
    return { ok: true, mode: 'retire', ...result };
  }
  if (validated.mode === 'recover') {
    const recovery = await clients.recoverExpired({ signal });
    const state = await clients.recoveryState({ signal });
    if (!recoveryStateClosed(state)) fail('pilot_recovery_state_unverified');
    const consumedAttemptCount = number(recovery.consumedAttemptCount);
    if (number(state.historical_consumed_count) !== consumedAttemptCount ||
        (consumedAttemptCount === 0 &&
          number(state.unresolved_provider_attempt_count) !== 0)) {
      fail('pilot_recovery_state_unverified');
    }
    emit(logger, 'expired_authorization_recovered', recovery);
    return {
      ok: consumedAttemptCount === 0,
      mode: 'recover',
      effectsClassification: consumedAttemptCount === 0 ? 'no_effect' : 'outcome_unknown',
      ...recovery,
      gatesConclusivelyClosed: true,
      ...(consumedAttemptCount === 0 ? { providerCallCount: 0 } : {}),
      noReplay: true,
    };
  }

  const state = await clients.readOperationalState({ signal });
  validateNayaxControlledPilotOperationalState(state);
  const identity = await clients.authIdentity({ signal });
  const preflightRow = await clients.preflight({ ownerUserId: identity.userId, signal });
  const preflight = validateNayaxControlledPilotPreflight({
    config: validated, identity, row: preflightRow,
  });
  emit(logger, 'preflight_passed');
  if (validated.mode === 'dry-run') {
    emit(logger, 'dry_run_passed');
    return {
      ok: true, mode: 'dry-run', providerCallCount: 0,
      authorizationCreated: false, payloadRedacted: true,
    };
  }

  const authorizationId = authorizationIdFactory();
  if (!UUID.test(authorizationId)) fail('authorization_id_generation_failed');
  let authorization = null;
  let primaryError = null;
  let edgeConfirmed = false;
  let closure = null;
  let classification = null;
  try {
    authorization = await clients.authorize({
      authorizationId,
      ownerUserId: preflight.ownerUserId,
      expectedCaseVersion: preflight.expectedCaseVersion,
      signal,
    });
    emit(logger, 'authorization_armed');
    emit(logger, 'ready_for_private_totp');
    if (typeof readFreshTotp !== 'function') fail('private_totp_reader_unavailable');
    const freshTotp = await readFreshTotp({ signal });
    if (!/^\d{6}$/u.test(freshTotp ?? '')) fail('fresh_totp_invalid');
    const edge = await clients.execute({
      authorizationId,
      intentId: authorization.intentId,
      expectedCaseVersion: preflight.expectedCaseVersion,
      code: freshTotp,
      signal,
    });
    edgeConfirmed = edge.confirmed === true;
    emit(logger, 'edge_post_completed', { ok: edgeConfirmed });
  } catch (error) {
    primaryError = error instanceof NayaxControlledPilotRunnerError
      ? error : new NayaxControlledPilotRunnerError('pilot_execution_failed_closed');
  } finally {
    let closeError = null;
    let reconciliationError = null;
    try {
      closure = await conclusivelyCloseNayaxControlledPilot({
        client: clients, authorizationId,
      });
    } catch (error) {
      closeError = error instanceof NayaxControlledPilotRunnerError
        ? error : new NayaxControlledPilotRunnerError('pilot_close_state_unknown');
    }
    try {
      classification = await reconcileNayaxControlledPilot({
        client: clients,
        authorizationId,
        baseline: preflight.baseline,
        deadlineMs: runStartedAtMs + Math.max(5_000, validated.timeoutMs - 30_000),
        now,
        signal,
        ...(sleep ? { sleep } : {}),
      });
    } catch (error) {
      reconciliationError = error instanceof NayaxControlledPilotRunnerError
        ? error : new NayaxControlledPilotRunnerError('pilot_postflight_failed');
      classification = {
        ok: false, effectsClassification: 'outcome_unknown', noReplay: true,
        providerHold: true, manualReconciliationRequired: true,
      };
    }
    emit(logger, 'postflight_classified', {
      ok: classification.ok,
      effectsClassification: classification.effectsClassification,
      gatesConclusivelyClosed: closure?.closed === true,
    });
    primaryError ??= closeError ?? reconciliationError;
  }

  const result = {
    ...classification,
    mode: 'live',
    edgeConfirmed,
    gatesConclusivelyClosed: closure?.closed === true,
    gateState: closure?.closed === true ? 'closed' : 'unknown',
    providerEmailBehavior: validated.contract.providerEmailBehavior,
    payloadRedacted: true,
  };
  if (classification.effectsClassification === 'complete_exact' && result.gatesConclusivelyClosed) {
    return result;
  }
  if (classification.effectsClassification === 'terminal_rejected' &&
      result.gatesConclusivelyClosed) {
    return result;
  }
  throw new NayaxControlledPilotRunnerError(
    classification.effectsClassification === 'no_effect'
      ? primaryError?.code ?? 'pilot_no_effect'
      : classification.effectsClassification === 'outcome_unknown'
      ? 'pilot_outcome_unknown'
      : 'pilot_partial_incident',
    {
      effectsClassification: classification.effectsClassification,
      gatesConclusivelyClosed: result.gatesConclusivelyClosed,
      emergencyIndependentVerificationRequired: !result.gatesConclusivelyClosed,
      providerAttemptCount: classification.providerAttemptCount,
      requestCount: classification.requestCount,
      approvalCount: classification.approvalCount,
      providerHold: classification.providerHold,
      manualReconciliationRequired: classification.manualReconciliationRequired,
      customerDeliveryDelta: classification.customerDeliveryDelta,
      gmailOutboundDelta: classification.gmailOutboundDelta,
      providerEmailBehavior: validated.contract.providerEmailBehavior,
      noReplay: true,
    },
  );
};

export const runNayaxControlledPilotWithTimeout = async ({ timeoutMs, signal, run }) => {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || typeof run !== 'function') {
    fail('timeout_invalid');
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(
    new NayaxControlledPilotRunnerError('pilot_timeout'),
  ), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
};
