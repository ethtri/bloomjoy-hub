/// <reference lib="deno.ns" />
import { applyMachineRatePeriod, machineRateDraftError, machineRateDraftKey, parseMachineRatePolicyState, parseMachineRatePreview, type MachineRateDraft } from './reportingMachineRatePolicy.ts';

const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const rejects = (fn: () => unknown) => { let rejected = false; try { fn(); } catch { rejected = true; } assert(rejected, 'Expected invalid response to be rejected'); };
const draft: MachineRateDraft = { ratePercent: '9', status: 'provisional', startsOn: '2026-09-01', endsOn: '', reason: 'Awaiting source access', evidenceReference: '' };
const amounts = { knownSalesExTaxCents: 0, knownRefundExTaxCents: null, unknownSalesComponents: 2, unknownRefundComponents: 1, estimatedSalesExTaxCents: null, estimatedRefundExTaxCents: null, estimatedNetExTaxCents: null, provisionalSalesComponents: 0, provisionalRefundComponents: 0 };
const preview = { previewToken: '11111111-1111-4111-8111-111111111111', expiresAt: '2026-10-08T23:00:00Z', revision: '1', range: { startsOn: '2026-09-01', endsOn: null }, observedRange: { startsOn: '2024-05-12', endsOn: '2026-10-07' }, affectedSalesComponents: 3, affectedRefundComponents: 2, preservedActualTaxSalesFacts: 1, before: amounts, after: { ...amounts, knownSalesExTaxCents: 918, unknownSalesComponents: 0 }, sourceBehavior: 'provisional_fallback', warnings: [] };

Deno.test('Rate presets use evidenced history and permit explicit earlier dates without an arbitrary cutoff', () => {
  const historical = applyMachineRatePeriod({ ...draft, startsOn: '2026-10-08' }, 'past', '2026-10-08', '2024-05-12');
  assert(historical.startsOn === '2024-05-12' && historical.endsOn === '2026-10-07', 'Use first recorded history and yesterday');
  const both = applyMachineRatePeriod({ ...draft, startsOn: '2023-01-01' }, 'both', '2026-10-08', '2024-05-12');
  assert(both.startsOn === '2023-01-01' && both.endsOn === '', 'Keep an explicit earlier start and open-ended future');
  const current = applyMachineRatePeriod(draft, 'current', '2026-10-08');
  assert(current.startsOn === '2026-10-08' && current.endsOn === '', 'Current continues into future');
  assert(applyMachineRatePeriod({ ...draft, startsOn: '2026-10-08' }, 'both', '2026-10-08').startsOn === '', 'Require explicit history when no evidence');
});

Deno.test('Rate validation accepts explicit zero and percentage units while rejecting invalid ranges', () => {
  assert(machineRateDraftError(draft) === null && machineRateDraftError({ ...draft, ratePercent: '0' }) === null, '9 means9%, zero intentional');
  for (const ratePercent of ['', '-1', '101', 'NaN', '9%', '1e2']) assert(Boolean(machineRateDraftError({ ...draft, ratePercent })), `Reject ${ratePercent}`);
  assert(Boolean(machineRateDraftError({ ...draft, startsOn: '2026-02-30' })), 'Reject nonexistent date');
  assert(Boolean(machineRateDraftError({ ...draft, endsOn: '2026-08-01' })), 'Reject reversed range');
  assert(Boolean(machineRateDraftError({ ...draft, reason: ' ' })), 'Require audit reason');
});

Deno.test('Every draft field changes the preview identity', () => {
  const key = machineRateDraftKey(draft);
  for (const patch of [{ ratePercent: '8' }, { status: 'confirmed' as const }, { startsOn: '2026-08-01' }, { endsOn: '2026-09-30' }, { reason: 'Updated reason' }, { evidenceReference: 'Owner statement' }]) assert(machineRateDraftKey({ ...draft, ...patch }) !== key, 'Invalidate preview for every edit');
});

Deno.test('Preview preserves known zero versus unavailable and rejects unsafe monetary or count data', () => {
  const parsed = parseMachineRatePreview(preview);
  assert(parsed.before.knownSalesExTaxCents === 0 && parsed.before.knownRefundExTaxCents === null, 'Do not invent unknown money');
  rejects(() => parseMachineRatePreview({ ...preview, before: { ...amounts, knownSalesExTaxCents: 1.25 } }));
  rejects(() => parseMachineRatePreview({ ...preview, before: { ...amounts, knownSalesExTaxCents: Number.MAX_SAFE_INTEGER + 1 } }));
  rejects(() => parseMachineRatePreview({ ...preview, affectedSalesComponents: -1 }));
  rejects(() => parseMachineRatePreview({ ...preview, sourceBehavior: 'verified_estimate' }));
  rejects(() => parseMachineRatePreview({ ...preview, previewToken: 'not-a-token' }));
  rejects(() => parseMachineRatePreview({ ...preview, observedRange: { startsOn: null, endsOn: '2026-10-07' } }));
  const empty = parseMachineRatePreview({ ...preview, observedRange: { startsOn: null, endsOn: null } });
  assert(empty.observedRange.startsOn === null, 'Empty recorded scope stays explicit');
  assert(parsed.range.startsOn === '2026-09-01' && parsed.observedRange.startsOn === '2024-05-12', 'Do not confuse selected purchases with whole-machine recorded scope');
});

Deno.test('Current policy does not label a missing rate or provisional policy as source verified', () => {
  const state = { machineId: 'synthetic', asOfDate: '2026-10-08', historyStartsOn: null, revision: '1', current: { ratePercent: null, status: 'unavailable', source: null, label: 'No verified rate', startsOn: null, endsOn: null }, policies: [] };
  assert(parseMachineRatePolicyState(state).current.ratePercent === null, 'No false zero');
  const provisional = parseMachineRatePolicyState({ ...state, current: { ...state.current, ratePercent: 7.5, status: 'provisional', source: 'machine_policy', label: 'Estimate pending verification' } });
  assert(provisional.current.status === 'provisional', 'Preserve estimate state');
  rejects(() => parseMachineRatePolicyState({ ...state, current: { ...state.current, ratePercent: null, status: 'confirmed' } }));
  rejects(() => parseMachineRatePolicyState({ ...state, current: { ...state.current, ratePercent: 0, status: 'unavailable' } }));
});
