/// <reference lib="deno.ns" />
import { createOwnerResolutionSubmission } from './ownerResolutionSubmission.ts';
const assert = (v: unknown, message = 'assertion') => { if (!v) throw new Error(message); };
Deno.test('lost commit response retries the exact retained adoption after the case advances', async () => {
  let calls = 0; let builds = 0; const requests: Record<string, unknown>[] = [];
  const submission = createOwnerResolutionSubmission(async (request) => { requests.push(structuredClone(request)); calls++;
    if (calls === 1) throw new Error('response lost after commit'); return { status: 'adopted' }; });
  const original = { caseId: 'same-case', intentId: 'same-intent', expectedCaseVersion: 7, source: 'same-source' };
  try { await submission.submit(async () => { builds++; return original; }); } catch { /* retry below */ }
  const result = await submission.submit(async () => { builds++; return { ...original, expectedCaseVersion: 8 }; });
  assert(builds === 1 && calls === 2 && JSON.stringify(requests[0]) === JSON.stringify(requests[1])); assert(result.status === 'adopted');
});
Deno.test('explicit evidence edit discards the retained uncertain payload', async () => {
  let calls = 0; const seen: Record<string, unknown>[] = [];
  const submission = createOwnerResolutionSubmission(async (request) => { seen.push(request); calls++; if (calls === 1) throw new Error('lost'); return request; });
  try { await submission.submit(async () => ({ intentId: 'old' })); } catch { /* edit below */ }
  submission.reset(); await submission.submit(async () => ({ intentId: 'new' }));
  assert(seen[0].intentId === 'old' && seen[1].intentId === 'new');
});
