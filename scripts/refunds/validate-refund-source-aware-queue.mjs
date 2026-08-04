import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [migration, databaseTest, client, ui, edgeFunction, workflow, runbook, qa, releaseManifest, portalUat] =
  await Promise.all([
    read('supabase/migrations/202608040007_refund_source_aware_queue.sql'),
    read('supabase/tests/refund_source_aware_queue.sql'),
    read('src/lib/refundOperations.ts'),
    read('src/pages/admin/Refunds.tsx'),
    read('supabase/functions/refund-source-reconciliation/index.ts'),
    read('.github/workflows/refund-source-reconciliation.yml'),
    read('Docs/REFUND_SOURCE_AWARE_QUEUE.md'),
    read('Docs/QA_SMOKE_TEST_CHECKLIST.md'),
    read('scripts/refunds/refund-production-release.json'),
    read('scripts/refunds/validate-refund-portal-uat.mjs'),
  ]);

assert(migration.includes('admin_get_refund_source_draft_cases'), 'One draft RPC must include every supported source');
assert(
  migration.includes("refund_case.intake_source = 'sms_google_form'") &&
    migration.includes('public.admin_get_refund_gmail_draft_cases()'),
  'Gmail and SMS Google Form drafts must join one queue',
);
assert(
  migration.includes('public.can_manage_refund_case(actor_user_id, refund_case.id)'),
  'Case rows must use the existing machine-manager authorization boundary',
);
assert(
  migration.includes("'/refunds?case=' || refund_case.id::text"),
  'Every case needs an exact canonical portal path',
);
assert(
  migration.includes("'missing_information'") && migration.includes("'unmapped_machine'") &&
    migration.includes("'import_failure'") && migration.includes("'providerReconciliationHold'"),
  'The queue snapshot must expose every readiness state as a fixed code',
);
assert(
  migration.includes("'sourceSubmissionCount'") && migration.includes("'representedItemCount'") &&
    migration.includes("'visibleQuarantineCount'") && migration.includes("'payloadRedacted', true"),
  'The source equation must be aggregate-only and explicitly redacted',
);
assert(
  migration.includes("if not caller_is_service") && migration.includes("'cases', visible_cases"),
  'Service monitoring must not receive browser case rows',
);
assert(
  migration.includes('revoke all on function public.get_refund_source_queue_snapshot') &&
    !migration.includes('grant execute on function public.get_refund_source_queue_snapshot(timestamp with time zone) to anon'),
  'Anonymous callers must not access source health',
);

assert(databaseTest.includes('select plan(22)'), 'The source-aware database suite must remain comprehensive');
assert(databaseTest.includes('Daily service monitor receives no case-level rows'), 'Database tests must prove service redaction');
assert(databaseTest.includes('Source submissions reconcile to cases plus authorized quarantine'), 'Database tests must prove the daily equation');

assert(client.includes("admin_get_refund_source_draft_cases"), 'The client must fetch unified source drafts');
assert(client.includes("get_refund_source_queue_snapshot"), 'The client must fetch the source snapshot');
assert(!client.includes("supabaseClient.rpc('admin_get_refund_gmail_draft_cases')"), 'The queue may not remain Gmail-draft-only');
assert(ui.includes('refund-intake-source-badge'), 'Queue rows must show a stable source badge');
assert(ui.includes('refund-detail-source-badge'), 'Case detail must show the same source badge');
assert(ui.includes('refund-canonical-case-link'), 'Case detail must expose the exact link');
for (const filter of ['missing_information', 'unmapped_machine', 'import_failure', 'possible_duplicate', 'aging', 'provider_hold']) {
  assert(ui.includes(`value="${filter}"`), `Saved filter ${filter} must be visible`);
}
assert(ui.includes('refund-source-health'), 'Managers need one aggregate source-health view');
assert(ui.includes('renderSourceDraftWorkbench'), 'SMS Google Form drafts need a safe workbench');
assert(
  ui.includes("refundCase.status !== 'draft'") && ui.includes('refundCase.intakeComplete !== false'),
  'Incomplete source drafts must not auto-run transaction matching',
);

assert(edgeFunction.includes('REFUND_SOURCE_RECONCILIATION_SECRET'), 'The monitor needs a dedicated secret');
assert(edgeFunction.includes('REFUND_SOURCE_RECONCILIATION_ENABLED'), 'The monitor must default closed');
assert(edgeFunction.includes('safeSource') && edgeFunction.includes('safeReconciliation'), 'The endpoint must allowlist aggregate output');
assert(edgeFunction.includes('failureTest'), 'A PII-free synthetic failure test is required');
assert(workflow.includes('vars.REFUND_SOURCE_RECONCILIATION_ENABLED'), 'The daily schedule must be default-off');
assert(workflow.includes('secrets.REFUND_SOURCE_RECONCILIATION_TOKEN'), 'GitHub must use the dedicated monitor token');
assert(!workflow.includes('SERVICE_ROLE'), 'The GitHub workflow must never receive the Supabase service-role key');
assert(workflow.includes('cancel-in-progress: false'), 'A reconciliation run must not be cancelled mid-check');

assert(runbook.includes('accepted source submissions = Hub cases + authorized quarantine items'), 'Runbook must define the equation');
assert(runbook.includes('Go / no-go'), 'Runbook must include an explicit pilot gate');
assert(qa.includes('refunds:validate-source-aware-queue'), 'QA checklist must include the executable guard');
assert(releaseManifest.includes('202608040007_refund_source_aware_queue.sql'), 'Release manifest must include the source-aware migration');
assert(releaseManifest.includes('refund-source-reconciliation'), 'Release manifest must include the monitor function');
assert(portalUat.includes('runSourceAwareQueueChecks'), 'Rendered browser UAT must cover the source-aware queue');
assert(portalUat.includes('refund-source-aware-queue-mobile.png'), 'Rendered browser UAT must capture mobile evidence');

console.log('Refund source-aware queue validation passed: unified drafts, scoped states, aggregate health, daily reconciliation, and exact case links are present.');
