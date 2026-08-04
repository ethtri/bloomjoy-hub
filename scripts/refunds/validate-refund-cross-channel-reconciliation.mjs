import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [migration, databaseTest, client, ui, runbook, qa, releaseManifest] = await Promise.all([
  read('supabase/migrations/202608040006_refund_cross_channel_case_reconciliation.sql'),
  read('supabase/tests/refund_cross_channel_case_reconciliation.sql'),
  read('src/lib/refundOperations.ts'),
  read('src/pages/admin/Refunds.tsx'),
  read('Docs/REFUND_CROSS_CHANNEL_RECONCILIATION.md'),
  read('Docs/QA_SMOKE_TEST_CHECKLIST.md'),
  read('scripts/refunds/refund-production-release.json'),
]);

assert(
  migration.includes('refund_case_reconciliation_reviews'),
  'A dedicated case-level review table is required',
);
assert(
  migration.includes('constraint refund_case_reconciliation_pair_unique unique'),
  'Case pairs must be unique under concurrent ingestion',
);
assert(
  migration.includes('pg_advisory_xact_lock') && migration.includes('hashtextextended'),
  'Likely concurrent channel submissions must serialize without persisting raw identity keys',
);
assert(
  migration.includes("match_class in ('exact', 'possible')"),
  'Exact and partial candidates must stay distinguishable',
);
assert(
  migration.includes('reason_codes <@ array[') && !migration.includes('customer_name_exact'),
  'Only fixed, bounded comparison reasons may be persisted',
);
assert(
  migration.includes('revoke all on table public.refund_case_reconciliation_reviews from public, anon, authenticated'),
  'Raw review rows must not be browser-readable',
);
assert(
  migration.includes('admin_get_refund_case_reconciliation') &&
    migration.includes('public.can_manage_refund_case(actor_user_id, other_case.id)'),
  'Manager context must be scoped across both reviewed cases',
);
assert(
  migration.includes('admin_resolve_refund_case_reconciliation') &&
    migration.includes("normalized_resolution not in ('duplicate', 'distinct')"),
  'Managers need explicit duplicate and distinct decisions',
);
assert(
  migration.includes('previous_duplicate_case_id') &&
    migration.includes('duplicate_of_refund_case_id = null'),
  'Manager reconciliation decisions must be reversible before an official action',
);
assert(
  migration.includes('Resolve possible duplicate refund cases before taking an official action') &&
    migration.includes('Resolve possible duplicate refund cases before provider execution') &&
    migration.includes('Resolve possible duplicate refund cases before settlement'),
  'Case, provider, and settlement paths must all fail closed',
);
assert(
  migration.includes('refund_case_has_unresolved_reconciliation(refund_case.id)') &&
    migration.includes('duplicate_of_refund_case_id is null'),
  'The Nayax readiness predicate must include case-level duplicate safety',
);
assert(
  migration.includes('admin_get_refund_reconciliation_health') &&
    migration.includes("'payloadRedacted', true"),
  'Aggregate duplicate-review health must be PII-free',
);

assert(databaseTest.includes('select plan(26)'), 'The reconciliation database suite must remain comprehensive');
assert(
  databaseTest.includes('pending review prevents an official case decision') &&
    databaseTest.includes('confirmed duplicate cannot take an official action'),
  'Database tests must prove both pending and confirmed action blocks',
);
assert(
  databaseTest.includes('A duplicate decision can be reversed to distinct'),
  'Database tests must prove reversible manager decisions',
);
assert(
  databaseTest.includes('partial cross-channel match is routed to manager review'),
  'Partial candidates must be tested as review-only',
);

assert(client.includes('fetchRefundCaseReconciliation'), 'The portal must load reconciliation context');
assert(client.includes('resolveRefundCaseReconciliation'), 'The portal must save manager decisions');
assert(ui.includes('refund-reconciliation-panel'), 'The selected case must surface duplicate safety');
assert(ui.includes('These are different purchases'), 'Managers need a clear distinct-case action');
assert(ui.includes('Keep {selectedCase.publicReference}'), 'Managers need an explicit canonical-case action');
assert(ui.includes('Duplicate safety status is unavailable'), 'UI failures must disable official actions');

assert(runbook.includes('Same-source replay protection'), 'The runbook must identify each source idempotency boundary');
assert(runbook.includes('No silent cross-source merge'), 'The runbook must state the conservative merge policy');
assert(runbook.includes('Go / no-go'), 'The runbook must include a pilot gate');
assert(qa.includes('refunds:validate-cross-channel-reconciliation'), 'The smoke checklist must include the executable guard');
assert(
  releaseManifest.includes('202608040006_refund_cross_channel_case_reconciliation.sql'),
  'The controlled Refund Operations release manifest must include the reconciliation migration',
);

console.log('Refund cross-channel reconciliation validation passed: source replay boundaries, manager review, reversible decisions, and official-action guards are present.');
