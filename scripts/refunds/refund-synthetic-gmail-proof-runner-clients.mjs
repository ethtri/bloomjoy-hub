import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import {
  REFUND_REPOSITORY,
  REFUND_PRODUCTION_PROJECT_REF,
  REFUND_SYNTHETIC_PROOF_MESSAGE_TYPE,
  MANAGEMENT_API_OWNER_DATABASE_ADAPTER,
  SyntheticGmailProofRunnerError,
  evaluateBackupHealth,
  sha256Hex,
} from './refund-synthetic-gmail-proof-runner-lib.mjs';
import {
  createManagementApiOwnerDatabaseClient,
} from './refund-synthetic-gmail-proof-management-api.mjs';

const execFileAsync = promisify(execFile);
const { Client } = pg;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const genericFailure = (code) => new SyntheticGmailProofRunnerError(code);
const numberValue = (value) => Number.parseInt(String(value), 10);
const createSafeChildEnvironment = (
  extra = {},
  { environment = process.env, includeWindowsGithubConfig = false } = {},
) => {
  const result = { ...extra };
  for (const name of [
    'PATH',
    'PATHEXT',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'ComSpec',
    'COMSPEC',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
  ]) {
    if (typeof environment[name] === 'string') result[name] = environment[name];
  }
  if (
    includeWindowsGithubConfig &&
    typeof environment.APPDATA === 'string' &&
    environment.APPDATA.trim()
  ) {
    result.APPDATA = environment.APPDATA;
  }
  return result;
};

const abortableFetch = async (url, options, code) => {
  try {
    return await fetch(url, { ...options, redirect: 'error', cache: 'no-store' });
  } catch {
    throw genericFailure(code);
  }
};

export const installRedactedDatabaseErrorBoundary = (client) => {
  const state = { failed: false };
  client.on('error', () => {
    state.failed = true;
  });
  return state;
};

const createDatabaseClient = ({ databaseUrl }) => {
  const client = new Client({
    connectionString: databaseUrl,
    application_name: 'bloomjoy_owner_synthetic_gmail_proof',
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    query_timeout: 15_000,
    ssl: { rejectUnauthorized: true },
  });
  const failureState = installRedactedDatabaseErrorBoundary(client);
  let connected = false;
  const connect = async () => {
    if (failureState.failed) throw genericFailure('database_connection_failed');
    if (connected) return;
    try {
      await client.connect();
      if (failureState.failed) throw genericFailure('database_connection_failed');
      connected = true;
    } catch {
      throw genericFailure('database_connect_failed');
    }
  };
  const query = async (text, values = []) => {
    if (failureState.failed) throw genericFailure('database_connection_failed');
    await connect();
    if (failureState.failed) throw genericFailure('database_connection_failed');
    try {
      return await client.query({ text, values });
    } catch {
      throw genericFailure('database_query_failed');
    }
  };

  return {
    async preflight({ caseId }) {
      const result = await query(
        `
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
  current_user = pg_get_userbyid(database.datdba)
    and session_user = pg_get_userbyid(database.datdba) as database_owner_session,
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
from pg_database database
where database.datname = current_database()
        `,
        [caseId],
      );
      const row = result.rows[0] ?? {};
      return {
        databaseOwnerSession: row.database_owner_session === true,
        activeAuthorizationCount: numberValue(row.active_authorization_count),
        unresolvedGmailOutboundCount: numberValue(row.unresolved_gmail_outbound_count),
        eligibleCaseCount: numberValue(row.eligible_case_count),
        threadCount: numberValue(row.thread_count),
        attachmentCount: numberValue(row.attachment_count),
        managerRouteResolved: row.manager_route_resolved === true,
        managerCount: numberValue(row.manager_count),
        automaticCustomerContactEnabled: row.automatic_customer_contact_enabled === true,
        gptTriageEnabled: row.gpt_triage_enabled === true,
        gptAutoSendEnabled: row.gpt_auto_send_enabled === true,
        attachmentQuarantineApproved: row.attachment_quarantine_approved === true,
      };
    },

    async canManageCase({ userId, caseId }) {
      const result = await query(
        'select public.can_manage_refund_case($1::uuid, $2::uuid) as allowed',
        [userId, caseId],
      );
      return result.rows[0]?.allowed === true;
    },

    async prepare({ caseId, runTokenDigest, confirmation }) {
      const result = await query(
        `select public.owner_prepare_refund_synthetic_gmail_proof(
          $1::uuid, $2::text, $3::text
        ) as result`,
        [caseId, runTokenDigest, confirmation],
      );
      return result.rows[0]?.result ?? null;
    },

    async findActiveAuthorizationId({ caseId }) {
      const result = await query(
        `select id from public.refund_synthetic_gmail_proof_authorizations
         where cancelled_at is null and refund_case_id = $1::uuid
         limit 1`,
        [caseId],
      );
      const id = result.rows[0]?.id;
      return UUID_PATTERN.test(id ?? '') ? id : null;
    },

    async summary({ authorizationId, confirmation }) {
      const result = await query(
        `select public.owner_get_refund_synthetic_gmail_proof_summary(
          $1::uuid, $2::text
        ) as result`,
        [authorizationId, confirmation],
      );
      return result.rows[0]?.result ?? null;
    },

    async close({ authorizationId, confirmation }) {
      const result = await query(
        `select public.owner_close_refund_synthetic_gmail_proof(
          $1::uuid, $2::text
        ) as result`,
        [authorizationId, confirmation],
      );
      return result.rows[0]?.result ?? null;
    },

    async dispose() {
      if (!connected) return;
      try {
        await client.end();
      } catch {
        // Process teardown must not expose database details.
      }
    },
  };
};

const createIdentityClient = ({ database }) => ({
  async preflight({ projectRef, caseId, anonKey, userAccessToken, signal }) {
    const response = await abortableFetch(
      `https://${projectRef}.supabase.co/auth/v1/user`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${userAccessToken}`,
        },
        signal,
      },
      'identity_lookup_failed',
    );
    if (!response.ok) throw genericFailure('identity_lookup_failed');
    let body;
    try {
      body = await response.json();
    } catch {
      throw genericFailure('identity_lookup_failed');
    }
    if (!UUID_PATTERN.test(body?.id ?? '')) throw genericFailure('identity_lookup_failed');
    const canManageCase = await database.canManageCase({ userId: body.id, caseId });
    return { authenticated: true, canManageCase };
  },
});

const secretDigestState = (secrets, name, { absent = false } = {}) => {
  const entry = secrets.find((secret) => secret?.name === name);
  if (!entry) return absent;
  const digest = String(entry.value ?? '').trim().toLowerCase();
  if (digest === sha256Hex('true')) return true;
  if (digest === sha256Hex('false')) return false;
  throw genericFailure('edge_secret_state_unrecognized');
};

const firstContactMode = (secrets) => {
  const entry = secrets.find((secret) => secret?.name === 'REFUND_GMAIL_FIRST_CONTACT_MODE');
  if (!entry) return 'absent';
  const digest = String(entry.value ?? '').trim().toLowerCase();
  if (digest === sha256Hex('disabled')) return 'disabled';
  if (digest === sha256Hex('off')) return 'off';
  throw genericFailure('first_contact_mode_not_disabled');
};

export const assertSyntheticGmailProofProductionAligned = async ({
  repoRoot,
  projectRef,
  managementToken,
  execFileImpl = execFileAsync,
  readFileImpl = fs.readFileSync,
}) => {
  if (projectRef !== REFUND_PRODUCTION_PROJECT_REF) {
    throw genericFailure('production_release_not_aligned');
  }
  try {
    const releaseScript = path.resolve(
      repoRoot,
      'scripts',
      'refunds',
      'refund-release.mjs',
    );
    await execFileImpl(
      process.execPath,
      [
        releaseScript,
        '--production',
        '--project-ref',
        projectRef,
        '--confirm-project-ref',
        projectRef,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 90_000,
        windowsHide: true,
        shell: false,
        maxBuffer: 2_000_000,
        env: createSafeChildEnvironment({ SUPABASE_ACCESS_TOKEN: managementToken }),
      },
    );
    const gateSource = readFileImpl(
      path.join(repoRoot, 'supabase/functions/_shared/nayax-refund-gates.ts'),
      'utf8',
    );
    const handlerSource = readFileImpl(
      path.join(repoRoot, 'supabase/functions/nayax-card-refund/index.ts'),
      'utf8',
    );
    if (
      !gateSource.includes('NAYAX_REFUND_OFFICIAL_ACTIONS_ENABLED = false') ||
      !handlerSource.includes('provider: disabledNayaxProviderAdapter')
    ) {
      throw genericFailure('static_provider_gate_invalid');
    }
    return true;
  } catch {
    throw genericFailure('production_release_not_aligned');
  }
};

export const getSyntheticGmailProofGithubVariable = async (
  name,
  {
    repoRoot,
    execFileImpl = execFileAsync,
    platform = process.platform,
    environment = process.env,
  },
) => {
  const gh = platform === 'win32' ? 'gh.exe' : 'gh';
  try {
    const { stdout } = await execFileImpl(
      gh,
      ['variable', 'get', name, '--repo', REFUND_REPOSITORY],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 15_000,
        windowsHide: true,
        shell: false,
        maxBuffer: 32_768,
        env: createSafeChildEnvironment(
          {},
          {
            environment,
            includeWindowsGithubConfig: platform === 'win32',
          },
        ),
      },
    );
    const value = stdout.trim().toLowerCase();
    if (value === 'true') return true;
    if (value === 'false' || value === '') return false;
    throw genericFailure('github_variable_state_unrecognized');
  } catch (error) {
    const safeStderr = typeof error?.stderr === 'string' ? error.stderr.toLowerCase() : '';
    if (safeStderr.includes('variable not found') || safeStderr.includes('could not find')) return false;
    throw genericFailure('github_variable_read_failed');
  }
};

const createControlClient = ({ projectRef, managementToken, repoRoot }) => {
  let productionAlignedPromise;
  const managementRequest = async ({ method, body, code }) => {
    const response = await abortableFetch(
      `https://api.supabase.com/v1/projects/${projectRef}/secrets`,
      {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${managementToken}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      },
      code,
    );
    if (!response.ok) throw genericFailure(code);
    return response;
  };
  const readSecrets = async () => {
    const response = await managementRequest({ method: 'GET', code: 'edge_secret_read_failed' });
    let body;
    try {
      body = await response.json();
    } catch {
      throw genericFailure('edge_secret_read_failed');
    }
    if (!Array.isArray(body)) throw genericFailure('edge_secret_read_failed');
    return body;
  };
  const readBackupHealth = async () => {
    const response = await abortableFetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/backups`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${managementToken}`,
        },
        signal: AbortSignal.timeout(15_000),
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
    if (!evaluateBackupHealth(body)) throw genericFailure('backup_not_recently_completed');
    return true;
  };
  const assertProductionAligned = () => {
    if (!productionAlignedPromise) {
      productionAlignedPromise = assertSyntheticGmailProofProductionAligned({
        repoRoot,
        projectRef,
        managementToken,
      });
    }
    return productionAlignedPromise;
  };

  return {
    async readState() {
      const [
        secrets,
        backupCompletedFresh,
        gmailSync,
        gmailRetention,
        automationSweep,
        gptTriageSync,
        productionAligned,
      ] =
        await Promise.all([
          readSecrets(),
          readBackupHealth(),
          getSyntheticGmailProofGithubVariable('REFUND_GMAIL_SYNC_ENABLED', { repoRoot }),
          getSyntheticGmailProofGithubVariable('REFUND_GMAIL_RETENTION_ENABLED', { repoRoot }),
          getSyntheticGmailProofGithubVariable('REFUND_AUTOMATION_SWEEP_ENABLED', { repoRoot }),
          getSyntheticGmailProofGithubVariable('REFUND_GPT_TRIAGE_SYNC_ENABLED', { repoRoot }),
          assertProductionAligned(),
        ]);
      return {
        edge: {
          gmailEnabled: secretDigestState(secrets, 'REFUND_GMAIL_ENABLED'),
          automaticCustomerContactEnabled: secretDigestState(
            secrets,
            'REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED',
          ),
          firstContactMode: firstContactMode(secrets),
          automationEnabled: secretDigestState(secrets, 'REFUND_AUTOMATION_ENABLED'),
          managerAgingEnabled: secretDigestState(secrets, 'REFUND_MANAGER_AGING_NOTICES_ENABLED'),
          gmailRetentionEnabled: secretDigestState(secrets, 'REFUND_GMAIL_RETENTION_ENABLED'),
          attachmentScannerEnabled: secretDigestState(
            secrets,
            'REFUND_GMAIL_ATTACHMENT_SCANNER_ENABLED',
          ),
          gptTriageEnabled: secretDigestState(secrets, 'REFUND_GPT_TRIAGE_ENABLED'),
          nayaxExecutionEnabled: secretDigestState(secrets, 'NAYAX_REFUND_EXECUTION_ENABLED'),
          nayaxDryRun: secretDigestState(secrets, 'NAYAX_REFUND_EXECUTION_DRY_RUN'),
          nayaxKillSwitch: secretDigestState(secrets, 'NAYAX_REFUND_EXECUTION_KILL_SWITCH'),
          nayaxProviderContractConfirmed: secretDigestState(
            secrets,
            'NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED',
            { absent: false },
          ),
          nayaxSponsorGoNoGo: secretDigestState(
            secrets,
            'NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO',
            { absent: false },
          ),
        },
        github: {
          gmailSyncEnabled: gmailSync,
          gmailRetentionEnabled: gmailRetention,
          automationSweepEnabled: automationSweep,
          gptTriageSyncEnabled: gptTriageSync,
        },
        release: {
          productionAligned,
          backupCompletedFresh,
          officialActionsEnabled: false,
          nayaxProviderAdapterEnabled: false,
        },
      };
    },

    async setGmailEnabled(enabled) {
      const response = await managementRequest({
        method: 'POST',
        body: [{ name: 'REFUND_GMAIL_ENABLED', value: enabled ? 'true' : 'false' }],
        code: enabled ? 'gmail_enable_failed' : 'gmail_disable_failed',
      });
      if (![200, 201].includes(response.status)) {
        throw genericFailure(enabled ? 'gmail_enable_failed' : 'gmail_disable_failed');
      }
    },
  };
};

const createEdgeClient = () => ({
  async send({ projectRef, caseId, anonKey, userAccessToken, runToken, messageType, signal }) {
    if (messageType !== REFUND_SYNTHETIC_PROOF_MESSAGE_TYPE) {
      throw genericFailure('message_type_invalid');
    }
    const response = await abortableFetch(
      `https://${projectRef}.supabase.co/functions/v1/refund-case-message-send`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${userAccessToken}`,
        },
        body: JSON.stringify({
          caseId,
          messageType: REFUND_SYNTHETIC_PROOF_MESSAGE_TYPE,
          syntheticProofRunToken: runToken,
        }),
        signal,
      },
      'send_transport_failed',
    );
    if (!response.ok) throw genericFailure('send_rejected');
    let body;
    try {
      body = await response.json();
    } catch {
      throw genericFailure('send_response_invalid');
    }
    return {
      sent: true,
      status: body?.message?.status,
      messageType: body?.message?.type,
      transport: body?.message?.transport,
    };
  },
});

export const createSyntheticGmailProofClients = (config, { repoRoot }) => {
  const database = config.databaseAdapter === MANAGEMENT_API_OWNER_DATABASE_ADAPTER
    ? createManagementApiOwnerDatabaseClient({
        projectRef: config.projectRef,
        confirmProjectRef: config.confirmProjectRef,
        managementToken: config.managementToken,
      })
    : createDatabaseClient({ databaseUrl: config.databaseUrl });
  return {
    database,
    identity: createIdentityClient({ database }),
    control: createControlClient({
      projectRef: config.projectRef,
      managementToken: config.managementToken,
      repoRoot,
    }),
    edge: createEdgeClient(),
  };
};
