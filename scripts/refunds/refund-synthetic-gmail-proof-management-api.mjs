import {
  MANAGEMENT_API_OWNER_DATABASE_ADAPTER,
  REFUND_PRODUCTION_PROJECT_REF,
  SyntheticGmailProofRunnerError,
} from './refund-synthetic-gmail-proof-runner-lib.mjs';

const MANAGEMENT_API_REQUEST_TIMEOUT_MS = 15_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const OWNER_GATE_SQL = `
select
  current_user = pg_catalog.pg_get_userbyid(database.datdba)
    and session_user = pg_catalog.pg_get_userbyid(database.datdba)
    as database_owner_session
from pg_catalog.pg_database database
where database.datname = pg_catalog.current_database()
`;

const READ_OPERATION_NAMES = new Set([
  'preflight',
  'canManageCase',
  'findActiveAuthorizationId',
  'summary',
]);
const SQL_MUTATION_PATTERN =
  /\b(?:alter|analyze|begin|call|checkpoint|cluster|comment|commit|copy|create|deallocate|delete|discard|do|drop|execute|grant|insert|into|listen|lock|merge|move|notify|perform|prepare|reassign|refresh|reindex|reset|revoke|rollback|set|truncate|unlisten|update|vacuum)\b|\b(?:nextval|setval|pg_notify|dblink|lo_import|lo_export)\s*\(/iu;

const MANAGEMENT_API_OWNER_QUERIES = Object.freeze({
  preflight: Object.freeze({
    managementApiReadOnly: false,
    parameterCount: 1,
    sql: `
with candidate as (
  select refund_case.id, refund_case.customer_email, refund_case.intake_source,
    refund_case.status, refund_case.reporting_machine_id
  from public.refund_cases refund_case
  where refund_case.id = $1::uuid
), route as (
  select public.service_resolve_refund_customer_manager_cc(
    candidate.id,
    candidate.customer_email,
    array[
      'info@bloomjoysweets.com',
      'support@bloomjoysweets.com',
      'refunds@bloomjoysweets.com'
    ]::text[]
  ) resolution
  from candidate
)
select
  current_user = pg_catalog.pg_get_userbyid(database.datdba)
    and session_user = pg_catalog.pg_get_userbyid(database.datdba)
    as database_owner_session,
  (select count(*) from public.refund_synthetic_gmail_proof_authorizations
    where cancelled_at is null) as active_authorization_count,
  (select count(*) from public.refund_gmail_messages
    where status in ('pending_send', 'delivery_unknown')) as unresolved_gmail_outbound_count,
  (select count(*) from candidate
    where intake_source = 'gmail'
      and status = 'needs_review'
      and reporting_machine_id is not null
      and public.refund_synthetic_gmail_proof_recipient_allowed(customer_email)
  ) as eligible_case_count,
  (select count(*) from public.refund_gmail_threads thread
    join candidate on candidate.id = thread.refund_case_id) as thread_count,
  (select count(*) from public.refund_gmail_attachments attachment
    join candidate on candidate.id = attachment.refund_case_id) as attachment_count,
  coalesce((select resolution ->> 'status' = 'resolved' from route), false)
    as manager_route_resolved,
  coalesce((select (resolution ->> 'managerCcCount')::integer from route), 0)
    as manager_count,
  coalesce((select automatic_customer_contact_enabled
    from public.refund_customer_contact_settings where singleton), false)
    as automatic_customer_contact_enabled,
  coalesce((select enabled from public.refund_gpt_triage_settings where singleton), false)
    as gpt_triage_enabled,
  coalesce((select auto_send_enabled from public.refund_gpt_triage_settings where singleton), false)
    as gpt_auto_send_enabled,
  coalesce((select attachment_quarantine_approved
    from public.refund_gmail_retention_settings where singleton), false)
    as attachment_quarantine_approved
from pg_catalog.pg_database database
where database.datname = pg_catalog.current_database()
`,
  }),
  canManageCase: Object.freeze({
    managementApiReadOnly: false,
    parameterCount: 2,
    sql: `
with owner_gate as (
  ${OWNER_GATE_SQL}
)
select
  owner_gate.database_owner_session,
  case when owner_gate.database_owner_session
    then public.can_manage_refund_case($1::uuid, $2::uuid)
    else false
  end as allowed
from owner_gate
`,
  }),
  prepare: Object.freeze({
    managementApiReadOnly: false,
    parameterCount: 3,
    sql: `
with owner_gate as (
  ${OWNER_GATE_SQL}
), prepared as (
  select public.owner_prepare_refund_synthetic_gmail_proof(
    $1::uuid, $2::text, $3::text
  ) as result
  from owner_gate
  where owner_gate.database_owner_session
)
select owner_gate.database_owner_session, prepared.result
from owner_gate
left join prepared on true
`,
  }),
  findActiveAuthorizationId: Object.freeze({
    managementApiReadOnly: false,
    parameterCount: 1,
    sql: `
with owner_gate as (
  ${OWNER_GATE_SQL}
), active_authorization as (
  select proof_authorization.id
  from owner_gate
  join public.refund_synthetic_gmail_proof_authorizations proof_authorization
    on owner_gate.database_owner_session
   and proof_authorization.cancelled_at is null
   and proof_authorization.refund_case_id = $1::uuid
)
select
  owner_gate.database_owner_session,
  count(active_authorization.id)::integer as active_authorization_count,
  max(active_authorization.id)::text as authorization_id
from owner_gate
left join active_authorization on true
group by owner_gate.database_owner_session
`,
  }),
  summary: Object.freeze({
    managementApiReadOnly: false,
    parameterCount: 2,
    sql: `
with owner_gate as (
  ${OWNER_GATE_SQL}
), proof_summary as (
  select public.owner_get_refund_synthetic_gmail_proof_summary(
    $1::uuid, $2::text
  ) as result
  from owner_gate
  where owner_gate.database_owner_session
)
select owner_gate.database_owner_session, proof_summary.result
from owner_gate
left join proof_summary on true
`,
  }),
  close: Object.freeze({
    managementApiReadOnly: false,
    parameterCount: 2,
    sql: `
with owner_gate as (
  ${OWNER_GATE_SQL}
), proof_close as (
  select public.owner_close_refund_synthetic_gmail_proof(
    $1::uuid, $2::text
  ) as result
  from owner_gate
  where owner_gate.database_owner_session
)
select owner_gate.database_owner_session, proof_close.result
from owner_gate
left join proof_close on true
`,
  }),
});

const assertClosedOwnerQueryRegistry = () => {
  const operationNames = Object.keys(MANAGEMENT_API_OWNER_QUERIES);
  const expectedNames = [
    'preflight',
    'canManageCase',
    'prepare',
    'findActiveAuthorizationId',
    'summary',
    'close',
  ];
  if (
    operationNames.length !== expectedNames.length ||
    expectedNames.some((name) => !operationNames.includes(name))
  ) {
    throw new Error('Management API owner query registry is not closed.');
  }
  for (const [name, operation] of Object.entries(MANAGEMENT_API_OWNER_QUERIES)) {
    if (
      operation.managementApiReadOnly !== false ||
      !Number.isInteger(operation.parameterCount) ||
      operation.parameterCount < 1 ||
      typeof operation.sql !== 'string' ||
      operation.sql.includes(';')
    ) {
      throw new Error('Management API owner query registry is invalid.');
    }
    if (
      READ_OPERATION_NAMES.has(name) &&
      (SQL_MUTATION_PATTERN.test(operation.sql) || !/^\s*(?:with\b|select\b)/iu.test(operation.sql))
    ) {
      throw new Error('Management API owner read query is not semantically read-only.');
    }
  }
};
assertClosedOwnerQueryRegistry();

export const getManagementApiOwnerQuerySnapshots = () =>
  Object.freeze(Object.fromEntries(
    Object.entries(MANAGEMENT_API_OWNER_QUERIES).map(([name, operation]) => [
      name,
      Object.freeze({
        managementApiReadOnly: operation.managementApiReadOnly,
        parameterCount: operation.parameterCount,
        sql: operation.sql,
      }),
    ]),
  ));

const genericFailure = (code) => new SyntheticGmailProofRunnerError(code);
const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const requireExactKeys = (row, expectedKeys) => {
  if (!isPlainObject(row)) throw genericFailure('management_database_response_invalid');
  const actual = Object.keys(row).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw genericFailure('management_database_response_invalid');
  }
};

const requireOwnerSession = (row) => {
  if (row.database_owner_session !== true) {
    throw genericFailure('management_database_owner_required');
  }
};

const requireBoolean = (value) => {
  if (value !== true && value !== false) {
    throw genericFailure('management_database_response_invalid');
  }
  return value;
};

const requireCount = (value) => {
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return value;
  }
  if (typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw genericFailure('management_database_response_invalid');
};

const requireResultObject = (value) => {
  if (!isPlainObject(value)) throw genericFailure('management_database_response_invalid');
  return value;
};

const createRequestSignal = ({ parentSignal, timeoutMs }) => {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(
    () => controller.abort(genericFailure('management_database_request_timeout')),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
};

export const createManagementApiOwnerDatabaseClient = ({
  projectRef,
  confirmProjectRef,
  managementToken,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = MANAGEMENT_API_REQUEST_TIMEOUT_MS,
}) => {
  if (
    projectRef !== REFUND_PRODUCTION_PROJECT_REF ||
    confirmProjectRef !== REFUND_PRODUCTION_PROJECT_REF
  ) {
    throw genericFailure('management_database_project_not_confirmed');
  }
  if (typeof managementToken !== 'string' || managementToken.length < 20) {
    throw genericFailure('management_database_token_missing');
  }
  if (typeof fetchImpl !== 'function' || !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
    throw genericFailure('management_database_configuration_invalid');
  }

  const endpoint =
    `https://api.supabase.com/v1/projects/${REFUND_PRODUCTION_PROJECT_REF}/database/query`;

  const query = async (operationName, parameters, signal) => {
    const operation = MANAGEMENT_API_OWNER_QUERIES[operationName];
    if (
      !operation ||
      !Array.isArray(parameters) ||
      parameters.length !== operation.parameterCount
    ) {
      throw genericFailure('management_database_operation_invalid');
    }
    const request = createRequestSignal({ parentSignal: signal, timeoutMs: requestTimeoutMs });
    try {
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${managementToken}`,
          },
          body: JSON.stringify({
            query: operation.sql,
            parameters,
            // Supabase executes read_only:true as a non-owner role. The fixed SQL
            // registry above enforces semantic read-only behavior for read lanes.
            read_only: operation.managementApiReadOnly,
          }),
          redirect: 'error',
          cache: 'no-store',
          signal: request.signal,
        });
      } catch {
        throw genericFailure(`management_database_${operationName}_failed`);
      }
      if (response?.status !== 201) {
        throw genericFailure(`management_database_${operationName}_failed`);
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw genericFailure('management_database_response_invalid');
      }
      if (!Array.isArray(body) || body.length !== 1) {
        throw genericFailure('management_database_response_invalid');
      }
      return body[0];
    } finally {
      request.dispose();
    }
  };

  return {
    async preflight({ caseId, signal }) {
      const row = await query('preflight', [caseId], signal);
      const keys = [
        'database_owner_session',
        'active_authorization_count',
        'unresolved_gmail_outbound_count',
        'eligible_case_count',
        'thread_count',
        'attachment_count',
        'manager_route_resolved',
        'manager_count',
        'automatic_customer_contact_enabled',
        'gpt_triage_enabled',
        'gpt_auto_send_enabled',
        'attachment_quarantine_approved',
      ];
      requireExactKeys(row, keys);
      requireOwnerSession(row);
      return {
        databaseOwnerSession: true,
        activeAuthorizationCount: requireCount(row.active_authorization_count),
        unresolvedGmailOutboundCount: requireCount(row.unresolved_gmail_outbound_count),
        eligibleCaseCount: requireCount(row.eligible_case_count),
        threadCount: requireCount(row.thread_count),
        attachmentCount: requireCount(row.attachment_count),
        managerRouteResolved: requireBoolean(row.manager_route_resolved),
        managerCount: requireCount(row.manager_count),
        automaticCustomerContactEnabled: requireBoolean(
          row.automatic_customer_contact_enabled,
        ),
        gptTriageEnabled: requireBoolean(row.gpt_triage_enabled),
        gptAutoSendEnabled: requireBoolean(row.gpt_auto_send_enabled),
        attachmentQuarantineApproved: requireBoolean(row.attachment_quarantine_approved),
      };
    },

    async canManageCase({ userId, caseId, signal }) {
      const row = await query('canManageCase', [userId, caseId], signal);
      requireExactKeys(row, ['database_owner_session', 'allowed']);
      requireOwnerSession(row);
      return requireBoolean(row.allowed);
    },

    async prepare({ caseId, runTokenDigest, confirmation, signal }) {
      const row = await query('prepare', [caseId, runTokenDigest, confirmation], signal);
      requireExactKeys(row, ['database_owner_session', 'result']);
      requireOwnerSession(row);
      return requireResultObject(row.result);
    },

    async findActiveAuthorizationId({ caseId, signal }) {
      const row = await query('findActiveAuthorizationId', [caseId], signal);
      requireExactKeys(row, [
        'database_owner_session',
        'active_authorization_count',
        'authorization_id',
      ]);
      requireOwnerSession(row);
      const count = requireCount(row.active_authorization_count);
      if (count === 0 && row.authorization_id === null) return null;
      if (count === 1 && UUID_PATTERN.test(row.authorization_id ?? '')) {
        return row.authorization_id;
      }
      throw genericFailure('management_database_response_invalid');
    },

    async summary({ authorizationId, confirmation, signal }) {
      const row = await query('summary', [authorizationId, confirmation], signal);
      requireExactKeys(row, ['database_owner_session', 'result']);
      requireOwnerSession(row);
      return requireResultObject(row.result);
    },

    async close({ authorizationId, confirmation, signal }) {
      const row = await query('close', [authorizationId, confirmation], signal);
      requireExactKeys(row, ['database_owner_session', 'result']);
      requireOwnerSession(row);
      return requireResultObject(row.result);
    },

    async dispose() {},
  };
};

export { MANAGEMENT_API_OWNER_DATABASE_ADAPTER };
