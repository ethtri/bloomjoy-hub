#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertSupportedFunctionDeploymentInputs,
  buildProductionCaptureReceipt,
  buildUpdatedLocalManifest,
  buildPreDeploymentProductionBaseline,
  buildLocalReleaseState,
  canonicalFunctionEntrypointIdentity,
  calculateFunctionSource,
  calculateMigrationDigest,
  calculateMigrationVersionSetDigest,
  compareCaptureState,
  comparePreMigrationCompatibilityState,
  compareLocalState,
  compareProductionState,
  discoverRefundMigrationFiles,
  manifestPath,
  normalizeProductionEntrypointIdentity,
  parseFunctionDeploymentConfig,
  prepareManifestForLocalRefresh,
  repoRoot,
  requiredFunctionSlugs,
  historicalFunctionSlugs,
  sanitizeProductionMetadata,
  validateManifestShape,
  validateApprovedRestoreSource,
  validateHistoricalPreMigrationCompatibilityEntries,
  validatePreMigrationCompatibilitySource,
  validateReleaseManifestGitAnchorState,
} from './refund-release.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const productionRunbook = fs.readFileSync(path.join(repositoryRoot, 'Docs', 'PRODUCTION_RUNBOOK.md'), 'utf8');
const qaSmokeChecklist = fs.readFileSync(
  path.join(repositoryRoot, 'Docs', 'QA_SMOKE_TEST_CHECKLIST.md'),
  'utf8'
);
const refundEmailAssistantRunbook = fs.readFileSync(
  path.join(repositoryRoot, 'Docs', 'REFUND_EMAIL_ASSISTANT_RUNBOOK.md'),
  'utf8'
);
const cutoverPacket = fs.readFileSync(
  path.join(repositoryRoot, 'Docs', 'REFUND_PRODUCTION_CUTOVER_PACKET.md'),
  'utf8'
);
const productionDriftCommand =
  'npm run refunds:release:check-production -- --project-ref <project-ref>';

assert.match(
  productionRunbook,
  new RegExp(productionDriftCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  'The release runbook must call the production drift checker explicitly'
);
assert(
  productionRunbook.includes('canonical `supabase/functions/<slug>/index.ts` identity') &&
    productionRunbook.includes('raw absolute paths are never retained') &&
    cutoverPacket.includes('canonical `supabase/functions/<slug>/index.ts` entrypoint identity'),
  'Release guidance must require the sanitized canonical production entrypoint identity'
);
assert(
  productionRunbook.includes(
    'canonical ten-function/51-migration object remains immutable pre-`#427` evidence'
  ) &&
    productionRunbook.includes(
      'paired provider-free resolution-window/closure sequence'
    ) &&
    productionRunbook.includes(
      'Deploy only the eleven functions listed in the release manifest from the exact immutable, reviewed canonical-main commit'
    ) &&
    productionRunbook.includes('production Gmail OAuth/mailbox connection is now configured and proved under `#634`') &&
    productionRunbook.includes('production adapter exists but cannot reserve or call Nayax') &&
    productionRunbook.includes('Issue `#409` tracks the remaining staffed shadow and production-label/legacy-responder no-overlap cutover') &&
    !productionRunbook.includes('For the unmerged candidate') &&
    !productionRunbook.includes('The later `#767` outcome-resolution migration and function deployment') &&
    !productionRunbook.includes('Do not configure Gmail OAuth/mailbox secrets before') &&
    !productionRunbook.includes('candidate handler') &&
    !productionRunbook.includes('unmerged `#409` integration candidate') &&
    !productionRunbook.includes('The candidate requires its own reviewed final manifest/evidence'),
  'The runbook must bind the immutable canonical 10/51 bridge and current default-off release'
);

const refundDeployStart = productionRunbook.indexOf('Before deploying Refund Operations functions');
const refundDeployEnd = productionRunbook.indexOf(
  'After deploying the eleven manifest-tracked Refund Operations functions',
  refundDeployStart
);
assert(
  refundDeployStart >= 0 && refundDeployEnd > refundDeployStart,
  'The runbook must contain the reviewed Refund Operations deployment block'
);
const refundDeployBlock = productionRunbook.slice(refundDeployStart, refundDeployEnd);
assert(
  refundDeployBlock.includes(
    'npm run refunds:deploy:functions -- --project-ref ygbzkgxktzqsiygjlqyg --confirm-project-ref ygbzkgxktzqsiygjlqyg --all'
  ) &&
    refundDeployBlock.includes('--execute --authorize "DEPLOY CANONICAL REFUND FUNCTIONS"') &&
    refundDeployBlock.includes('absolute repository-root') &&
    refundDeployBlock.includes('exact reviewed `origin/main` source'),
  'Refund Operations deployment must use the exact-project root-pinned guarded wrapper'
);
for (const slug of requiredFunctionSlugs) {
  assert(
    !refundDeployBlock.includes(`supabase functions deploy ${slug} --no-verify-jwt`),
    `Raw Refund Operations deployment must not bypass the root-pinned wrapper for ${slug}`
  );
}

for (const requiredFailClosedControl of [
  'NAYAX_REFUND_EXECUTION_ENABLED=false',
  'NAYAX_REFUND_EXECUTION_DRY_RUN=true',
  'NAYAX_REFUND_EXECUTION_KILL_SWITCH=true',
  'REFUND_AUTOMATION_ENABLED=false',
  'REFUND_GMAIL_ENABLED=false',
  'REFUND_GPT_TRIAGE_ENABLED=false',
  'OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=false',
  'Keep the runtime Nayax execution gates off during deployment',
]) {
  assert(
    productionRunbook.includes(requiredFailClosedControl),
    `Release runbook is missing fail-closed control: ${requiredFailClosedControl}`
  );
}

assert.match(cutoverPacket, /all 90 required refund\/Nayax migrations/);
assert.match(cutoverPacket, /exact canonical 51-migration predeployment bridge/);
assert.match(
  cutoverPacket,
  /all ten manifest-tracked Refund Operations functions/
);
assert.match(cutoverPacket, /historical `#629\/#716` five-migration bridge does not apply/);
for (const requiredPilotBoundary of [
  'Customer contact alone creates zero cases',
  'A Bloomjoy form submission creates exactly one case',
  'Every active Nayax machine',
  'Snapcase is in scope',
  'reopens the same case without payment authority',
  'Cut over responders without overlap',
  'Monitor for 72 hours',
  'are not pilot requirements',
  '20260821090000_refund_form_only_case_creation.sql',
  '20260821091000_refund_nayax_inventory.sql',
  '20260821100000_refund_branded_appeals.sql',
  '20260822190000_refund_portfolio_intake_inventory_correction.sql',
]) {
  assert(
    cutoverPacket.includes(requiredPilotBoundary),
    `Cutover packet is missing the current v1 boundary: ${requiredPilotBoundary}`
  );
}
for (const retiredPilotGate of [
  /\| `#633` cash workflow \|/,
  /\| `#692` \/ `#782` human step-up \|/,
  /\| `#635` GPT triage \|/,
]) {
  assert.doesNotMatch(
    cutoverPacket,
    retiredPilotGate,
    'Retired optional work must not remain in the Refund Operations v1 evidence ledger'
  );
}
assert.match(
  productionRunbook,
  /exactly 85 reviewed synthetic screenshots/,
  'Production runbook must use the current 85-screenshot evidence inventory'
);
assert.doesNotMatch(
  productionRunbook,
  /exactly (?:44|83) reviewed synthetic screenshots/,
  'Production runbook must not retain a retired screenshot evidence count'
);
for (const [documentName, document] of [
  ['QA smoke checklist', qaSmokeChecklist],
  ['refund email assistant runbook', refundEmailAssistantRunbook],
]) {
  assert.match(
    document,
    /exactly 85 reviewed synthetic screenshots/,
    `${documentName} must use the current 85-screenshot evidence inventory`
  );
  assert.doesNotMatch(
    document,
    /exactly (?:44|83) reviewed synthetic screenshots/,
    `${documentName} must not retain a retired screenshot evidence count`
  );
}
const smokeOrder = cutoverPacket.indexOf('## Exact postdeployment readiness order');
const routeSmoke = cutoverPacket.indexOf('refunds:smoke-routes', smokeOrder);
const captureManifest = cutoverPacket.indexOf(
  'Capture and independently review the timestamped production function receipt',
  routeSmoke
);
const cleanDrift = cutoverPacket.indexOf(
  'require the standard production drift check to pass for all ten functions',
  captureManifest
);
const inventorySync = cutoverPacket.indexOf('Run one controlled inventory sync', cleanDrift);
const publicOptionsSmoke = cutoverPacket.indexOf('refunds:smoke-public-options', inventorySync);
assert(
  smokeOrder >= 0 &&
    routeSmoke > smokeOrder &&
    captureManifest > routeSmoke &&
    cleanDrift > captureManifest &&
    inventorySync > cleanDrift &&
    publicOptionsSmoke > inventorySync,
  'The smoke order must be routes, capture/review, clean drift, complete inventory, then public options'
);
assert.doesNotMatch(
  cutoverPacket,
  /Merge only the approved `#644` head/,
  'The current compatibility bridge must not retain the superseded main-only release instruction'
);

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomjoy-refund-release-test-'));
const functionsRoot = path.join(fixtureRoot, 'supabase', 'functions');
const reviewedManagerSourceSha256 = {
  'refund-manager-action-step-up':
    'b81f078b652bd1ae576d5c6da14962039a755e9f47bfe8be0971484a1c25e447',
  'refund-manager-totp-enrollment':
    'f98c1999c62b7ff51dafdcc42d42d9bebc2026da11805bb51c55e3c60c706511',
};
const canonicalPreDeploymentManagerSourceSha256 = {
  'refund-manager-action-step-up':
    'b4bfb6a6b89ef93b2ed1d8ac3c286dfa079fb198afca27418a4ceb030d7ebd4d',
  'refund-manager-totp-enrollment':
    'f98c1999c62b7ff51dafdcc42d42d9bebc2026da11805bb51c55e3c60c706511',
};

try {
  assert.equal(requiredFunctionSlugs.length, 11, 'Current refund release inventory must cover exactly eleven functions');
  assert.equal(historicalFunctionSlugs.length, 10, 'Historical inventory must remain exactly ten functions');
  assert.equal(requiredFunctionSlugs.at(-1), 'refund-nayax-outcome-resolve');
  assert.deepEqual(
    historicalFunctionSlugs.slice(-2),
    ['refund-manager-action-step-up', 'refund-manager-totp-enrollment'],
    'Manager step-up and TOTP enrollment must be in the release inventory'
  );
  const repositoryManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  validateManifestShape(repositoryManifest);
  const priorInventoryManifest = JSON.parse(execFileSync('git', [
    'show', '2e0316b7e074f5ff133d40cc1e9faa0724ba059e:scripts/refunds/refund-production-release.json',
  ], { cwd: repoRoot, encoding: 'utf8', windowsHide: true }));
  for (const key of ['preDeploymentCapturedAt', 'preDeploymentProduction', 'approvedRestoreSource', 'preMigrationCompatibility']) {
    assert.deepEqual(repositoryManifest[key], priorInventoryManifest[key], `${key} must preserve immutable historical ten/51 evidence`);
  }
  const oldInventoryManifest = structuredClone(repositoryManifest);
  oldInventoryManifest.functions.pop();
  assert.throws(() => validateManifestShape(oldInventoryManifest), /function order or allowlist/);
  const oldRestoreOnlyManifest = structuredClone(repositoryManifest);
  delete oldRestoreOnlyManifest.additionalFunctionBaselines;
  assert.throws(() => validateManifestShape(oldRestoreOnlyManifest), /additionalFunctionBaselines function allowlist/);
  for (const [property, value] of [
    ['status', 'MISSING'], ['verifyJwt', true], ['importMap', true],
    ['entrypointIdentity', canonicalFunctionEntrypointIdentity('refund-case-intake')],
    ['restoreSourceGitCommit', 'not-a-commit'],
  ]) {
    const badBaseline = structuredClone(repositoryManifest);
    badBaseline.additionalFunctionBaselines[0][property] = value;
    assert.throws(() => validateManifestShape(badBaseline), /Additional baseline/);
  }
  const invalidAdditionalRestore = structuredClone(repositoryManifest);
  invalidAdditionalRestore.additionalFunctionBaselines[0].sourceSha256 = 'e'.repeat(64);
  assert.throws(() => validateApprovedRestoreSource(repoRoot, invalidAdditionalRestore), /Additional baseline restore source does not match/);
  assert.match(
    fs.readFileSync(path.join(repoRoot, '.github/workflows/refund-production-drift.yml'), 'utf8'),
    /supabase\/functions\/refund-nayax-outcome-resolve\/\*\*/,
    'Resolver-only edits must trigger the production source guard'
  );
  const missingEntrypointManifest = structuredClone(repositoryManifest);
  delete missingEntrypointManifest.functions[0].production.entrypointIdentity;
  assert.throws(
    () => validateManifestShape(missingEntrypointManifest),
    /Production entrypoint identity is invalid/,
    'An approved production bundle without an entrypoint identity must fail closed'
  );
  assert.match(
    repositoryManifest.sourceGitCommit,
    /^[a-f0-9]{40}$/,
    'Integrated release source commit must be a full immutable Git SHA'
  );
  const repositoryMigrations = discoverRefundMigrationFiles(repoRoot);
  assert.equal(
    repositoryMigrations.length,
    118,
    'Refund release inventory must cover exactly 118 discovered refund/Nayax migrations'
  );
  assert(
    repositoryMigrations.includes('20260902161318_refund_authoritative_reconciliation_receipt.sql'),
    'The exact-original authoritative receipt contract must be in the release inventory'
  );
  assert(
    repositoryMigrations.includes('20260902174648_refund_sent_status_delivery_metadata.sql'),
    'The populated-upgrade status delivery metadata repair must be in the release inventory'
  );
  assert(
    repositoryMigrations.includes('20260902000417_refund_lifecycle_v2_integrity.sql'),
    'The integrated lifecycle v2 integrity and release-skew boundary must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260902002716_refund_manual_message_outbox.sql'),
    'The durable manager-message outbox migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260902004500_refund_payout_destination_follow_up.sql'),
    'The protected payout-destination follow-up migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260902160946_refund_gmail_reply_recovery.sql'),
    'The exact-message customer correction replay recovery must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260901080000_refund_gmail_existing_case_linking.sql'),
    'The existing-case inbound linking migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260901202359_refund_provider_delay_evidence_1069.sql'),
    'The provider-delay evidence repair must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260901180116_refund_scheduler_incident_1069.sql'),
    'The refund scheduler incident repair must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('202608040004_refund_nayax_provider_orchestration.sql'),
    'Provider orchestration migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260812053417_refund_gmail_attachment_off_copy_gate.sql'),
    'The attachment-off Gmail copy gate migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260828003503_refund_nayax_authoritative_journal_v3.sql'),
    'The hardened Nayax journal v3 migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260901050000_refund_selected_nayax_transaction_evidence.sql'),
    'The selected Nayax transaction evidence migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260901060000_refund_nayax_scope_recovery.sql'),
    'The bounded Nayax account-scope recovery migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260901070000_refund_transactional_delivery_truth.sql'),
    'The transactional delivery truth migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260901080000_refund_gmail_existing_case_linking.sql'),
    'The existing-case-first Gmail linking migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260830182855_refund_manager_queue_truth.sql'),
    'The canonical manager queue lifecycle migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260831232759_refund_waiting_lifecycle_truth.sql'),
    'The truthful customer-wait lifecycle migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260901010259_refund_acknowledgement_recovery_disposition.sql'),
    'The skipped-acknowledgement recovery migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260901021433_refund_customer_locale_correction.sql'),
    'The existing-case customer-locale correction migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260828035155_refund_nayax_retry_safe_resolution_release.sql'),
    'The retry-safe account and lifecycle release migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260830175740_refund_automation_scheduler_reliability.sql'),
    'The refund automation scheduler reliability migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260830182744_refund_nayax_superseded_generation_hold.sql'),
    'The superseded-generation account-hold migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260830182855_refund_manager_queue_truth.sql'),
    'The canonical manager queue lifecycle migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260830183702_refund_customer_status_recovery.sql'),
    'The customer status recovery migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260830182941_refund_customer_correction_persistence.sql'),
    'The customer-correction persistence migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260830202234_refund_production_simplification.sql'),
    'The transaction-scoped production simplification migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260830205449_refund_automation_scheduler_30_minute_cadence.sql'),
    'The refund automation 30-minute cadence migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260812200000_refund_owner_totp_enrollment_window.sql'),
    'The owner-only refund authenticator window migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260812210000_refund_legacy_card_state_normalization.sql'),
    'The legacy no-provider-attempt normalization migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260812220000_refund_legacy_confirmation_normalization.sql'),
    'The exact confirmation-and-approval normalization migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('202608170002_refund_nayax_manager_candidate_selection.sql'),
    'The mapped-manager candidate-selection boundary must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260824224813_refund_nayax_daily_readiness_usage.sql'),
    'The service-only aggregate daily refund readiness migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260825000909_refund_manual_external_cash_completion.sql'),
    'The server-derived manual external cash completion migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260825013128_refund_simple_cash_intake.sql'),
    'The simple Card/Cash public intake migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260825041548_refund_nayax_authoritative_journal_v2.sql'),
    'The authoritative Nayax provider journal migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260825174905_refund_nayax_dtm_reference_width.sql'),
    'The current Nayax DTM reference-width migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260825185840_refund_nayax_evidence_only_reconciliation.sql'),
    'The provider-free existing-refund reconciliation migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260825211442_refund_nayax_preexisting_attempt_evidence.sql'),
    'The pre-existing Nayax DTM refund timing and exactly-once evidence migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260826165423_refund_durable_lifecycle_v1.sql'),
    'The durable bounded refund lifecycle migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260827125641_refund_nayax_definitive_failure_retry.sql'),
    'The authoritative no-refund release migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('202608170003_refund_nayax_manager_overview_authority.sql'),
    'The mapped-manager Nayax overview authority boundary must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260821080000_refund_form_completion_transport.sql'),
    'The source-appropriate Nayax customer completion transport must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260821083000_refund_completion_delivery_decoupling.sql'),
    'The one-time website-form completion recovery must be independent of provider execution identity'
  );
  assert(
    repositoryMigrations.includes('20260821090000_refund_form_only_case_creation.sql'),
    'The form-only case-creation boundary must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260821091000_refund_nayax_inventory.sql'),
    'The all-active Nayax inventory boundary must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260821100000_refund_branded_appeals.sql'),
    'The branded customer-message and same-case appeal boundary must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260822190000_refund_portfolio_intake_inventory_correction.sql'),
    'The portfolio-intake and inventory-classification correction must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260822200000_refund_nayax_obvious_mapping_repair.sql'),
    'The exact production Nayax mapping repair must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260822210000_refund_nayax_active_inventory_reconciliation.sql'),
    'The complete active Nayax inventory reconciliation must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260823203839_repair_refund_placeholder_location_selections.sql'),
    'The placeholder-location selection repair must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260823221537_refund_nc_manual_nayax_portal.sql'),
    'The Adam-managed API-pending manual Nayax boundary must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260824003000_refund_nc_manual_machine_timezones.sql'),
    'The API-pending manual path must use exact per-machine timezones instead of the shared placeholder'
  );
  assert(
    repositoryMigrations.includes('20260824160609_refund_confirmation_readiness.sql'),
    'Manager transaction confirmation must be replay-safe and return explicit refund readiness'
  );
  assert(
    repositoryMigrations.includes('20260820041101_refund_nayax_pending_approval_recovery.sql'),
    'The fail-closed pending-approval recovery and provider stage journal must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260820143000_refund_nayax_support_resolution_window.sql') &&
      repositoryMigrations.includes('20260820150000_refund_nayax_support_resolution_close.sql'),
    'The reviewed support-resolution window and fail-closed closure must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('202608140002_refund_nayax_controlled_owner_pilot.sql'),
    'The default-off controlled owner Nayax pilot migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('202608150001_refund_automatic_nayax_lookup.sql'),
    'The automatic read-only Nayax lookup migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('202608150002_refund_follow_up_reply_template_v2.sql'),
    'The labeled refund follow-up reply migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('202608160001_refund_nayax_manager_session_execution.sql'),
    'The normal manager-session Nayax refund migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('20260812230000_refund_synthetic_gmail_proof_authorization.sql'),
    'The one-shot synthetic Gmail proof migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('202608130001_refund_nayax_outcome_resolution.sql'),
    'The default-off Nayax outcome-resolution migration must be in the discovered release inventory'
  );
  assert(
    repositoryMigrations.includes('202608140001_refund_gmail_intake_shadow.sql'),
    'The exact-run owner Gmail intake-shadow migration must be in the discovered release inventory'
  );
  assert.deepEqual(
    repositoryManifest.requiredMigrations,
    repositoryMigrations,
    'Repository manifest must list every discovered refund/Nayax migration in order'
  );
  assert.equal(
    repositoryManifest.functions.length,
    11,
    'Repository release manifest must contain exactly eleven functions'
  );
  const repositoryLocalState = buildLocalReleaseState(repoRoot, repositoryManifest);
  assert.deepEqual(
    compareLocalState(repositoryManifest, repositoryLocalState),
    [],
    'Repository function and migration digests must align with the anchored manifest'
  );
  assert.equal(
    repositoryManifest.preMigrationCompatibility?.sourceGitCommit,
    '71eb076bc3ad95ccabd0c591b8140820bed6c393',
    'The production bridge must bind to the exact canonical 51-migration release'
  );
  assert.equal(
    repositoryManifest.preMigrationCompatibility.requiredMigrations.length,
    51,
    'The historical production bridge must cover exactly the 51 migrations captured before deployment'
  );
  assert(
    !repositoryManifest.preMigrationCompatibility.requiredMigrations.includes(
      '202608140002_refund_nayax_controlled_owner_pilot.sql'
    ),
    'The historical production bridge must exclude the controlled-owner pilot migration applied after capture'
  );
  const currentProductionMayAdvance = structuredClone(repositoryManifest);
  currentProductionMayAdvance.functions[0].production.sourceSha256 = 'a'.repeat(64);
  validatePreMigrationCompatibilitySource(repoRoot, currentProductionMayAdvance);
  const historicalSourceBySlug = new Map(
    repositoryManifest.preDeploymentProduction.map((entry) => [
      entry.slug,
      entry.sourceSha256,
    ])
  );

  for (const [label, mutate, expectedFailure] of [
    [
      'missing historical entry',
      (manifest) => manifest.preDeploymentProduction.pop(),
      /historical baseline function allowlist is invalid/,
    ],
    [
      'duplicate historical entry',
      (manifest) => {
        manifest.preDeploymentProduction[1].slug = manifest.preDeploymentProduction[0].slug;
      },
      /historical baseline function allowlist is invalid/,
    ],
    [
      'non-ACTIVE historical entry',
      (manifest) => {
        manifest.preDeploymentProduction[0] = {
          slug: manifest.preDeploymentProduction[0].slug,
          status: 'MISSING',
        };
      },
      /historical baseline must be ACTIVE/,
    ],
    [
      'historical verifyJwt drift',
      (manifest) => {
        manifest.preDeploymentProduction[0].verifyJwt = true;
      },
      /historical security pairing does not match/,
    ],
    [
      'historical import-map drift',
      (manifest) => {
        manifest.preDeploymentProduction[0].importMap = true;
      },
      /historical security pairing does not match/,
    ],
    [
      'historical source drift',
      (manifest) => {
        manifest.preDeploymentProduction[0].sourceSha256 = 'a'.repeat(64);
      },
      /source commit does not match the historical baseline/,
    ],
  ]) {
    const invalidHistoricalManifest = structuredClone(repositoryManifest);
    mutate(invalidHistoricalManifest);
    assert.throws(
      () => validateHistoricalPreMigrationCompatibilityEntries({
        functions: invalidHistoricalManifest.functions,
        preDeploymentProduction: invalidHistoricalManifest.preDeploymentProduction,
        historicalSourceBySlug,
      }),
      expectedFailure,
      `${label} must fail the historical pre-migration bridge closed`
    );
  }
  for (const managerSlug of ['refund-manager-action-step-up', 'refund-manager-totp-enrollment']) {
    const localEntry = repositoryManifest.functions.find((entry) => entry.slug === managerSlug);
    const localStateEntry = repositoryLocalState.functions.find((entry) => entry.slug === managerSlug);
    assert(localStateEntry, `${managerSlug} must be present in the local release state`);
    assert.equal(
      localStateEntry.sourceSha256,
      reviewedManagerSourceSha256[managerSlug],
      `${managerSlug} local source must match its independently reviewed digest`
    );
    const baselineEntry = repositoryManifest.preDeploymentProduction.find(
      (entry) => entry.slug === managerSlug
    );
    const restoreEntry = repositoryManifest.approvedRestoreSource.functions.find(
      (entry) => entry.slug === managerSlug
    );
    assert.equal(localEntry.verifyJwt, false, `${managerSlug} must keep verify_jwt disabled`);
    assert.equal(
      localEntry.sourceSha256,
      reviewedManagerSourceSha256[managerSlug],
      `${managerSlug} manifest source must match its independently reviewed digest`
    );
    assert(
      baselineEntry &&
        baselineEntry.status === 'ACTIVE' &&
        baselineEntry.verifyJwt === localEntry.verifyJwt &&
        baselineEntry.importMap === false &&
        baselineEntry.sourceSha256 ===
          canonicalPreDeploymentManagerSourceSha256[managerSlug],
      `${managerSlug} must retain the exact canonical-51 pre-deployment source and security pairing`
    );
    assert.deepEqual(
      restoreEntry,
      { slug: managerSlug, restoreAction: 'disable' },
      `${managerSlug} rollback must disable the newly introduced function`
    );
  }
  fs.mkdirSync(path.join(functionsRoot, 'example'), { recursive: true });
  fs.mkdirSync(path.join(functionsRoot, '_shared'), { recursive: true });
  fs.writeFileSync(
    path.join(functionsRoot, 'example', 'index.ts'),
    'import { helper } from "../_shared/helper.ts";\nhelper();\n',
    'utf8'
  );
  fs.writeFileSync(path.join(functionsRoot, '_shared', 'helper.ts'), 'export const helper = () => true;\n', 'utf8');

  const baseline = calculateFunctionSource(fixtureRoot, 'example');
  fs.writeFileSync(path.join(functionsRoot, '_shared', 'helper.ts'), 'export const helper = () => false;\n', 'utf8');
  const changedDependency = calculateFunctionSource(fixtureRoot, 'example');
  assert.notEqual(changedDependency.sourceSha256, baseline.sourceSha256, 'Shared dependency changes must alter the digest');

  fs.writeFileSync(path.join(functionsRoot, '_shared', 'helper.ts'), 'export const helper = () => true;\r\n', 'utf8');
  const crlf = calculateFunctionSource(fixtureRoot, 'example');
  assert.equal(crlf.sourceSha256, baseline.sourceSha256, 'CRLF and LF source must hash identically');

  fs.writeFileSync(path.join(functionsRoot, 'example', 'index.ts'), 'import "../_shared/missing.ts";\n', 'utf8');
  assert.throws(
    () => calculateFunctionSource(fixtureRoot, 'example'),
    /Unresolved relative import/,
    'Missing relative imports must fail closed'
  );

  const migrationsRoot = path.join(fixtureRoot, 'supabase', 'migrations');
  fs.mkdirSync(migrationsRoot, { recursive: true });
  const migrationFiles = [
    '202601010001_refund_first.sql',
    '202601010002_nayax_second.sql',
  ];
  for (const fileName of migrationFiles) {
    fs.writeFileSync(path.join(migrationsRoot, fileName), `select '${fileName}';\n`, 'utf8');
  }
  fs.writeFileSync(path.join(migrationsRoot, '202601010003_unrelated.sql'), 'select true;\n', 'utf8');
  assert.deepEqual(
    discoverRefundMigrationFiles(fixtureRoot),
    migrationFiles,
    'Every refund/Nayax migration and no unrelated migration must be discovered'
  );

  const configLines = requiredFunctionSlugs.flatMap((slug) => [
    `[functions.${slug}]`,
    'verify_jwt = false',
    '',
  ]);
  fs.writeFileSync(path.join(fixtureRoot, 'supabase', 'config.toml'), `${configLines.join('\n')}\n`, 'utf8');
  for (const slug of requiredFunctionSlugs) {
    fs.mkdirSync(path.join(functionsRoot, slug), { recursive: true });
    fs.writeFileSync(path.join(functionsRoot, slug, 'index.ts'), `export const slug = '${slug}';\n`, 'utf8');
  }

  const localFunctions = requiredFunctionSlugs.map((slug) => ({
    slug,
    verifyJwt: false,
    ...calculateFunctionSource(fixtureRoot, slug),
    production: null,
  }));
  const previousFunctions = localFunctions.filter(({ slug }) => historicalFunctionSlugs.includes(slug))
    .map(({ slug, sourceSha256 }) => ({ slug, sourceSha256 }));
  const shapeManifest = {
    schemaVersion: 3,
    environment: 'production',
    projectRef: 'a'.repeat(20),
    releaseId: 'fixture-release',
    sourceGitCommit: 'a'.repeat(40),
    requiredMigrations: migrationFiles,
    migrationFilesSha256: calculateMigrationDigest(fixtureRoot, migrationFiles),
    migrationVersionSetSha256: calculateMigrationVersionSetDigest(migrationFiles),
    functions: localFunctions,
    preDeploymentCapturedAt: '2026-01-01T00:00:00.000Z',
    preDeploymentProduction: historicalFunctionSlugs.map((slug) => ({ slug, status: 'MISSING' })),
    additionalFunctionBaselines: structuredClone(repositoryManifest.additionalFunctionBaselines),
    approvedRestoreSource: {
      releaseId: 'fixture-restore',
      sourceGitCommit: 'b'.repeat(40),
      migrationFilesSha256: calculateMigrationDigest(fixtureRoot, migrationFiles),
      migrationVersionSetSha256: calculateMigrationVersionSetDigest(migrationFiles),
      functions: previousFunctions,
    },
  };
  validateManifestShape(shapeManifest);
  const fixtureManifestPath = 'scripts/refunds/refund-production-release.json';
  const validAnchorState = {
    manifest: shapeManifest,
    headGitCommit: 'c'.repeat(40),
    sourceCommitExists: true,
    sourceIsAncestor: true,
    worktreeIsClean: true,
    changedPaths: [fixtureManifestPath],
    manifestRelativePath: fixtureManifestPath,
  };
  assert.deepEqual(
    validateReleaseManifestGitAnchorState(validAnchorState),
    {
      sourceGitCommit: 'a'.repeat(40),
      anchorGitCommit: 'c'.repeat(40),
      changedPaths: [fixtureManifestPath],
    },
    'A final release anchor must be exactly one manifest-only commit after its source'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      manifest: { ...shapeManifest, sourceGitCommit: 'pending' },
    }),
    /sourceGitCommit is invalid/,
    'A pending source commit must fail once the release is anchored'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      headGitCommit: 'not-a-commit',
    }),
    /anchor Git commit is invalid/,
    'An invalid release-anchor commit must fail closed'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      sourceCommitExists: false,
    }),
    /does not exist as a Git commit/,
    'A wrong or missing source commit must fail closed'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      sourceIsAncestor: false,
    }),
    /not an ancestor/,
    'A stale source outside the current release ancestry must fail closed'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      worktreeIsClean: false,
    }),
    /require a clean Git worktree/,
    'A dirty release anchor must fail before release validation'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      headGitCommit: shapeManifest.sourceGitCommit,
      changedPaths: [],
    }),
    /Only the refund production release manifest may differ/,
    'The source commit cannot also serve as its own manifest anchor'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      changedPaths: ['supabase/functions/refund-case-intake/index.ts'],
    }),
    /Only the refund production release manifest may differ/,
    'A wrong-path-only anchor must fail closed'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      changedPaths: [fixtureManifestPath, 'supabase/functions/refund-case-intake/index.ts'],
    }),
    /Only the refund production release manifest may differ/,
    'Any source change between the approved source and manifest anchor must fail closed'
  );
  assert.throws(
    () => validateReleaseManifestGitAnchorState({
      ...validAnchorState,
      changedPaths: [],
    }),
    /Only the refund production release manifest may differ/,
    'A source commit without a separate manifest-only anchor must fail closed'
  );
  const refreshLocalStateManifest = prepareManifestForLocalRefresh(shapeManifest, {
    worktreeIsClean: true,
  });
  assert.equal(
    refreshLocalStateManifest.sourceGitCommit,
    'pending',
    'Manifest refresh may bypass only the stale approved-source comparison'
  );
  assert.deepEqual(
    Object.keys(shapeManifest).filter(
      (key) => JSON.stringify(shapeManifest[key]) !== JSON.stringify(refreshLocalStateManifest[key])
    ),
    ['sourceGitCommit'],
    'Manifest refresh must preserve inventory, configuration, and every existing digest input'
  );
  assert.throws(
    () => prepareManifestForLocalRefresh(shapeManifest, { worktreeIsClean: false }),
    /requires a clean source worktree/,
    'A dirty source worktree must never enter manifest refresh mode'
  );
  const fixtureLocalState = buildLocalReleaseState(fixtureRoot, refreshLocalStateManifest);
  assert.equal(fixtureLocalState.functions.length, requiredFunctionSlugs.length);
  const updatedLocalManifest = buildUpdatedLocalManifest(
    refreshLocalStateManifest,
    fixtureLocalState,
    'c'.repeat(40)
  );
  assert.equal(
    updatedLocalManifest.sourceGitCommit,
    'c'.repeat(40),
    'Local manifest refresh must bind the approved source to the current immutable commit'
  );
  validateManifestShape(updatedLocalManifest);
  assert.deepEqual(
    compareLocalState(updatedLocalManifest, fixtureLocalState),
    [],
    'A refreshed manifest must align every function and migration digest'
  );
  const staleDigestManifest = {
    ...updatedLocalManifest,
    migrationFilesSha256: 'd'.repeat(64),
  };
  assert.match(
    compareLocalState(staleDigestManifest, fixtureLocalState).join('\n'),
    /migration source differs/,
    'A stale migration source digest must fail local release alignment'
  );

  const disableOnlySlug = 'refund-gmail-sync';
  const disableOnlyIndex = requiredFunctionSlugs.indexOf(disableOnlySlug);
  assert.notEqual(disableOnlyIndex, -1, 'Gmail sync must be covered by the refund release allowlist');
  const disableOnlyRestoreManifest = structuredClone(shapeManifest);
  disableOnlyRestoreManifest.approvedRestoreSource.functions[disableOnlyIndex] = {
    slug: disableOnlySlug,
    restoreAction: 'disable',
  };
  validateManifestShape(disableOnlyRestoreManifest);

  for (const managerSlug of ['refund-manager-action-step-up', 'refund-manager-totp-enrollment']) {
    const managerIndex = requiredFunctionSlugs.indexOf(managerSlug);
    assert.notEqual(managerIndex, -1, `${managerSlug} must be covered by the refund release allowlist`);
    const managerDisableManifest = structuredClone(shapeManifest);
    managerDisableManifest.approvedRestoreSource.functions[managerIndex] = {
      slug: managerSlug,
      restoreAction: 'disable',
    };
    validateManifestShape(managerDisableManifest);
    assert.equal(
      managerDisableManifest.preDeploymentProduction[managerIndex].status,
      'MISSING',
      `${managerSlug} must retain an explicit missing pre-deployment baseline`
    );
  }

  const invalidDisableRestoreManifest = structuredClone(disableOnlyRestoreManifest);
  invalidDisableRestoreManifest.approvedRestoreSource.functions[disableOnlyIndex].sourceSha256 =
    'a'.repeat(64);
  assert.throws(
    () => validateManifestShape(invalidDisableRestoreManifest),
    /disable-only entry must not include a source digest/,
    'Disable-only restore entries must not pretend a previous function source existed'
  );

  fs.writeFileSync(path.join(migrationsRoot, '202601010004_refund_unlisted.sql'), 'select true;\n', 'utf8');
  assert.throws(
    () => buildLocalReleaseState(fixtureRoot, shapeManifest),
    /do not match every refund\/Nayax migration/,
    'A newly added in-scope migration must fail until the manifest includes it'
  );
  fs.rmSync(path.join(migrationsRoot, '202601010004_refund_unlisted.sql'));

  fs.appendFileSync(
    path.join(fixtureRoot, 'supabase', 'config.toml'),
    `[functions.${requiredFunctionSlugs[0]}]\nentrypoint = './custom.ts'\n`,
    'utf8'
  );
  assert.throws(
    () => parseFunctionDeploymentConfig(fixtureRoot),
    /Unsupported Supabase config key entrypoint/,
    'Custom entrypoints must fail closed'
  );
  fs.writeFileSync(path.join(fixtureRoot, 'supabase', 'config.toml'), `${configLines.join('\n')}\n`, 'utf8');

  const importMapPath = path.join(functionsRoot, requiredFunctionSlugs[0], 'import_map.json');
  fs.writeFileSync(importMapPath, '{}\n', 'utf8');
  assert.throws(
    () => assertSupportedFunctionDeploymentInputs(fixtureRoot),
    /Unsupported Edge Function deployment input/,
    'Untracked deployment configuration files must fail closed'
  );
  fs.rmSync(importMapPath);

  assert.throws(
    () => validateManifestShape({ ...shapeManifest, schemaVersion: 1 }),
    /schemaVersion must be 3/,
    'Stale manifest schema versions must fail'
  );
  assert.throws(
    () => validateManifestShape({
      ...shapeManifest,
      requiredMigrations: [migrationFiles[0], migrationFiles[0]],
    }),
    /duplicate migrations/,
    'Duplicate migration entries must fail'
  );

  const manifest = {
    functions: requiredFunctionSlugs.map((slug, index) => ({
      slug,
      verifyJwt: false,
      sourceSha256: String(index).padStart(64, 'a'),
      production: {
        sourceSha256: String(index).padStart(64, 'a'),
        version: index + 2,
        ezbrSha256: String(index).padStart(64, 'b'),
        entrypointIdentity: canonicalFunctionEntrypointIdentity(slug),
      },
    })),
  };
  const rawProduction = manifest.functions.map((entry, index) => ({
    slug: entry.slug,
    status: 'ACTIVE',
    version: entry.production.version,
    verify_jwt: false,
    import_map: false,
    ezbr_sha256: entry.production.ezbrSha256,
    entrypoint_path: index % 2 === 0
      ? `file:///Repos/deployment-worktree/${canonicalFunctionEntrypointIdentity(entry.slug)}`
      : `/tmp/deploy/source/${canonicalFunctionEntrypointIdentity(entry.slug)}`,
    id: 'must-not-survive-sanitization',
  }));
  rawProduction.push({ slug: 'unrelated-function', status: 'ACTIVE', version: 99 });

  const sanitized = sanitizeProductionMetadata(rawProduction);
  assert.equal(sanitized.length, requiredFunctionSlugs.length, 'Unrelated production functions must be ignored');
  assert.equal('entrypoint_path' in sanitized[0], false, 'Raw host-specific entrypoint paths must be removed');
  assert.equal(
    sanitized[0].entrypointIdentity,
    canonicalFunctionEntrypointIdentity(sanitized[0].slug),
    'Production metadata must retain only the canonical function entrypoint identity'
  );
  for (const [label, rawEntrypointPath] of [
    ['missing path', undefined],
    ['query', `file:///tmp/${canonicalFunctionEntrypointIdentity(requiredFunctionSlugs[0])}?candidate=1`],
    ['fragment', `file:///tmp/${canonicalFunctionEntrypointIdentity(requiredFunctionSlugs[0])}#candidate`],
    ['backslash', `C:\\tmp\\${canonicalFunctionEntrypointIdentity(requiredFunctionSlugs[0])}`],
    ['traversal', `/tmp/../${canonicalFunctionEntrypointIdentity(requiredFunctionSlugs[0])}`],
    ['encoded traversal', `/tmp/%2e%2e/${canonicalFunctionEntrypointIdentity(requiredFunctionSlugs[0])}`],
    ['double-encoded traversal', `/tmp/%252e%252e/${canonicalFunctionEntrypointIdentity(requiredFunctionSlugs[0])}`],
    ['wrong slug', `/tmp/${canonicalFunctionEntrypointIdentity(requiredFunctionSlugs[1])}`],
    ['wrong basename', `/tmp/supabase/functions/${requiredFunctionSlugs[0]}/main.ts`],
    ['non-file URI', `https://example.invalid/${canonicalFunctionEntrypointIdentity(requiredFunctionSlugs[0])}`],
  ]) {
    assert.equal(
      normalizeProductionEntrypointIdentity(rawEntrypointPath, requiredFunctionSlugs[0]),
      null,
      `${label} must not produce an approved entrypoint identity`
    );
  }
  assert.deepEqual(compareProductionState(manifest, sanitized), [], 'Matching production metadata must pass');
  const laterSameBundleProduction = sanitized.map((entry) => ({
    ...entry,
    version: entry.version + 1,
  }));
  assert.deepEqual(
    compareProductionState(manifest, laterSameBundleProduction),
    [],
    'Later live counters must pass when the approved bundle and security metadata are unchanged'
  );
  assert.match(
    compareProductionState(
      manifest,
      laterSameBundleProduction.map((entry, index) =>
        index === 0 ? { ...entry, ezbrSha256: 'c'.repeat(64) } : entry
      )
    ).join('\n'),
    /bundle digest differs/,
    'A later counter must still fail when its production bundle differs from the approved bundle'
  );
  assert.match(
    compareProductionState(
      manifest,
      laterSameBundleProduction.map((entry, index) =>
        index === 0
          ? { ...entry, entrypointIdentity: canonicalFunctionEntrypointIdentity(requiredFunctionSlugs[1]) }
          : entry
      )
    ).join('\n'),
    /entrypoint identity differs/,
    'A later counter must fail when its production entrypoint differs from the approved bundle'
  );

  const productionSources = manifest.functions.map((entry) => ({
    slug: entry.slug,
    sourceSha256: entry.sourceSha256,
  }));
  const withoutResolver = (entries) => entries.filter((entry) => entry.slug !== 'refund-nayax-outcome-resolve');
  assert.match(compareProductionState(manifest, withoutResolver(sanitized)).join('\n'), /refund-nayax-outcome-resolve: missing/);
  assert.match(compareCaptureState(manifest, withoutResolver(sanitized), withoutResolver(productionSources)).join('\n'), /refund-nayax-outcome-resolve: missing/);
  assert.throws(
    () => buildProductionCaptureReceipt(manifest, withoutResolver(sanitized), withoutResolver(productionSources), '2026-09-02T00:00:00.000Z'),
    /refund-nayax-outcome-resolve: missing/,
    'A ten-function capture must never produce a successful current release receipt'
  );
  assert.match(compareCaptureState(manifest, sanitized, withoutResolver(productionSources)).join('\n'), /refund-nayax-outcome-resolve: downloaded production source/);
  for (const patch of [
    { status: 'MISSING' }, { version: 0 }, { verifyJwt: true }, { importMap: true },
    { ezbrSha256: 'e'.repeat(64) },
    { entrypointIdentity: canonicalFunctionEntrypointIdentity('refund-case-intake') },
  ]) {
    const changedResolver = sanitized.map((entry) => entry.slug === 'refund-nayax-outcome-resolve' ? { ...entry, ...patch } : entry);
    assert.match(compareProductionState(manifest, changedResolver).join('\n'), /refund-nayax-outcome-resolve:/);
  }
  const compatibilityManifest = structuredClone(manifest);
  compatibilityManifest.functions[0].sourceSha256 = 'd'.repeat(64);
  assert.deepEqual(
    comparePreMigrationCompatibilityState(
      compatibilityManifest,
      sanitized.map((entry) => ({ ...entry, version: entry.version + 1 })),
      manifest.functions.map((entry) => ({
        slug: entry.slug,
        sourceSha256: entry.production.sourceSha256,
      }))
    ),
    [],
    'Pinned pre-migration sources must tolerate version-only Edge restarts'
  );
  assert.match(
    comparePreMigrationCompatibilityState(
      compatibilityManifest,
      sanitized,
      manifest.functions.map((entry, index) => ({
        slug: entry.slug,
        sourceSha256: index === 0 ? 'e'.repeat(64) : entry.production.sourceSha256,
      }))
    ).join('\n'),
    /downloaded source differs from the approved pre-migration baseline/,
    'Pre-migration compatibility must reject unapproved production source'
  );
  assert.match(
    comparePreMigrationCompatibilityState(
      compatibilityManifest,
      sanitized.map((entry, index) =>
        index === 0 ? { ...entry, ezbrSha256: 'c'.repeat(64) } : entry
      ),
      manifest.functions.map((entry) => ({
        slug: entry.slug,
        sourceSha256: entry.production.sourceSha256,
      }))
    ).join('\n'),
    /production bundle differs from the approved pre-migration baseline/,
    'Pre-migration compatibility must reject unapproved production bundles'
  );
  assert.match(
    comparePreMigrationCompatibilityState(
      compatibilityManifest,
      sanitized.map((entry, index) =>
        index === 0
          ? { ...entry, entrypointIdentity: canonicalFunctionEntrypointIdentity(requiredFunctionSlugs[1]) }
          : entry
      ),
      manifest.functions.map((entry) => ({
        slug: entry.slug,
        sourceSha256: entry.production.sourceSha256,
      }))
    ).join('\n'),
    /entrypoint identity differs from the approved pre-migration baseline/,
    'Pre-migration compatibility must reject an unapproved production entrypoint'
  );
  assert.equal(
    buildPreDeploymentProductionBaseline(sanitized, productionSources)[0].entrypointIdentity,
    canonicalFunctionEntrypointIdentity(requiredFunctionSlugs[0]),
    'A new pre-deployment baseline must retain the canonical entrypoint identity'
  );
  assert.equal(
    buildPreDeploymentProductionBaseline(sanitized.slice(1), productionSources.slice(1))[0].status,
    'MISSING',
    'An absent pre-deployment function must be recorded explicitly'
  );
  assert.throws(
    () => buildPreDeploymentProductionBaseline(
      sanitized.map((entry, index) => index === 0 ? { ...entry, version: 0 } : entry),
      productionSources
    ),
    /baseline production version is invalid/,
    'Invalid pre-deployment metadata must fail closed'
  );
  assert.deepEqual(
    compareCaptureState(manifest, sanitized, productionSources),
    [],
    'Capture must pass only when downloaded production source matches the approved source'
  );
  const capturedAt = '2026-08-27T20:00:00.000Z';
  const laterSameBundleReceipt = buildProductionCaptureReceipt(
    {
      ...manifest,
      projectRef: 'a'.repeat(20),
      releaseId: 'test-release',
      sourceGitCommit: 'a'.repeat(40),
      migrationFilesSha256: 'a'.repeat(64),
      migrationVersionSetSha256: 'b'.repeat(64),
      preDeploymentProduction: [],
      approvedRestoreSource: { releaseId: 'test-restore' },
    },
    laterSameBundleProduction,
    productionSources,
    capturedAt
  );
  assert.equal(laterSameBundleReceipt.capturedAt, capturedAt, 'Capture receipts must record their exact observation time');
  assert.equal(laterSameBundleReceipt.schemaVersion, 2, 'Entrypoint-aware capture receipts must use schemaVersion 2');
  assert.equal(
    laterSameBundleReceipt.functions[0].version,
    sanitized[0].version + 1,
    'Capture receipts must record the live production version rather than the sealed manifest version'
  );
  assert.equal(
    laterSameBundleReceipt.functions[0].approvedBundleVersion,
    sanitized[0].version,
    'Capture receipts must retain the approved bundle version as separate audit context'
  );
  assert.equal(
    laterSameBundleReceipt.functions[0].versionRelation,
    'same_bundle_later_revision',
    'Capture receipts must identify a later counter for the exact approved bundle'
  );
  assert.equal(
    laterSameBundleReceipt.functions[0].entrypointIdentity,
    canonicalFunctionEntrypointIdentity(requiredFunctionSlugs[0]),
    'Capture receipts must retain the canonical entrypoint identity without the deployment-host prefix'
  );
  assert.throws(
    () => buildProductionCaptureReceipt(manifest, sanitized, productionSources, 'not-a-timestamp'),
    /timestamp is invalid/,
    'Capture receipts must reject an invalid observation timestamp'
  );
  assert.match(
    compareCaptureState(
      manifest,
      sanitized,
      productionSources.map((entry, index) =>
        index === 0 ? { ...entry, sourceSha256: 'e'.repeat(64) } : entry
      )
    ).join('\n'),
    /downloaded production source does not match/,
    'Capture must reject stale production source even when metadata is active'
  );
  assert.match(
    compareCaptureState(
      manifest,
      sanitized.map((entry, index) => index === 0 ? { ...entry, version: 0 } : entry),
      productionSources
    ).join('\n'),
    /production version is invalid/,
    'Capture must reject invalid production versions'
  );
  assert.match(
    compareCaptureState(
      manifest,
      sanitized.map((entry, index) => index === 0 ? { ...entry, ezbrSha256: '' } : entry),
      productionSources
    ).join('\n'),
    /production bundle digest is invalid/,
    'Capture must reject invalid production bundle digests'
  );
  assert.match(
    compareCaptureState(
      manifest,
      sanitized.map((entry, index) => index === 0 ? { ...entry, entrypointIdentity: null } : entry),
      productionSources
    ).join('\n'),
    /entrypoint identity differs/,
    'Capture must reject missing or malformed production entrypoint metadata'
  );

  assert.match(
    compareProductionState(manifest, sanitized.slice(1)).join('\n'),
    /missing from production/,
    'Missing production functions must fail'
  );
  assert.match(
    compareProductionState(manifest, sanitized.map((entry, index) => index === 0 ? { ...entry, status: 'FAILED' } : entry)).join('\n'),
    /status is not ACTIVE/,
    'Inactive production functions must fail'
  );
  assert.match(
    compareProductionState(manifest, sanitized.map((entry, index) => index === 0 ? { ...entry, version: 1 } : entry)).join('\n'),
    /version regressed below the approved bundle version/,
    'A production version regression must fail even when the bundle digest is unchanged'
  );
  assert.match(
    compareProductionState(manifest, sanitized.map((entry, index) => index === 0 ? { ...entry, verifyJwt: true } : entry)).join('\n'),
    /verify_jwt differs/,
    'Unexpected production JWT settings must fail'
  );
  assert.match(
    compareProductionState(manifest, sanitized.map((entry, index) => index === 0 ? { ...entry, importMap: true } : entry)).join('\n'),
    /unexpected production import map/,
    'Unexpected production import maps must fail'
  );
  assert.match(
    compareProductionState(manifest, [...sanitized, sanitized[0]]).join('\n'),
    /duplicate refund function slugs/,
    'Duplicate production metadata must fail'
  );
  assert.match(
    compareProductionState(manifest, sanitized.map((entry, index) => index === 0 ? { ...entry, ezbrSha256: 'c'.repeat(64) } : entry)).join('\n'),
    /bundle digest differs/,
    'Unexpected production bundles must fail'
  );

  const unpairedManifest = structuredClone(manifest);
  unpairedManifest.functions[0].sourceSha256 = 'd'.repeat(64);
  assert.match(
    compareProductionState(unpairedManifest, sanitized).join('\n'),
    /has not been paired with production/,
    'Approved source changes must require a new production capture'
  );

  console.log('Refund release tooling validated.');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
