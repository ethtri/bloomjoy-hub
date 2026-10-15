import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../../supabase/functions/refund-case-automation-sweep/index.ts',import.meta.url),'utf8');
const start=source.indexOf('const runHealthCheck = async ('),end=source.indexOf('const runFailureTest = async (',start);
assert.ok(start>0&&end>start);
const executable=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
async function exercise(handoffThrows=false){
 const calls=[];
 const deps={supabase:{},getAutomationHealth:async()=>({status:'failing',technicalIncidentHandoffVersion:1}),
 claimAutomationHealthNotification:async()=>({notificationType:'none',incidentId:'existing-open'}),refundHealthNotificationStatus:()=> 'workflow_degraded',
 deliverRefundTechnicalHandoff:async()=>{calls.push('handoff');if(handoffThrows)throw new Error('unavailable');return 'accepted';},
 Deno:{env:{get:()=> 'configured'}},getRefundManagerQueueUrl:()=> 'https://app.bloomjoyusa.com/refunds',
 automationEnabled:true,automaticCustomerContactEnabled:true,refundManualMessageOutboxEnabled:()=>true,managerDigestEnabled:true,managerReadyNoticesEnabled:true,
 getRefundGmailMailboxIdentities:()=>[],sendTransactionalEmail:()=>{throw new Error('No live transport in test');},
 addReason:(_c,reason)=>calls.push(reason),finishRun:async()=>calls.push('finish'),
 claimAction:()=>{throw new Error('Legacy none must not claim another action');}};
 const run=new Function(...Object.keys(deps),`${executable};return runHealthCheck('run','key',{},'window');`);
 return {result:await run(...Object.values(deps)),calls};
}
test('actual health handler drains existing open human handoff before legacy none early return',async()=>{
 const {result,calls}=await exercise();assert.equal(result.humanHandoff,'accepted');assert.deepEqual(calls,['handoff','technical_handoff_accepted','finish']);
});
test('human handoff outage does not abandon or falsely complete the existing health run',async()=>{
 const {result,calls}=await exercise(true);assert.equal(result.humanHandoff,'unavailable');assert.equal(result.health.status,'failing');assert.equal(result.alertStatus,'suppressed');assert.equal(calls.at(-1),'finish');
});
