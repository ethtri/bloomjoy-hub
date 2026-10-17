import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { bindClaimSelect, extractClaimSelect, priorClaimSelect, raceFixture } from './refund-claim-queue-evidence.mjs';

test('queue baseline is the real prior five-call original-reader SELECT', () => {
  const old = priorClaimSelect();
  assert.equal((old.match(/service_refund_case_reader_identity\(/gu) ?? []).length, 5);
  assert.match(old, /for update of attempt skip locked\s+limit p_limit/u);
  assert.match(old, /refund_nayax_current_continuation_proof_matches_v1/u);
  assert.match(bindClaimSelect(old), /limit \$4/u);
  assert(!/\bp_(account_key|serialization_mode|refund_email_list_mode|limit)\b/u.test(bindClaimSelect(old)));
});

test('explicit queue definition resolves identity once after cheap eligibility and rechecks the outer tuple', () => {
  const migration = fs.readFileSync(new URL('../../supabase/migrations/20261017022126_refund_claim_reader_identity_once.sql', import.meta.url), 'utf8');
  const query = extractClaimSelect(migration);
  assert.equal((query.match(/service_refund_case_reader_identity\(/gu) ?? []).length, 1);
  assert.equal((query.match(/attempt.status = 'created'/gu) ?? []).length, 2);
  assert.match(query, /eligible as materialized/u);
  assert.match(query, /readers as materialized/u);
  assert.match(query, /refund_nayax_current_continuation_proof_matches_v1[\s\S]*order by attempt.created_at, attempt.id[\s\S]*skip locked\s+limit p_limit/u);
  assert.equal((query.match(/limit p_limit/gu) ?? []).length, 1);
  const fixture = raceFixture();
  assert.match(fixture.setup, /create function refund_single_gate_race.approve/u);
  assert(!fixture.setup.includes('create trigger refund_single_gate_race_delay'));
  assert.match(fixture.cleanup, /drop schema refund_single_gate_race cascade/u);
});
