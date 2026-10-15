import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { recordRefundWorkObservation, refundHealthNotificationStatus } from './refund-work-observation.ts';
const runtime = { automation: true, contact: true, manualOutbox: true, paymentExecutor: true, policyWindow: true };
Deno.test('present unavailable/malformed evidence never uses the legacy green incident override', () => {
  const legacy = { status: 'waiting', schedulerStatus: 'healthy', workflowStatus: 'instrumentation_unavailable',
    deliveryStatus: 'healthy', blockedReasons: [] };
  assertEquals(refundHealthNotificationStatus(legacy), 'healthy');
  for (const dueWork of [undefined, null, {}, { status: 'instrumentation_unavailable', reason: 'current_work_query_failed' }]) {
    assertEquals(refundHealthNotificationStatus({ ...legacy, dueWork }), 'waiting');
  }
  assertEquals(refundHealthNotificationStatus({ ...legacy, status: 'failing', workflowStatus: 'degraded',
    dueWork: { status: 'degraded' } }), 'workflow_degraded');
});
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

Deno.test('a stalled observation is bounded, aborts transport and stays unavailable without retry', async () => {
  let calls = 0;
  let signal: AbortSignal | undefined;
  const pending = new Promise<{data: unknown; error: unknown}>(() => {});
  const result = await recordRefundWorkObservation({ rpc: () => {
    calls++;
    return Object.assign(pending, { abortSignal: (value: AbortSignal) => { signal = value; return pending; } });
  } }, 'run', 'before', runtime, 5);
  assertEquals(result, 'unavailable');
  assertEquals(signal?.aborted, true);
  assertEquals(calls, 1);
});
