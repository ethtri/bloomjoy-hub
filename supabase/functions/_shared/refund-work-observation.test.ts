import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { recordRefundWorkObservation } from './refund-work-observation.ts';
const runtime = { automation: true, contact: true, manualOutbox: true, paymentExecutor: true, policyWindow: true };
Deno.test('missing additive schema is compatible but real observation failures stay unavailable', async () => {
  for (const [error, expected] of [[{ code: 'PGRST202' }, 'legacy'], [{ code: '42501' }, 'unavailable']] as const) {
    assertEquals(await recordRefundWorkObservation({ rpc: () => Promise.resolve({ data: null, error }) }, 'run', 'before', runtime), expected);
  }
  assertEquals(await recordRefundWorkObservation({ rpc: () => Promise.resolve({ data: { recorded: true, status: 'instrumentation_unavailable' }, error: null }) }, 'run', 'after', runtime), 'unavailable');
});
Deno.test('records one explicit phase with readiness booleans and no transport', async () => {
  const calls: unknown[] = [];
  const result = await recordRefundWorkObservation({ rpc: (name, args) => {
    calls.push({ name, args });
    return Promise.resolve({ data: { recorded: true, status: 'available' }, error: null });
  } }, 'run-id', 'before', runtime);
  assertEquals(result, 'recorded');
  assertEquals(calls, [{ name: 'service_record_refund_work_observation', args: { p_run_id: 'run-id', p_phase: 'before', p_runtime: runtime } }]);
});
