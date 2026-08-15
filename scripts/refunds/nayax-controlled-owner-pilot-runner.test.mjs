import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  loadNayaxControlledPilotEnvironment,
  parseNayaxControlledPilotEnvFile,
} from './nayax-controlled-owner-pilot-runner-config.mjs';

import {
  NayaxControlledPilotRunnerError,
  classifyNayaxControlledPilotPostflight,
  executeNayaxControlledPilot,
  reconcileNayaxControlledPilot,
  selectNayaxControlledPilotFailureDetails,
  sha256Hex,
  validateNayaxControlledPilotConfig,
} from './nayax-controlled-owner-pilot-runner-lib.mjs';

const contract = JSON.stringify({
  schemaVersion: 1,
  contractVersion: 'nayax-production-confirmed-v1',
  baseUrl: 'https://lynx.nayax.com/operational/v1',
  authorizationMode: 'bearer',
  amountUnit: 'major',
  amountRoundingMode: 'exact_cent',
  refundEmailListMode: 'omit',
  providerEmailBehavior: 'suppressed_by_written_contract',
  writeCredentialMode: 'separate',
  sameWriteTokenContractConfirmed: false,
  reconciliationMode: 'dtm_then_structured_resolution',
  requestResponses: [
    { result: 'True', status: 'Pending Approval', outcome: 'accepted' },
    { result: 'False', status: 'Rejected', outcome: 'rejected' },
    { result: 'False', status: 'Duplicate', outcome: 'duplicate' },
    { result: 'False', status: 'Already Refunded', outcome: 'already_refunded' },
  ],
  approveResponses: [
    { result: 'True', status: 'Approved', outcome: 'succeeded' },
    { result: 'False', status: 'Rejected', outcome: 'rejected' },
    { result: 'False', status: 'Duplicate', outcome: 'duplicate' },
    { result: 'False', status: 'Already Refunded', outcome: 'already_refunded' },
    { result: 'True', status: 'Pending', outcome: 'pending' },
  ],
});

const digest = (character) => character.repeat(64);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const baseConfig = (mode = 'dry-run') => ({
  mode,
  timeoutMs: 600_000,
  projectRef: 'ygbzkgxktzqsiygjlqyg',
  confirmProjectRef: 'ygbzkgxktzqsiygjlqyg',
  managementToken: 'm'.repeat(32),
  anonKey: 'a'.repeat(32),
  ownerUserJwt: 'j'.repeat(80),
  ownerEmailDigest: digest('1'),
  caseId: '43000000-0000-4000-8000-000000000001',
  ownerCaseEvidenceDigest: digest('2'),
  selfCaseAttestationDigest: digest('a'),
  expectedMachineDigest: digest('3'),
  expectedAmountCents: 700,
  runnerAssertion: 'runner_assertion_value_12345678901234567890',
  accountKey: 'PILOT_ACCOUNT',
  requestWriteToken: '',
  approveWriteToken: '',
  requestWriteTokenDigest: digest('4'),
  approveWriteTokenDigest: digest('5'),
  idempotencySecretDigest: digest('6'),
  executorAssertionDigest: digest('7'),
  executorAssertion: '',
  providerContractJson: contract,
  providerEmailConfirmation: '',
  writtenContractDigest: sha256Hex(contract),
  dtmOwnerOperatorProofDigest: digest('8'),
  sponsorProofDigest: digest('9'),
  exactCapsConfirmed: 'true',
  providerOnlyConfirmed: 'true',
  noRetryConfirmed: 'true',
  initializeConfirmation: '',
  retireConfirmation: '',
  recoveryConfirmation: '',
  liveConfirmation: '',
});

const operationalState = {
  edge: {
    gmailEnabled: false,
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
    pilotSecretsAligned: true,
    reportingTokenFallbackStaticallyAbsent: true,
  },
  github: {
    gmailSyncEnabled: false,
    gmailRetentionEnabled: false,
    automationSweepEnabled: false,
    gptTriageSyncEnabled: false,
  },
  release: { productionAligned: true, backupCompletedFresh: true },
};

const preflightRow = {
  database_owner_session: true,
  payload_redacted: true,
  official_actions_enabled: false,
  resolution_enabled: false,
  automatic_customer_contact_enabled: false,
  gpt_triage_enabled: false,
  gpt_auto_send_enabled: false,
  attachments_enabled: false,
  scanner_enabled: false,
  eligible_case_count: 1,
  owner_manageable_case_count: 1,
  self_owned_email_count: 1,
  exact_machine_closed_count: 1,
  case_amount_cents: 700,
  case_evidence_digest: digest('2'),
  self_case_attestation_digest: digest('a'),
  machine_evidence_digest: digest('3'),
  account_key_digest: sha256Hex('PILOT_ACCOUNT'),
  expected_case_version: 1,
  case_status: 'correlated',
  case_decision: null,
  provider_attempt_count: 8,
  customer_delivery_count: 7,
  gmail_outbound_count: 2,
  reporting_adjustment_count: 1,
  pilot_authorization_count: 0,
  pilot_closure_count: 0,
  unresolved_provider_attempt_count: 0,
  resolution_operator_count: 0,
  resolution_intent_count: 0,
  active_official_authorization_count: 0,
  pending_step_up_intent_count: 0,
  active_proof_authorization_count: 0,
  armed_dispatch_authorization_count: 0,
  unresolved_gmail_outbound_count: 0,
  unresolved_first_contact_count: 0,
  nayax_operator_count: 0,
  overdue_cleanup_obligation_count: 0,
  provider_caller_count: 0,
  enabled_nayax_machine_count: 0,
  configured_machine_cap_count: 0,
};

const initializationDatabaseState = {
  database_owner_session: true,
  payload_redacted: true,
  official_actions_enabled: false,
  resolution_enabled: false,
  automatic_customer_contact_enabled: false,
  gpt_triage_enabled: false,
  gpt_auto_send_enabled: false,
  active_proof_authorization_count: 0,
  unresolved_gmail_outbound_count: 0,
  unresolved_first_contact_count: 0,
  overdue_cleanup_obligation_count: 0,
  active_official_authorization_count: 0,
  pending_step_up_intent_count: 0,
  active_provider_caller_count: 0,
  enabled_nayax_machine_count: 0,
  configured_machine_cap_count: 0,
  unresolved_provider_attempt_count: 0,
  resolution_operator_count: 0,
  resolution_intent_count: 0,
  exact_machine_account_binding_count: 1,
  machine_evidence_digest: digest('3'),
  account_key_digest: sha256Hex('PILOT_ACCOUNT'),
};

const postflight = (overrides = {}) => ({
  database_owner_session: true,
  payload_redacted: true,
  official_actions_enabled: false,
  resolution_enabled: false,
  active_provider_caller_count: 0,
  enabled_nayax_machine_count: 0,
  configured_machine_cap_count: 0,
  worker_terminal_acknowledged: true,
  worker_active: false,
  worker_terminal_status: 'success',
  exact_closure_count: 1,
  pilot_status: 'consumed',
  attempt_status: 'succeeded',
  provider_outcome: 'success',
  reconciliation_required: false,
  stage_count: 4,
  stage_sequence: 'request_started,request_result,approve_started,approve_result',
  case_completed: true,
  case_status: 'completed',
  case_decision: 'approved',
  case_version: 2,
  reporting_adjustment_present: true,
  evidence_reference_safe: true,
  provider_attempt_count: 9,
  customer_delivery_count: 7,
  gmail_outbound_count: 2,
  reporting_adjustment_count: 2,
  ...overrides,
});

const baseline = {
  providerAttempts: 8,
  customerDeliveries: 7,
  gmailOutbound: 2,
  reportingAdjustments: 1,
  caseStatus: 'correlated',
  caseDecision: null,
  caseVersion: 1,
};

test('dry-run validates without a TOTP or raw write credentials', () => {
  const validated = validateNayaxControlledPilotConfig(baseConfig());
  assert.equal(Object.hasOwn(validated, 'totpCode'), false);
  assert.equal(validated.requestWriteToken, '');
  assert.equal(validated.contractDigest, sha256Hex(contract));
});

test('live configuration requires the exact private-owner confirmation', () => {
  assert.throws(
    () => validateNayaxControlledPilotConfig(baseConfig('live')),
    (error) => error.code === 'live_confirmation_missing',
  );
});

test('live configuration rejects the QA host even when the generic confirmation is exact', () => {
  const qaContract = JSON.stringify({
    ...JSON.parse(contract), baseUrl: 'https://qa-lynx.nayax.com/operational/v1',
  });
  assert.throws(
    () => validateNayaxControlledPilotConfig({
      ...baseConfig('live'),
      liveConfirmation:
        'I_AUTHORIZE_ONE_SELF_OWNED_PROVIDER_ONLY_NAYAX_TRANSACTION_NO_RETRY',
      providerContractJson: qaContract,
      writtenContractDigest: sha256Hex(qaContract),
    }),
    (error) => error.code === 'provider_contract_host_invalid',
  );
});

test('owner-expected provider email requires an exact observable consent confirmation', () => {
  const consentContract = JSON.stringify({
    ...JSON.parse(contract), providerEmailBehavior: 'owner_consented_expected',
  });
  const configured = {
    ...baseConfig('live'),
    liveConfirmation:
      'I_AUTHORIZE_ONE_SELF_OWNED_PROVIDER_ONLY_NAYAX_TRANSACTION_NO_RETRY',
    providerContractJson: consentContract,
    writtenContractDigest: sha256Hex(consentContract),
  };
  assert.throws(
    () => validateNayaxControlledPilotConfig(configured),
    (error) => error.code === 'provider_email_consent_missing',
  );
  const validated = validateNayaxControlledPilotConfig({
    ...configured,
    providerEmailConfirmation:
      'I_EXPECT_AND_CONSENT_TO_NAYAX_PROVIDER_EMAIL_FOR_MY_SELF_OWNED_TRANSACTION',
  });
  assert.equal(validated.contract.providerEmailBehavior, 'owner_consented_expected');
});

test('initialize uses a pre-existing idempotency digest and no raw idempotency secret', () => {
  const config = {
    ...baseConfig('initialize'),
    anonKey: '', ownerUserJwt: '', ownerEmailDigest: '',
    ownerCaseEvidenceDigest: '', selfCaseAttestationDigest: '',
    requestWriteToken: 'request-write-token-value-123456789',
    approveWriteToken: 'approve-write-token-value-123456789',
    requestWriteTokenDigest: '', approveWriteTokenDigest: '',
    executorAssertion: 'x'.repeat(48),
    executorAssertionDigest: sha256Hex('x'.repeat(48)),
    initializeConfirmation:
      'I_INITIALIZE_DEFAULT_OFF_NAYAX_PILOT_SECRETS_AND_RECONCILE_RELEASE_METADATA',
  };
  assert.equal(validateNayaxControlledPilotConfig(config).idempotencySecretDigest, digest('6'));
  assert.equal(Object.hasOwn(config, 'idempotencySecret'), false);
});

test('classification uses historical baselines and accepts one exact provider-only success', () => {
  assert.deepEqual(
    classifyNayaxControlledPilotPostflight({ baseline, row: postflight() }),
    {
      ok: true, effectsClassification: 'complete_exact', noReplay: true,
      providerHold: false, manualReconciliationRequired: false,
      providerAttemptCount: 1, requestCount: 1, approvalCount: 1,
      customerDeliveryDelta: 0, gmailOutboundDelta: 0, providerOnly: true,
    },
  );
});

test('definite provider rejection is terminal and not an ambiguous incident', () => {
  const result = classifyNayaxControlledPilotPostflight({
    baseline,
    row: postflight({
      attempt_status: 'declined', provider_outcome: 'rejected',
      stage_count: 2, stage_sequence: 'request_started,request_result',
      case_completed: false, reporting_adjustment_present: false,
      reporting_adjustment_count: 1,
    }),
  });
  assert.equal(result.effectsClassification, 'terminal_rejected');
  assert.equal(result.providerHold, false);
  assert.equal(result.noReplay, true);
});

test('a failed/unknown outward delta is a manual reconciliation incident', () => {
  const result = classifyNayaxControlledPilotPostflight({
    baseline, row: postflight({ customer_delivery_count: 8 }),
  });
  assert.equal(result.effectsClassification, 'partial_incident');
  assert.equal(result.manualReconciliationRequired, true);
});

test('controller dry-run performs only state, identity, and owner preflight reads', async () => {
  const calls = [];
  const clients = {
    readOperationalState: async () => (calls.push('state'), operationalState),
    authIdentity: async () => (calls.push('identity'), {
      userId: '43000000-0000-4000-8000-000000000002', emailDigest: digest('1'),
    }),
    preflight: async () => (calls.push('preflight'), preflightRow),
  };
  const result = await executeNayaxControlledPilot({ config: baseConfig(), clients });
  assert.equal(result.ok, true);
  assert.equal(result.authorizationCreated, false);
  assert.deepEqual(calls, ['state', 'identity', 'preflight']);
});

test('controller live sends one POST and closes only after exact atomic reservation', async () => {
  const calls = [];
  const config = {
    ...baseConfig('live'),
    liveConfirmation: 'I_AUTHORIZE_ONE_SELF_OWNED_PROVIDER_ONLY_NAYAX_TRANSACTION_NO_RETRY',
  };
  const clients = {
    readOperationalState: async () => (calls.push('state'), operationalState),
    authIdentity: async () => (calls.push('identity'), {
      userId: '43000000-0000-4000-8000-000000000002', emailDigest: digest('1'),
    }),
    preflight: async () => (calls.push('preflight'), preflightRow),
    authorize: async () => (calls.push('authorize'), {
      intentId: '43000000-0000-4000-8000-000000000003',
    }),
    execute: async () => (calls.push('execute'), { confirmed: true }),
    cancel: async () => (calls.push('cancel'), { closed: true }),
    postflight: async () => (calls.push('postflight'), postflight()),
  };
  const result = await executeNayaxControlledPilot({
    config, clients,
    sleep: async () => {},
    readFreshTotp: async () => (calls.push('totp'), '123456'),
    authorizationIdFactory: () => '43000000-0000-4000-8000-000000000004',
  });
  assert.equal(result.effectsClassification, 'complete_exact');
  assert.equal(calls.filter((value) => value === 'execute').length, 1);
  assert.deepEqual(calls.slice(0, 6), [
    'state', 'identity', 'preflight', 'authorize', 'totp', 'execute',
  ]);
  assert.equal(calls.indexOf('totp') > calls.indexOf('authorize'), true);
  assert.equal(calls.indexOf('totp') < calls.indexOf('execute'), true);
  assert.equal(calls.indexOf('cancel') < calls.indexOf('postflight'), true);
});

test('invalid fresh TOTP closes the armed pilot with zero provider calls and no replay', async () => {
  const config = {
    ...baseConfig('live'),
    liveConfirmation: 'I_AUTHORIZE_ONE_SELF_OWNED_PROVIDER_ONLY_NAYAX_TRANSACTION_NO_RETRY',
  };
  let providerCalls = 0;
  let promptCalls = 0;
  let closeCalls = 0;
  const noEffect = postflight({
    pilot_status: 'cancelled', attempt_status: null, provider_outcome: null,
    stage_count: 0, stage_sequence: null, case_completed: false,
    case_status: 'correlated', case_decision: null, case_version: 1,
    reporting_adjustment_present: false, evidence_reference_safe: false,
    provider_attempt_count: 8, reporting_adjustment_count: 1,
  });
  await assert.rejects(() => executeNayaxControlledPilot({
    config,
    authorizationIdFactory: () => '43000000-0000-4000-8000-000000000004',
    readFreshTotp: async () => { promptCalls += 1; return '12'; },
    sleep: async () => {},
    clients: {
      readOperationalState: async () => operationalState,
      authIdentity: async () => ({
        userId: '43000000-0000-4000-8000-000000000002', emailDigest: digest('1'),
      }),
      preflight: async () => preflightRow,
      authorize: async () => ({
        intentId: '43000000-0000-4000-8000-000000000003',
      }),
      execute: async () => { providerCalls += 1; return { confirmed: true }; },
      cancel: async () => { closeCalls += 1; return { closed: true }; },
      postflight: async () => noEffect,
    },
  }), (error) => error.code === 'fresh_totp_invalid' &&
    error.details.effectsClassification === 'no_effect' &&
    error.details.gatesConclusivelyClosed === true);
  assert.equal(promptCalls, 1);
  assert.equal(providerCalls, 0);
  assert.equal(closeCalls, 1);
});

for (const [label, promptCode] of [
  ['non-TTY prompt rejection', 'private_totp_tty_required'],
  ['private prompt timeout', 'private_totp_timeout'],
]) {
  test(`${label} closes the armed pilot with zero provider calls`, async () => {
    const config = {
      ...baseConfig('live'),
      liveConfirmation: 'I_AUTHORIZE_ONE_SELF_OWNED_PROVIDER_ONLY_NAYAX_TRANSACTION_NO_RETRY',
    };
    let providerCalls = 0;
    let closeCalls = 0;
    const noEffect = postflight({
      pilot_status: 'cancelled', attempt_status: null, provider_outcome: null,
      stage_count: 0, stage_sequence: null, case_completed: false,
      case_status: 'correlated', case_decision: null, case_version: 1,
      reporting_adjustment_present: false, evidence_reference_safe: false,
      provider_attempt_count: 8, reporting_adjustment_count: 1,
    });
    await assert.rejects(() => executeNayaxControlledPilot({
      config,
      authorizationIdFactory: () => '43000000-0000-4000-8000-000000000004',
      readFreshTotp: async () => { throw new NayaxControlledPilotRunnerError(promptCode); },
      sleep: async () => {},
      clients: {
        readOperationalState: async () => operationalState,
        authIdentity: async () => ({
          userId: '43000000-0000-4000-8000-000000000002', emailDigest: digest('1'),
        }),
        preflight: async () => preflightRow,
        authorize: async () => ({
          intentId: '43000000-0000-4000-8000-000000000003',
        }),
        execute: async () => { providerCalls += 1; return { confirmed: true }; },
        cancel: async () => { closeCalls += 1; return { closed: true }; },
        postflight: async () => noEffect,
      },
    }), (error) => error.code === promptCode &&
      error.details.effectsClassification === 'no_effect' &&
      error.details.gatesConclusivelyClosed === true);
    assert.equal(providerCalls, 0);
    assert.equal(closeCalls, 1);
  });
}

test('private packet uses canonical outside-repo authority and rejects TOTP fields', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nayax-pilot-config-'));
  const packetPath = path.join(temporaryRoot, 'pilot.env');
  const linkedRepo = path.join(temporaryRoot, 'repo-link');
  fs.writeFileSync(packetPath, 'REFUND_NAYAX_PILOT_PROJECT_REF=packet-project\n', 'utf8');
  const previousAmbient = process.env.REFUND_NAYAX_PILOT_PROJECT_REF;
  process.env.REFUND_NAYAX_PILOT_PROJECT_REF = 'ambient-project';
  try {
    assert.equal(
      loadNayaxControlledPilotEnvironment(packetPath).REFUND_NAYAX_PILOT_PROJECT_REF,
      'packet-project',
    );
    assert.throws(
      () => loadNayaxControlledPilotEnvironment('.env.example'),
      (error) => error.code === 'env_file_path_invalid',
    );
    fs.symlinkSync(repoRoot, linkedRepo, 'junction');
    assert.throws(
      () => loadNayaxControlledPilotEnvironment(path.join(linkedRepo, '.env.example')),
      (error) => error.code === 'env_file_path_invalid',
    );
    assert.throws(
      () => parseNayaxControlledPilotEnvFile('REFUND_NAYAX_PILOT_TOTP_CODE=123456\n'),
      (error) => error.code === 'env_file_invalid',
    );
  } finally {
    if (previousAmbient === undefined) delete process.env.REFUND_NAYAX_PILOT_PROJECT_REF;
    else process.env.REFUND_NAYAX_PILOT_PROJECT_REF = previousAmbient;
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('hard-crash recovery requires no case handle and proves every provider surface closed', async () => {
  const config = {
    ...baseConfig('recover'), anonKey: '', ownerUserJwt: '',
    recoveryConfirmation:
      'I_RECOVER_EXPIRED_NAYAX_PILOT_WITH_NO_PROVIDER_REPLAY',
  };
  const calls = [];
  const result = await executeNayaxControlledPilot({
    config,
    clients: {
      recoverExpired: async () => (calls.push('recover'), {
        closed: true, cancelledAuthorizationCount: 1,
        disabledMachineCount: 1, revokedCallerCount: 1,
        consumedAttemptCount: 0, providerCallCountStatus: 'proven_zero',
        payloadRedacted: true,
      }),
      recoveryState: async () => (calls.push('readback'), {
        database_owner_session: true, payload_redacted: true,
        armed_authorization_count: 0, unsettled_consumed_count: 0,
        historical_consumed_count: 0,
        active_provider_caller_count: 0, enabled_nayax_machine_count: 0,
        configured_machine_cap_count: 0, unresolved_provider_attempt_count: 0,
        durable_closure_count: 1,
      }),
    },
  });
  assert.equal(result.providerCallCount, 0);
  assert.equal(result.providerCallCountStatus, 'proven_zero');
  assert.deepEqual(calls, ['recover', 'readback']);
});

test('hard-crash recovery closes an expired consumed worker as a no-replay provider hold', async () => {
  const config = {
    ...baseConfig('recover'), anonKey: '', ownerUserJwt: '',
    recoveryConfirmation: 'I_RECOVER_EXPIRED_NAYAX_PILOT_WITH_NO_PROVIDER_REPLAY',
  };
  const result = await executeNayaxControlledPilot({
    config,
    clients: {
      recoverExpired: async () => ({
        closed: true, cancelledAuthorizationCount: 0,
        disabledMachineCount: 1, revokedCallerCount: 1,
        consumedAttemptCount: 1, providerCallCountStatus: 'unknown',
        providerHold: true,
        manualReconciliationRequired: true, payloadRedacted: true,
      }),
      recoveryState: async () => ({
        database_owner_session: true, payload_redacted: true,
        armed_authorization_count: 0, unsettled_consumed_count: 0,
        historical_consumed_count: 1,
        active_provider_caller_count: 0, enabled_nayax_machine_count: 0,
        configured_machine_cap_count: 0, unresolved_provider_attempt_count: 1,
        durable_closure_count: 1,
      }),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.effectsClassification, 'outcome_unknown');
  assert.equal(result.consumedAttemptCount, 1);
  assert.equal(result.providerCallCountStatus, 'unknown');
  assert.equal(Object.hasOwn(result, 'providerCallCount'), false);
  assert.equal(result.providerHold, true);
  assert.equal(result.manualReconciliationRequired, true);
  assert.equal(result.noReplay, true);
});

test('repeated recovery preserves every terminal consumed pilot as unknown history', async () => {
  const config = {
    ...baseConfig('recover'), anonKey: '', ownerUserJwt: '',
    recoveryConfirmation: 'I_RECOVER_EXPIRED_NAYAX_PILOT_WITH_NO_PROVIDER_REPLAY',
  };
  for (const terminalHistory of ['success', 'rejected', 'forced_unknown_resolved']) {
    const result = await executeNayaxControlledPilot({
      config,
      clients: {
        recoverExpired: async () => ({
          closed: true, cancelledAuthorizationCount: 0,
          disabledMachineCount: 0, revokedCallerCount: 0,
          consumedAttemptCount: 1, providerCallCountStatus: 'unknown',
          providerHold: true, manualReconciliationRequired: true,
          payloadRedacted: true,
        }),
        recoveryState: async () => ({
          database_owner_session: true, payload_redacted: true,
          armed_authorization_count: 0, unsettled_consumed_count: 0,
          historical_consumed_count: 1,
          active_provider_caller_count: 0, enabled_nayax_machine_count: 0,
          configured_machine_cap_count: 0, unresolved_provider_attempt_count: 0,
          durable_closure_count: 1,
        }),
      },
    });
    assert.equal(result.ok, false, terminalHistory);
    assert.equal(result.providerCallCountStatus, 'unknown', terminalHistory);
    assert.equal(Object.hasOwn(result, 'providerCallCount'), false, terminalHistory);
  }
});

test('initialization and retirement use fixed owner safety reads without Auth or provider calls', async () => {
  const initialize = {
    ...baseConfig('initialize'), anonKey: '', ownerUserJwt: '',
    ownerEmailDigest: '', ownerCaseEvidenceDigest: '',
    selfCaseAttestationDigest: '',
    requestWriteToken: 'request-write-token-value-123456789',
    approveWriteToken: 'approve-write-token-value-123456789',
    requestWriteTokenDigest: '', approveWriteTokenDigest: '',
    executorAssertion: 'x'.repeat(48),
    executorAssertionDigest: sha256Hex('x'.repeat(48)),
    initializeConfirmation:
      'I_INITIALIZE_DEFAULT_OFF_NAYAX_PILOT_SECRETS_AND_RECONCILE_RELEASE_METADATA',
  };
  const initialized = await executeNayaxControlledPilot({
    config: initialize,
    clients: {
      readOperationalState: async () => ({
        ...operationalState,
        edge: {
          ...operationalState.edge,
          pilotSecretsAligned: false,
          pilotSecretsAbsent: true,
          idempotencyDigestMatches: true,
          safeBaselineCaps: true,
        },
      }),
      initializationState: async () => initializationDatabaseState,
      initializePilotSecrets: async () => ({
      initialized: true, metadataReconciliationRequired: true,
      closedStateVerified: true,
      }),
    },
  });
  assert.equal(initialized.metadataReconciliationRequired, true);

  const retired = await executeNayaxControlledPilot({
    config: {
      ...baseConfig('retire'), anonKey: '', ownerUserJwt: '',
      retireConfirmation:
        'I_RETIRE_NAYAX_PILOT_WRITE_SECRETS_AND_RECONCILE_RELEASE_METADATA',
    },
    clients: {
      recoveryState: async () => ({
        database_owner_session: true, payload_redacted: true,
        armed_authorization_count: 0, unsettled_consumed_count: 0,
        active_provider_caller_count: 0, enabled_nayax_machine_count: 0,
        configured_machine_cap_count: 0, unresolved_provider_attempt_count: 0,
        durable_closure_count: 1,
      }),
      retirePilotSecrets: async () => ({
        retired: true, metadataReconciliationRequired: true,
        closedStateVerified: true,
      }),
    },
  });
  assert.equal(retired.retired, true);
});

test('initialization stops before the secret write on any owner-DB drift', async () => {
  const config = {
    ...baseConfig('initialize'), anonKey: '', ownerUserJwt: '',
    ownerEmailDigest: '', ownerCaseEvidenceDigest: '',
    selfCaseAttestationDigest: '',
    requestWriteToken: 'request-write-token-value-123456789',
    approveWriteToken: 'approve-write-token-value-123456789',
    requestWriteTokenDigest: '', approveWriteTokenDigest: '',
    executorAssertion: 'x'.repeat(48),
    executorAssertionDigest: sha256Hex('x'.repeat(48)),
    initializeConfirmation:
      'I_INITIALIZE_DEFAULT_OFF_NAYAX_PILOT_SECRETS_AND_RECONCILE_RELEASE_METADATA',
  };
  let wrote = false;
  await assert.rejects(() => executeNayaxControlledPilot({
    config,
    clients: {
      readOperationalState: async () => ({
        ...operationalState,
        edge: {
          ...operationalState.edge, pilotSecretsAligned: false,
          pilotSecretsAbsent: true, idempotencyDigestMatches: true,
          safeBaselineCaps: true,
        },
      }),
      initializationState: async () => ({
        ...initializationDatabaseState, unresolved_provider_attempt_count: 1,
      }),
      initializePilotSecrets: async () => { wrote = true; },
    },
  }), (error) => error.code === 'pilot_initialization_database_state_invalid');
  assert.equal(wrote, false);
});

test('initialization binds the selected machine evidence to its account secret suffix before writing', async () => {
  const config = {
    ...baseConfig('initialize'), anonKey: '', ownerUserJwt: '', ownerEmailDigest: '',
    ownerCaseEvidenceDigest: '', selfCaseAttestationDigest: '',
    requestWriteToken: 'request-write-token-value-123456789',
    approveWriteToken: 'approve-write-token-value-123456789',
    requestWriteTokenDigest: '', approveWriteTokenDigest: '',
    executorAssertion: 'x'.repeat(48),
    executorAssertionDigest: sha256Hex('x'.repeat(48)),
    initializeConfirmation:
      'I_INITIALIZE_DEFAULT_OFF_NAYAX_PILOT_SECRETS_AND_RECONCILE_RELEASE_METADATA',
  };
  let secretWrites = 0;
  await assert.rejects(() => executeNayaxControlledPilot({
    config,
    clients: {
      readOperationalState: async () => ({
        ...operationalState,
        edge: { ...operationalState.edge, pilotSecretsAligned: false,
          pilotSecretsAbsent: true, idempotencyDigestMatches: true,
          safeBaselineCaps: true },
      }),
      initializationState: async () => ({
        ...initializationDatabaseState,
        account_key_digest: digest('f'),
      }),
      initializePilotSecrets: async () => { secretWrites += 1; },
    },
  }), (error) => error.code === 'pilot_initialization_machine_account_binding_invalid');
  assert.equal(secretWrites, 0);
});

test('retirement with no prior authorization first writes the no-target closure', async () => {
  const config = {
    ...baseConfig('retire'), anonKey: '', ownerUserJwt: '',
    retireConfirmation:
      'I_RETIRE_NAYAX_PILOT_WRITE_SECRETS_AND_RECONCILE_RELEASE_METADATA',
  };
  const calls = [];
  let reads = 0;
  const result = await executeNayaxControlledPilot({
    config,
    clients: {
      recoveryState: async () => {
        calls.push('state'); reads += 1;
        return {
          database_owner_session: true, payload_redacted: true,
          armed_authorization_count: 0, unsettled_consumed_count: 0,
          active_provider_caller_count: 0, enabled_nayax_machine_count: 0,
          configured_machine_cap_count: 0, unresolved_provider_attempt_count: 0,
          durable_closure_count: reads === 1 ? 0 : 1,
        };
      },
      recoverExpired: async () => (calls.push('recover'), { closed: true }),
      retirePilotSecrets: async () => (calls.push('retire'), {
        retired: true, metadataReconciliationRequired: true,
      }),
    },
  });
  assert.equal(result.retired, true);
  assert.deepEqual(calls, ['state', 'recover', 'state', 'retire']);
});

test('retirement refuses an active or unsettled consumed lane before secret deletion', async () => {
  const config = {
    ...baseConfig('retire'), anonKey: '', ownerUserJwt: '',
    retireConfirmation:
      'I_RETIRE_NAYAX_PILOT_WRITE_SECRETS_AND_RECONCILE_RELEASE_METADATA',
  };
  let retired = false;
  await assert.rejects(() => executeNayaxControlledPilot({
    config,
    clients: {
      recoveryState: async () => ({
        database_owner_session: true, payload_redacted: true,
        armed_authorization_count: 0, unsettled_consumed_count: 1,
        active_provider_caller_count: 1, enabled_nayax_machine_count: 1,
        configured_machine_cap_count: 1, unresolved_provider_attempt_count: 1,
        durable_closure_count: 0,
      }),
      retirePilotSecrets: async () => { retired = true; },
    },
  }), (error) => error.code === 'pilot_retirement_lane_active');
  assert.equal(retired, false);
});

test('known provider effects survive a separate close/readback failure', async () => {
  const config = {
    ...baseConfig('live'),
    liveConfirmation: 'I_AUTHORIZE_ONE_SELF_OWNED_PROVIDER_ONLY_NAYAX_TRANSACTION_NO_RETRY',
  };
  let postflightReads = 0;
  await assert.rejects(() => executeNayaxControlledPilot({
    config,
    authorizationIdFactory: () => '43000000-0000-4000-8000-000000000004',
    sleep: async () => {},
    readFreshTotp: async () => '123456',
    clients: {
      readOperationalState: async () => operationalState,
      authIdentity: async () => ({
        userId: '43000000-0000-4000-8000-000000000002', emailDigest: digest('1'),
      }),
      preflight: async () => preflightRow,
      authorize: async () => ({
        intentId: '43000000-0000-4000-8000-000000000003',
      }),
      execute: async () => ({ confirmed: true }),
      cancel: async () => { throw new Error('redacted'); },
      postflight: async () => {
        postflightReads += 1;
        if (postflightReads <= 2) throw new Error('redacted');
        return postflight();
      },
    },
  }), (error) => {
    assert.equal(error.details.effectsClassification, 'complete_exact');
    assert.equal(error.details.gatesConclusivelyClosed, false);
    assert.equal(error.details.providerAttemptCount, 1);
    return true;
  });
});

test('an active provider worker lease can never be reported conclusively closed', async () => {
  const config = {
    ...baseConfig('live'),
    liveConfirmation: 'I_AUTHORIZE_ONE_SELF_OWNED_PROVIDER_ONLY_NAYAX_TRANSACTION_NO_RETRY',
  };
  let clock = Date.now();
  let cancelCalls = 0;
  await assert.rejects(() => executeNayaxControlledPilot({
    config,
    authorizationIdFactory: () => '43000000-0000-4000-8000-000000000004',
    now: () => { clock += 300_000; return clock; },
    sleep: async () => {},
    readFreshTotp: async () => '123456',
    clients: {
      readOperationalState: async () => operationalState,
      authIdentity: async () => ({
        userId: '43000000-0000-4000-8000-000000000002', emailDigest: digest('1'),
      }),
      preflight: async () => preflightRow,
      authorize: async () => ({ intentId: '43000000-0000-4000-8000-000000000003' }),
      execute: async () => { throw new NayaxControlledPilotRunnerError('edge_response_ambiguous'); },
      cancel: async () => { cancelCalls += 1; return { closed: false, status: 'worker_active' }; },
      postflight: async () => postflight({
        pilot_status: 'consumed', attempt_status: 'in_progress',
        provider_outcome: null, reconciliation_required: false,
        stage_count: 1, stage_sequence: 'request_started',
        case_completed: false, reporting_adjustment_present: false,
        reporting_adjustment_count: 1,
        worker_terminal_acknowledged: false, worker_active: true,
        worker_terminal_status: null, exact_closure_count: 0,
      }),
    },
  }), (error) => error.details.gatesConclusivelyClosed === false &&
    error.details.providerHold === true && error.details.noReplay === true);
  assert.equal(cancelCalls, 2);
});

test('aborted reconciliation exits without accumulating a sleeping poll', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 0);
  const result = await reconcileNayaxControlledPilot({
    client: { postflight: async () => postflight({
      pilot_status: 'consumed', attempt_status: 'in_progress',
      provider_outcome: null, reconciliation_required: false,
      stage_count: 1, stage_sequence: 'request_started',
      case_completed: false, reporting_adjustment_present: false,
      reporting_adjustment_count: 1,
    }) },
    authorizationId: '43000000-0000-4000-8000-000000000004',
    baseline,
    deadlineMs: Date.now() + 60_000,
    signal: controller.signal,
    sleep: async () => new Promise(() => {}),
  });
  assert.equal(result.effectsClassification, 'partial_incident');
  assert.equal(controller.signal.aborted, true);
});

test('sanitized failures never include private identifiers or provider payloads', () => {
  const error = new NayaxControlledPilotRunnerError('pilot_failed', {
    caseId: 'private', token: 'private',
  });
  assert.deepEqual(Object.keys(error).sort(), ['code', 'details', 'name']);
});

test('failure output retains only the fixed provider-email behavior enum', () => {
  const safe = selectNayaxControlledPilotFailureDetails({
    providerEmailBehavior: 'owner_consented_expected',
    providerHold: true,
    token: 'private',
    providerBody: { private: true },
  });
  assert.deepEqual(safe, {
    providerHold: true,
    providerEmailBehavior: 'owner_consented_expected',
  });
  assert.equal(Object.hasOwn(selectNayaxControlledPilotFailureDetails({
    providerEmailBehavior: 'private-unrecognized-value',
  }), 'providerEmailBehavior'), false);
});
