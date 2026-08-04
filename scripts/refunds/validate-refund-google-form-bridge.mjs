import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(path), 'utf8');
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const shared = read('supabase/functions/_shared/refund-google-form.ts');
const edge = read('supabase/functions/refund-google-form-sync/index.ts');
const migration = read('supabase/migrations/202608040005_refund_google_form_case_bridge.sql');
const workflow = read('.github/workflows/refund-google-form-sync.yml');
const config = read('supabase/config.toml');
const envExample = read('.env.example');
const releaseTool = read('scripts/refunds/refund-release.mjs');
const releaseManifest = read('scripts/refunds/refund-production-release.json');

for (const header of [
  'Timestamp',
  'Your Name',
  'Email Address',
  'Location of Purchase',
  'Date and Time of Incident',
  'Incident Description',
  'Request Amount',
  'Payment Method',
  'Last 4 digits of the credit card used',
  'Refund Payment Preference',
  'Venmo/Zelle Payment ID',
]) {
  expect(shared.includes(`"${header}"`), `Missing legacy Google Form contract header: ${header}`);
}

expect(shared.includes('2026-08-04.v1'), 'Google Form contract must be versioned');
expect(shared.includes('unexpectedHeaders') && shared.includes('duplicateHeaders'), 'Unexpected or duplicate Form columns must fail closed');
expect(shared.includes('normalized.includes("apple pay")'), 'Wallet/card normalization is missing');
expect(shared.includes('missingFields.push("incident_datetime")'), 'Missing incident time must remain explicit');
expect(shared.includes('normalized > 100'), 'Legacy request amount must retain its public 0-100 boundary');

expect(edge.includes('https://www.googleapis.com/auth/spreadsheets.readonly'), 'Google access must remain Sheets read-only');
expect(edge.includes('sheet_header_fetch_failed') && edge.includes('!1:1'), 'Full response header must be checked for unsupported columns');
expect(edge.includes('REFUND_GOOGLE_FORM_SYNC_ENABLED') && edge.includes('=== "true"'), 'Edge function must fail closed behind an explicit enable flag');
expect(edge.includes('REFUND_GOOGLE_FORM_START_AT'), 'A declared no-backfill/start boundary is required');
expect(edge.includes('REFUND_GOOGLE_FORM_SOURCE_SALT'), 'Opaque source fingerprinting salt is required');
expect(edge.includes('service_ingest_refund_google_form_response'), 'Edge function must use the atomic service ingestion RPC');
expect(!edge.includes('RESEND_API_KEY'), 'Google Form sync must not send customer email');
expect(!edge.includes('nayax-card-refund'), 'Google Form sync must not invoke official refund execution');
expect(!edge.includes('console.log('), 'Edge function must not log source/customer payloads');
expect(edge.includes('google_authentication_failed'), 'Revoked Google credentials must return a sanitized failure');
expect(edge.includes('counts.rowsFailed += 1') && edge.includes('finalStatus === "failed" ? 500 : 200'), 'Partial row failures must be visible and retryable');

expect(migration.includes("check (intake_source in ('form', 'gmail', 'sms_google_form'))"), 'Explicit sms_google_form intake source is required');
expect(migration.includes("status = 'draft' and intake_source in ('gmail', 'sms_google_form')"), 'SMS bridge cases must remain draft-safe');
expect(migration.includes("auth.role() <> 'service_role'"), 'Service ingestion must enforce service-role authority');
expect(migration.includes('source_response_key_hash ~'), 'Source identifiers must be stored only as opaque hashes');
expect(migration.includes("raise exception 'Source start boundary required'"), 'Atomic ingestion must require the no-backfill boundary');
expect(migration.includes("resolved_reason_code := 'invalid_source_timestamp'"), 'Invalid source timestamps must fail closed');
expect(migration.includes("hashtextextended('refund_google_form_case_bridge', 0)"), 'Concurrent workers must serialize reordered Sheet intake');
expect(
  migration.indexOf('(source_payload_fingerprint = normalized_payload_hash) desc') <
    migration.indexOf('(source_response_key_hash = normalized_source_key) desc'),
  'Payload identity must take precedence over moved Sheet row numbers',
);
expect(migration.includes("'automatic_customer_contact', false"), 'Automatic customer contact must remain off');
expect(migration.includes("'official_actions_allowed', false"), 'Official actions must remain off for imported drafts');
expect(migration.includes('admin_get_refund_google_form_quarantine'), 'Authorized aggregate/quarantine visibility is required');
expect(migration.includes('revoke all on table public.refund_google_form_import_rows from anon, authenticated'), 'Raw import ledger must not be browser-readable');

expect(workflow.includes("cron: '3,13,23,33,43,53 * * * *'"), 'Default cadence must be the approved 10-minute bridge interval');
expect(workflow.includes('REFUND_GOOGLE_FORM_SYNC_ENABLED'), 'Scheduled workflow must be default-off');
expect(workflow.includes('npm run refunds:validate-google-form-bridge'), 'Workflow must validate bridge safety before syncing');
expect(workflow.includes('persist-credentials: false'), 'Workflow checkout credentials must not persist');
expect(workflow.includes('rowsQuarantined'), 'Workflow output must expose aggregate quarantine health');
expect(workflow.includes('::warning title=Refund intake review needed'), 'Quarantined/rejected rows must raise an aggregate PII-free warning');

expect(config.includes('[functions.refund-google-form-sync]\nverify_jwt = false'), 'Supabase function configuration is missing');
expect(releaseTool.includes("'refund-google-form-sync'"), 'Refund release allowlist must include the bridge function');
expect(releaseManifest.includes('"slug": "refund-google-form-sync"'), 'Refund release manifest must include the bridge function');
expect(releaseManifest.includes('202608040005_refund_google_form_case_bridge.sql'), 'Refund release manifest must include the bridge migration');
for (const key of [
  'REFUND_GOOGLE_FORM_SYNC_ENABLED=false',
  'REFUND_GOOGLE_FORM_SYNC_SECRET=',
  'REFUND_GOOGLE_FORM_SHEET_ID=',
  'REFUND_GOOGLE_FORM_SOURCE_SALT=',
  'REFUND_GOOGLE_FORM_START_AT=',
]) {
  expect(envExample.includes(key), `Missing server-only configuration placeholder: ${key}`);
}

if (failures.length > 0) {
  console.error('Refund Google Form bridge validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Refund Google Form bridge validation passed.');
console.log('- two-page field contract is versioned and tested');
console.log('- Sheets access is read-only and all source identifiers are opaque');
console.log('- ingestion is default-off, draft-only, idempotent, and service-authorized');
console.log('- customer sends, official actions, and payment execution are absent');
