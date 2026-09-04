import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
const source=ts.createSourceFile('Refunds.tsx',fs.readFileSync(new URL('../../src/pages/admin/Refunds.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function load(name,dependencies){
 let initializer;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)===name)initializer=node.initializer;ts.forEachChild(node,visit);}visit(source);
 assert.ok(initializer,`Actual handler ${name} exists`);
 const code=ts.transpile(`const handler=${initializer.getText(source)};globalThis.handler=handler;`,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None});
 const context=vm.createContext({document:{activeElement:null,getElementById:()=>null},HTMLElement:class {},correctionDialogTriggerRef:{current:null},...dependencies,console,crypto:webcrypto});vm.runInContext(code,context);return context.handler;
}
const managerModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../src/lib/refundManagerState.ts',import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,managerModule);
const dependencies={...managerModule.exports,hasConfirmedRefundReceipt:c=>c.receipt===true,getLatestCustomerMessage:()=>null,isDefinitiveNoRefundRetryReady:()=>false,transactionalDeliveryLabel:state=>state,hasTransactionMatch:c=>Boolean(c.matched),derivePortalRefundMissingFields:()=>[],isWaitingCase:()=>true,activeNayaxCandidate:()=>null,hasSelectedCardEvidence:()=>true,formatCurrency:amount=>`$${(amount/100).toFixed(2)}`};
test('actual manager action respects current scope, delivery holds and terminal truth',()=>{
 const action=load('primaryActionConfig',dependencies);
 const base={status:'needs_review',paymentMethod:'card',customerCorrection:{state:'pending',isActive:true,isUsable:true}};
 const editor={status:'needs_review',decision:null,matchedNayaxCandidateToken:''};
 assert.equal(action(base,editor,[],null).label,'Waiting for customer response');
 assert.equal(action({...base,customerCorrection:{...base.customerCorrection,isActive:false,isUsable:false}},editor,[],null).label,'Manager review required');
 assert.equal(action({...base,matched:true,customerCorrection:{state:'pending',isActive:false,isUsable:false},lifecycle:{managerQueue:{bucket:'waiting_on_customer'}}},editor,[],{canIssueCardRefund:true,refundAmountCents:700}).mode,'nayax_refund_execution');
 assert.equal(action({...base,customerDeliveryException:{state:'bounced'}},editor,[],null).label,'Delivery needs review');
 assert.equal(action({...base,providerHold:true},editor,[],null).label,'Refund status not confirmed');
 assert.equal(action({...base,status:'completed'},editor,[],null).label,'Case complete');
 assert.equal(action({...base,status:'denied'},editor,[],null).label,'Request denied');
 assert.notEqual(action({...base,receipt:true},editor,[],null).label,'Waiting for customer response');
});
test('actual one-action correction sends canonical fields without unreviewed triage/editor content',async()=>{
 let sent;let refreshed=0;const errors=[];
 const handler=load('handleSendCustomerMessage',{
  selectedCase:{id:'case-1',customerCorrectionFields:['card_last4','amount']},customerDeliveryNeedsReconciliation:false,isUsingDemoData:false,pendingRevision:null,setPendingRevision:()=>{},
  correctionSelection:{caseId:'case-1',version:12,fields:['amount']},setCorrectionSelection:()=>{},
  messageType:'denied',messageSubject:'Old denial subject',messageBody:'Old denial draft',
  gmailContext:{triageSuggestion:{id:'unreviewed',status:'ready_for_review',route:'draft_reply',missingFields:['incident_time']}},
  officialActionVersion:12,getCustomerMessageDraft:()=>({subject:'Canonical',body:'Canonical'}),manualMessageIntentRef:{current:null},
  setIsSendingCustomerMessage:()=>{},sendRefundCaseMessage:async input=>{sent=input;return {transport:'gmail_thread'};},refresh:async()=>{refreshed++;},
  toast:{error:value=>errors.push(value),success:()=>{},info:()=>{}},isEdgeFunctionError:()=>false,
 });
 await handler('more_info',['amount']);
 assert.equal(errors.length,0);assert.equal(refreshed,1);assert.equal(sent.messageType,'more_info');
 assert.deepEqual(Array.from(sent.missingFields),['amount']);
 assert.equal(sent.subject,undefined);assert.equal(sent.body,undefined);assert.equal(sent.triageSuggestionId,undefined);
});

test('actual correction action opens preselected fields, rejects empty, stale and unsupported selections before send',async()=>{
 let selection;let sends=0;const errors=[];
 const base={selectedCase:{id:'case-1',customerCorrectionFields:['amount','card_last4']},correctionSelection:null,officialActionVersion:12,customerDeliveryNeedsReconciliation:false,isUsingDemoData:false,pendingRevision:null,setPendingRevision:()=>{},
  setCorrectionSelection:value=>{selection=value;},toast:{error:value=>errors.push(value)},sendRefundCaseMessage:()=>{sends++;}};
 await load('handleSendCustomerMessage',base)('more_info');
 assert.deepEqual(Array.from(selection.fields),['amount','card_last4']);assert.equal(sends,0);
 for(const [version,fields] of [[12,[]],[11,['amount']],[12,['wallet_provider']]]) {
  await load('handleSendCustomerMessage',{...base,correctionSelection:{caseId:'case-1',version,fields}})('more_info',fields);
 }
 assert.equal(errors.length,3);assert.equal(sends,0);
});

test('uncertain revision retains exact payload for read-only inspection after polling advances case',async()=>{
 let saved;let calls=0;const sent=[];const intent={current:null};
 const selectedCase={id:'case',customerCorrectionFields:['amount','card_last4'],customerCorrection:{state:'pending',isActive:true,requestId:'old-request',canRevise:true}};
 const base={selectedCase,pendingRevision:null,setPendingRevision:value=>{saved=value;},correctionSelection:{caseId:'case',version:12,fields:['card_last4'],requestId:'old-request',editing:true},
 customerDeliveryNeedsReconciliation:false,isUsingDemoData:false,messageType:'more_info',gmailContext:{},officialActionVersion:12,
 getCustomerMessageDraft:()=>({subject:'canonical',body:'canonical'}),manualMessageIntentRef:intent,setIsSendingCustomerMessage:()=>{},
 sendRefundCaseMessage:async input=>{sent.push(input);calls++;throw Error('Lost response after commit');},setCorrectionSelection:()=>{},refresh:async()=>{},
 toast:{error:()=>{},success:()=>{},info:()=>{}},isEdgeFunctionError:()=>false};
 await load('handleSendCustomerMessage',base)('more_info',['card_last4']);assert.equal(calls,1);assert.equal(saved.expectedCaseVersion,12);
 selectedCase.customerCorrection={state:'revoked',isActive:false,requestId:'replacement',canRevise:false};
 const retained=saved;
 await load('handleInspectRevisionDelivery',{...base,pendingRevision:retained,officialActionVersion:19,sendRefundCaseMessage:async input=>{sent.push(input);return {status:'sent'};}})();
 assert.equal(sent.length,2);assert.equal(sent[1].inspectRevisionOnly,true);assert.equal(sent[1].expectedCaseVersion,12);
 assert.equal(sent[1].messageIntentId,sent[0].messageIntentId);assert.equal(sent[1].currentCorrectionRequestId,'old-request');assert.equal(saved,null);
});
test('pending revision storage is per case and unrelated success cannot erase exact recovery payload',()=>{
 let stored={first:{caseId:'first',messageIntentId:'original'}};
 const set=load('setPendingRevision',{selectedCase:{id:'second'},setPendingRevisions:updater=>{stored=updater(stored);}});
 set({caseId:'second',messageIntentId:'other'});assert.equal(stored.first.messageIntentId,'original');
 set(null);assert.equal(stored.first.messageIntentId,'original');assert.equal(stored.second,undefined);
});
test('proven-unsent inspection clears only current case recovery; unknown remains retained',async()=>{
 for(const code of ['revision_intent_proven_unsent','customer_email_delivery_unknown']){
  let cleared=false;const handler=load('handleInspectRevisionDelivery',{pendingRevision:{caseId:'case'},selectedCase:{id:'case'},isUsingDemoData:false,setIsSendingCustomerMessage:()=>{},
   sendRefundCaseMessage:async()=>{throw {data:{errorCode:code}};},isEdgeFunctionError:()=>true,setPendingRevision:()=>{cleared=true;},manualMessageIntentRef:{current:{}},setCorrectionSelection:()=>{},refresh:async()=>{},toast:{error:()=>{}}});
  await handler();assert.equal(cleared,code==='revision_intent_proven_unsent');
 }
});
test('actual correction close restores enabled opener, or current summary when opener is gone',()=>{
 for(const enabled of [true,false]){
  let openerFocus=0;let summaryFocus=0;let prevented=0;
  const handler=load('handleCorrectionDialogCloseAutoFocus',{selectedCase:{id:'current-case'},correctionDialogTriggerRef:{current:{caseId:'current-case',element:{isConnected:enabled,matches:()=>false,focus:()=>openerFocus++}}},
    document:{getElementById:id=>{assert.equal(id,'refund-correction-current-case');return {focus:()=>summaryFocus++};}}});
  handler({preventDefault:()=>prevented++});assert.equal(prevented,1);assert.equal(openerFocus,enabled?1:0);assert.equal(summaryFocus,enabled?0:1);
 }
});
test('successful inspect restores focus to the same case summary without creating another send',async()=>{
 let requested;let focusId;const handler=load('handleInspectRevisionDelivery',{pendingRevision:{caseId:'original'},selectedCase:{id:'original'},isUsingDemoData:false,setIsSendingCustomerMessage:()=>{},
  sendRefundCaseMessage:async value=>{requested=value;return {status:'sent'};},setPendingRevision:()=>{},manualMessageIntentRef:{current:{}},setCorrectionSelection:()=>{},refresh:async()=>{},toast:{success:()=>{}},
  document:{getElementById:id=>({focus:()=>{focusId=id;}})}});
 await handler();assert.equal(requested.inspectRevisionOnly,true);assert.equal(focusId,'refund-correction-original');
});

test('case switch and missing custom targets preserve normal close without focusing reused opener',()=>{
 for (const switched of [true,false]) {
  let prevented=0;let focused=0;
  const handler=load('handleCorrectionDialogCloseAutoFocus',{selectedCase:{id:switched?'next-case':'original'},
   correctionDialogTriggerRef:{current:{caseId:'original',element:{isConnected:switched,matches:()=>false,focus:()=>focused++}}},document:{getElementById:()=>null}});
  handler({preventDefault:()=>prevented++});assert.equal(prevented,0);assert.equal(focused,0);
 }
});
test('inspection finishing after case switch cannot focus a different case',async()=>{
 let requestedId;const handler=load('handleInspectRevisionDelivery',{pendingRevision:{caseId:'original'},selectedCase:{id:'original'},isUsingDemoData:false,setIsSendingCustomerMessage:()=>{},
  sendRefundCaseMessage:async()=>({status:'sent'}),setPendingRevision:()=>{},manualMessageIntentRef:{current:{}},setCorrectionSelection:()=>{},refresh:async()=>{},toast:{success:()=>{}},
  document:{getElementById:id=>{requestedId=id;return null;}}});
 await handler();assert.equal(requestedId,'refund-correction-original');
});


test('actual action preserves canonical unpaid readiness despite failed, skipped or uncertain customer notices',()=>{
 const editor={status:'needs_review',decision:null,matchedNayaxCandidateToken:''};
 const lifecycle={stage:'transaction_confirmed',terminal:false,paymentState:'not_requested',managerQueue:{bucket:'ready_to_pay'}};
 const base={status:'needs_review',decision:'approved',paymentMethod:'card',providerOutcome:'not_attempted',matched:true,lifecycle};
 const available={canIssueCardRefund:true,refundAmountCents:700};
 for(const status of ['sent','failed','skipped']) for(const state of ['unknown','deferred','failed','bounced','complained']) {
  const action=load('primaryActionConfig',{...dependencies,getLatestCustomerMessage:()=>({status,messageType:'confirmation'}),isWaitingCase:()=>false});
  const result=action({...base,customerDeliveryException:{state}},editor,[],available);
  assert.equal(result.mode,'nayax_refund_execution',`${status}/${state}`);
  assert.equal(result.messageType,'completed');assert.notEqual(result.disabled,true);
  assert.equal(action({...base,customerDeliveryException:{state}},editor,[],{...available,canIssueCardRefund:false,blockReason:'unauthorized'}).disabled,true);
 }
 const missing=load('primaryActionConfig',{...dependencies,derivePortalRefundMissingFields:()=>['incident_time']});
 assert.equal(missing({...base,customerDeliveryException:{state:'bounced'}},editor,[],available).disabled,true);
 assert.equal(load('primaryActionConfig',dependencies)({...base,lifecycle:{...lifecycle,stage:'waiting_on_customer'},customerDeliveryException:{state:'bounced'}},editor,[],available).label,'Waiting for customer reply');
});

test('actual action gives payment holds, pending and terminal truth priority over a delivery task',()=>{
 const action=load('primaryActionConfig',dependencies);
 const editor={status:'needs_review',decision:null,matchedNayaxCandidateToken:''};
 const base={status:'needs_review',paymentMethod:'card',customerDeliveryException:{state:'bounced'}};
 for(const [stage,paymentState,label] of [['refund_initiated','submitted_pending','Refund initiated'],['confirming_with_nayax','submitted_pending','Confirming refund'],['needs_refund_operations','outcome_unknown','Needs Refund Operations'],['integrity_hold','integrity_unknown','Lifecycle evidence needs review'],['denied','not_issued','Denied']]) {
  const result=action({...base,lifecycle:{stage,paymentState,terminal:stage==='denied',managerQueue:{bucket:'needs_action'}}},editor,[],{canIssueCardRefund:true});
  assert.equal(result.disabled,true,stage);assert.equal(result.label,label,stage);
  assert.equal(result.mode,undefined,stage);
 }
 assert.equal(action({...base,providerHold:true},editor,[],{canIssueCardRefund:true}).label,'Refund status not confirmed');
});

test('actual action keeps explicit no-refund release independent of delivery-only review and current availability',()=>{
 const action=load('primaryActionConfig',{...dependencies,isDefinitiveNoRefundRetryReady:managerModule.exports.isDefinitiveNoRefundRetryReady,isWaitingCase:()=>false});
 const lifecycle={stage:'transaction_confirmed',terminal:false,paymentState:'not_requested',definitiveNoRefund:true,safeRetryEligible:true,operations:{required:true,safeStage:'released_no_refund',failureClass:'customer_delivery_exception'},managerQueue:{bucket:'ready_to_pay'}};
 const current={status:'needs_review',paymentMethod:'card',providerOutcome:'rejected',providerHold:false,matched:true,lifecycle,customerDeliveryException:{state:'unknown'}};
 const editor={status:'needs_review',decision:null,matchedNayaxCandidateToken:''};
 assert.equal(action(current,editor,[],{canIssueCardRefund:true,refundAmountCents:700}).mode,'nayax_refund_execution');
 assert.equal(action(current,editor,[],{canIssueCardRefund:false,blockReason:'reconciliation_hold'}).disabled,true);
 assert.equal(action({...current,lifecycle:{...lifecycle,operations:{...lifecycle.operations,failureClass:'provider_outcome_unknown'}}},editor,[],{canIssueCardRefund:true}).disabled,true);
});

const approvalValidationDependencies={
 centsFromCurrency:value=>/^\d+(?:\.\d{1,2})?$/.test(value)?Math.round(Number(value)*100):null,
 statusDecisionMap:{completed:'approved',denied:'denied'},
 noDecisionStatuses:new Set(['needs_review','waiting_on_customer']),
 statusLabel:status=>status,
 customerSafeDenialReasonSet:new Set(['Unable to verify the purchase']),
 hasConfirmedRefundReceipt:()=>false,
};
const unchangedApproval=load('hasUnchangedSavedApproval',approvalValidationDependencies);
const saveIssues=load('getCaseSaveIssues',approvalValidationDependencies);
const displayIssues=load('getPrimaryActionIssues',{...approvalValidationDependencies,hasUnchangedSavedApproval:unchangedApproval,getCaseSaveIssues:saveIssues});
const approvedCase={paymentMethod:'card',status:'needs_review',decision:'approved',decisionReason:'Ordinary manager approval',refundAmountCents:963};
const approvedEditor={status:'needs_review',decision:'approved',decisionReason:'Ordinary manager approval',refundAmount:'9.63',clearNayaxMatch:false,matchedNayaxCandidateToken:'',matchedNayaxAmount:'',matchedNayaxCardLast4:'',matchedNayaxCurrencyCode:'',matchedNayaxMachineAuthTime:''};

test('opening unchanged approved review suppresses only the false read-only decision warning',()=>{
 const action={label:'Manager review required',disabled:true};
 assert.equal(saveIssues(approvedCase,approvedEditor).length,1,'generic save validation stays intact');
 assert.equal(displayIssues(approvedCase,approvedEditor,action).length,0);
 const invalidCard={...approvedEditor,matchedNayaxCardLast4:'bad'};
 assert.equal(displayIssues(approvedCase,invalidCard,action).length,1,'unrelated input errors remain visible');
 assert.match(displayIssues(approvedCase,invalidCard,action)[0],/exactly 4 digits/);
});

test('changed approvals and real mutation modes retain original save validation',()=>{
 for(const change of [{refundAmount:'9.64'},{decisionReason:'Changed'},{decision:null},{status:'waiting_on_customer'},{clearNayaxMatch:true}]) {
  const next={...approvedEditor,...change};
  assert.equal(unchangedApproval(approvedCase,next),false);
  assert.equal(JSON.stringify(displayIssues(approvedCase,next,{disabled:true})),JSON.stringify(saveIssues(approvedCase,next)));
 }
 for(const mode of ['case_update','nayax_evidence_selection','nayax_refund_execution','manual_nayax_approval']) {
  assert.equal(JSON.stringify(displayIssues(approvedCase,approvedEditor,{disabled:true,mode})),JSON.stringify(saveIssues(approvedCase,approvedEditor)));
 }
 for(const change of [{decision:null},{decision:'denied'},{refundAmountCents:null},{refundAmountCents:0},{paymentMethod:'cash'}]) {
  assert.equal(unchangedApproval({...approvedCase,...change},approvedEditor),false);
 }
});

test('existing approval does not waive exact full-refund completion checks',()=>{
 const completed={...approvedEditor,status:'completed',matchedNayaxAmount:'9.64'};
 const issues=displayIssues(approvedCase,completed,{mode:'nayax_refund_execution'});
 assert.ok(issues.some(issue=>issue.includes('must match the selected machine transaction')));
 assert.ok(issues.some(issue=>issue.includes('before completing this refund')));
});
