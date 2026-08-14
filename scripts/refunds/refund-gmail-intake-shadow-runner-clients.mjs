import {
  assertSyntheticGmailProofProductionAligned,
  getSyntheticGmailProofGithubVariable,
} from './refund-synthetic-gmail-proof-runner-clients.mjs';
import { evaluateBackupHealth } from './refund-synthetic-gmail-proof-runner-lib.mjs';
import {
  REFUND_INTAKE_SHADOW_PROJECT_REF,
  REFUND_INTAKE_SHADOW_SAFE_START_AT,
  REFUND_INTAKE_SHADOW_ZERO_DIGEST,
  RefundGmailIntakeShadowRunnerError,
  sha256Hex,
} from './refund-gmail-intake-shadow-runner-lib.mjs';

const MANAGEMENT_REQUEST_TIMEOUT_MS = 15_000;
const EDGE_REQUEST_TIMEOUT_MS = 150_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const genericFailure = (code) => new RefundGmailIntakeShadowRunnerError(code);
const SQL_MUTATION_PATTERN =
  /\b(?:alter|analyze|begin|call|checkpoint|cluster|comment|commit|copy|create|deallocate|delete|discard|do|drop|execute|grant|insert|into|listen|lock|merge|move|notify|perform|prepare|reassign|refresh|reindex|reset|revoke|rollback|set|truncate|unlisten|update|vacuum)\b|\b(?:nextval|setval|pg_notify|dblink|lo_import|lo_export)\s*\(/iu;

const OWNER_SQL = `
current_user = pg_catalog.pg_get_userbyid(database.datdba)
  and session_user = pg_catalog.pg_get_userbyid(database.datdba)
`;

const SNAPSHOT_SQL = `
  (select count(*) from public.refund_cases where intake_source = 'gmail') as refund_cases,
  (select count(*) from public.refund_gmail_messages) as gmail_messages,
  (select count(*) from public.refund_gmail_messages
    where direction = 'inbound' and participant_role = 'customer') as customer_inbound,
  (select count(*) from public.refund_gmail_messages
    where direction = 'outbound' and operation_key is null) as provider_sent_mailbox,
  (select count(*) from public.refund_gmail_attachments) as attachments,
  (select count(*) from public.refund_gmail_messages
    where direction = 'outbound' and operation_key is not null) as hub_outbound_operations,
  (select count(*) from public.refund_case_messages) as case_delivery_messages,
  (select count(*) from public.refund_gmail_first_contact_operations
    where status = 'shadowed') as first_contact_shadowed,
  (select count(*) from public.refund_gmail_first_contact_operations
    where status in ('pending_send', 'sent', 'delivery_unknown')) as first_contact_pending_or_sent,
  (select count(*) from public.refund_case_events
    where event_type = 'gmail_manager_action_notice_shadowed') as manager_notice_shadowed,
  (select count(*) from public.refund_case_events
    where event_type in (
      'gmail_customer_action_notice_sent',
      'gmail_bounce_action_notice_sent',
      'gmail_manager_action_notice_failed'
    )) as manager_notice_outbound_attempts,
  (select count(*) from public.refund_gmail_intake_shadow_notices) as notice_ledger,
  (select count(*) from public.refund_gmail_intake_shadow_cleanup_obligations)
    as cleanup_obligations,
  (select count(*) from public.refund_case_nayax_refund_attempts) as nayax_provider_attempts
`;

const OWNER_QUERIES = Object.freeze({
  preflight: Object.freeze({
    parameterCount: 0,
    sql: `
with gate as (
  select public.service_preflight_refund_gmail_intake_shadow(
    false,
    'refund_gmail_retention_v1',
    false,
    false,
    ''
  ) as value
)
select
  ${OWNER_SQL} as database_owner_session,
  coalesce((gate.value ->> 'allowed')::boolean, false) as gate_allowed,
  gate.value ->> 'status' as gate_status,
  (gate.value ->> 'activeProofAuthorizationCount')::integer as active_proof_authorization_count,
  (gate.value ->> 'armedDispatchAuthorizationCount')::integer
    as armed_dispatch_authorization_count,
  (gate.value ->> 'unresolvedGmailOutboundCount')::integer as unresolved_gmail_outbound_count,
  (gate.value ->> 'unresolvedFirstContactCount')::integer as unresolved_first_contact_count,
  (gate.value ->> 'automaticCustomerContactEnabled')::boolean as automatic_customer_contact_enabled,
  (gate.value ->> 'gptTriageEnabled')::boolean as gpt_triage_enabled,
  (gate.value ->> 'gptAutoSendEnabled')::boolean as gpt_auto_send_enabled,
  (gate.value ->> 'officialActionsEnabled')::boolean as official_actions_enabled,
  (gate.value ->> 'activeOfficialAuthorizationCount')::integer as active_official_authorization_count,
  (gate.value ->> 'pendingStepUpIntentCount')::integer as pending_step_up_intent_count,
  (gate.value ->> 'nayaxResolutionEnabled')::boolean as nayax_resolution_enabled,
  (gate.value ->> 'nayaxOperatorCount')::integer as nayax_operator_count,
  (gate.value ->> 'nayaxResolutionIntentCount')::integer as nayax_resolution_intent_count,
  (gate.value ->> 'nayaxProviderAttemptCount')::integer as nayax_provider_attempt_count,
  (gate.value ->> 'unresolvedNayaxProviderAttemptCount')::integer
    as unresolved_nayax_provider_attempt_count,
  (gate.value ->> 'overdueCleanupObligationCount')::integer
    as overdue_cleanup_obligation_count,
  (gate.value ->> 'retentionPolicyHealthy')::boolean as retention_policy_healthy,
  (gate.value ->> 'attachmentsEnabled')::boolean as attachments_enabled,
  (gate.value ->> 'scannerEnabled')::boolean as scanner_enabled,
  (gate.value ->> 'payloadRedacted')::boolean as payload_redacted,
  ${SNAPSHOT_SQL}
from pg_catalog.pg_database database
cross join gate
where database.datname = pg_catalog.current_database()
`,
  }),
  authorizeDispatch: Object.freeze({
    parameterCount: 3,
    sql: `
with authorization as (
  select public.owner_authorize_refund_gmail_intake_shadow_dispatch(
    $1::text
    , $2::text
    , $3::timestamptz
  ) as value
)
select
  ${OWNER_SQL} as database_owner_session,
  (authorization.value ->> 'authorized')::boolean as authorized,
  authorization.value ->> 'status' as status,
  (authorization.value ->> 'payloadRedacted')::boolean as payload_redacted
from pg_catalog.pg_database database
cross join authorization
where database.datname = pg_catalog.current_database()
`,
  }),
  closeDispatch: Object.freeze({
    parameterCount: 1,
    sql: `
with closure as (
  select public.owner_cancel_refund_gmail_intake_shadow_dispatch(
    $1::text
  ) as value
)
select
  ${OWNER_SQL} as database_owner_session,
  (closure.value ->> 'closed')::boolean as closed,
  closure.value ->> 'status' as status,
  (closure.value ->> 'payloadRedacted')::boolean as payload_redacted
from pg_catalog.pg_database database
cross join closure
where database.datname = pg_catalog.current_database()
`,
  }),
  recoverExpiredDispatches: Object.freeze({
    parameterCount: 0,
    sql: `
with recovery as (
  select public.owner_recover_expired_refund_gmail_intake_shadow_dispatches() as value
)
select
  ${OWNER_SQL} as database_owner_session,
  (recovery.value ->> 'recoveredExpiredCount')::integer as recovered_expired_count,
  (recovery.value ->> 'armedAuthorizationCount')::integer as armed_authorization_count,
  (recovery.value ->> 'consumedRunningCount')::integer as consumed_running_count,
  (recovery.value ->> 'payloadRedacted')::boolean as payload_redacted
from pg_catalog.pg_database database
cross join recovery
where database.datname = pg_catalog.current_database()
`,
  }),
  completeDueCleanup: Object.freeze({
    parameterCount: 1,
    sql: `
with completion as (
  select public.owner_complete_due_refund_gmail_intake_shadow_cleanup($1::uuid) as value
)
select
  ${OWNER_SQL} as database_owner_session,
  (completion.value ->> 'completedNow')::integer as completed_now,
  (completion.value ->> 'assignedOverdue')::integer as assigned_overdue,
  (completion.value ->> 'taskFound')::boolean as task_found,
  completion.value ->> 'taskStatus' as task_status,
  (completion.value ->> 'payloadRedacted')::boolean as payload_redacted
from pg_catalog.pg_database database
cross join completion
where database.datname = pg_catalog.current_database()
`,
  }),
  postflight: Object.freeze({
    parameterCount: 2,
    sql: `
with exact_dispatch as (
  select status
  from public.refund_gmail_intake_shadow_dispatch_authorizations
  where run_key_digest = encode(
    extensions.digest(convert_to($1::text, 'UTF8'), 'sha256'),
    'hex'
  )
),
exact_run as (
  select id, trigger_source, status, started_at, finished_at,
    threads_scanned, messages_seen, messages_created, messages_failed
  from public.refund_gmail_sync_runs
  where run_key = $1::text
),
exact_notice as (
  select notice.source_message_id, notice.refund_case_id, notice.route_class,
    notice.first_contact_operation_id, notice.first_contact_event_id,
    notice.event_id
  from public.refund_gmail_intake_shadow_notices notice
  join exact_run run on run.id = notice.run_id
),
exact_source as (
  select notice.refund_case_id, notice.route_class, source.gmail_thread_id
  from exact_notice notice
  join public.refund_gmail_messages source on source.id = notice.source_message_id
),
exact_thread_messages as (
  select distinct message.id, message.retention_expires_at
  from exact_source source
  join public.refund_gmail_messages message
    on message.gmail_thread_id = source.gmail_thread_id
),
exact_cases as (
  select distinct refund_case.id, refund_case.intake_source,
    refund_case.status, refund_case.automation_state
  from exact_notice notice
  join public.refund_cases refund_case on refund_case.id = notice.refund_case_id
),
exact_first_contact_operations as (
  select operation.id
  from exact_notice notice
  join public.refund_gmail_first_contact_operations operation
    on operation.id = notice.first_contact_operation_id
    and operation.source_message_id = notice.source_message_id
    and operation.refund_case_id = notice.refund_case_id
    and operation.mode = 'shadow'
    and operation.template_key = 'refund_first_contact_v1'
    and operation.status = 'shadowed'
    and operation.prior_mailbox_reply_present is true
),
exact_first_contact_events as (
  select event.id
  from exact_notice notice
  join public.refund_case_events event
    on event.id = notice.first_contact_event_id
    and event.refund_case_id = notice.refund_case_id
    and event.event_type = 'gmail_first_contact_shadowed'
),
exact_action_events as (
  select event.id
  from exact_notice notice
  join public.refund_case_events event
    on event.id = notice.event_id
    and event.refund_case_id = notice.refund_case_id
    and event.event_type = 'gmail_manager_action_notice_shadowed'
),
exact_cleanup as (
  select obligation.*
  from public.refund_gmail_intake_shadow_cleanup_obligations obligation
  join exact_run run on run.id = obligation.run_id
  join exact_notice notice
    on notice.source_message_id = obligation.source_message_id
    and notice.refund_case_id = obligation.refund_case_id
)
select
  ${OWNER_SQL} as database_owner_session,
  (select count(*) from public.refund_synthetic_gmail_proof_authorizations
    where cancelled_at is null) as active_proof_authorization_count,
  (select count(*) from public.refund_gmail_messages
    where status in ('pending_send', 'delivery_unknown')) as unresolved_gmail_outbound_count,
  (select count(*) from public.refund_gmail_first_contact_operations
    where status in ('pending_send', 'delivery_unknown')) as unresolved_first_contact_count,
  (select count(*) from exact_run) as run_count,
  (select min(trigger_source) from exact_run) as trigger_source,
  (select min(status) from exact_run) as run_status,
  (select min(started_at)::text from exact_run) as run_started_at,
  (select min(finished_at)::text from exact_run) as run_finished_at,
  coalesce((select min(status) from exact_dispatch), 'absent') as dispatch_status,
  (select min(threads_scanned) from exact_run) as threads_scanned,
  (select min(messages_seen) from exact_run) as messages_seen,
  (select min(messages_created) from exact_run) as messages_created,
  (select min(messages_failed) from exact_run) as messages_failed,
  (select count(*) from exact_notice) as exact_notice_count,
  (select count(*) from exact_first_contact_operations)
    as exact_first_contact_operation_count,
  (select count(*) from exact_first_contact_events)
    as exact_first_contact_event_count,
  (select count(*) from exact_action_events) as exact_action_event_count,
  (select count(*) from exact_cleanup) as cleanup_obligation_count,
  (select min(cleanup_task_handle)::text from exact_cleanup) as cleanup_task_handle,
  (select min(assigned_owner_role) from exact_cleanup) as cleanup_assigned_owner_role,
  (select min(status) from exact_cleanup) as cleanup_status,
  (select min(route_class) from exact_notice) as route_class,
  (select count(*) from exact_thread_messages) as exact_thread_message_count,
  (select count(*) from exact_thread_messages exact_message
    join public.refund_gmail_messages message on message.id = exact_message.id
    where message.direction = 'inbound' and message.participant_role = 'customer')
    as exact_customer_inbound_count,
  (select count(*) from exact_thread_messages exact_message
    join public.refund_gmail_messages message on message.id = exact_message.id
    where message.direction = 'outbound' and message.operation_key is null)
    as exact_provider_sent_mailbox_count,
  (select count(*) from exact_cases refund_case
    where public.can_manage_refund_case($2::uuid, refund_case.id))
    as owner_manageable_case_count,
  (select min(intake_source) from exact_cases) as case_source,
  (select min(status) from exact_cases) as case_status,
  (select min(automation_state) from exact_cases) as case_automation_state,
  (select min(earliest_retention_due_at)::text from exact_cleanup)
    as earliest_retention_due_at,
  (select max(latest_retention_due_at)::text from exact_cleanup)
    as latest_retention_due_at,
  ${SNAPSHOT_SQL}
from pg_catalog.pg_database database
where database.datname = pg_catalog.current_database()
`,
  }),
});

const assertClosedReadRegistry = () => {
  const entries = Object.entries(OWNER_QUERIES);
  if (
    entries.length !== 6 || !OWNER_QUERIES.preflight ||
    !OWNER_QUERIES.authorizeDispatch || !OWNER_QUERIES.closeDispatch ||
    !OWNER_QUERIES.recoverExpiredDispatches ||
    !OWNER_QUERIES.completeDueCleanup ||
    !OWNER_QUERIES.postflight
  ) {
    throw new Error('Intake shadow owner query registry must remain closed.');
  }
  for (const [, value] of entries) {
    if (
      !Number.isInteger(value.parameterCount) || value.parameterCount < 0 ||
      value.sql.includes(';') || SQL_MUTATION_PATTERN.test(value.sql) ||
      !/^\s*(?:select|with)\b/iu.test(value.sql)
    ) throw new Error('Intake shadow owner query must remain a fixed SELECT boundary.');
  }
};
assertClosedReadRegistry();

export const getRefundGmailIntakeShadowOwnerQuerySnapshots = () => OWNER_QUERIES;

const requireCount = (value) => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw genericFailure('database_response_invalid');
};

const requireBoolean = (value) => {
  if (value === true || value === false) return value;
  throw genericFailure('database_response_invalid');
};

const requireDatabaseOwnerSession = (value) => {
  if (requireBoolean(value) !== true) {
    throw genericFailure('database_owner_required');
  }
  return true;
};

const requireNullableText = (value, allowed) => {
  if (value === null && allowed.includes(null)) return null;
  if (typeof value === 'string' && allowed.includes(value)) return value;
  throw genericFailure('database_response_invalid');
};

const requireExactKeys = (row, keys) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw genericFailure('database_response_invalid');
  }
  const actual = Object.keys(row).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw genericFailure('database_response_invalid');
  }
};

const SNAPSHOT_KEYS = [
  'refund_cases',
  'gmail_messages',
  'customer_inbound',
  'provider_sent_mailbox',
  'attachments',
  'hub_outbound_operations',
  'case_delivery_messages',
  'first_contact_shadowed',
  'first_contact_pending_or_sent',
  'manager_notice_shadowed',
  'manager_notice_outbound_attempts',
  'notice_ledger',
  'cleanup_obligations',
  'nayax_provider_attempts',
];

const normalizeSnapshot = (row) => ({
  refundCases: requireCount(row.refund_cases),
  gmailMessages: requireCount(row.gmail_messages),
  customerInbound: requireCount(row.customer_inbound),
  providerSentMailbox: requireCount(row.provider_sent_mailbox),
  attachments: requireCount(row.attachments),
  hubOutboundOperations: requireCount(row.hub_outbound_operations),
  caseDeliveryMessages: requireCount(row.case_delivery_messages),
  firstContactShadowed: requireCount(row.first_contact_shadowed),
  firstContactPendingOrSent: requireCount(row.first_contact_pending_or_sent),
  managerNoticeShadowed: requireCount(row.manager_notice_shadowed),
  managerNoticeOutboundAttempts: requireCount(row.manager_notice_outbound_attempts),
  noticeLedger: requireCount(row.notice_ledger),
  cleanupObligations: requireCount(row.cleanup_obligations),
  nayaxProviderAttempts: requireCount(row.nayax_provider_attempts),
});

const PRE_KEYS = [
  'database_owner_session',
  'gate_allowed',
  'gate_status',
  'active_proof_authorization_count',
  'armed_dispatch_authorization_count',
  'unresolved_gmail_outbound_count',
  'unresolved_first_contact_count',
  'automatic_customer_contact_enabled',
  'gpt_triage_enabled',
  'gpt_auto_send_enabled',
  'official_actions_enabled',
  'active_official_authorization_count',
  'pending_step_up_intent_count',
  'nayax_resolution_enabled',
  'nayax_operator_count',
  'nayax_resolution_intent_count',
  'nayax_provider_attempt_count',
  'unresolved_nayax_provider_attempt_count',
  'overdue_cleanup_obligation_count',
  'retention_policy_healthy',
  'attachments_enabled',
  'scanner_enabled',
  'payload_redacted',
  ...SNAPSHOT_KEYS,
];

const POST_KEYS = [
  'database_owner_session',
  'active_proof_authorization_count',
  'unresolved_gmail_outbound_count',
  'unresolved_first_contact_count',
  'run_count',
  'trigger_source',
  'run_status',
  'run_started_at',
  'run_finished_at',
  'dispatch_status',
  'threads_scanned',
  'messages_seen',
  'messages_created',
  'messages_failed',
  'exact_notice_count',
  'exact_first_contact_operation_count',
  'exact_first_contact_event_count',
  'exact_action_event_count',
  'cleanup_obligation_count',
  'cleanup_task_handle',
  'cleanup_assigned_owner_role',
  'cleanup_status',
  'route_class',
  'exact_thread_message_count',
  'exact_customer_inbound_count',
  'exact_provider_sent_mailbox_count',
  'owner_manageable_case_count',
  'case_source',
  'case_status',
  'case_automation_state',
  'earliest_retention_due_at',
  'latest_retention_due_at',
  ...SNAPSHOT_KEYS,
];

const delta = (after, before, code = 'database_response_invalid') => {
  const value = after - before;
  if (!Number.isSafeInteger(value) || value < 0) throw genericFailure(code);
  return value;
};

const abortableFetch = async (fetchImpl, url, init, code) => {
  try {
    return await fetchImpl(url, { ...init, redirect: 'error', cache: 'no-store' });
  } catch {
    throw genericFailure(code);
  }
};

export const createRefundGmailIntakeShadowDatabaseClient = ({
  projectRef,
  confirmProjectRef,
  managementToken,
  fetchImpl = globalThis.fetch,
}) => {
  if (
    projectRef !== REFUND_INTAKE_SHADOW_PROJECT_REF ||
    confirmProjectRef !== REFUND_INTAKE_SHADOW_PROJECT_REF
  ) throw genericFailure('database_project_not_confirmed');
  if (typeof managementToken !== 'string' || managementToken.length < 20) {
    throw genericFailure('database_token_missing');
  }
  const endpoint =
    `https://api.supabase.com/v1/projects/${REFUND_INTAKE_SHADOW_PROJECT_REF}/database/query`;
  const query = async (operationName, parameters, signal) => {
    const operation = OWNER_QUERIES[operationName];
    if (!operation || parameters.length !== operation.parameterCount) {
      throw genericFailure('database_operation_invalid');
    }
    const response = await abortableFetch(fetchImpl, endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${managementToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: operation.sql, parameters, read_only: false }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(MANAGEMENT_REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(MANAGEMENT_REQUEST_TIMEOUT_MS),
    }, 'database_query_failed');
    if (!response.ok) throw genericFailure('database_query_failed');
    let rows;
    try {
      rows = await response.json();
    } catch {
      throw genericFailure('database_response_invalid');
    }
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw genericFailure('database_response_invalid');
    }
    return rows[0];
  };

  return {
    async preflight({ signal } = {}) {
      const row = await query('preflight', [], signal);
      requireExactKeys(row, PRE_KEYS);
      const result = {
        databaseOwnerSession: requireDatabaseOwnerSession(row.database_owner_session),
        activeProofAuthorizationCount: requireCount(row.active_proof_authorization_count),
        armedDispatchAuthorizationCount:
          requireCount(row.armed_dispatch_authorization_count),
        unresolvedGmailOutboundCount: requireCount(row.unresolved_gmail_outbound_count),
        unresolvedFirstContactCount: requireCount(row.unresolved_first_contact_count),
        automaticCustomerContactEnabled: requireBoolean(row.automatic_customer_contact_enabled),
        gptTriageEnabled: requireBoolean(row.gpt_triage_enabled),
        gptAutoSendEnabled: requireBoolean(row.gpt_auto_send_enabled),
        officialActionsEnabled: requireBoolean(row.official_actions_enabled),
        activeOfficialAuthorizationCount: requireCount(row.active_official_authorization_count),
        pendingStepUpIntentCount: requireCount(row.pending_step_up_intent_count),
        nayaxResolutionEnabled: requireBoolean(row.nayax_resolution_enabled),
        nayaxOperatorCount: requireCount(row.nayax_operator_count),
        nayaxResolutionIntentCount: requireCount(row.nayax_resolution_intent_count),
        nayaxProviderAttemptCount: requireCount(row.nayax_provider_attempt_count),
        unresolvedNayaxProviderAttemptCount:
          requireCount(row.unresolved_nayax_provider_attempt_count),
        overdueCleanupObligationCount:
          requireCount(row.overdue_cleanup_obligation_count),
        retentionPolicyHealthy: requireBoolean(row.retention_policy_healthy),
        attachmentsEnabled: requireBoolean(row.attachments_enabled),
        scannerEnabled: requireBoolean(row.scanner_enabled),
        payloadRedacted: requireBoolean(row.payload_redacted),
        snapshot: normalizeSnapshot(row),
      };
      if (
        requireBoolean(row.gate_allowed) !== true || row.gate_status !== 'authorized'
      ) throw genericFailure('database_preflight_invalid');
      return result;
    },

    async authorizeDispatch({ runKeyDigest, ownerSenderDigest, freshStartAt, signal } = {}) {
      if (
        !SHA256_PATTERN.test(runKeyDigest ?? '') ||
        !SHA256_PATTERN.test(ownerSenderDigest ?? '') ||
        ownerSenderDigest === REFUND_INTAKE_SHADOW_ZERO_DIGEST ||
        typeof freshStartAt !== 'string' || !Number.isFinite(Date.parse(freshStartAt))
      ) {
        throw genericFailure('database_dispatch_input_invalid');
      }
      const row = await query(
        'authorizeDispatch',
        [runKeyDigest, ownerSenderDigest, freshStartAt],
        signal,
      );
      requireExactKeys(row, [
        'database_owner_session', 'authorized', 'status', 'payload_redacted',
      ]);
      requireDatabaseOwnerSession(row.database_owner_session);
      if (
        requireBoolean(row.authorized) !== true || row.status !== 'armed' ||
        requireBoolean(row.payload_redacted) !== true
      ) throw genericFailure('database_dispatch_authorization_failed');
      return { authorized: true, status: 'armed', payloadRedacted: true };
    },

    async closeDispatch({ runKeyDigest, signal } = {}) {
      if (!SHA256_PATTERN.test(runKeyDigest ?? '')) {
        throw genericFailure('database_dispatch_input_invalid');
      }
      const row = await query('closeDispatch', [runKeyDigest], signal);
      requireExactKeys(row, [
        'database_owner_session', 'closed', 'status', 'payload_redacted',
      ]);
      requireDatabaseOwnerSession(row.database_owner_session);
      const status = requireNullableText(
        row.status,
        ['cancelled', 'consumed'],
      );
      if (
        requireBoolean(row.closed) !== true ||
        requireBoolean(row.payload_redacted) !== true
      ) throw genericFailure('database_dispatch_close_failed');
      return { closed: true, status, payloadRedacted: true };
    },

    async recoverExpiredDispatches({ signal } = {}) {
      const row = await query('recoverExpiredDispatches', [], signal);
      requireExactKeys(row, [
        'database_owner_session', 'recovered_expired_count',
        'armed_authorization_count', 'consumed_running_count',
        'payload_redacted',
      ]);
      requireDatabaseOwnerSession(row.database_owner_session);
      const result = {
        recoveredExpiredCount: requireCount(row.recovered_expired_count),
        armedAuthorizationCount: requireCount(row.armed_authorization_count),
        consumedRunningCount: requireCount(row.consumed_running_count),
        payloadRedacted: requireBoolean(row.payload_redacted),
      };
      if (
        result.armedAuthorizationCount !== 0 ||
        result.consumedRunningCount !== 0 ||
        result.payloadRedacted !== true
      ) throw genericFailure('database_dispatch_recovery_incomplete');
      return result;
    },

    async completeDueCleanup({ cleanupTaskHandle, signal } = {}) {
      if (!UUID_PATTERN.test(cleanupTaskHandle ?? '')) {
        throw genericFailure('database_cleanup_handle_invalid');
      }
      const row = await query('completeDueCleanup', [cleanupTaskHandle], signal);
      requireExactKeys(row, [
        'database_owner_session', 'completed_now', 'assigned_overdue',
        'task_found', 'task_status', 'payload_redacted',
      ]);
      requireDatabaseOwnerSession(row.database_owner_session);
      const result = {
        completedNow: requireCount(row.completed_now),
        assignedOverdue: requireCount(row.assigned_overdue),
        taskFound: requireBoolean(row.task_found),
        taskStatus: requireNullableText(row.task_status, ['absent', 'assigned', 'completed']),
        payloadRedacted: requireBoolean(row.payload_redacted),
      };
      if (
        result.assignedOverdue !== 0 || result.taskFound !== true ||
        result.taskStatus !== 'completed' ||
        result.payloadRedacted !== true
      ) throw genericFailure('database_cleanup_completion_failed');
      return result;
    },

    async postflight({ before, runKey, ownerUserId, signal } = {}) {
      if (!/^owner-intake-shadow:[a-f0-9]{64}$/u.test(runKey ?? '') ||
          !UUID_PATTERN.test(ownerUserId ?? '') || !before?.snapshot) {
        throw genericFailure('database_postflight_input_invalid');
      }
      const row = await query('postflight', [runKey, ownerUserId], signal);
      requireExactKeys(row, POST_KEYS);
      const after = normalizeSnapshot(row);
      const beforeSnapshot = before.snapshot;
      const runCount = requireCount(row.run_count);
      const nullableCount = (value) => value === null ? null : requireCount(value);
      const parseRetentionDate = (value) => {
        if (value === null) return null;
        if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
          throw genericFailure('database_response_invalid');
        }
        return value;
      };
      const earliestRetentionDueAt = parseRetentionDate(row.earliest_retention_due_at);
      const latestRetentionDueAt = parseRetentionDate(row.latest_retention_due_at);
      const runStartedAt = parseRetentionDate(row.run_started_at);
      const runFinishedAt = parseRetentionDate(row.run_finished_at);
      if (
        earliestRetentionDueAt !== null && latestRetentionDueAt !== null &&
        Date.parse(earliestRetentionDueAt) > Date.parse(latestRetentionDueAt)
      ) throw genericFailure('database_response_invalid');
      const cleanupTaskHandle = row.cleanup_task_handle;
      if (cleanupTaskHandle !== null && !UUID_PATTERN.test(cleanupTaskHandle)) {
        throw genericFailure('database_response_invalid');
      }
      return {
        databaseOwnerSession: requireDatabaseOwnerSession(row.database_owner_session),
        activeProofAuthorizationCount: requireCount(row.active_proof_authorization_count),
        unresolvedGmailOutboundCount: requireCount(row.unresolved_gmail_outbound_count),
        unresolvedFirstContactCount: requireCount(row.unresolved_first_contact_count),
        runCount,
        triggerSource: requireNullableText(row.trigger_source, [null, 'intake_shadow']),
        runStatus: requireNullableText(row.run_status, [null, 'running', 'succeeded', 'failed', 'suppressed']),
        runStartedAt,
        runFinishedAt,
        dispatchStatus: requireNullableText(
          row.dispatch_status,
          ['absent', 'armed', 'consumed', 'cancelled'],
        ),
        threadsScanned: nullableCount(row.threads_scanned),
        messagesSeen: nullableCount(row.messages_seen),
        messagesCreated: nullableCount(row.messages_created),
        messagesFailed: nullableCount(row.messages_failed),
        exactNoticeCount: requireCount(row.exact_notice_count),
        exactFirstContactOperationCount:
          requireCount(row.exact_first_contact_operation_count),
        exactFirstContactEventCount:
          requireCount(row.exact_first_contact_event_count),
        exactActionEventCount: requireCount(row.exact_action_event_count),
        cleanupObligationCount: requireCount(row.cleanup_obligation_count),
        cleanupTaskHandle,
        cleanupAssignedOwnerRole: requireNullableText(
          row.cleanup_assigned_owner_role,
          [null, 'refund_operations_owner'],
        ),
        cleanupStatus: requireNullableText(
          row.cleanup_status,
          [null, 'assigned', 'completed'],
        ),
        routeClass: requireNullableText(row.route_class, [
          null,
          'assigned_managers',
          'operations_fallback',
          'unassigned_owner_ops_queue',
        ]),
        exactThreadMessageCount: requireCount(row.exact_thread_message_count),
        exactCustomerInboundCount: requireCount(row.exact_customer_inbound_count),
        exactProviderSentMailboxCount: requireCount(row.exact_provider_sent_mailbox_count),
        ownerManageableCaseCount: requireCount(row.owner_manageable_case_count),
        caseSource: requireNullableText(row.case_source, [null, 'gmail']),
        caseStatus: requireNullableText(row.case_status, [null, 'draft']),
        caseAutomationState: requireNullableText(row.case_automation_state, [null, 'customer_replied']),
        earliestRetentionDueAt,
        latestRetentionDueAt,
        refundCaseDelta: delta(after.refundCases, beforeSnapshot.refundCases),
        gmailMessageDelta: delta(after.gmailMessages, beforeSnapshot.gmailMessages),
        customerInboundDelta: delta(after.customerInbound, beforeSnapshot.customerInbound),
        providerSentMailboxDelta:
          delta(after.providerSentMailbox, beforeSnapshot.providerSentMailbox),
        attachmentDelta: delta(after.attachments, beforeSnapshot.attachments),
        hubOutboundOperationDelta:
          delta(after.hubOutboundOperations, beforeSnapshot.hubOutboundOperations),
        caseDeliveryMessageDelta:
          delta(after.caseDeliveryMessages, beforeSnapshot.caseDeliveryMessages),
        firstContactShadowedDelta:
          delta(after.firstContactShadowed, beforeSnapshot.firstContactShadowed),
        firstContactPendingOrSentDelta:
          delta(after.firstContactPendingOrSent, beforeSnapshot.firstContactPendingOrSent),
        managerNoticeShadowedDelta:
          delta(after.managerNoticeShadowed, beforeSnapshot.managerNoticeShadowed),
        managerNoticeOutboundAttemptDelta:
          delta(
            after.managerNoticeOutboundAttempts,
            beforeSnapshot.managerNoticeOutboundAttempts,
          ),
        noticeLedgerDelta: delta(after.noticeLedger, beforeSnapshot.noticeLedger),
        cleanupObligationDelta:
          delta(after.cleanupObligations, beforeSnapshot.cleanupObligations),
        nayaxProviderAttemptDelta:
          delta(after.nayaxProviderAttempts, beforeSnapshot.nayaxProviderAttempts),
      };
    },
  };
};

const secretDigest = (secrets, name) => {
  const matches = secrets.filter((secret) => secret?.name === name);
  if (matches.length !== 1) return '';
  const digest = String(matches[0]?.value ?? '').trim().toLowerCase();
  return SHA256_PATTERN.test(digest) ? digest : '';
};
const secretBoolean = (secrets, name, { absent = false } = {}) => {
  const digest = secretDigest(secrets, name);
  if (!digest) return absent;
  if (digest === sha256Hex('true')) return true;
  if (digest === sha256Hex('false')) return false;
  throw genericFailure('edge_secret_state_invalid');
};
const secretMode = (secrets) => {
  const digest = secretDigest(secrets, 'REFUND_GMAIL_FIRST_CONTACT_MODE');
  if (digest === sha256Hex('disabled')) return 'disabled';
  if (digest === sha256Hex('shadow')) return 'shadow';
  throw genericFailure('edge_secret_state_invalid');
};

const edgeStateFromSecrets = (secrets) => {
  const maxDigest = secretDigest(secrets, 'GMAIL_REFUND_MAX_THREADS_PER_RUN');
  return {
    intakeEnabled: secretBoolean(secrets, 'REFUND_GMAIL_INTAKE_ENABLED'),
    gmailEnabled: secretBoolean(secrets, 'REFUND_GMAIL_ENABLED'),
    firstContactMode: secretMode(secrets),
    startAtDigest: secretDigest(secrets, 'GMAIL_REFUND_START_AT'),
    maxThreads: maxDigest === sha256Hex('1') ? 1 : 0,
    productionLabelDigest: secretDigest(secrets, 'GMAIL_REFUND_LABEL_ID'),
    shadowLabelDigest: secretDigest(secrets, 'GMAIL_REFUND_INTAKE_SHADOW_LABEL_ID'),
    ownerSenderSecretDigest:
      secretDigest(secrets, 'REFUND_GMAIL_INTAKE_SHADOW_OWNER_SENDER_SHA256'),
    runKeySecretDigest:
      secretDigest(secrets, 'REFUND_GMAIL_INTAKE_SHADOW_RUN_KEY_SHA256'),
    automaticCustomerContactEnabled:
      secretBoolean(secrets, 'REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED'),
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
    nayaxProviderContractConfirmed: secretBoolean(
      secrets,
      'NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED',
      { absent: false },
    ),
    nayaxSponsorGoNoGo: secretBoolean(
      secrets,
      'NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO',
      { absent: false },
    ),
  };
};

export const createRefundGmailIntakeShadowControlClient = ({
  projectRef,
  managementToken,
  repoRoot,
  fetchImpl = globalThis.fetch,
}) => {
  if (projectRef !== REFUND_INTAKE_SHADOW_PROJECT_REF) {
    throw genericFailure('control_project_invalid');
  }
  let releasePromise;
  const managementRequest = async ({ method, body, code, signal }) => {
    const response = await abortableFetch(
      fetchImpl,
      `https://api.supabase.com/v1/projects/${REFUND_INTAKE_SHADOW_PROJECT_REF}/secrets`,
      {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${managementToken}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(MANAGEMENT_REQUEST_TIMEOUT_MS)])
          : AbortSignal.timeout(MANAGEMENT_REQUEST_TIMEOUT_MS),
      },
      code,
    );
    if (!response.ok) throw genericFailure(code);
    return response;
  };
  const readSecrets = async (signal) => {
    const response = await managementRequest({
      method: 'GET',
      code: 'edge_secret_read_failed',
      signal,
    });
    let body;
    try {
      body = await response.json();
    } catch {
      throw genericFailure('edge_secret_read_failed');
    }
    if (!Array.isArray(body)) throw genericFailure('edge_secret_read_failed');
    return body;
  };
  const readBackup = async (signal) => {
    const response = await abortableFetch(
      fetchImpl,
      `https://api.supabase.com/v1/projects/${REFUND_INTAKE_SHADOW_PROJECT_REF}/database/backups`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${managementToken}`,
        },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(MANAGEMENT_REQUEST_TIMEOUT_MS)])
          : AbortSignal.timeout(MANAGEMENT_REQUEST_TIMEOUT_MS),
      },
      'backup_health_read_failed',
    );
    if (!response.ok) throw genericFailure('backup_health_read_failed');
    let body;
    try {
      body = await response.json();
    } catch {
      throw genericFailure('backup_health_read_failed');
    }
    return evaluateBackupHealth(body);
  };
  const setSecrets = async (values, code, signal) => {
    const response = await managementRequest({
      method: 'POST',
      body: values,
      code,
      signal,
    });
    if (![200, 201].includes(response.status)) throw genericFailure(code);
  };

  return {
    async readState({ signal } = {}) {
      if (!releasePromise) {
        releasePromise = assertSyntheticGmailProofProductionAligned({
          repoRoot,
          projectRef,
          managementToken,
        });
      }
      const [
        secrets,
        backupCompletedFresh,
        gmailSyncEnabled,
        gmailRetentionEnabled,
        automationSweepEnabled,
        gptTriageSyncEnabled,
        productionAligned,
      ] = await Promise.all([
        readSecrets(signal),
        readBackup(signal),
        getSyntheticGmailProofGithubVariable('REFUND_GMAIL_SYNC_ENABLED', { repoRoot }),
        getSyntheticGmailProofGithubVariable('REFUND_GMAIL_RETENTION_ENABLED', { repoRoot }),
        getSyntheticGmailProofGithubVariable('REFUND_AUTOMATION_SWEEP_ENABLED', { repoRoot }),
        getSyntheticGmailProofGithubVariable('REFUND_GPT_TRIAGE_SYNC_ENABLED', { repoRoot }),
        releasePromise,
      ]);
      return {
        edge: edgeStateFromSecrets(secrets),
        github: {
          gmailSyncEnabled,
          gmailRetentionEnabled,
          automationSweepEnabled,
          gptTriageSyncEnabled,
        },
        release: {
          productionAligned,
          backupCompletedFresh,
          officialActionsEnabled: false,
          nayaxProviderAdapterEnabled: false,
        },
      };
    },

    async initializeClosed({ shadowLabelId, signal } = {}) {
      if (typeof shadowLabelId !== 'string' || !shadowLabelId.trim()) {
        throw genericFailure('intake_initialize_input_invalid');
      }
      await setSecrets([
        { name: 'REFUND_GMAIL_INTAKE_ENABLED', value: 'false' },
        { name: 'REFUND_GMAIL_ENABLED', value: 'false' },
        { name: 'REFUND_GMAIL_RETENTION_ENABLED', value: 'false' },
        { name: 'REFUND_GMAIL_FIRST_CONTACT_MODE', value: 'disabled' },
        { name: 'GMAIL_REFUND_START_AT', value: REFUND_INTAKE_SHADOW_SAFE_START_AT },
        { name: 'GMAIL_REFUND_MAX_THREADS_PER_RUN', value: '1' },
        { name: 'GMAIL_REFUND_INTAKE_SHADOW_LABEL_ID', value: shadowLabelId.trim() },
        {
          name: 'REFUND_GMAIL_INTAKE_SHADOW_OWNER_SENDER_SHA256',
          value: REFUND_INTAKE_SHADOW_ZERO_DIGEST,
        },
        {
          name: 'REFUND_GMAIL_INTAKE_SHADOW_RUN_KEY_SHA256',
          value: REFUND_INTAKE_SHADOW_ZERO_DIGEST,
        },
      ], 'intake_initialize_failed', signal);
    },

    async readInitializedClosedState({ signal } = {}) {
      return { edge: edgeStateFromSecrets(await readSecrets(signal)) };
    },
  };
};

export const createRefundGmailIntakeShadowIdentityClient = ({
  projectRef,
  anonKey,
  ownerUserJwt,
  ownerSenderDigest,
  fetchImpl = globalThis.fetch,
}) => ({
  async getOwnerUserId({ signal } = {}) {
    if (projectRef !== REFUND_INTAKE_SHADOW_PROJECT_REF) {
      throw genericFailure('identity_project_invalid');
    }
    const response = await abortableFetch(
      fetchImpl,
      `https://${REFUND_INTAKE_SHADOW_PROJECT_REF}.supabase.co/auth/v1/user`,
      {
        method: 'GET',
        headers: { apikey: anonKey, Authorization: `Bearer ${ownerUserJwt}` },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(MANAGEMENT_REQUEST_TIMEOUT_MS)])
          : AbortSignal.timeout(MANAGEMENT_REQUEST_TIMEOUT_MS),
      },
      'owner_identity_failed',
    );
    if (!response.ok) throw genericFailure('owner_identity_failed');
    let body;
    try {
      body = await response.json();
    } catch {
      throw genericFailure('owner_identity_failed');
    }
    const normalizedEmail = typeof body?.email === 'string'
      ? body.email.trim().toLowerCase()
      : '';
    if (
      !UUID_PATTERN.test(body?.id ?? '') ||
      !SHA256_PATTERN.test(ownerSenderDigest ?? '') ||
      ownerSenderDigest === REFUND_INTAKE_SHADOW_ZERO_DIGEST ||
      sha256Hex(normalizedEmail) !== ownerSenderDigest
    ) throw genericFailure('owner_identity_failed');
    return body.id;
  },
});

export const createRefundGmailIntakeShadowEdgeClient = ({
  projectRef,
  syncSecret,
  fetchImpl = globalThis.fetch,
}) => ({
  async run({ runKey, signal }) {
    if (
      projectRef !== REFUND_INTAKE_SHADOW_PROJECT_REF ||
      !/^owner-intake-shadow:[a-f0-9]{64}$/u.test(runKey ?? '')
    ) throw genericFailure('edge_input_invalid');
    const response = await abortableFetch(
      fetchImpl,
      `https://${REFUND_INTAKE_SHADOW_PROJECT_REF}.supabase.co/functions/v1/refund-gmail-sync`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${syncSecret}`,
        },
        body: JSON.stringify({ runKey, trigger: 'intake_shadow' }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(EDGE_REQUEST_TIMEOUT_MS)])
          : AbortSignal.timeout(EDGE_REQUEST_TIMEOUT_MS),
      },
      'edge_request_failed',
    );
    if (!response.ok) throw genericFailure('edge_request_rejected');
    let body;
    try {
      body = await response.json();
    } catch {
      throw genericFailure('edge_response_invalid');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw genericFailure('edge_response_invalid');
    }
    return Object.fromEntries([
      'status',
      'payloadRedacted',
      'threadsScanned',
      'messagesSeen',
      'messagesCreated',
      'messagesDeduplicated',
      'messagesFailed',
      'attachmentsQuarantined',
      'customerInboundMessages',
      'providerSentMailboxMessages',
      'mailboxAcknowledgementObserved',
      'firstContactShadowed',
      'firstContactSent',
      'firstContactFailed',
      'firstContactReconciliationOutstanding',
      'outboundReconciliationFailed',
      'outboundReconciliationOutstanding',
      'managerNoticeShadowed',
      'managerNoticeSentEvents',
    ].map((key) => [key, body[key]]));
  },
});

export const createRefundGmailIntakeShadowClients = (config, { repoRoot }) => ({
  database: createRefundGmailIntakeShadowDatabaseClient(config),
  control: createRefundGmailIntakeShadowControlClient({ ...config, repoRoot }),
  identity: createRefundGmailIntakeShadowIdentityClient(config),
  edge: createRefundGmailIntakeShadowEdgeClient(config),
});
