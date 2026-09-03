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
 const context=vm.createContext({...dependencies,console,crypto:webcrypto});vm.runInContext(code,context);return context.handler;
}
const dependencies={hasConfirmedRefundReceipt:c=>c.receipt===true,getLatestCustomerMessage:()=>null,isDefinitiveNoRefundRetryReady:()=>false,transactionalDeliveryLabel:state=>state,hasTransactionMatch:c=>Boolean(c.matched),derivePortalRefundMissingFields:()=>[],isWaitingCase:()=>true,activeNayaxCandidate:()=>null,hasSelectedCardEvidence:()=>true,formatCurrency:amount=>`$${(amount/100).toFixed(2)}`};
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
  selectedCase:{id:'case-1',customerCorrectionFields:['card_last4','amount']},customerDeliveryNeedsReconciliation:false,isUsingDemoData:false,
  messageType:'denied',messageSubject:'Old denial subject',messageBody:'Old denial draft',
  gmailContext:{triageSuggestion:{id:'unreviewed',status:'ready_for_review',route:'draft_reply',missingFields:['incident_time']}},
  officialActionVersion:12,getCustomerMessageDraft:()=>({subject:'Canonical',body:'Canonical'}),manualMessageIntentRef:{current:null},
  setIsSendingCustomerMessage:()=>{},sendRefundCaseMessage:async input=>{sent=input;return {transport:'gmail_thread'};},refresh:async()=>{refreshed++;},
  toast:{error:value=>errors.push(value),success:()=>{},info:()=>{}},isEdgeFunctionError:()=>false,
 });
 await handler('more_info');
 assert.equal(errors.length,0);assert.equal(refreshed,1);assert.equal(sent.messageType,'more_info');
 assert.deepEqual(Array.from(sent.missingFields),['card_last4','amount']);
 assert.equal(sent.subject,undefined);assert.equal(sent.body,undefined);assert.equal(sent.triageSuggestionId,undefined);
});
