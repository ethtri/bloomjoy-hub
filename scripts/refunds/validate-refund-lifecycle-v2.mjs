import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relativePath) => readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

const [migration, payoutMigration, lifecycle, managerState, customerStatus, statusCapability, portalFixture, releaseValidator] =
  await Promise.all([
    read('supabase/migrations/20260902000417_refund_lifecycle_v2_integrity.sql'),
    read('supabase/migrations/20260902004500_refund_payout_destination_follow_up.sql'),
    read('src/lib/refundLifecycle.ts'),
    read('src/lib/refundManagerState.ts'),
    read('src/lib/refundCustomerStatus.ts'),
    read('supabase/functions/_shared/refund-status-capability.ts'),
    read('scripts/refunds/validate-refund-portal-uat.mjs'),
    read('scripts/refunds/validate-refund-release.mjs'),
  ]);

assert.match(migration, /'schemaVersion', 'refund_lifecycle_v2'/);
assert.match(migration, /'schemaVersion', 'refund_manager_queue_v2'/);
assert.match(migration, /create constraint trigger refund_cases_enforce_lifecycle_v2/);
assert.match(migration, /deferrable initially deferred/);
assert.match(migration, /card_payment_state_without_attempt/);
assert.match(migration, /service_reconcile_refund_lifecycle_integrity_v2/);
assert.match(migration, /'paymentRetriesMade', 0/);
assert.match(migration, /'customerMessagesCreated', 0/);
assert.match(migration, /'locationEvidence', jsonb_build_object/);
assert.match(migration, /'customerReported', jsonb_build_object/);
assert.match(migration, /'normalized', jsonb_build_object/);
assert.match(migration, /'releaseOrder', jsonb_build_array\('database', 'functions', 'ui'\)/);
assert.match(migration, /lifecycle ->> 'classification' <> 'customer'/);
assert.match(payoutMigration, /'zelle_payment_contact'::text, 10/);
assert.match(payoutMigration, /requested_fields_satisfied_by_gmail_message_id/);
assert.match(payoutMigration, /payout_destination_request_not_active/);
assert.match(payoutMigration, /payload_redacted/);

assert.match(lifecycle, /REFUND_LIFECYCLE_SCHEMA_VERSION = "refund_lifecycle_v2"/);
assert.match(lifecycle, /"integrity_hold"/);
assert.match(lifecycle, /"internal_test_archived"/);
assert.match(lifecycle, /locationEvidence:/);
assert.match(managerState, /case 'awaiting_payout':/);
assert.match(managerState, /case 'integrity_hold':/);
assert.match(managerState, /case 'unable_to_complete':/);
assert.match(managerState, /case 'internal_test_archived':/);
assert.match(customerStatus, /REFUND_CUSTOMER_LIFECYCLE_SCHEMA_VERSION = 'refund_lifecycle_v2'/);
assert.doesNotMatch(statusCapability, /locationEvidence/);
assert.doesNotMatch(statusCapability, /managerAction/);
assert.doesNotMatch(statusCapability, /providerAccountKey/);
assert.doesNotMatch(portalFixture, /refund_lifecycle_v1|refund_manager_queue_v1/);
assert.match(releaseValidator, /20260902000417_refund_lifecycle_v2_integrity\.sql/);
assert.match(releaseValidator, /exactly 130 discovered refund\/Nayax migrations/);

console.log('Refund lifecycle v2 integrity, privacy, UI, fixture, and release-skew validation passed.');
