/// <reference lib="deno.ns" />
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { parseRefundDueWorkHealth, parseRefundTechnicalHandoffHealth } from './refundDueWorkHealth.ts';

const health = { schemaVersion: 'refund_due_work_health_v1', payloadRedacted: true,
  status: 'healthy', observationsComplete: true, sourceCoverage: ['purchase_lookup'],
  dueCount: 0, overdueCount: 0, awaitingDecisionCount: 3, customerWaitCount: 2, unknownHoldCount: 1,
  oldestDecisionAt: '2026-10-10T10:00:00Z', technicalOwner: { required: false, activity: 'working' } };
Deno.test('empty processing queue remains separate from Manager and customer waits', () => {
    const result = parseRefundDueWorkHealth(health);
    assertEquals(result.status, 'healthy');
    assertEquals(result.awaitingDecisionCount, 3);
    assertEquals(result.customerWaitCount, 2);
    assertEquals(result.unknownHoldCount, 1);
    assertEquals(result.technicalOwner.activity, null);
});
Deno.test('unavailable observations never become zero', () => {
  for (const input of [undefined, {}, { ...health, overdueCount: null }, { ...health, dueCount: -1 },
    { ...health, schemaVersion: 'future' }]) {
    const result = parseRefundDueWorkHealth(input);
    assertEquals(result.status, 'instrumentation_unavailable');
    assertEquals(result.dueCount, null);
  }
});
Deno.test('degraded result does not infer an active repair consumer', () => {
    const result = parseRefundDueWorkHealth({ ...health, status: 'degraded', overdueCount: 1,
      technicalOwner: { required: true, activity: 'working' } });
    assertEquals(result.overdueCount, 1);
    assertEquals(result.technicalOwner.required, true);
    assertEquals(result.technicalOwner.availability, 'unverified');
    assertEquals(result.technicalOwner.activity, null);
});

Deno.test('human email acceptance never becomes delivered or active repair',()=>{
 const accepted=parseRefundTechnicalHandoffHealth({state:'accepted',incidentId:'synthetic',recipientCount:2,
  acceptedAt:'2026-10-15T22:00:00Z',repairActivity:'working',payloadRedacted:true},1);
 assertEquals(accepted.state,'accepted');assertEquals(accepted.repairActivity,null);
 assertEquals(parseRefundTechnicalHandoffHealth({state:'accepted',recipientCount:2,payloadRedacted:true},1).state,'unavailable');
 assertEquals(parseRefundTechnicalHandoffHealth({state:'accepted',recipientCount:2,payloadRedacted:true},'1').state,'unavailable');
});
