#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const cli = read('scripts/refunds/refund-synthetic-gmail-proof-runner.mjs');
const clients = read('scripts/refunds/refund-synthetic-gmail-proof-runner-clients.mjs');
const managementApi = read('scripts/refunds/refund-synthetic-gmail-proof-management-api.mjs');
const library = read('scripts/refunds/refund-synthetic-gmail-proof-runner-lib.mjs');
const portal = read('src/pages/admin/Refunds.tsx');
const portalClient = read('src/lib/refundOperations.ts');
const runbook = read('Docs/PRODUCTION_RUNBOOK.md');
const checklist = read('Docs/QA_SMOKE_TEST_CHECKLIST.md');
const cutoverPacket = read('Docs/REFUND_PRODUCTION_CUTOVER_PACKET.md');
const emailRunbook = read('Docs/REFUND_EMAIL_ASSISTANT_RUNBOOK.md');
const emailPilotUat = read('Docs/REFUND_EMAIL_PILOT_UAT_SCRIPT.md');
const gmailDataHandling = read('Docs/REFUND_GMAIL_DATA_HANDLING.md');
const firstContactCutover = read('Docs/REFUND_GMAIL_FIRST_CONTACT_CUTOVER.md');
const demoPacket = read('Docs/REFUND_EMAIL_PILOT_DEMO_PACKET.md');
const currentStatus = read('Docs/CURRENT_STATUS.md');
const envExample = read('.env.example');
const packageJson = JSON.parse(read('package.json'));

assert.match(library, /ygbzkgxktzqsiygjlqyg/u, 'Runner must pin the exact production project');
assert.match(library, /RUN_ONE_OWNER_CONTROLLED_SYNTHETIC_GMAIL_PROOF/u);
assert.match(library, /PREPARE_ONE_OWNER_CONTROLLED_SYNTHETIC_GMAIL_SEND/u);
assert.match(library, /READ_REDACTED_SYNTHETIC_GMAIL_PROOF/u);
assert.match(library, /CLOSE_SYNTHETIC_GMAIL_PROOF_WINDOW/u);
assert.match(library, /randomBytes\(32\)\.toString\('base64url'\)/u);
assert.match(library, /ensureGmailDisabled/u);
assert.match(library, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/u);
assert.match(library, /if \(gmailDisabled\)[\s\S]*database\.close/u);
assert.doesNotMatch(library, /logger\([^\n]*(?:caseId|authorizationId|runToken|userAccessToken)/u);

assert.match(clients, /refund-case-message-send/u);
assert.match(clients, /createManagementApiOwnerDatabaseClient/u);
assert.match(
  clients,
  /const database = config\.databaseAdapter === MANAGEMENT_API_OWNER_DATABASE_ADAPTER[\s\S]*identity: createIdentityClient\(\{ database \}\)/u,
  'Identity authorization and runner operations must use the same selected database adapter',
);
assert.match(clients, /client\.on\('error', \(\) => \{/u);
assert.match(clients, /failureState\.failed/u);
assert.match(clients, /\/database\/backups/u);
assert.match(clients, /status in \('pending_send', 'delivery_unknown'\)/u);
assert.match(
  clients,
  /JSON\.stringify\(\{\s*caseId,\s*messageType: REFUND_SYNTHETIC_PROOF_MESSAGE_TYPE,\s*syntheticProofRunToken: runToken,\s*\}\)/u,
  'The live request must have only the exact fixed proof fields',
);
assert.doesNotMatch(clients, /REFUND_SYNTHETIC_GMAIL_PROOF_(?:RECIPIENT|SUBJECT|BODY|ENDPOINT)/u);
assert.doesNotMatch(clients, /env:\s*\{\s*\.\.\.process\.env/u);
assert.match(clients, /getSyntheticGmailProofGithubVariable/u);
assert.match(clients, /includeWindowsGithubConfig: platform === 'win32'/u);
assert.match(
  clients,
  /includeWindowsGithubConfig &&[\s\S]*typeof environment\.APPDATA === 'string'[\s\S]*result\.APPDATA = environment\.APPDATA/u,
);
assert.doesNotMatch(clients, /GH_TOKEN|GITHUB_TOKEN/u);
assert.match(clients, /assertSyntheticGmailProofProductionAligned/u);
assert.match(clients, /process\.execPath/u);
assert.match(clients, /path\.resolve\([\s\S]*'refund-release\.mjs'/u);
assert.match(
  clients,
  /\[\s*releaseScript,\s*'--production',\s*'--project-ref',\s*projectRef,\s*'--confirm-project-ref',\s*projectRef,\s*\]/u,
);
assert.match(clients, /shell: false/u);
assert.doesNotMatch(clients, /npm\.cmd/u);
assert.doesNotMatch(clients, /refunds:release:check-production/u);
assert.doesNotMatch(cli, /--(?:case|recipient|subject|body|endpoint|token|jwt)/u);
assert.match(cli, /Use only --mode, --env-file, and --timeout-seconds/u);
assert.match(cli, /REFUND_SYNTHETIC_GMAIL_PROOF_DATABASE_ADAPTER/u);
assert.doesNotMatch(cli, /console\.(?:log|error)/u);

assert.doesNotMatch(portal, /syntheticProofRunToken/u);
assert.doesNotMatch(portalClient, /syntheticProofRunToken/u);
assert.doesNotMatch(portal, /refundpilot/iu);
assert.doesNotMatch(portalClient, /refundpilot/iu);

assert.match(runbook, /owner-controlled case-specific Gmail proof is completed historical evidence/u);
assert.match(runbook, /If a future rerun is explicitly approved, use only the reviewed owner runner from `#810`/u);
assert.match(runbook, /--mode dry-run --env-file <private-absolute-path>/u);
assert.match(runbook, /RUN_ONE_OWNER_CONTROLLED_SYNTHETIC_GMAIL_PROOF/u);
assert.match(runbook, /backups_read/u);
assert.match(runbook, /latest completed production backup/u);
assert.match(runbook, /zero unresolved Gmail outbound/u);
assert.match(runbook, /read_only=false/u);
assert.match(runbook, /closed immutable registry/u);
assert.match(runbook, /do not rerun it/u);
assert.match(runbook, /leaves the exclusive authorization open/u);
assert.match(checklist, /refunds:validate-synthetic-gmail-proof-runner/u);
assert.match(checklist, /Preserve the completed isolated first-contact and case-specific evidence/u);
assert.match(checklist, /Any explicitly approved future live case-specific proof rerun must use the same owner-only runner/u);
assert.match(cutoverPacket, /Under the separately approved staffed UAT window/u);
assert.match(cutoverPacket, /one cotton-candy and one Snapcase case preserve the exact amount/u);
assert.match(cutoverPacket, /Cut over responders without overlap/u);
assert.match(emailPilotUat, /Passed through the reviewed owner-only runner/u);
assert.match(gmailDataHandling, /bounded owner-controlled proof also passed exactly one case-specific original-thread message/u);
assert.match(emailRunbook, /Cutover is a sequenced no-overlap handoff/u);
assert.match(emailRunbook, /documented rapid, sequenced rollback/u);
assert.doesNotMatch(emailRunbook, /instant rollback/iu);
assert.match(runbook, /staffed, sequenced no-overlap handoff/u);
assert.match(runbook, /manually review and handle transition-interval messages/u);
assert.match(firstContactCutover, /Staffed, sequenced no-overlap production cutover/u);
assert.match(firstContactCutover, /bounded `#800`\s*\/\s*`#810` owner-runner evidence completed one case-specific original-thread reply/u);
assert.match(firstContactCutover, /remaining gate is the staffed production-label\/legacy-responder no-overlap handoff, one new post-boundary synthetic first-contact/u);
assert.match(firstContactCutover, /Keep Hub disabled throughout this verification/u);
assert.match(firstContactCutover, /Manually review and handle any messages that arrive in the transition interval/u);
assert.match(demoPacket, /staffed, sequenced no-overlap cutover/u);
assert.match(currentStatus, /owner-controlled, case-specific Gmail proof passed once[\s\S]*exactly one case message and one Gmail outbound/u);
assert.match(currentStatus, /remaining email gate is the staffed production-label\/legacy-responder cutover and explicit owner go\/no-go/u);
assert.doesNotMatch(
  [
    currentStatus,
    runbook,
    checklist,
    cutoverPacket,
    emailRunbook,
    emailPilotUat,
    gmailDataHandling,
    firstContactCutover,
    demoPacket,
  ].join('\n'),
  /remaining case-specific|still-required case-specific|case-specific mapped-manager-CC UAT and the active-cutover gates are pending|One case-specific reply[^.\n]*remain required|Cutover is atomic|Atomic production cutover|atomic no-overlap cutover|cut over atomically|new explicitly approved email window|The live case-specific proof must/iu,
  'Operational Gmail docs must record the completed case-specific proof and describe only the remaining no-overlap cutover gate',
);
assert.match(currentStatus, /P0 `#810` delivered the required owner-only one-command runner/u);
assert.match(currentStatus, /P0 `#814` adds the explicit owner-grade Management API database path/u);
for (const name of [
  'REFUND_SYNTHETIC_GMAIL_PROOF_PROJECT_REF',
  'REFUND_SYNTHETIC_GMAIL_PROOF_CONFIRM_PROJECT_REF',
  'REFUND_SYNTHETIC_GMAIL_PROOF_CASE_ID',
  'REFUND_SYNTHETIC_GMAIL_PROOF_CONFIRM_CASE_ID',
  'REFUND_SYNTHETIC_GMAIL_PROOF_DATABASE_ADAPTER',
  'REFUND_SYNTHETIC_GMAIL_PROOF_DATABASE_URL',
  'REFUND_SYNTHETIC_GMAIL_PROOF_MANAGEMENT_TOKEN',
  'REFUND_SYNTHETIC_GMAIL_PROOF_ANON_KEY',
  'REFUND_SYNTHETIC_GMAIL_PROOF_USER_ACCESS_TOKEN',
  'REFUND_SYNTHETIC_GMAIL_PROOF_LIVE_CONFIRMATION',
]) {
  assert.match(envExample, new RegExp(`^${name}=$`, 'mu'));
}

assert.equal(
  packageJson.scripts['refunds:synthetic-gmail-proof'],
  'node scripts/refunds/refund-synthetic-gmail-proof-runner.mjs',
);
assert.equal(
  packageJson.scripts['refunds:validate-synthetic-gmail-proof-runner'],
  'node --test scripts/refunds/refund-synthetic-gmail-proof-runner.test.mjs scripts/refunds/refund-synthetic-gmail-proof-management-api.test.mjs && node scripts/refunds/validate-refund-synthetic-gmail-proof-runner.mjs',
);
assert.match(packageJson.scripts.test, /refunds:validate-synthetic-gmail-proof-runner/u);

assert.match(managementApi, /MANAGEMENT_API_OWNER_DATABASE_ADAPTER/u);
assert.match(managementApi, /api\.supabase\.com\/v1\/projects\/\$\{REFUND_PRODUCTION_PROJECT_REF\}\/database\/query/u);
assert.match(managementApi, /READ_OPERATION_NAMES/u);
assert.match(managementApi, /SQL_MUTATION_PATTERN/u);
assert.match(managementApi, /operation\.sql\.includes\(';'\)/u);
assert.match(managementApi, /read_only: operation\.managementApiReadOnly/u);
assert.match(managementApi, /operation\.managementApiReadOnly !== false/u);
assert.match(managementApi, /response\?\.status !== 201/u);
assert.match(managementApi, /body\.length !== 1/u);
assert.match(managementApi, /requestTimeoutMs = MANAGEMENT_API_REQUEST_TIMEOUT_MS/u);
assert.doesNotMatch(managementApi, /console\.(?:log|error)/u);

const sentinel = 'owner_private_cli_secret_never_print_810000';
const cliPath = path.join(repoRoot, 'scripts', 'refunds', 'refund-synthetic-gmail-proof-runner.mjs');
const unsafeArgument = spawnSync(process.execPath, [cliPath, `--${sentinel}`], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: { ...process.env, REFUND_SYNTHETIC_GMAIL_PROOF_MANAGEMENT_TOKEN: sentinel },
});
assert.equal(unsafeArgument.status, 1);
assert.match(unsafeArgument.stderr, /"phase":"failed_closed"/u);
assert.match(unsafeArgument.stderr, /"code":"unsupported_argument"/u);
assert.doesNotMatch(`${unsafeArgument.stdout}\n${unsafeArgument.stderr}`, new RegExp(sentinel));

console.log('PASS: proof runner is exact-project, exact-case-confirmed, and owner-only');
console.log('PASS: live payload is one fixed status_update with no recipient/copy/endpoint setter');
console.log('PASS: try/finally teardown, no-retry send, signal/timeout, and redacted logs are executable');
console.log('PASS: the customer/manager portal exposes no synthetic proof control');
