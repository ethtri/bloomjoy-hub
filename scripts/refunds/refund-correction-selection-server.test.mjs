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
function harness({fields=['amount','card_last4'],allowed=true,previous=null,providerEvidence=[],correctionEnabled=true}={}){
 const enqueues=[];let delivered=0;
 const context=vm.createContext({Request,Response,console,Set,Number,
  resolveSupabaseAccessToken:()=> 'session',allowedPortalMessageTypes:new Set(['more_info']),
  supabase:{from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:previous}),limit:async()=>({data:providerEvidence})})})}),auth:{getUser:async()=>({data:{user:{id:'manager'}}})},rpc:async(name,input)=>{
   if(name==='can_manage_refund_case')return {data:allowed};
   if(name==='service_refund_nayax_completion_message_lane_open')return {data:true};
   if(name==='service_enqueue_refund_manual_message_intent'||name==='service_revise_refund_purchase_correction'){
    enqueues.push(input);if(previous)return {data:{replayed:true,messageId:previous.id}};return input.p_expected_case_version!==12?{error:{code:'P4609'}}:{data:{enqueued:true,messageId:intentId,payloadRedacted:true}};
   }throw Error('Unexpected RPC '+name);
  }},
  getRefundCase:async()=>({id:caseId,official_action_version:12,case_population:'customer',customer_email:'fixture@example.invalid',public_reference:'RF-FIXTURE',status:'needs_review',payment_method:'card'}),
  sanitizeRefundMessageType:value=>value==='more_info'?value:null,
  sanitizeRefundMissingFields:value=>Array.isArray(value)?['amount','card_last4','wallet_provider'].filter(field=>value.includes(field)):[],
  deriveRefundMissingFields:()=>({missingFields:fields}),refundCorrectionLinksEnabled:async()=>correctionEnabled,getCurrentRefundCorrectionFields:async()=>fields,
  assertOpenNayaxCompletionMessageLane:async({checkOpen})=>{assert.equal(await checkOpen(),true);},RefundNayaxCompletionMessageLaneBlockedError:class extends Error{},
  validateRefundCustomerMessageRequest:()=>null,resolveRefundPublicLabels:()=>({}),refundCustomerLocaleFromIntakeMeta:()=> 'en',
  correctionLinkRequested:(_type,_fields,enabled)=>enabled,STORED_CORRECTION_LINK_MARKER:'[Secure refund correction link included at delivery]',refundStatusLinksEnabled:()=>false,
  buildRefundCustomerEmail:input=>({subject:'Canonical',text:'Canonical '+input.missingFields.join(',')}),
  buildEditableRefundCustomerEmail:({subject,body})=>({subject,text:'Editable '+body}),
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
test('actual server handler refreshes stale optional field selections from authoritative facts',async()=>{
 for(const body of [{missingFields:[]},{missingFields:['amount','provider_id']},{missingFields:['amount','amount']},{missingFields:['wallet_provider']}]){
  const h=harness();assert.equal((await h.request(body)).status,200);assert.equal(h.enqueues.length,1);assert.equal(h.delivered(),1);
  assert.deepEqual(Array.from(h.enqueues[0].p_requested_fields),['amount','card_last4']);
  assert.equal(h.enqueues[0].p_body,'Canonical amount,card_last4');
 }
 const changed=harness({fields:['card_last4']});assert.equal((await changed.request()).status,200);assert.equal(changed.enqueues.length,1);
 assert.deepEqual(Array.from(changed.enqueues[0].p_requested_fields),['card_last4']);
 assert.equal(changed.enqueues[0].p_body,'Canonical card_last4');
});
test('actual server handler still rejects arbitrary correction-link drafts before enqueue',async()=>{
 for(const body of [{subject:'Unreviewed draft'},{body:'Arbitrary prose'},{body:0},{subject:false}]){
  const h=harness();assert.equal((await h.request(body)).status,400);assert.equal(h.enqueues.length,0);assert.equal(h.delivered(),0);
 }
});
test('actual server handler replaces a stale editable draft but preserves a current one',async()=>{
 const stale=harness({fields:['card_last4'],correctionEnabled:false});
 assert.equal((await stale.request({missingFields:['amount'],subject:'Stale subject',body:'stale amount copy'})).status,200);
 assert.deepEqual(Array.from(stale.enqueues[0].p_requested_fields),['card_last4']);
 assert.equal(stale.enqueues[0].p_body,'Canonical card_last4');
 const current=harness({fields:['amount'],correctionEnabled:false});
 assert.equal((await current.request({subject:'Reviewed subject',body:'reviewed amount copy'})).status,200);
 assert.deepEqual(Array.from(current.enqueues[0].p_requested_fields),['amount']);
 assert.equal(current.enqueues[0].p_body,'Editable reviewed amount copy');
});
test('actual server handler retains manager authorization and stale-version refusal before transport',async()=>{
 const denied=harness({allowed:false});assert.equal((await denied.request()).status,403);assert.equal(denied.enqueues.length,0);
 const stale=harness();assert.equal((await stale.request({expectedCaseVersion:11})).status,409);assert.equal(stale.delivered(),0);
});

test('actual revision handler binds the current request and canonical fields to its narrow RPC',async()=>{
 const h=harness();const requestId='33333333-3333-4333-8333-333333333333';
 assert.equal((await h.request({currentCorrectionRequestId:requestId,missingFields:[]})).status,200);
 assert.equal(h.enqueues[0].p_current_request_id,requestId);
 assert.equal(h.enqueues[0].p_actor_user_id,'manager');
 assert.deepEqual(Array.from(h.enqueues[0].p_requested_fields),['amount','card_last4']);
 for(const value of [null,'bad-id',false]){const bad=harness();assert.equal((await bad.request({currentCorrectionRequestId:value})).status,400);assert.equal(bad.delivered(),0);}
});

test('actual revision replay reaches immutable intent after fields change without new transport',async()=>{
 const previous={id:intentId,recipient_email:'fixture@example.invalid',subject:'Original subject',body:'Original body',status:'sent',manual_delivery_state:'sent',delivery_transport:'gmail_thread',requested_fields:['amount']};
 const h=harness({fields:[],previous});
 assert.equal((await h.request({currentCorrectionRequestId:'33333333-3333-4333-8333-333333333333',missingFields:['wallet_provider']})).status,200);
 assert.equal(h.enqueues.length,1);assert.equal(h.enqueues[0].p_subject,'Original subject');assert.equal(h.delivered(),0);
 assert.deepEqual(Array.from(h.enqueues[0].p_requested_fields),['amount']);
 const invalid=harness({previous:{...previous,requested_fields:['amount','provider_account']}});
 assert.equal((await invalid.request({currentCorrectionRequestId:'33333333-3333-4333-8333-333333333333'})).status,409);
 assert.equal(invalid.enqueues.length,0);assert.equal(invalid.delivered(),0);
});
test('inspection of queued revision never drains, and absent intent cannot create a request',async()=>{
 const previous={id:intentId,recipient_email:'fixture@example.invalid',subject:'Original',body:'Original',status:'pending',manual_delivery_state:'queued',requested_fields:['amount']};
 const pending=harness({fields:[],previous});assert.equal((await pending.request({currentCorrectionRequestId:'33333333-3333-4333-8333-333333333333',inspectRevisionOnly:true})).status,409);assert.equal(pending.delivered(),0);
 const absent=harness();const response=await absent.request({currentCorrectionRequestId:'33333333-3333-4333-8333-333333333333',inspectRevisionOnly:true});
 assert.equal(response.status,409);assert.equal((await response.json()).errorCode,'revision_intent_not_found');assert.equal(absent.enqueues.length,0);assert.equal(absent.delivered(),0);
});

test('exact proven-unsent inspection permits review, while provider evidence and uncertainty keep hold',async()=>{
 const previous={id:intentId,recipient_email:'fixture@example.invalid',subject:'Original',body:'Original',status:'failed',manual_delivery_state:'failed',sent_at:null,provider_message_id:null,manual_delivery_provider_attempted_at:null,delivery_transport:null,requested_fields:['amount']};
 const request={currentCorrectionRequestId:'33333333-3333-4333-8333-333333333333',inspectRevisionOnly:true};
 const safe=harness({previous});assert.equal((await (await safe.request(request)).json()).errorCode,'revision_intent_proven_unsent');assert.equal(safe.delivered(),0);
 for(const options of [{previous:{...previous,manual_delivery_state:'delivery_unknown'}},{previous:{...previous,manual_delivery_provider_attempted_at:'now'}},{previous,providerEvidence:[{id:'provider'}]}]){
  const held=harness(options);assert.notEqual((await (await held.request(request)).json()).errorCode,'revision_intent_proven_unsent');assert.equal(held.delivered(),0);
 }
});
