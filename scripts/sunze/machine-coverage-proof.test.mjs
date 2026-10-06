import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { verifySunzeMachineCoverage } from '../../supabase/functions/_shared/sunze-machine-coverage.mjs';
const codes = ['a', 'b'];
const meta = () => ({ machineCoverageVerified: true, expectedVisibleMachineCount: 2,
  machineCoverage: { verified: true, navigationExhausted: true, issue: null,
    visibleSourceMachineCount: 2, providerTotal: 2,
    sourceIdsDigest: createHash('sha256').update(JSON.stringify(codes)).digest('hex') } });
test('accepts navigation/count/exact-set proof', async () => {
  assert.deepEqual(await verifySunzeMachineCoverage(meta(), codes), { verified: true, issue: null });
});
test('old nonempty list and boolean alone cannot claim coverage', async () => {
  assert.equal((await verifySunzeMachineCoverage({ machineCoverageVerified: true }, codes)).verified, false);
});
test('partial navigation, mismatched counts and identity set are unverified', async () => {
  for (const patch of [{ navigationExhausted: false }, { visibleSourceMachineCount: 1 }, { providerTotal: 3 }, { sourceIdsDigest: '0'.repeat(64) }, { verified: false }, { issue: 'page_limit' }]) {
    const input = meta(); Object.assign(input.machineCoverage, patch);
    assert.equal((await verifySunzeMachineCoverage(input, codes)).verified, false);
  }
  assert.equal((await verifySunzeMachineCoverage(meta(), ['a', 'c'])).issue, 'machine_source_set_mismatch');
});
test('producer incomplete issue is retained rather than replaced by nonempty success', async () => {
  assert.equal((await verifySunzeMachineCoverage({ ...meta(), machineCoverageIssue: 'machine_page_limit' }, codes)).issue, 'machine_page_limit');
});
test('configured expected count is independently enforced', async () => {
  assert.equal((await verifySunzeMachineCoverage({ ...meta(), expectedVisibleMachineCount: 3 }, codes)).issue, 'machine_expected_count_mismatch');
});
test('navigation alone without a trusted total/count is not certified', async () => {
  const input = meta(); input.machineCoverage.providerTotal = null; input.expectedVisibleMachineCount = null;
  assert.equal((await verifySunzeMachineCoverage(input, codes)).issue, 'machine_provider_total_unavailable');
});
