import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sweep = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'functions', 'refund-case-automation-sweep', 'index.ts'),
  'utf8',
);
const migration = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260929221500_refund_system_candidate_review.sql'),
  'utf8',
);

test('scheduled ambiguous lookup settles after its authoritative commit without a second case update', () => {
  const branchStart = sweep.indexOf('if (\n        !walletCorrectionUseful &&');
  const branchEnd = sweep.indexOf('await finishAction(action, "completed", "nayax_review_ready"', branchStart);
  assert.ok(branchStart >= 0 && branchEnd > branchStart);
  const branch = sweep.slice(branchStart, branchEnd);

  assert.doesNotMatch(branch, /\.from\("refund_cases"\)[\s\S]*?\.update\(/);
  assert.match(branch, /event_type:\s*"nayax_auto_recommendation_evaluated"/);
  assert.match(branch, /payload_redacted:\s*true/);
});

test('System candidate review remains exact-current and leaves manual evidence actor-bound', () => {
  assert.match(migration, /lookup_candidate\.actor_user_id is null/);
  assert.match(migration, /lookup_candidate\.lookup_generation = refund_case\.nayax_lookup_generation/);
  assert.match(migration, /refund_case\.nayax_lookup_status in \('multiple_matches','manual_exception'\)/);
  assert.match(migration, /refund_case\.nayax_recommendation_state in \('ambiguous','manual_exception'\)/);
  assert.match(migration, /<> 'manual_nayax_portal'/);
  assert.doesNotMatch(migration, /service_commit_refund_nayax_lookup/);
});
