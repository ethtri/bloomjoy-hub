#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8')
  .replace(/\r\n/gu, '\n');
let assertions = 0;
const check = (condition, message) => {
  assertions += 1;
  assert.ok(condition, message);
};

const migration = read('supabase/migrations/202608140002_refund_nayax_controlled_owner_pilot.sql');
const handler = read('supabase/functions/nayax-card-refund/index.ts');
const controlledPilotHandler = handler.slice(
  handler.indexOf('if (operation === "controlled_owner_pilot")'),
  handler.indexOf('const normalAccountKey'),
);
const stepUp = read('supabase/functions/refund-manager-action-step-up/index.ts');
const officialAction = read('supabase/functions/_shared/refund-official-action.ts');
const runner = read('scripts/refunds/nayax-controlled-owner-pilot-runner.mjs');
const runnerLib = read('scripts/refunds/nayax-controlled-owner-pilot-runner-lib.mjs');
const runnerTests = read('scripts/refunds/nayax-controlled-owner-pilot-runner.test.mjs');
const runnerClients = read('scripts/refunds/nayax-controlled-owner-pilot-runner-clients.mjs');
const runnerConfig = read('scripts/refunds/nayax-controlled-owner-pilot-runner-config.mjs');
const packageJson = JSON.parse(read('package.json'));
const currentStatus = read('Docs/CURRENT_STATUS.md');
const runbook = read('Docs/REFUND_NAYAX_CONTROLLED_OWNER_PILOT.md');
const nayaxDocs = read('Docs/NAYAX_LYNX_API.md');
const productionRunbook = read('Docs/PRODUCTION_RUNBOOK.md');
const qaChecklist = read('Docs/QA_SMOKE_TEST_CHECKLIST.md');
const cutoverPacket = read('Docs/REFUND_PRODUCTION_CUTOVER_PACKET.md');

const customConsumeStart = migration.indexOf(
  'create or replace function public.admin_consume_refund_nayax_controlled_pilot_intent(',
);
const caseTransition = migration.indexOf(
  "set status = 'card_refund_pending'",
  customConsumeStart,
);
const receiptInsert = migration.indexOf(
  'insert into public.refund_case_official_action_authorizations',
  customConsumeStart,
);
const atomicReservation = migration.indexOf(
  'reservation := public.service_reserve_and_consume_nayax_controlled_pilot_attempt(',
  customConsumeStart,
);
const customConsumeEnd = migration.indexOf(
  'create or replace function public.service_reserve_and_consume_nayax_controlled_pilot_attempt(',
  customConsumeStart,
);
check(
  customConsumeStart >= 0 && caseTransition > customConsumeStart &&
    receiptInsert > caseTransition && atomicReservation > receiptInsert &&
    atomicReservation < customConsumeEnd,
  'TOTP, case transition, receipt, and provider reservation share one DB transaction.',
);
check(
  officialAction.includes('admin_consume_refund_nayax_controlled_pilot_intent') &&
    officialAction.includes('pilotReservation') &&
    handler.includes('authorization.pilotReservation') &&
    !handler.includes('service_reserve_and_consume_nayax_controlled_pilot_attempt'),
  'Edge consumes the reservation returned by the custom TOTP RPC and has no second reservation call.',
);
check(
    migration.includes('owner_recover_expired_refund_nayax_controlled_pilot()') &&
    migration.includes("recovery_tombstone_id constant uuid") &&
    migration.includes("worker_lease_expires_at > clock_timestamp()") &&
    migration.includes("worker_terminal_status = 'forced_unknown'") &&
    migration.includes("set nayax_refunds_enabled = false") &&
    migration.includes("set status = 'revoked'"),
  'No-target recovery waits out the worker lease, then closes lost consumed work as an exact provider hold.',
);
check(
  migration.includes('service_validate_nayax_controlled_pilot_postarm') &&
    handler.includes('service_validate_nayax_controlled_pilot_postarm') &&
    handler.includes('pilot_machine_not_exactly_armed') &&
    handler.indexOf('service_validate_nayax_controlled_pilot_postarm') <
      handler.indexOf('authorizeRefundOfficialAction({'),
  'The runner-only Edge path proves the exact post-arm authorization, machine, and cap before TOTP.',
);
check(
  migration.includes("'request_started', 'request_result', 'approve_started', 'approve_result'") &&
    migration.includes('Controlled Nayax pilot stage evidence is immutable'),
  'The four-stage journal is ordered and immutable.',
);
check(
  migration.includes('p_contract_digest text') &&
    migration.includes('contract_digest is distinct from lower(p_contract_digest)') &&
    migration.includes('p_sponsor_confirmation_digest text') &&
    migration.includes('p_dtm_owner_operator_proof_digest text'),
  'The exact contract, sponsor, and DTM evidence digests are DB-bound.',
);
check(
  migration.includes('computed_customer_email_digest is distinct from computed_owner_email_digest') &&
    migration.includes('refund_nayax_controlled_pilot_self_attestation_hash') &&
    migration.includes('computed_self_case_attestation_digest') &&
    migration.includes('computed_account_key_digest is distinct from lower(p_account_key_digest)') &&
    migration.includes('guard_refund_nayax_controlled_pilot_binding_immutable'),
  'The immutable authorization binds Auth owner email, self-case/card/amount attestation, machine, and account key.',
);
check(
  migration.includes('current_customer_email_digest is distinct from pilot.owner_email_digest') &&
    migration.includes('current_owner_email_digest is distinct from pilot.owner_email_digest') &&
    migration.includes('current_self_case_attestation_digest is distinct from') &&
    migration.includes("raise exception 'Reviewed controlled pilot self-owner evidence changed'") &&
    migration.includes('from auth.users owner_user') &&
    migration.includes('for share;'),
  'Atomic TOTP consumption revalidates the locked self-owner/Auth/case attestation before reservation.',
);
check(
  migration.includes('worker_lease_id') &&
    migration.includes('worker_lease_expires_at') &&
    migration.includes('worker_terminal_at') &&
    migration.includes('p_worker_lease_id') &&
    migration.includes("worker_terminal_status = 'forced_unknown'") &&
    migration.includes("'status', 'worker_active'") &&
    handler.includes('const workerLeaseId = crypto.randomUUID()'),
  'A durable exact worker lease prevents close or recovery from racing captured provider credentials.',
);
check(
  migration.includes("'providerCallCountStatus', case") &&
    migration.includes("when consumed_attempt_count = 1 then 'unknown'") &&
    runnerLib.includes("consumedAttemptCount === 0 ? { providerCallCount: 0 } : {}") &&
    runner.includes("'consumedAttemptCount', 'providerCallCount', 'providerCallCountStatus'") &&
    runnerTests.includes("providerCallCountStatus, 'unknown'") &&
    runnerTests.includes("Object.hasOwn(result, 'providerCallCount'), false"),
  'Consumed hard-crash recovery exposes unknown provider-call cardinality and never fabricates numeric zero.',
);
check(
  runnerLib.includes("const PRODUCTION_NAYAX_REFUND_BASE_URL = 'https://lynx.nayax.com/operational/v1'") &&
    runnerLib.includes("fail('provider_contract_host_invalid')") &&
    handler.includes('parseNayaxRefundProviderContract(rawContract)') &&
    handler.includes('parsedPilotContract.baseUrl !== "https://lynx.nayax.com/operational/v1"') &&
    runnerTests.includes('live configuration rejects the QA host'),
  'The owner-live ceremony and Edge pilot accept only the exact production Nayax host.',
);
check(
  !runnerConfig.includes('REFUND_NAYAX_PILOT_PROVIDER_EMAIL_CONFIRMATION') &&
    !runnerLib.includes('providerEmailBehavior') &&
    !runner.includes('providerEmailBehavior') &&
    runner.includes('selectNayaxControlledPilotFailureDetails(error.details)') &&
    runnerTests.includes('schemaVersion: 2') &&
    runnerTests.includes('failure output retains only fixed approved aggregate fields') &&
    runbook.includes('schema-v2 contract'),
  'The retired runner uses the hardened schema-v2 contract and exposes no unwired provider-email assertion.',
);
check(
  migration.includes("when authorization_row.status = 'consumed' then 1") &&
    runnerClients.includes('historical_consumed_count') &&
    runnerLib.includes('number(state.historical_consumed_count) !== consumedAttemptCount') &&
    runnerTests.includes('repeated recovery preserves every terminal consumed pilot as unknown history'),
  'Repeated recovery can never relabel durable consumed provider history as proven zero.',
);
check(
  migration.includes("provider_result in ('contract_match', 'contract_mismatch')") &&
    migration.includes("'http_success', 'http_failure', 'transport_timeout', 'transport_network'") &&
    migration.includes('classification_digest') &&
    handler.includes('p_contract_matched') && handler.includes('p_classification_digest') &&
    !migration.includes('provider_result text not null') &&
    !handler.includes('sanitizeProviderCode'),
  'The journal persists only fixed provider classes and a digest, never unmatched Result/Status text.',
);
check(
  /create or replace function public\.refund_nayax_controlled_pilot_audit_retention_approved\(\)[\s\S]*?as \$\$\s*select false;\s*\$\$;/u.test(migration) &&
    migration.includes('Controlled Nayax pilot audit retention approval is required'),
  'Live authorization is hard-blocked until a separate reviewed audit-retention policy and purge procedure exist.',
);
check(
  handler.includes('NAYAX_REFUND_OFFICIAL_ACTIONS_ENABLED') &&
    handler.includes('global_official_actions_not_closed') &&
    handler.includes('global_execution_not_closed') &&
    handler.includes('global_kill_switch_not_closed'),
  'The pilot requires every broad official/provider gate to remain closed.',
);
check(
  controlledPilotHandler.includes('NAYAX_REFUND_REQUEST_WRITE_TOKEN_${accountKey}') &&
    controlledPilotHandler.includes('NAYAX_REFUND_APPROVE_WRITE_TOKEN_${accountKey}') &&
    !controlledPilotHandler.includes('NAYAX_LYNX_API_TOKEN_') &&
    !controlledPilotHandler.includes('NAYAX_LYNX_API_TOKEN"'),
  'The controlled owner-pilot adapter has no reporting/lookup token fallback.',
);
for (const forbidden of [
  'body?.requestWriteToken', 'body?.approveWriteToken', 'body?.accountKey',
  'body?.providerContract', 'body?.providerAdapter', 'body?.baseUrl',
]) {
  check(!handler.includes(forbidden), `Request input cannot select ${forbidden}.`);
}
check(
    stepUp.includes('frozenPayload?.operation === "controlled_owner_pilot"') &&
    stepUp.includes('x-bloomjoy-nayax-pilot-assertion') &&
    (runnerClients.match(/functions\/v1\/refund-manager-action-step-up/gu) ?? [])
      .length === 1 &&
    runnerClients.includes("targetFunction: 'nayax-card-refund'") &&
    !runnerClients.includes('for (let providerAttempt'),
  'Only the checked-in owner runner can select the one-POST pilot operation.',
);
check(
  handler.includes('customerCompletionAttempted: false') &&
    handler.includes('providerOnly: true') &&
    !runner.includes('GMAIL_') && !runner.includes('customer_email'),
  'The pilot is provider-only with no Gmail/customer completion path.',
);
check(
  runnerLib.includes("mode === 'dry-run'") &&
    runnerLib.indexOf("mode === 'dry-run'") < runnerLib.indexOf('clients.authorize({'),
  'Dry-run returns before authorization or TOTP/provider execution.',
);
const authorizeIndex = runnerLib.indexOf('clients.authorize({');
const readyForTotpIndex = runnerLib.indexOf("emit(logger, 'ready_for_private_totp')");
const readFreshTotpIndex = runnerLib.indexOf('readFreshTotp({ signal })');
const executeIndex = runnerLib.indexOf('clients.execute({');
check(
  authorizeIndex >= 0 && readyForTotpIndex > authorizeIndex &&
    readFreshTotpIndex > readyForTotpIndex && executeIndex > readFreshTotpIndex,
  'The private TOTP prompt is armed only after authorization and immediately before the sole Edge POST.',
);
check(
  ['initialize', 'retire', 'recover', 'dry-run'].every((mode) =>
    runnerLib.indexOf(`mode === '${mode}'`) >= 0 &&
    runnerLib.indexOf(`mode === '${mode}'`) < readyForTotpIndex),
  'Every non-live mode returns before the private TOTP prompt.',
);
check(
  !/(?:TOTP|totp|_CODE|codeField)/u.test(runnerConfig),
  'The private packet allowlist and config contain no TOTP/code field.',
);
check(
  runner.includes('process.stdin.isTTY') && runner.includes('process.stderr.isTTY') &&
    runner.includes('process.stdin.setRawMode(true)') &&
    runner.includes("process.stderr.write('Enter current owner TOTP (input hidden): ')") &&
    !runner.includes('process.stdout.write'),
  'The live CLI requires an interactive raw TTY and never echoes the TOTP.',
);
check(
  runnerLib.includes('conclusivelyCloseNayaxControlledPilot') &&
    runnerLib.includes("effectsClassification: 'outcome_unknown'") &&
    runnerLib.includes('gatesConclusivelyClosed'),
  'Closure and effects classification remain independent and fail closed.',
);
check(
  runnerClients.includes("'NAYAX_REFUND_EXECUTOR_ASSERTION'") &&
    runnerClients.includes("method: 'DELETE'") &&
    !runnerClients.match(/initializePilotSecrets[\s\S]*?name: 'NAYAX_REFUND_IDEMPOTENCY_SECRET'/u),
  'Initialization preserves the existing idempotency secret and retirement removes the executor.',
);
check(
  runnerConfig.includes('fs.realpathSync(repoRoot)') &&
    runnerConfig.includes('fs.realpathSync(path.resolve(envFile))') &&
    !runnerConfig.includes('...process.env'),
  'The private packet is canonicalized outside the repo and ambient env cannot override it.',
);
check(
  !runner.includes('console.log') && !runner.includes('authorizationId') &&
    !runner.includes('intentId') && !runner.includes('caseId'),
  'CLI output has no private case, intent, or authorization identifiers.',
);
check(
  packageJson.scripts['refunds:nayax-controlled-owner-pilot'] ===
    'node scripts/refunds/nayax-controlled-owner-pilot-runner.mjs' &&
    packageJson.scripts['refunds:validate-nayax-controlled-owner-pilot']
      .includes('nayax-controlled-owner-pilot-runner.test.mjs'),
  'Package scripts expose only the checked-in runner and its validation.',
);
check(
  currentStatus.includes('#430') &&
    currentStatus.includes('database and Edge release is deployed') &&
    currentStatus.includes('zero provider attempts') &&
    currentStatus.includes('single owner-authorized $10.90 East Ridge acceptance'),
  'CURRENT_STATUS distinguishes the deployed fail-closed release from the still-pending live provider acceptance.',
);
check(
  runbook.includes('provider-only owner smoke') &&
    /one refund-request POST and at most one refund-approve POST/iu.test(runbook) &&
    runbook.includes('owner runs this privately') &&
    runbook.includes('metadata reconciliation') &&
    /no blind replay/iu.test(runbook) &&
    runbook.includes('A TOTP is never stored in the packet') &&
    !/(?:TOTP|totp)[^\n]{0,40}=/u.test(runbook),
  'The checked-in ceremony states the provider-only, human-private, no-retry boundary.',
);
check(
  runbook.includes('normalized authenticated-owner email digest') &&
    runbook.includes('worker lease is active') &&
    runbook.includes('Nayax-originated email') &&
    runbook.includes('refund_operations_owner') &&
    runbook.includes('there is no automatic purge') &&
    runbook.includes('Delete every local private packet') &&
    runbook.includes('Revoke the short-lived Supabase Management token'),
  'The ceremony documents self-ownership, lease-aware recovery, provider-email truth, unresolved retention, and private credential teardown.',
);
check(
  nayaxDocs.includes('controlled owner pilot') &&
    nayaxDocs.includes('normal portal action remains unavailable') &&
    nayaxDocs.includes('it has not been write-tested or confirmed broken') &&
    nayaxDocs.includes('must never be used as a permission probe') &&
    nayaxDocs.includes('existing reporting token must never be used as a write-permission probe or fallback') &&
    !nayaxDocs.includes('whether the existing reporting token has refund request and approval permissions'),
  'Nayax API documentation distinguishes the runner-only pilot from product execution.',
);
check(
  productionRunbook.includes('Nayax card-refund operation (current authority)') &&
    productionRunbook.includes('eligible customer case of $10 or less') &&
    productionRunbook.includes('One immutable generation permits at most one Nayax request and one approval') &&
    productionRunbook.includes('Docs/REFUND_NAYAX_CONTROLLED_OWNER_PILOT.md') &&
    productionRunbook.includes('historical documentation for the retired owner-only runner') &&
    productionRunbook.includes('There is no bulk-refund action'),
  'The production runbook makes the real-customer path authoritative while preserving exactly-once controls.',
);
check(
  qaChecklist.includes('ten-function/51-migration default-off foundation') &&
    qaChecklist.includes('npm run refunds:validate-nayax-controlled-owner-pilot') &&
    qaChecklist.includes('historical regression check for the retired `#430` runner') &&
    qaChecklist.includes('legitimate unresolved customer refund of $10 or less') &&
    qaChecklist.includes('at most one Nayax request and one approval') &&
    qaChecklist.includes('There is no bulk-refund action'),
  'The smoke checklist retains historical regression coverage without reintroducing pilot ceremony.',
);
check(
  !read('.github/workflows/refund-automation-sweep.yml').includes('controlled_owner_pilot') &&
    !read('src/pages/admin/Refunds.tsx').includes('controlled_owner_pilot'),
  'No schedule or portal UI exposes the controlled pilot.',
);
check(
  !controlledPilotHandler.includes('NAYAX_LYNX_API_TOKEN_') &&
    !runnerConfig.includes('REFUND_NAYAX_PILOT_PROVIDER_ADAPTER') &&
    !runnerConfig.includes('REFUND_NAYAX_PILOT_REQUEST_TARGET') &&
    !controlledPilotHandler.includes('customerCompletionAttempted: true') &&
    !read('.github/workflows/refund-automation-sweep.yml')
      .includes('nayax-controlled-owner-pilot'),
  'Static source forbids reporting-token fallback, runtime adapter/target selection, completion, and scheduling.',
);
for (const stale of [
  /10 functions \/ 50 migrations/iu,
  /10-function\/50-migration/iu,
  /reporting token[^\n]{0,100}(?:write fallback|permission probe is allowed)/iu,
  /retention (?:is|has been) resolved/iu,
]) {
  check(
    ![currentStatus, runbook, nayaxDocs, productionRunbook, qaChecklist, cutoverPacket]
      .some((document) => stale.test(document)),
    `Operational documents reject stale or unsafe controlled-pilot wording: ${stale}.`,
  );
}

process.stdout.write(`Controlled Nayax owner pilot validated (${assertions} assertions).\n`);
