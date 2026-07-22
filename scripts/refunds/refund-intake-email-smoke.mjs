#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const linkedProjectRefPath = path.join(repoRoot, 'supabase', '.temp', 'project-ref');

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXECUTION_PHRASE = 'SEND SYNTHETIC REFUND EMAILS';
const PREFLIGHT_KEYS = [
  'read_only',
  'selected_machine_count',
  'active_manager_assignment_count',
];
const EVIDENCE_KEYS = [
  'case_reference',
  'event_type',
  'recipient_count',
  'delivery_state',
];

export const parseRefundIntakeEmailSmokeArgs = (argv) => {
  const args = {
    projectRef: '',
    confirmProjectRef: '',
    machineId: '',
    executeSynthetic: false,
    authorizationPhrase: '',
    syntheticRunId: '',
    timeoutMs: 20_000,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (value === '--help' || value === '-h') {
      args.help = true;
    } else if (value === '--project-ref' && next) {
      args.projectRef = next.trim();
      index += 1;
    } else if (value === '--confirm-project-ref' && next) {
      args.confirmProjectRef = next.trim();
      index += 1;
    } else if (value === '--machine-id' && next) {
      args.machineId = next.trim();
      index += 1;
    } else if (value === '--execute-synthetic') {
      args.executeSynthetic = true;
    } else if (value === '--authorize-email-send' && next) {
      args.authorizationPhrase = next;
      index += 1;
    } else if (value === '--synthetic-run-id' && next) {
      args.syntheticRunId = next.trim();
      index += 1;
    } else if (value === '--timeout-ms' && next) {
      args.timeoutMs = Number(next);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${value}`);
    }
  }

  return args;
};

export const validateRefundIntakeEmailSmokeArgs = (args, env = process.env) => {
  if (!PROJECT_REF_PATTERN.test(args.projectRef)) {
    throw new Error('--project-ref must be a 20-character lowercase Supabase project reference.');
  }
  if (args.confirmProjectRef !== args.projectRef) {
    throw new Error('--confirm-project-ref must exactly match --project-ref.');
  }
  if (!UUID_PATTERN.test(args.machineId)) {
    throw new Error('--machine-id must be the privately approved refund-intake machine UUID.');
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 5_000 || args.timeoutMs > 60_000) {
    throw new Error('--timeout-ms must be an integer from 5000 to 60000.');
  }

  if (!args.executeSynthetic) {
    if (args.authorizationPhrase || args.syntheticRunId) {
      throw new Error('--authorize-email-send and --synthetic-run-id are valid only with --execute-synthetic.');
    }
    return { customerEmail: '' };
  }

  if (args.authorizationPhrase !== EXECUTION_PHRASE) {
    throw new Error(`--execute-synthetic requires --authorize-email-send "${EXECUTION_PHRASE}".`);
  }
  if (!UUID_PATTERN.test(args.syntheticRunId)) {
    throw new Error('--execute-synthetic requires a UUID --synthetic-run-id; reuse it after any uncertain retry.');
  }

  const customerEmail = String(env.REFUND_SMOKE_CUSTOMER_EMAIL || '').trim().toLowerCase();
  const confirmedEmail = String(env.REFUND_SMOKE_CONFIRM_CUSTOMER_EMAIL || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(customerEmail)) {
    throw new Error('REFUND_SMOKE_CUSTOMER_EMAIL must contain the approved synthetic test inbox.');
  }
  if (confirmedEmail !== customerEmail) {
    throw new Error('REFUND_SMOKE_CONFIRM_CUSTOMER_EMAIL must exactly match REFUND_SMOKE_CUSTOMER_EMAIL.');
  }

  return { customerEmail };
};

export const buildRefundIntakeEmailPreflightQuery = (machineId) => {
  if (!UUID_PATTERN.test(machineId)) throw new Error('Invalid machine UUID.');
  return `
with selected_machine as (
  select rm.id
  from public.reporting_machines rm
  join public.reporting_locations rl on rl.id = rm.location_id
  where rm.id = '${machineId}'::uuid
    and rm.status = 'active'
    and rl.status = 'active'
    and rm.machine_type in ('commercial', 'mini')
    and rm.refund_intake_enabled = true
), manager_assignments as (
  select count(*)::integer as assignment_count
  from public.reporting_machine_refund_managers rfrm
  join selected_machine sm on sm.id = rfrm.reporting_machine_id
  where rfrm.status = 'active'
    and rfrm.revoked_at is null
)
select
  true as read_only,
  (select count(*)::integer from selected_machine) as selected_machine_count,
  (select assignment_count from manager_assignments) as active_manager_assignment_count;
`.trim();
};

export const buildRefundIntakeEmailEvidenceQuery = (refundCaseId) => {
  if (!UUID_PATTERN.test(refundCaseId)) throw new Error('Invalid refund case UUID.');
  return `
with selected_case as (
  select id, public_reference
  from public.refund_cases
  where id = '${refundCaseId}'::uuid
), manager_delivery as (
  select
    sc.public_reference as case_reference,
    rce.event_type,
    greatest(coalesce((rce.metadata ->> 'recipient_count')::integer, 0), 0) as recipient_count,
    case
      when rce.event_type = 'manager_notification_sent' then 'sent'
      else 'failed'
    end as delivery_state
  from selected_case sc
  join lateral (
    select event_type, metadata
    from public.refund_case_events
    where refund_case_id = sc.id
      and event_type in ('manager_notification_sent', 'manager_notification_failed')
    order by created_at desc
    limit 1
  ) rce on true
), customer_delivery as (
  select
    sc.public_reference as case_reference,
    'customer_acknowledgement'::text as event_type,
    case when rcm.status = 'sent' then 1 else 0 end as recipient_count,
    rcm.status::text as delivery_state
  from selected_case sc
  join lateral (
    select status
    from public.refund_case_messages
    where refund_case_id = sc.id
      and message_type in ('confirmation', 'more_info')
    order by created_at desc
    limit 1
  ) rcm on true
)
select case_reference, event_type, recipient_count, delivery_state from manager_delivery
union all
select case_reference, event_type, recipient_count, delivery_state from customer_delivery
order by event_type;
`.trim();
};

export const buildExistingSyntheticRunQuery = (machineId, syntheticRunId) => {
  if (!UUID_PATTERN.test(machineId)) throw new Error('Invalid machine UUID.');
  if (!UUID_PATTERN.test(syntheticRunId)) throw new Error('Invalid synthetic run UUID.');
  const marker = `[SYNTHETIC PRODUCTION SMOKE] Run ${syntheticRunId}. Intake and email delivery verification. No customer incident.`;
  return `
select id, public_reference
from public.refund_cases
where reporting_machine_id = '${machineId}'::uuid
  and customer_name = 'Bloomjoy Refund Smoke'
  and issue_summary = '${marker}'
order by created_at desc
limit 2;
`.trim();
};

export const validateExistingSyntheticRun = (rows) => {
  if (!Array.isArray(rows) || rows.length > 1) {
    throw new Error('Synthetic run ID resolved to multiple cases; stop and review privately.');
  }
  if (rows.length === 0) return null;
  const row = rows[0];
  assertExactKeys(row, ['id', 'public_reference'], 'Existing synthetic run lookup');
  if (!UUID_PATTERN.test(String(row.id || '')) || !/^RF-[A-Z0-9-]+$/.test(String(row.public_reference || ''))) {
    throw new Error('Existing synthetic run lookup returned an invalid case marker.');
  }
  return { id: row.id, publicReference: row.public_reference };
};

const assertExactKeys = (row, expectedKeys, label) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`${label} returned an invalid row.`);
  }
  if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...expectedKeys].sort())) {
    throw new Error(`${label} returned unexpected columns; refusing to print them.`);
  }
};

export const validateRefundIntakeEmailPreflight = (row) => {
  assertExactKeys(row, PREFLIGHT_KEYS, 'Refund intake email preflight');
  if (row.read_only !== true) throw new Error('Refund intake email preflight did not affirm read-only mode.');
  for (const key of PREFLIGHT_KEYS.filter((key) => key !== 'read_only')) {
    if (!Number.isInteger(row[key]) || row[key] < 0) {
      throw new Error(`Refund intake email preflight ${key} is invalid.`);
    }
  }
  return {
    ...row,
    ready: row.selected_machine_count === 1 && row.active_manager_assignment_count > 0,
  };
};

export const validateRefundIntakeEmailEvidence = (rows, expectedReference) => {
  if (!Array.isArray(rows) || rows.length !== 2) {
    throw new Error('Refund intake email smoke requires exactly two sanitized delivery rows.');
  }
  for (const row of rows) {
    assertExactKeys(row, EVIDENCE_KEYS, 'Refund intake email evidence');
    if (row.case_reference !== expectedReference || !/^RF-[A-Z0-9-]+$/.test(row.case_reference)) {
      throw new Error('Refund intake email evidence returned an unexpected case reference.');
    }
    if (!Number.isInteger(row.recipient_count) || row.recipient_count < 0) {
      throw new Error('Refund intake email evidence returned an invalid recipient count.');
    }
  }

  const manager = rows.find((row) => row.event_type === 'manager_notification_sent');
  const customer = rows.find((row) => row.event_type === 'customer_acknowledgement');
  const passed = Boolean(
    manager?.delivery_state === 'sent' && manager.recipient_count > 0 &&
    customer?.delivery_state === 'sent' && customer.recipient_count === 1,
  );
  return { rows, passed };
};

const runLinkedQuery = (query) => {
  const result = spawnSync(
    'supabase',
    ['db', 'query', '--linked', '--output', 'json', '--agent=yes', '--', query],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error('Linked query failed. Review the command locally; output is suppressed to protect the private machine selection.');
  }
  try {
    const payload = JSON.parse(result.stdout);
    if (!Array.isArray(payload.rows)) throw new Error();
    return payload.rows;
  } catch {
    throw new Error('Linked query returned invalid JSON.');
  }
};

const verifyLinkedProject = (projectRef) => {
  if (!fs.existsSync(linkedProjectRefPath)) {
    throw new Error('No linked Supabase project was found in this worktree.');
  }
  const linkedProjectRef = fs.readFileSync(linkedProjectRefPath, 'utf8').trim();
  if (linkedProjectRef !== projectRef) {
    throw new Error(`Linked project ref does not match --project-ref ${projectRef}.`);
  }
};

export const invokeSyntheticRefundIntake = async ({
  projectRef,
  machineId,
  customerEmail,
  timeoutMs,
  syntheticRunId,
  fetchImpl = fetch,
  now = () => new Date(),
}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const incidentAt = now().toISOString();
  const payload = {
    machineId,
    customerEmail,
    customerName: 'Bloomjoy Refund Smoke',
    paymentMethod: 'card',
    paymentAmount: '0.01',
    cardLast4: '0000',
    cardWalletUsed: false,
    incidentAt,
    issueSummary: `[SYNTHETIC PRODUCTION SMOKE] Run ${syntheticRunId}. Intake and email delivery verification. No customer incident.`,
    attachments: [],
  };

  try {
    const response = await fetchImpl(`https://${projectRef}.supabase.co/functions/v1/refund-case-intake`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'bloomjoy-refund-intake-email-smoke/1.0',
      },
      body: JSON.stringify(payload),
      redirect: 'manual',
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Synthetic refund intake returned HTTP ${response.status}.`);
    const refundCase = data?.refundCase;
    if (!UUID_PATTERN.test(String(refundCase?.id || ''))) {
      throw new Error('Synthetic refund intake did not return a valid case ID.');
    }
    if (!/^RF-[A-Z0-9-]+$/.test(String(refundCase?.publicReference || ''))) {
      throw new Error('Synthetic refund intake did not return a valid public reference.');
    }
    return {
      id: refundCase.id,
      publicReference: refundCase.publicReference,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const printHelp = () => {
  console.log(`Refund intake/email production smoke

Read-only preflight (no case or email):
  npm run refunds:smoke-intake-email -- --project-ref <ref> --confirm-project-ref <ref> --machine-id <approved-uuid>

Authorized synthetic submission (creates one retained audit case and sends customer,
assigned-manager, and operations-fallback emails):
  Set REFUND_SMOKE_CUSTOMER_EMAIL and REFUND_SMOKE_CONFIRM_CUSTOMER_EMAIL to the
  same owner-approved test inbox, then add:
  --execute-synthetic --synthetic-run-id <new-uuid> --authorize-email-send "${EXECUTION_PHRASE}"

The command never prints the test inbox, machine ID, customer fields, or message
content. Reuse the same run UUID after an uncertain retry; the command reuses the
existing case instead of sending again. Final evidence is limited to case reference,
event type, recipient count, and delivery state.`);
};

const main = async () => {
  const args = parseRefundIntakeEmailSmokeArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const { customerEmail } = validateRefundIntakeEmailSmokeArgs(args);
  verifyLinkedProject(args.projectRef);

  const preflightRows = runLinkedQuery(buildRefundIntakeEmailPreflightQuery(args.machineId));
  if (preflightRows.length !== 1) throw new Error('Refund intake email preflight must return one row.');
  const preflight = validateRefundIntakeEmailPreflight(preflightRows[0]);
  console.log('Refund intake/email production smoke');
  console.log(`Project ref: ${args.projectRef}`);
  console.log('Read-only preflight: yes');
  console.log(`Selected public machine ready: ${preflight.selected_machine_count === 1 ? 'yes' : 'no'}`);
  console.log(`Active assigned-manager count: ${preflight.active_manager_assignment_count}`);
  if (!preflight.ready) {
    throw new Error('Selected machine is not public-intake ready with an active assigned manager.');
  }

  if (!args.executeSynthetic) {
    console.log('Synthetic submission: NOT RUN');
    console.log('No case was created and no email was sent.');
    return;
  }

  console.log('Synthetic submission: AUTHORIZED');
  const existingRows = runLinkedQuery(buildExistingSyntheticRunQuery(args.machineId, args.syntheticRunId));
  let refundCase = validateExistingSyntheticRun(existingRows);
  if (refundCase) {
    console.log('Synthetic run: REUSED EXISTING CASE; no email was sent again');
  } else {
    refundCase = await invokeSyntheticRefundIntake({
      projectRef: args.projectRef,
      machineId: args.machineId,
      customerEmail,
      timeoutMs: args.timeoutMs,
      syntheticRunId: args.syntheticRunId,
    });
    console.log('Synthetic run: CREATED ONE CASE');
  }
  const evidenceRows = runLinkedQuery(buildRefundIntakeEmailEvidenceQuery(refundCase.id));
  const evidence = validateRefundIntakeEmailEvidence(evidenceRows, refundCase.publicReference);
  for (const row of evidence.rows) {
    console.log(
      `Case ${row.case_reference}: ${row.event_type}; recipients=${row.recipient_count}; delivery=${row.delivery_state}`,
    );
  }
  console.log(`Overall: ${evidence.passed ? 'PASS' : 'FAIL'}`);
  console.log('No inbox, machine ID, customer fields, payment data, or message content was printed or written.');
  if (!evidence.passed) process.exitCode = 2;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERROR: ${message}`);
    process.exit(1);
  });
}
