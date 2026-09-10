import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file) => readFileSync(path.resolve(process.cwd(), file), 'utf8');
const intake = read('supabase/functions/refund-case-intake/index.ts');
const migration = read('supabase/migrations/20260910235500_refund_submission_identity_atomicity.sql');
const concurrency = read('supabase/tests/refund_submission_identity_concurrency.sql');

assert.match(migration, /generated always as[\s\S]*submission_identity_hash/iu);
assert.match(migration, /create unique index[\s\S]*refund_cases_submission_identity_hash_idx/iu);
assert.match(migration, /pg_advisory_xact_lock/iu);
assert.match(migration, /guard_refund_submission_identity_immutable/iu);
assert.match(intake, /service_claim_refund_submission_identity/iu);
assert.match(intake, /insertError\.code !== "23505"[\s\S]*concurrentIdentityClaim/iu);
assert.match(concurrency, /dblink_send_query\('refund_submission_a'/u);
assert.match(concurrency, /Concurrent changed-payload UUID reuse creates exactly one case/u);
assert.match(concurrency, /A later update cannot overwrite an adopted identity/u);

console.log('Refund submission atomic identity recovery validated.');
