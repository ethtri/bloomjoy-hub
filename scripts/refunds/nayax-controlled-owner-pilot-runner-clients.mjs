import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertSyntheticGmailProofProductionAligned,
  getSyntheticGmailProofGithubVariable,
} from './refund-synthetic-gmail-proof-runner-clients.mjs';
import { evaluateBackupHealth } from './refund-synthetic-gmail-proof-runner-lib.mjs';
import {
  NAYAX_CONTROLLED_PILOT_PROJECT_REF,
  NayaxControlledPilotRunnerError,
  sha256Hex,
} from './nayax-controlled-owner-pilot-runner-lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const fail = (code) => { throw new NayaxControlledPilotRunnerError(code); };
const OWNER_SQL = `current_user = pg_catalog.pg_get_userbyid(database.datdba)
  and session_user = pg_catalog.pg_get_userbyid(database.datdba)`;
const MANAGEMENT_REQUEST_TIMEOUT_MS = 15_000;
const SQL_MUTATION_PATTERN =
  /\b(?:alter|analyze|begin|call|checkpoint|cluster|comment|commit|copy|create|deallocate|delete|discard|do|drop|execute|grant|insert|into|listen|lock|merge|move|notify|perform|prepare|reassign|refresh|reindex|reset|revoke|rollback|set|truncate|unlisten|update|vacuum)\b|\b(?:nextval|setval|pg_notify|dblink|lo_import|lo_export)\s*\(/iu;

const QUERIES = Object.freeze({
  initializationState: Object.freeze({ readOnly: false, parameterCount: 4, sql: `
with gate as (
  select public.service_preflight_refund_gmail_intake_shadow(
    false, 'refund_gmail_retention_v1', false, false, ''
  ) as value
), exact_machine as (
  select refund_case.id as case_id, refund_case.payment_amount_cents,
    machine.id as machine_id, machine.status as machine_status,
    machine.nayax_machine_id, machine.nayax_account_key,
    machine.nayax_refunds_enabled, machine.nayax_refund_max_amount_cents,
    encode(extensions.digest(convert_to(concat_ws('|',
      machine.id::text, machine.nayax_machine_id, machine.nayax_account_key,
      refund_case.payment_amount_cents::text
    ), 'UTF8'), 'sha256'), 'hex') as machine_evidence_digest,
    encode(extensions.digest(convert_to(
      upper(regexp_replace(btrim(machine.nayax_account_key), '[^A-Za-z0-9_]', '_', 'g')),
      'UTF8'
    ), 'sha256'), 'hex') as account_key_digest
  from public.refund_cases refund_case
  join public.reporting_machines machine
    on machine.id = refund_case.reporting_machine_id
  where refund_case.id = $1::uuid
)
select
  ${OWNER_SQL} as database_owner_session,
  true as payload_redacted,
  public.refund_official_actions_enabled() as official_actions_enabled,
  public.refund_nayax_outcome_resolution_enabled() as resolution_enabled,
  (gate.value ->> 'automaticCustomerContactEnabled')::boolean
    as automatic_customer_contact_enabled,
  (gate.value ->> 'gptTriageEnabled')::boolean as gpt_triage_enabled,
  (gate.value ->> 'gptAutoSendEnabled')::boolean as gpt_auto_send_enabled,
  (gate.value ->> 'activeProofAuthorizationCount')::integer
    as active_proof_authorization_count,
  (gate.value ->> 'unresolvedGmailOutboundCount')::integer
    as unresolved_gmail_outbound_count,
  (gate.value ->> 'unresolvedFirstContactCount')::integer
    as unresolved_first_contact_count,
  (gate.value ->> 'overdueCleanupObligationCount')::integer
    as overdue_cleanup_obligation_count,
  (select count(*) from public.refund_case_official_action_authorizations
    where status = 'authorized' and consumed_at is null)
    as active_official_authorization_count,
  (select count(*) from public.refund_manager_action_step_up_intents
    where status = 'pending') as pending_step_up_intent_count,
  (select count(*) from public.refund_nayax_provider_callers
    where status = 'active') as active_provider_caller_count,
  (select count(*) from public.reporting_machines
    where nayax_refunds_enabled) as enabled_nayax_machine_count,
  (select count(*) from public.reporting_machines
    where nayax_refund_max_amount_cents is not null)
    as configured_machine_cap_count,
  (select count(*) from public.refund_case_nayax_refund_attempts
    where status = 'in_progress' or reconciliation_required)
    as unresolved_provider_attempt_count,
  (select count(*) from public.refund_nayax_resolution_operators
    where status = 'active' and revoked_at is null) as resolution_operator_count,
  (select count(*) from public.refund_nayax_resolution_intents
    where status = 'pending') as resolution_intent_count,
  (select count(*) from exact_machine
    where machine_status = 'active'
      and nayax_refunds_enabled = false
      and nayax_refund_max_amount_cents is null
      and payment_amount_cents = $4::integer
      and machine_evidence_digest = $2::text
      and account_key_digest = $3::text) as exact_machine_account_binding_count,
  (select machine_evidence_digest from exact_machine) as machine_evidence_digest,
  (select account_key_digest from exact_machine) as account_key_digest
from pg_catalog.pg_database database cross join gate
where database.datname = pg_catalog.current_database()
` }),
  preflight: Object.freeze({ readOnly: false, parameterCount: 2, sql: `
with gate as (
  select public.service_preflight_refund_gmail_intake_shadow(
    false, 'refund_gmail_retention_v1', false, false, ''
  ) as value
), exact_case as (
  select refund_case.*, machine.id as exact_machine_id,
    machine.nayax_machine_id as exact_nayax_machine_id,
    machine.nayax_account_key as exact_nayax_account_key,
    machine.nayax_refunds_enabled as exact_nayax_refunds_enabled,
    machine.nayax_refund_max_amount_cents as exact_machine_cap,
    encode(extensions.digest(convert_to(lower(btrim(refund_case.customer_email)), 'UTF8'), 'sha256'), 'hex')
      as customer_email_digest,
    encode(extensions.digest(convert_to(lower(btrim(owner_user.email)), 'UTF8'), 'sha256'), 'hex')
      as owner_email_digest,
    public.refund_nayax_controlled_pilot_self_attestation_hash(
      refund_case, machine,
      encode(extensions.digest(convert_to(lower(btrim(owner_user.email)), 'UTF8'), 'sha256'), 'hex'),
      refund_case.payment_amount_cents
    ) as self_case_attestation_digest,
    encode(extensions.digest(convert_to(
      upper(regexp_replace(btrim(machine.nayax_account_key), '[^A-Za-z0-9_]', '_', 'g')),
      'UTF8'
    ), 'sha256'), 'hex') as account_key_digest,
    public.refund_nayax_controlled_pilot_prearm_evidence_hash(
      refund_case, machine, refund_case.payment_amount_cents
    )
      as execution_evidence_hash
  from public.refund_cases refund_case
  join public.reporting_machines machine
    on machine.id = refund_case.reporting_machine_id
  join auth.users owner_user on owner_user.id = $2::uuid
  where refund_case.id = $1::uuid
), exact_shape as (
  select *,
    encode(extensions.digest(convert_to(concat_ws('|',
      id::text, exact_machine_id::text, official_action_version::text,
      refund_amount_cents::text, matched_nayax_transaction_id,
      matched_nayax_site_id::text, matched_nayax_machine_auth_time::text,
      execution_evidence_hash
    ), 'UTF8'), 'sha256'), 'hex') as case_evidence_digest,
    encode(extensions.digest(convert_to(concat_ws('|',
      exact_machine_id::text, exact_nayax_machine_id,
      exact_nayax_account_key, payment_amount_cents::text
    ), 'UTF8'), 'sha256'), 'hex') as machine_evidence_digest
  from exact_case
)
select
  ${OWNER_SQL} as database_owner_session,
  true as payload_redacted,
  public.refund_official_actions_enabled() as official_actions_enabled,
  public.refund_nayax_outcome_resolution_enabled() as resolution_enabled,
  (gate.value ->> 'activeProofAuthorizationCount')::integer
    as active_proof_authorization_count,
  (gate.value ->> 'armedDispatchAuthorizationCount')::integer
    as armed_dispatch_authorization_count,
  (gate.value ->> 'unresolvedGmailOutboundCount')::integer
    as unresolved_gmail_outbound_count,
  (gate.value ->> 'unresolvedFirstContactCount')::integer
    as unresolved_first_contact_count,
  (gate.value ->> 'automaticCustomerContactEnabled')::boolean
    as automatic_customer_contact_enabled,
  (gate.value ->> 'gptTriageEnabled')::boolean as gpt_triage_enabled,
  (gate.value ->> 'gptAutoSendEnabled')::boolean as gpt_auto_send_enabled,
  (gate.value ->> 'nayaxOperatorCount')::integer as nayax_operator_count,
  (gate.value ->> 'overdueCleanupObligationCount')::integer
    as overdue_cleanup_obligation_count,
  (gate.value ->> 'attachmentsEnabled')::boolean as attachments_enabled,
  (gate.value ->> 'scannerEnabled')::boolean as scanner_enabled,
  (select count(*) from public.refund_nayax_controlled_pilot_authorizations)
    as pilot_authorization_count,
  (select count(*) from public.refund_nayax_controlled_pilot_closures)
    as pilot_closure_count,
  (select count(*) from public.refund_case_nayax_refund_attempts)
    as provider_attempt_count,
  (select count(*) from public.refund_case_nayax_refund_attempts
    where status = 'in_progress' or reconciliation_required)
    as unresolved_provider_attempt_count,
  (select count(*) from public.refund_nayax_resolution_operators
    where status = 'active' and revoked_at is null) as resolution_operator_count,
  (select count(*) from public.refund_nayax_resolution_intents
    where status = 'pending') as resolution_intent_count,
  (select count(*) from public.refund_nayax_provider_callers)
    as provider_caller_count,
  (select count(*) from public.reporting_machines
    where nayax_refunds_enabled) as enabled_nayax_machine_count,
  (select count(*) from public.reporting_machines
    where nayax_refund_max_amount_cents is not null) as configured_machine_cap_count,
  (select count(*) from public.refund_case_official_action_authorizations
    where status = 'authorized' and consumed_at is null) as active_official_authorization_count,
  (select count(*) from public.refund_manager_action_step_up_intents
    where status = 'pending') as pending_step_up_intent_count,
  (select count(*) from public.refund_case_messages) as customer_delivery_count,
  (select count(*) from public.refund_gmail_messages
    where direction = 'outbound' and operation_key is not null) as gmail_outbound_count,
  (select count(*) from public.sales_adjustment_facts
    where adjustment_type = 'refund') as reporting_adjustment_count,
  (select count(*) from exact_shape
    where payment_method = 'card' and status = 'correlated'
      and decision is null and correlation_status = 'matched'
      and correlation_source = 'nayax' and nayax_recommendation_state = 'high_confidence'
      and nayax_match_execution_eligible and reporting_adjustment_id is null
      and matched_nayax_transaction_id ~ '^[1-9][0-9]{0,18}$'
      and payment_amount_cents = matched_nayax_amount_cents
      and matched_nayax_currency_code = 'USD') as eligible_case_count,
  (select count(*) from exact_shape
    where public.can_manage_refund_case($2::uuid, id)) as owner_manageable_case_count,
  (select count(*) from exact_shape
    where owner_email_digest = customer_email_digest) as self_owned_email_count,
  (select count(*) from exact_shape
    where exact_nayax_refunds_enabled = false and exact_machine_cap is null)
    as exact_machine_closed_count,
  (select payment_amount_cents from exact_shape) as case_amount_cents,
  (select status from exact_shape) as case_status,
  (select decision from exact_shape) as case_decision,
  (select official_action_version from exact_shape) as expected_case_version,
  (select case_evidence_digest from exact_shape) as case_evidence_digest,
  (select self_case_attestation_digest from exact_shape)
    as self_case_attestation_digest,
  (select machine_evidence_digest from exact_shape) as machine_evidence_digest,
  (select account_key_digest from exact_shape) as account_key_digest
from pg_catalog.pg_database database cross join gate
where database.datname = pg_catalog.current_database()
` }),
  authorize: Object.freeze({ readOnly: false, parameterCount: 16, sql: `
with value as (
  select public.owner_authorize_refund_nayax_controlled_pilot(
    $1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::integer,
    $6::text,$7::text,$8::text,$9::text,$10::text,$11::text,
    $12::text,$13::text,$14::text,$15::text,$16::text
  ) as result
)
select ${OWNER_SQL} as database_owner_session, value.result
from pg_catalog.pg_database database cross join value
where database.datname = pg_catalog.current_database()
` }),
  cancel: Object.freeze({ readOnly: false, parameterCount: 1, sql: `
with value as (
  select public.owner_cancel_refund_nayax_controlled_pilot($1::uuid) as result
)
select ${OWNER_SQL} as database_owner_session, value.result
from pg_catalog.pg_database database cross join value
where database.datname = pg_catalog.current_database()
` }),
  recover: Object.freeze({ readOnly: false, parameterCount: 0, sql: `
with value as (
  select public.owner_recover_expired_refund_nayax_controlled_pilot() as result
)
select ${OWNER_SQL} as database_owner_session, value.result
from pg_catalog.pg_database database cross join value
where database.datname = pg_catalog.current_database()
` }),
  recoveryState: Object.freeze({ readOnly: false, parameterCount: 0, sql: `
select
  ${OWNER_SQL} as database_owner_session,
  true as payload_redacted,
  (select count(*) from public.refund_nayax_controlled_pilot_authorizations
    where status = 'armed') as armed_authorization_count,
  (select count(*) from public.refund_nayax_controlled_pilot_authorizations
    where status = 'consumed' and settled_at is null) as unsettled_consumed_count,
  (select count(*) from public.refund_nayax_controlled_pilot_authorizations
    where status = 'consumed') as historical_consumed_count,
  (select count(*) from public.refund_nayax_provider_callers
    where status = 'active') as active_provider_caller_count,
  (select count(*) from public.reporting_machines
    where nayax_refunds_enabled) as enabled_nayax_machine_count,
  (select count(*) from public.reporting_machines
    where nayax_refund_max_amount_cents is not null) as configured_machine_cap_count,
  (select count(*) from public.refund_case_nayax_refund_attempts
    where status = 'in_progress' or reconciliation_required)
    as unresolved_provider_attempt_count,
  (select count(*) from public.refund_nayax_controlled_pilot_closures)
    as durable_closure_count
from pg_catalog.pg_database database
where database.datname = pg_catalog.current_database()
` }),
  postflight: Object.freeze({ readOnly: false, parameterCount: 1, sql: `
with pilot as (
  select * from public.refund_nayax_controlled_pilot_authorizations
  where authorization_id = $1::uuid
), exact_attempt as (
  select attempt.* from public.refund_case_nayax_refund_attempts attempt
  join pilot on pilot.provider_attempt_id = attempt.id
), exact_journal as (
  select journal.* from public.refund_nayax_controlled_pilot_stage_journal journal
  join exact_attempt on exact_attempt.id = journal.provider_attempt_id
), exact_case as (
  select refund_case.* from public.refund_cases refund_case
  join pilot on pilot.refund_case_id = refund_case.id
)
select
  ${OWNER_SQL} as database_owner_session,
  true as payload_redacted,
  public.refund_official_actions_enabled() as official_actions_enabled,
  public.refund_nayax_outcome_resolution_enabled() as resolution_enabled,
  (select count(*) from public.refund_nayax_provider_callers
    where status = 'active') as active_provider_caller_count,
  (select count(*) from public.reporting_machines
    where nayax_refunds_enabled) as enabled_nayax_machine_count,
  (select count(*) from public.reporting_machines
    where nayax_refund_max_amount_cents is not null) as configured_machine_cap_count,
  coalesce((select status from pilot),
    case when exists (
      select 1 from public.refund_nayax_controlled_pilot_closures closure
      where closure.authorization_id = $1::uuid
    )
      then 'cancelled_tombstone' else 'absent' end) as pilot_status,
  (select status from exact_attempt) as attempt_status,
  (select provider_outcome from exact_attempt) as provider_outcome,
  coalesce((select reconciliation_required from exact_attempt), false)
    as reconciliation_required,
  coalesce((select worker_terminal_at is not null from pilot), false)
    as worker_terminal_acknowledged,
  coalesce((select worker_terminal_at is null
    and worker_lease_expires_at > clock_timestamp() from pilot), false)
    as worker_active,
  (select worker_terminal_status from pilot) as worker_terminal_status,
  (select count(*) from public.refund_nayax_controlled_pilot_closures closure
    where closure.authorization_id = $1::uuid) as exact_closure_count,
  (select count(*) from exact_journal)::integer as stage_count,
  (select string_agg(stage_event, ',' order by stage_ordinal) from exact_journal)
    as stage_sequence,
  coalesce((select status = 'completed' from exact_case), false) as case_completed,
  (select status from exact_case) as case_status,
  (select decision from exact_case) as case_decision,
  (select official_action_version from exact_case) as case_version,
  coalesce((select reporting_adjustment_id is not null from exact_case), false)
    as reporting_adjustment_present,
  coalesce((select provider_reference ~ '^nayax-evidence-[a-f0-9]{64}$'
    from exact_attempt), false) as evidence_reference_safe,
  (select count(*) from public.refund_case_nayax_refund_attempts)
    as provider_attempt_count,
  (select count(*) from public.refund_case_messages) as customer_delivery_count,
  (select count(*) from public.refund_gmail_messages
    where direction = 'outbound' and operation_key is not null) as gmail_outbound_count,
  (select count(*) from public.sales_adjustment_facts
    where adjustment_type = 'refund') as reporting_adjustment_count
from pg_catalog.pg_database database
where database.datname = pg_catalog.current_database()
` }),
});

const exactObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const requestSignal = (parent, timeoutMs = 20_000) => {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  parent?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, dispose: () => {
    clearTimeout(timer); parent?.removeEventListener('abort', onAbort);
  } };
};

const secretDigest = (secrets, name) => {
  const entry = secrets.find((secret) => secret?.name === name);
  return entry ? String(entry.value ?? '').trim().toLowerCase() : null;
};
const secretBoolean = (secrets, name, { absent = false } = {}) => {
  const digest = secretDigest(secrets, name);
  if (digest === null) return absent;
  if (digest === sha256Hex('true')) return true;
  if (digest === sha256Hex('false')) return false;
  fail('edge_secret_state_unrecognized');
};
const firstContactMode = (secrets) => {
  const digest = secretDigest(secrets, 'REFUND_GMAIL_FIRST_CONTACT_MODE');
  if (digest === null) return 'absent';
  if (digest === sha256Hex('disabled')) return 'disabled';
  if (digest === sha256Hex('off')) return 'off';
  fail('first_contact_mode_not_disabled');
};

export const createNayaxControlledPilotClients = (config, {
  fetchImpl = globalThis.fetch,
  releaseCheck = assertSyntheticGmailProofProductionAligned,
} = {}) => {
  if (config.projectRef !== NAYAX_CONTROLLED_PILOT_PROJECT_REF ||
      config.confirmProjectRef !== NAYAX_CONTROLLED_PILOT_PROJECT_REF ||
      typeof fetchImpl !== 'function') fail('client_configuration_invalid');
  const managementEndpoint =
    `https://api.supabase.com/v1/projects/${config.projectRef}/database/query`;
  const secretEndpoint = `https://api.supabase.com/v1/projects/${config.projectRef}/secrets`;
  const backupEndpoint =
    `https://api.supabase.com/v1/projects/${config.projectRef}/database/backups`;
  const requestTokenName = `NAYAX_REFUND_REQUEST_WRITE_TOKEN_${config.accountKey}`;
  const approveTokenName = `NAYAX_REFUND_APPROVE_WRITE_TOKEN_${config.accountKey}`;

  const managementFetch = async (url, options, code, signal) => {
    const bounded = requestSignal(signal, MANAGEMENT_REQUEST_TIMEOUT_MS);
    try {
      let response;
      try {
        response = await fetchImpl(url, {
          ...options,
          headers: {
            Accept: 'application/json', Authorization: `Bearer ${config.managementToken}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers ?? {}),
          },
          redirect: 'error', cache: 'no-store', signal: bounded.signal,
        });
      } catch { fail(code); }
      return response;
    } finally { bounded.dispose(); }
  };

  const readSecrets = async (signal) => {
    const response = await managementFetch(secretEndpoint, { method: 'GET' },
      'edge_secret_read_failed', signal);
    if (!response.ok) fail('edge_secret_read_failed');
    let body;
    try { body = await response.json(); } catch { fail('edge_secret_read_failed'); }
    if (!Array.isArray(body)) fail('edge_secret_read_failed');
    return body;
  };

  const readBackup = async (signal) => {
    const response = await managementFetch(backupEndpoint, { method: 'GET' },
      'backup_health_read_failed', signal);
    if (!response.ok) fail('backup_health_read_failed');
    let body;
    try { body = await response.json(); } catch { fail('backup_health_read_failed'); }
    if (!evaluateBackupHealth(body)) fail('backup_not_recently_completed');
    return true;
  };

  const edgeStateFromSecrets = (secrets) => {
    const temporaryPilotNames = [
      'NAYAX_REFUND_CONTROLLED_PILOT_RUNNER_ASSERTION',
      'NAYAX_REFUND_CONTROLLED_PILOT_CONTRACT_JSON',
      requestTokenName,
      approveTokenName,
      'NAYAX_REFUND_EXECUTOR_ASSERTION',
    ];
    const expected = [
      ['NAYAX_REFUND_CONTROLLED_PILOT_RUNNER_ASSERTION', config.runnerAssertionDigest],
      ['NAYAX_REFUND_CONTROLLED_PILOT_CONTRACT_JSON', config.contractDigest],
      [requestTokenName, config.requestWriteTokenDigest],
      [approveTokenName, config.approveWriteTokenDigest],
      ['NAYAX_REFUND_IDEMPOTENCY_SECRET', config.idempotencySecretDigest],
      ['NAYAX_REFUND_EXECUTOR_ASSERTION', config.executorAssertionDigest],
      ['NAYAX_REFUND_MAX_AMOUNT_CENTS', sha256Hex(String(config.expectedAmountCents))],
      ['NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS', sha256Hex(String(config.expectedAmountCents))],
      ['NAYAX_REFUND_DAILY_COUNT_CAP', sha256Hex('1')],
    ];
    return {
      gmailEnabled: secretBoolean(secrets, 'REFUND_GMAIL_ENABLED'),
      automaticCustomerContactEnabled:
        secretBoolean(secrets, 'REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED'),
      firstContactMode: firstContactMode(secrets),
      automationEnabled: secretBoolean(secrets, 'REFUND_AUTOMATION_ENABLED'),
      managerAgingEnabled:
        secretBoolean(secrets, 'REFUND_MANAGER_AGING_NOTICES_ENABLED'),
      gmailRetentionEnabled: secretBoolean(secrets, 'REFUND_GMAIL_RETENTION_ENABLED'),
      attachmentScannerEnabled:
        secretBoolean(secrets, 'REFUND_GMAIL_ATTACHMENT_SCANNER_ENABLED'),
      gptTriageEnabled: secretBoolean(secrets, 'REFUND_GPT_TRIAGE_ENABLED'),
      nayaxExecutionEnabled: secretBoolean(secrets, 'NAYAX_REFUND_EXECUTION_ENABLED'),
      nayaxDryRun: secretBoolean(secrets, 'NAYAX_REFUND_EXECUTION_DRY_RUN'),
      nayaxKillSwitch: secretBoolean(secrets, 'NAYAX_REFUND_EXECUTION_KILL_SWITCH'),
      nayaxProviderContractConfirmed:
        secretBoolean(secrets, 'NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED'),
      nayaxSponsorGoNoGo:
        secretBoolean(secrets, 'NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO'),
      pilotSecretsAligned: expected.every(([name, digest]) =>
        secretDigest(secrets, name) === digest),
      pilotSecretsAbsent: temporaryPilotNames.every((name) =>
        secretDigest(secrets, name) === null),
      idempotencyDigestMatches:
        secretDigest(secrets, 'NAYAX_REFUND_IDEMPOTENCY_SECRET') ===
          config.idempotencySecretDigest,
      safeBaselineCaps:
        secretDigest(secrets, 'NAYAX_REFUND_MAX_AMOUNT_CENTS') === sha256Hex('1000') &&
        secretDigest(secrets, 'NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS') === sha256Hex('5000') &&
        secretDigest(secrets, 'NAYAX_REFUND_DAILY_COUNT_CAP') === sha256Hex('10'),
      // This is backed by the checked-in static validator: the runtime reads
      // only these two exact write-token names and has no lookup/reporting
      // token fallback. It is intentionally not presented as runtime telemetry.
      reportingTokenFallbackStaticallyAbsent: true,
    };
  };

  const query = async (name, parameters, signal) => {
    const operation = QUERIES[name];
    if (!operation || parameters.length !== operation.parameterCount) {
      fail('owner_query_invalid');
    }
    if (!/^\s*(?:with|select)\b/iu.test(operation.sql) ||
        SQL_MUTATION_PATTERN.test(operation.sql)) fail('owner_query_not_fixed_select');
    const bounded = requestSignal(signal);
    try {
      let response;
      try {
        response = await fetchImpl(managementEndpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json', 'Content-Type': 'application/json',
            Authorization: `Bearer ${config.managementToken}`,
          },
          body: JSON.stringify({
            query: operation.sql, parameters,
            read_only: operation.readOnly,
          }),
          redirect: 'error', cache: 'no-store', signal: bounded.signal,
        });
      } catch { fail(`owner_${name}_transport_failed`); }
      if (response.status !== 201) fail(`owner_${name}_rejected`);
      let body;
      try { body = await response.json(); } catch { fail('owner_response_invalid'); }
      if (!Array.isArray(body) || body.length !== 1 || !exactObject(body[0]) ||
          body[0].database_owner_session !== true) fail('owner_response_invalid');
      return body[0];
    } finally { bounded.dispose(); }
  };

  return Object.freeze({
    async assertReleaseAligned() {
      return await releaseCheck({
        repoRoot, projectRef: config.projectRef,
        managementToken: config.managementToken,
      });
    },
    async readOperationalState({ signal } = {}) {
      const [secrets, backupCompletedFresh, productionAligned,
        gmailSyncEnabled, gmailRetentionEnabled, automationSweepEnabled,
        gptTriageSyncEnabled] = await Promise.all([
        readSecrets(signal), readBackup(signal),
        releaseCheck({ repoRoot, projectRef: config.projectRef,
          managementToken: config.managementToken }),
        getSyntheticGmailProofGithubVariable('REFUND_GMAIL_SYNC_ENABLED', { repoRoot }),
        getSyntheticGmailProofGithubVariable('REFUND_GMAIL_RETENTION_ENABLED', { repoRoot }),
        getSyntheticGmailProofGithubVariable('REFUND_AUTOMATION_SWEEP_ENABLED', { repoRoot }),
        getSyntheticGmailProofGithubVariable('REFUND_GPT_TRIAGE_SYNC_ENABLED', { repoRoot }),
      ]);
      return {
        edge: edgeStateFromSecrets(secrets),
        github: { gmailSyncEnabled, gmailRetentionEnabled,
          automationSweepEnabled, gptTriageSyncEnabled },
        release: { productionAligned, backupCompletedFresh },
      };
    },
    initializationState: ({ signal } = {}) =>
      query('initializationState', [config.caseId, config.expectedMachineDigest,
        config.accountKeyDigest, config.expectedAmountCents], signal),
    async initializePilotSecrets({ signal } = {}) {
      let writeAccepted = false;
      try {
        const response = await managementFetch(secretEndpoint, {
          method: 'POST', body: JSON.stringify([
            { name: 'NAYAX_REFUND_CONTROLLED_PILOT_RUNNER_ASSERTION',
              value: config.runnerAssertion },
            { name: 'NAYAX_REFUND_CONTROLLED_PILOT_CONTRACT_JSON',
              value: config.providerContractJson },
            { name: requestTokenName, value: config.requestWriteToken },
            { name: approveTokenName, value: config.approveWriteToken },
            { name: 'NAYAX_REFUND_EXECUTOR_ASSERTION', value: config.executorAssertion },
            { name: 'NAYAX_REFUND_MAX_AMOUNT_CENTS',
              value: String(config.expectedAmountCents) },
            { name: 'NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS',
              value: String(config.expectedAmountCents) },
            { name: 'NAYAX_REFUND_DAILY_COUNT_CAP', value: '1' },
            { name: 'NAYAX_REFUND_EXECUTION_ENABLED', value: 'false' },
            { name: 'NAYAX_REFUND_EXECUTION_DRY_RUN', value: 'true' },
            { name: 'NAYAX_REFUND_EXECUTION_KILL_SWITCH', value: 'true' },
            { name: 'NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED', value: 'false' },
            { name: 'NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO', value: 'false' },
          ]),
        }, 'pilot_secret_initialize_ambiguous', signal);
        writeAccepted = [200, 201].includes(response.status);
      } catch {
        // A timed-out Management request may have committed. Read back once;
        // never retry the write or infer state from the client response.
      }
      let secrets;
      try { secrets = await readSecrets(signal); } catch {
        throw new NayaxControlledPilotRunnerError('pilot_secret_state_unknown', {
          metadataReconciliationRequired: true, closedStateVerified: false,
        });
      }
      const aligned = edgeStateFromSecrets(secrets).pilotSecretsAligned === true;
      if (!aligned) {
        throw new NayaxControlledPilotRunnerError('pilot_secret_initialize_failed', {
          metadataReconciliationRequired: true, closedStateVerified: false,
        });
      }
      return { initialized: true, writeAccepted, metadataReconciliationRequired: true,
        closedStateVerified: true, payloadRedacted: true };
    },
    async retirePilotSecrets({ signal } = {}) {
      const retiredNames = [
        'NAYAX_REFUND_CONTROLLED_PILOT_RUNNER_ASSERTION',
        'NAYAX_REFUND_CONTROLLED_PILOT_CONTRACT_JSON',
        requestTokenName,
        approveTokenName,
        'NAYAX_REFUND_EXECUTOR_ASSERTION',
      ];
      let deleteAccepted = false;
      let safeCapsAccepted = false;
      try {
        const response = await managementFetch(secretEndpoint, {
          method: 'DELETE', body: JSON.stringify(retiredNames),
        }, 'pilot_secret_retire_ambiguous', signal);
        deleteAccepted = [200, 201, 204].includes(response.status);
      } catch {
        // The deletion may have committed. Never retry; continue to safe caps
        // and an exact digest-only readback.
      }
      try {
        const response = await managementFetch(secretEndpoint, {
          method: 'POST', body: JSON.stringify([
            { name: 'NAYAX_REFUND_MAX_AMOUNT_CENTS', value: '1000' },
            { name: 'NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS', value: '5000' },
            { name: 'NAYAX_REFUND_DAILY_COUNT_CAP', value: '10' },
            { name: 'NAYAX_REFUND_EXECUTION_ENABLED', value: 'false' },
            { name: 'NAYAX_REFUND_EXECUTION_DRY_RUN', value: 'true' },
            { name: 'NAYAX_REFUND_EXECUTION_KILL_SWITCH', value: 'true' },
          ]),
        }, 'pilot_safe_caps_restore_ambiguous', signal);
        safeCapsAccepted = [200, 201].includes(response.status);
      } catch {
        // Readback below is authoritative; neither mutation is retried.
      }
      let secrets;
      try { secrets = await readSecrets(signal); } catch {
        throw new NayaxControlledPilotRunnerError('pilot_retirement_state_unknown', {
          metadataReconciliationRequired: true, closedStateVerified: false,
        });
      }
      const retired = retiredNames.every((name) => secretDigest(secrets, name) === null);
      const safeCaps =
        secretDigest(secrets, 'NAYAX_REFUND_MAX_AMOUNT_CENTS') === sha256Hex('1000') &&
        secretDigest(secrets, 'NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS') === sha256Hex('5000') &&
        secretDigest(secrets, 'NAYAX_REFUND_DAILY_COUNT_CAP') === sha256Hex('10') &&
        secretBoolean(secrets, 'NAYAX_REFUND_EXECUTION_ENABLED') === false &&
        secretBoolean(secrets, 'NAYAX_REFUND_EXECUTION_DRY_RUN') === true &&
        secretBoolean(secrets, 'NAYAX_REFUND_EXECUTION_KILL_SWITCH') === true;
      if (!retired || !safeCaps) {
        throw new NayaxControlledPilotRunnerError('pilot_retirement_incomplete', {
          metadataReconciliationRequired: true, closedStateVerified: false,
        });
      }
      return {
        retired: true, deleteAccepted, safeCapsAccepted,
        metadataReconciliationRequired: true, closedStateVerified: true,
        vendorCredentialRoleReviewRequired: true, payloadRedacted: true,
      };
    },
    async authIdentity({ signal } = {}) {
      const bounded = requestSignal(signal);
      try {
        let response;
        try {
          response = await fetchImpl(`https://${config.projectRef}.supabase.co/auth/v1/user`, {
            method: 'GET', headers: {
              apikey: config.anonKey,
              Authorization: `Bearer ${config.ownerUserJwt}`,
            }, redirect: 'error', cache: 'no-store', signal: bounded.signal,
          });
        } catch { fail('owner_auth_transport_failed'); }
        if (!response.ok) fail('owner_auth_rejected');
        let body;
        try { body = await response.json(); } catch { fail('owner_auth_response_invalid'); }
        if (!UUID.test(body?.id ?? '') || typeof body?.email !== 'string') {
          fail('owner_auth_response_invalid');
        }
        return { userId: body.id, emailDigest: sha256Hex(body.email.trim().toLowerCase()) };
      } finally { bounded.dispose(); }
    },
    preflight: ({ ownerUserId, signal } = {}) =>
      query('preflight', [config.caseId, ownerUserId], signal),
    async authorize({ authorizationId, ownerUserId, expectedCaseVersion, signal } = {}) {
      const row = await query('authorize', [
        authorizationId, ownerUserId, config.caseId, expectedCaseVersion,
        config.expectedAmountCents, config.ownerCaseEvidenceDigest,
        config.ownerEmailDigest, config.selfCaseAttestationDigest,
        config.expectedMachineDigest, config.accountKeyDigest,
        config.runnerAssertionDigest, config.executorAssertionDigest,
        config.contractDigest, config.contract.contractVersion,
        config.sponsorDigest, config.dtmOwnerOperatorProofDigest,
      ], signal);
      if (!exactObject(row.result) || row.result.authorized !== true ||
          row.result.authorizationId !== authorizationId ||
          !UUID.test(row.result.intentId ?? '') || row.result.payloadRedacted !== true) {
        fail('owner_authorization_response_invalid');
      }
      return row.result;
    },
    async cancel({ authorizationId, signal } = {}) {
      const row = await query('cancel', [authorizationId], signal);
      if (!exactObject(row.result) || row.result.closed !== true ||
          row.result.payloadRedacted !== true) fail('owner_cancel_response_invalid');
      return row.result;
    },
    async recoverExpired({ signal } = {}) {
      const row = await query('recover', [], signal);
      const consumedAttemptCount = Number(row.result?.consumedAttemptCount);
      if (!exactObject(row.result) || row.result.closed !== true ||
          row.result.payloadRedacted !== true ||
          ![0, 1].includes(consumedAttemptCount) ||
          row.result.providerCallCountStatus !==
            (consumedAttemptCount === 1 ? 'unknown' : 'proven_zero') ||
          (consumedAttemptCount === 1 && (
            row.result.providerHold !== true ||
            row.result.manualReconciliationRequired !== true
          ))) {
        fail('owner_recovery_response_invalid');
      }
      return row.result;
    },
    recoveryState: ({ signal } = {}) => query('recoveryState', [], signal),
    postflight: ({ authorizationId, signal } = {}) =>
      query('postflight', [authorizationId], signal),
    async execute({ authorizationId, intentId, expectedCaseVersion, code, signal } = {}) {
      if (!/^\d{6}$/u.test(code ?? '')) fail('fresh_totp_invalid');
      const bounded = requestSignal(signal, 150_000);
      try {
        let response;
        try {
          response = await fetchImpl(
            `https://${config.projectRef}.supabase.co/functions/v1/refund-manager-action-step-up`,
            {
              method: 'POST',
              headers: {
                Accept: 'application/json', 'Content-Type': 'application/json',
                apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}`,
                'x-supabase-auth-token': config.ownerUserJwt,
                'x-bloomjoy-nayax-pilot-assertion': config.runnerAssertion,
              },
              body: JSON.stringify({
                intentId, targetFunction: 'nayax-card-refund', code,
                frozenPayload: {
                  operation: 'controlled_owner_pilot', caseId: config.caseId,
                  pilotAuthorizationId: authorizationId,
                  expectedOfficialActionVersion: expectedCaseVersion,
                },
              }),
              redirect: 'error', cache: 'no-store', signal: bounded.signal,
            },
          );
        } catch { fail('edge_result_ambiguous'); }
        let body = {};
        try { body = await response.json(); } catch { /* reconciled below */ }
        return { confirmed: response.ok && body?.payloadRedacted === true, status: response.status };
      } finally { bounded.dispose(); }
    },
  });
};

export { QUERIES as NAYAX_CONTROLLED_PILOT_OWNER_QUERIES };
