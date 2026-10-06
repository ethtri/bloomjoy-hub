// Coverage is producer navigation evidence, not merely a nonempty discovery list.
export const verifySunzeMachineCoverage = async (meta, visibleCodes) => {
  const fail = issue => ({ verified: false, issue });
  if (typeof meta.machineCoverageIssue === 'string' && meta.machineCoverageIssue.trim()) return fail(meta.machineCoverageIssue.slice(0, 100));
  const proof = meta.machineCoverage;
  if (!proof || meta.machineCoverageVerified !== true || proof.verified !== true) return fail('machine_coverage_proof_missing');
  if (proof.issue != null || proof.navigationExhausted !== true) return fail('machine_navigation_unverified');
  if (proof.visibleSourceMachineCount !== visibleCodes.length) return fail('machine_proof_count_mismatch');
  if (proof.providerTotal != null && (!Number.isSafeInteger(proof.providerTotal) || proof.providerTotal < 0 || proof.providerTotal !== visibleCodes.length)) return fail('machine_provider_count_mismatch');
  const expected = meta.expectedVisibleMachineCount;
  if (proof.providerTotal == null && expected == null) return fail('machine_provider_total_unavailable');
  if (expected != null && (!Number.isSafeInteger(expected) || expected < 0 || expected !== visibleCodes.length)) return fail('machine_expected_count_mismatch');
  if (visibleCodes.length === 0 && proof.providerTotal !== 0) return fail('missing_visible_machine_codes');
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify([...visibleCodes].sort()))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (proof.sourceIdsDigest !== digest) return fail('machine_source_set_mismatch');
  return { verified: true, issue: null };
};
