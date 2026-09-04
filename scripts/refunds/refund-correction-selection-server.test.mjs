import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.createSourceFile('index.ts',fs.readFileSync(new URL('../../supabase/functions/refund-case-message-send/index.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const variables=new Map();let served;
for(const statement of source.statements){
 if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations)variables.set(declaration.name.getText(source),declaration.initializer?.getText(source));
 if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(source)==='serve')served=statement.expression.arguments[0].getText(source);
}
const caseId='11111111-1111-4111-8111-111111111111';
const intentId='22222222-2222-4222-8222-222222222222';
function harness({fields=['amount','card_last4'],allowed=true}={}){
 const enqueues=[];let delivered=0;
 const context=vm.createContext({Request,Response,console,Set,Number,
  resolveSupabaseAccessToken:()=> 'session',allowedPortalMessageTypes:new Set(['more_info']),
  supabase:{auth:{getUser:async()=>({data:{user:{id:'manager'}}})},rpc:async(name,input)=>{
   if(name==='can_manage_refund_case')return {data:allowed};
   if(name==='service_refund_nayax_completion_message_lane_open')return {data:true};
   if(name==='service_enqueue_refund_manual_message_intent'||name==='service_revise_refund_purchase_correction'){
    enqueues.push(input);return input.p_expected_case_version!==12?{error:{code:'P4609'}}:{data:{enqueued:true,messageId:intentId,payloadRedacted:true}};
   }throw Error('Unexpected RPC '+name);
  }},
  getRefundCase:async()=>({id:caseId,official_action_version:12,case_population:'customer',customer_email:'fixture@example.invalid',public_reference:'RF-FIXTURE',status:'needs_review',payment_method:'card'}),
  sanitizeRefundMessageType:value=>value==='more_info'?value:null,
  sanitizeRefundMissingFields:value=>Array.isArray(value)?['amount','card_last4','wallet_provider'].filter(field=>value.includes(field)):[],
  deriveRefundMissingFields:()=>({missingFields:fields}),refundCorrectionLinksEnabled:async()=>true,getCurrentRefundCorrectionFields:async()=>fields,
  assertOpenNayaxCompletionMessageLane:async({checkOpen})=>{assert.equal(await checkOpen(),true);},RefundNayaxCompletionMessageLaneBlockedError:class extends Error{},
  validateRefundCustomerMessageRequest:()=>null,resolveRefundPublicLabels:()=>({}),refundCustomerLocaleFromIntakeMeta:()=> 'en',
  correctionLinkRequested:()=>true,STORED_CORRECTION_LINK_MARKER:'[Secure refund correction link included at delivery]',
  buildRefundCustomerEmail:input=>({subject:'Canonical',text:'Canonical '+input.missingFields.join(',')}),
  authorizeRefundSyntheticGmailProof:async()=>({authorizationId:null}),
  drainRefundManualMessageOutbox:async()=>{delivered++;return [{outcome:'sent',transport:'gmail_thread'}];},
  jsonResponse:(body,status=200)=>new Response(JSON.stringify(body),{status}),
 });
 for(const name of ['sanitizeText','isUuid','firstRelation','sameMissingFields'])if(variables.has(name))vm.runInContext(ts.transpile(`globalThis.${name}=${variables.get(name)};`,{target:ts.ScriptTarget.ES2022}),context);
 vm.runInContext(ts.transpile(`globalThis.handler=${served};`,{target:ts.ScriptTarget.ES2022}),context);
 return {enqueues,delivered:()=>delivered,request:async(overrides={})=>context.handler(new Request('https://fixture.invalid/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({caseId,messageType:'more_info',messageIntentId:intentId,expectedCaseVersion:12,missingFields:['amount'],...overrides})}))};
}
test('actual server handler accepts a nonempty current subset through existing versioned outbox',async()=>{
 const h=harness();const response=await h.request();assert.equal(response.status,200);assert.equal(h.delivered(),1);
 assert.deepEqual(Array.from(h.enqueues[0].p_requested_fields),['amount']);assert.equal(h.enqueues[0].p_recipient_email,'fixture@example.invalid');assert.equal(h.enqueues[0].p_expected_case_version,12);
 assert.equal(h.enqueues[0].p_body,'Canonical amount');
});
test('actual server handler rejects empty, unsupported, duplicate, stale field and arbitrary draft requests before enqueue',async()=>{
 for(const body of [{missingFields:[]},{missingFields:['amount','provider_id']},{missingFields:['amount','amount']},{missingFields:['wallet_provider']},{subject:'Unreviewed draft'},{body:'Arbitrary prose'},{body:0},{subject:false}]){
  const h=harness();assert.ok([400,409].includes((await h.request(body)).status));assert.equal(h.enqueues.length,0);assert.equal(h.delivered(),0);
 }
 const changed=harness({fields:['card_last4']});assert.equal((await changed.request()).status,409);assert.equal(changed.enqueues.length,0);
});
test('actual server handler retains manager authorization and stale-version refusal before transport',async()=>{
 const denied=harness({allowed:false});assert.equal((await denied.request()).status,403);assert.equal(denied.enqueues.length,0);
 const stale=harness();assert.equal((await stale.request({expectedCaseVersion:11})).status,409);assert.equal(stale.delivered(),0);
});

test('actual revision handler binds the current request and canonical fields to its narrow RPC',async()=>{
 const h=harness();const requestId='33333333-3333-4333-8333-333333333333';
 assert.equal((await h.request({currentCorrectionRequestId:requestId})).status,200);
 assert.equal(h.enqueues[0].p_current_request_id,requestId);
 assert.equal(h.enqueues[0].p_actor_user_id,'manager');
 assert.deepEqual(Array.from(h.enqueues[0].p_requested_fields),['amount']);
 for(const value of [null,'bad-id',false]){const bad=harness();assert.equal((await bad.request({currentCorrectionRequestId:value})).status,400);assert.equal(bad.delivered(),0);}
});
