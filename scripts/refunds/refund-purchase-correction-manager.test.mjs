import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
const source=ts.createSourceFile('Refunds.tsx',fs.readFileSync(new URL('../../src/pages/admin/Refunds.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function load(name,dependencies,sourceFile=source){
 let initializer;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(sourceFile)===name)initializer=node.initializer;ts.forEachChild(node,visit);}visit(sourceFile);
 assert.ok(initializer,`Actual handler ${name} exists`);
 const code=ts.transpile(`const handler=${initializer.getText(sourceFile)};globalThis.handler=handler;`,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None});
 const context=vm.createContext({document:{activeElement:null,getElementById:()=>null},HTMLElement:class {},correctionDialogTriggerRef:{current:null},...dependencies,console,crypto:webcrypto});vm.runInContext(code,context);return context.handler;
}
const managerModule = { exports: {} };
const outreachModule = { exports: {} };
const completionContactModule = { exports: {} };
vm.runInNewContext(
 ts.transpileModule(fs.readFileSync(new URL('../../src/lib/refundCompletionContact.ts',import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 completionContactModule,
);
vm.runInNewContext(
 ts.transpileModule(fs.readFileSync(new URL('../../src/lib/refundCustomerOutreach.ts',import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 outreachModule,
);
const {
 canRequestRefundCustomerDetailsManually,
 getRefundCustomerOutreachPresentation,
} = outreachModule.exports;
vm.runInNewContext(
 ts.transpileModule(fs.readFileSync(new URL('../../src/lib/refundManagerState.ts',import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {...managerModule,require:specifier=>{
 if(specifier==='./refundCustomerOutreach.ts') return {getRefundCustomerOutreachPresentation};
  if(specifier==='./refundCompletionContact.ts') return completionContactModule.exports;
  throw new Error(`Unexpected refund manager dependency: ${specifier}`);
 }},
);
const dependencies={...managerModule.exports,canRequestRefundCustomerDetailsManually,hasConfirmedRefundReceipt:c=>c.receipt===true,getLatestCustomerMessage:()=>null,isDefinitiveNoRefundRetryReady:()=>false,transactionalDeliveryLabel:state=>state,hasTransactionMatch:c=>Boolean(c.matched),derivePortalRefundMissingFields:()=>[],isWaitingCase:()=>true,activeNayaxCandidate:()=>null,hasSelectedCardEvidence:()=>true,formatCurrency:amount=>`$${(amount/100).toFixed(2)}`};
const freshPersistedSelection = {
 hasMatchedNayaxTransaction:true,officialActionVersion:7,
 selectedNayaxTransaction:{saleAmountCents:700,currencyCode:'USD',providerAuthorizedAt:'2026-09-12T18:30:00Z',cardLast4:'4242'},
};
const freshAvailability = {transactionConfirmed:true,caseVersion:7,canIssueCardRefund:true,refundAmountCents:700};
test('a late case-save response can update only the case that initiated it',()=>{
 let initializer;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='applyCaseUpdateResponse')initializer=node.initializer;ts.forEachChild(node,visit);}visit(source);
 assert.ok(initializer,'Actual response handler exists');
 const handlerSource=initializer.getText(source);
 assert.match(handlerSource,/selectedIdRef\.current === targetCase\.id/);
 assert.match(handlerSource,/targetStillSelected && authoritativeCase/);
 assert.match(handlerSource,/targetStillSelected && !options\.quietTransactionConfirmation/);
 assert.doesNotMatch(handlerSource,/selectedCase\.id/);
});
test('actual workbench names the accounting correction directly',()=>{
 const refundCase={lifecycle:{managerQueue:{bucket:'accounting_review'}}};
 const bucket=caseValue=>caseValue.lifecycle.managerQueue.bucket;
 const queueSource=ts.createSourceFile('RefundCaseQueuePanel.tsx',fs.readFileSync(new URL('../../src/components/refunds/RefundCaseQueuePanel.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 assert.equal(load('refundSearchViewLabel',{getRefundManagerQueueBucket:bucket},queueSource)(refundCase),'Fix refund accounting');
});
test('actual manager action respects current scope, delivery holds and terminal truth',()=>{
 const action=load('primaryActionConfig',dependencies);
 const base={status:'needs_review',paymentMethod:'card',customerCorrection:{state:'pending',isActive:true,isUsable:true}};
 const editor={status:'needs_review',decision:null,matchedNayaxCandidateToken:''};
 assert.equal(action(base,editor,[],null).label,'Waiting for customer response');
 assert.equal(action({...base,customerCorrection:{...base.customerCorrection,isActive:false,isUsable:false}},editor,[],null).label,'Manager review required');
 const readyAction=action({...base,...freshPersistedSelection,matched:true,customerCorrection:{state:'pending',isActive:false,isUsable:false},lifecycle:{managerQueue:{bucket:'waiting_on_customer'}}},editor,[],freshAvailability);
 assert.equal(readyAction.mode,'nayax_refund_execution');
 assert.equal(readyAction.label,'Refund $7.00');
 assert.notEqual(readyAction.label,'Customer follow-up unavailable');
 assert.equal(action({...base,customerDeliveryException:{state:'bounced'}},editor,[],null).label,'Delivery needs review');
 assert.equal(action({...base,providerHold:true},editor,[],null).label,'Check the exact transaction in Nayax');
 assert.equal(action({...base,status:'completed'},editor,[],null).label,'Case complete');
 assert.equal(action({...base,status:'denied'},editor,[],null).label,'Request denied');
 assert.equal(action({...base,...freshPersistedSelection,status:'completed'},editor,[],freshAvailability).label,'Case complete');
 assert.equal(action({...base,...freshPersistedSelection,status:'card_refund_pending',decision:'approved'},editor,[],freshAvailability).label,'System is finishing this approved refund');
 for(const messageState of ['none','pending','failed','delivery_unconfirmed','sent']) {
  const receiptAction=action({...base,receipt:true,lifecycle:{messageState:{state:messageState},managerQueue:{bucket:'accounting_review'}}},editor,[],null);
  assert.equal(receiptAction.disabled,true,messageState);
  assert.equal(receiptAction.mode,undefined,messageState);
  assert.equal(receiptAction.label,'Refund confirmed · accounting review',messageState);
 }
});
test('current server capability wins over stale optional and privacy projections',()=>{
 const action=load('primaryActionConfig',{...dependencies,isWaitingCase:()=>true,derivePortalRefundMissingFields:()=>['incident_time']});
 const editor={status:'needs_review',decision:null,clearNayaxMatch:false,matchedNayaxCandidateToken:''};
 const staleOptional={
  status:'needs_review',paymentMethod:'card',matched:true,...freshPersistedSelection,
  canPerformOfficialAction:false,reconciliationActionBlocked:true,providerHold:true,
  refundOperationsAccess:false,customerDeliveryException:{state:'bounced'},legacyStateReviewRequired:true,
  lifecycle:{stage:'waiting_on_customer',paymentState:'not_requested',terminal:false,managerQueue:{bucket:'waiting_on_customer'}},
 };
 const result=action(staleOptional,editor,[],freshAvailability);
 assert.equal(result.mode,'nayax_refund_execution');
 assert.equal(result.disabled,undefined);
 assert.equal(result.label,'Refund $7.00');
 const denial=action(staleOptional,{...editor,status:'denied',decision:'denied'},[],freshAvailability);
 assert.equal(denial.mode,'case_update');
 assert.equal(denial.label,'Deny request');
});
test('current card capability remains visible in the composed manager presentation',()=>{
 const staleOptionalCase={
  status:'needs_review',paymentMethod:'card',...freshPersistedSelection,
  paymentAmountCents:1000,matchedNayaxAmountCents:1000,
  providerHold:true,legacyStateReviewRequired:true,
  lifecycle:{stage:'waiting_on_customer',managerQueue:{bucket:'waiting_on_customer'}},
 };
 const baseManagerState=managerModule.exports.getCurrentRefundCardManagerState(
  staleOptionalCase,
  freshAvailability,
 );
 const managerState=load('cardManagerState',{
  selectedCase:staleOptionalCase,
  hasConfirmedRefundReceipt:()=>false,
  hasProtectedRefundLifecycle:()=>true,
  hasUnpaidRefundReview:()=>true,
  baseManagerState,
 });
 assert.equal(managerState.id,'ready_to_refund');
 assert.equal(managerState.nextStep,'Select Refund once to issue the exact amount.');
 const selectedCaseHasCurrentCardDecisionAuthority=load('selectedCaseHasCurrentCardDecisionAuthority',{
  selectedCaseHasCurrentCardCapability:true,
  selectedCase:staleOptionalCase,
  selectedCaseIsTerminal:false,
  selectedCaseIsResolvedDuplicate:false,
  hasConfirmedRefundReceipt:()=>false,
 });
 assert.equal(selectedCaseHasCurrentCardDecisionAuthority,true);
 const hasNayaxOutcomeResolution=load('hasNayaxOutcomeResolution',{
  selectedCaseHasCurrentCardCapability:true,
  selectedCaseNeedsLegacyPaymentReview:false,
  selectedCase:staleOptionalCase,
 });
 assert.equal(hasNayaxOutcomeResolution,false);
 const cardAmountCents=load('cardAmountCents',{
  selectedCaseHasCurrentCardCapability:true,
  selectedRefundReadiness:freshAvailability,
  selectedTransactionEvidence:freshPersistedSelection.selectedNayaxTransaction,
  selectedCase:staleOptionalCase,
  selectedCaseNeedsLegacyPaymentReview:false,
  matchedCardSaleAmountCents:1000,
 });
 assert.equal(cardAmountCents,700);
 const comparisonCandidate=load('comparisonCandidate',{
  selectedCaseHasCurrentCardCapability:true,
  selectedCaseNeedsLegacyPaymentReview:false,
  activeCandidate:{amountCents:1000,cardLast4:'9999'},
  selectableComparisonCandidate:null,
  effectiveCandidates:[],
 });
 assert.equal(comparisonCandidate,null);
 const transactionDecisionPending=load('transactionDecisionPending',{
  selectedCaseHasCurrentCardCapability:true,
  hasSelectedMatch:false,
  waitingOnCustomer:false,
  hasActiveCustomerOutreach:false,
  transactionView:{kind:'unavailable'},
 });
 assert.equal(transactionDecisionPending,false);
 const topActionLabel=load('topActionLabel',{
  primaryAction:{mode:'nayax_refund_execution',label:'Refund $7.00'},
 });
 const presentedAction=load('cardManagerCapabilityAction',{
  transactionDecisionPending,
  showDisabledActionStatus:false,
  primaryAction:{mode:'nayax_refund_execution',label:'Refund $7.00'},
  hasReadyRefund:true,
  topActionLabel,
  cardActionDisabled:false,
  isSaving:false,
  isRunningNayaxRefund:false,
 });
 assert.deepEqual({...presentedAction},{
  kind:'button',testId:'refund-run-nayax-refund',label:'Refund $7.00',disabled:false,pending:false,
 });
 const denialAction={mode:'case_update',targetDecision:'denied',label:'Deny request'};
 const currentCardDenialAction=load('currentCardDenialAction',{
  selectedCaseHasCurrentCardDecisionAuthority,
  primaryAction:denialAction,
 });
 assert.equal(currentCardDenialAction,true);
 const cardActionDisabled=load('cardActionDisabled',{
  primaryAction:denialAction,
  selectedCaseHasCurrentCardDecisionAuthority,
  currentCardDenialAction,
  isSaving:false,isSendingCustomerMessage:false,isRunningNayaxRefund:false,isUsingDemoData:false,
  primaryActionNeedsOfficialAccess:true,officialActionVersion:7,selectedCaseIsReviewOnly:true,
  primaryActionIssues:[],
 });
 assert.equal(cardActionDisabled,false);
 const customerCommunicationActions=load('customerCommunicationActions',{
  nextCustomerDraft:null,canAskForCustomerDetails:false,primaryAction:{label:'Refund $7.00'},
  isUsingDemoData:false,selectedCaseIsReviewOnly:true,selectedCaseHasCurrentCardDecisionAuthority,
  selectedCase:staleOptionalCase,
 });
 assert.equal(customerCommunicationActions.denial.disabled,false);
});
test('current card capability lets an explicit denial reach the versioned server update',async()=>{
 const selectedCase={id:'case-current',status:'needs_review',paymentMethod:'card',...freshPersistedSelection};
 const denialEditor={
  status:'denied',assignedManagerEmail:'',decision:'denied',decisionReason:'Unable to verify the purchase',
  internalNote:'',refundAmount:'7.00',manualRefundReference:'',cashPayoutSentAt:'',cashPaymentConfirmed:false,
  clearNayaxMatch:false,matchedNayaxCandidateToken:'',matchedNayaxMachineAuthTime:'',matchedNayaxAmount:'',
  matchedNayaxCardLast4:'',matchedNayaxCurrencyCode:'',nayaxDisagreementReason:'',
 };
 let updateInput=null;
 const handler=load('handleSaveCase',{
  selectedCase,editor:denialEditor,officialActionVersion:7,
  selectedCaseHasCurrentCardDecisionAuthority:true,selectedCaseIsReviewOnly:true,
  editorRequiresOfficialAction:()=>true,toast:{error:()=>{},info:()=>{}},isUsingDemoData:false,
  centsFromCurrency:value=>Math.round(Number(value)*100),getCaseSaveIssues:()=>[],
  selectedNayaxCandidate:()=>null,nayaxCandidates:[],setIsSaving:()=>{},cashCompletionAmountCents:null,
  derivePortalRefundMissingFields:()=>[],
  updateRefundCaseAdmin:async input=>{updateInput=input;return {};},
  applyCaseUpdateResponse:async()=>({updateApplied:true,officialActionVersion:8,refundReadiness:null,customerMessage:null}),
  isRefundCaseUpdateError:()=>false,selectedIdRef:{current:selectedCase.id},
 });
 const result=await handler(denialEditor,'denied');
 assert.equal(result.updateApplied,true);
 assert.equal(updateInput.expectedOfficialActionVersion,7);
 assert.equal(updateInput.status,'denied');
 assert.equal(updateInput.decision,'denied');
 assert.equal(updateInput.customerMessageType,'denied');
});
test('current card capability owns ready queue classification over stale lifecycle',()=>{
 const isReady=load('isReadyToPayCase',{
  doneStatuses:new Set(['completed','denied','closed']),
  hasConfirmedRefundReceipt:()=>false,
  hasCurrentRefundCardCapability:managerModule.exports.hasCurrentRefundCardCapability,
  canonicalQueueBucket:refundCase=>refundCase.lifecycle.managerQueue.bucket,
 });
 const staleWaitingCase={
  status:'needs_review',paymentMethod:'card',...freshPersistedSelection,
  refundReadiness:freshAvailability,
  lifecycle:{stage:'waiting_on_customer',managerQueue:{bucket:'waiting_on_customer'}},
 };
 assert.equal(isReady(staleWaitingCase),true);
 const taskState=load('taskManagerState',{
  isReadyToPayCase:isReady,
  getCurrentRefundCardManagerState:managerModule.exports.getCurrentRefundCardManagerState,
  getRefundManagerState:managerModule.exports.getRefundManagerState,
 });
 assert.equal(taskState(staleWaitingCase).id,'ready_to_refund');
 assert.equal(
  isReady({...staleWaitingCase,refundReadiness:{...freshAvailability,canIssueCardRefund:false,blockReason:'reconciliation_hold'}}),
  false,
 );
});
test('authoritative unavailable reasons stay disabled with their existing recovery copy',()=>{
 const action=load('primaryActionConfig',{...dependencies,isWaitingCase:()=>false});
 const refundCase={status:'needs_review',paymentMethod:'card',matched:true,...freshPersistedSelection};
 const editor={status:'needs_review',decision:null,clearNayaxMatch:false,matchedNayaxCandidateToken:''};
 for(const blockReason of [
  'unauthorized','already_refunded','reconciliation_hold','duplicate_transaction',
  'case_not_refundable','transaction_not_confirmed','provider_remaining_value_unverified','provider_unavailable',
 ]) {
  const result=action(refundCase,editor,[],{...freshAvailability,canIssueCardRefund:false,blockReason});
  assert.equal(result.disabled,true,blockReason);
  assert.equal(result.mode,undefined,blockReason);
  assert.equal(result.label,'Refund temporarily unavailable',blockReason);
  assert.ok(result.helper.length>10,blockReason);
 }
});
test('fresh reread drift makes zero provider execution calls',async()=>{
 const selectedCase={
  id:'case-current',paymentMethod:'card',officialActionVersion:7,
  selectedNayaxTransaction:freshPersistedSelection.selectedNayaxTransaction,
 };
 const editor={clearNayaxMatch:false,matchedNayaxCandidateToken:''};
 for(const [label,freshCase,freshReadiness,confirmed] of [
  ['version drift',{...selectedCase,officialActionVersion:8},{...freshAvailability,caseVersion:8},true],
  ['capability revoked',selectedCase,{...freshAvailability,canIssueCardRefund:false,blockReason:'reconciliation_hold'},true],
  ['selection drift',{...selectedCase,selectedNayaxTransaction:{...selectedCase.selectedNayaxTransaction,saleAmountCents:800}},freshAvailability,true],
 ]) {
  let executions=0;let reads=0;
  const handler=load('handleRunNayaxRefund',{
   nayaxRefundInFlightRef:{current:false},selectedCase,editor,isUsingDemoData:false,
   selectedNayaxCandidate:()=>null,nayaxCandidates:[],setIsRefundConfirmationOpen:()=>{},
   setNayaxExecutionNotice:()=>{},setIsRunningNayaxRefund:()=>{},setRefundActionReceipt:()=>{},
   readFreshNayaxSelection:async()=>{reads++;return {freshCase,freshReadiness,confirmed};},
   selectedIdRef:{current:selectedCase.id},
   persistedNayaxSelectionMatchesCandidate:managerModule.exports.persistedNayaxSelectionMatchesCandidate,
   officialActionVersion:7,refundReadinessBlockMessage:managerModule.exports.refundReadinessBlockMessage,
   executeNayaxCardRefund:async()=>{executions++;return {};},applyNayaxExecutionResult:async()=>{},
   isNayaxCardRefundExecutionError:()=>false,toast:{error:()=>{},info:()=>{}},
  });
  await handler();
  assert.equal(reads,1,label);
  assert.equal(executions,0,label);
 }
});
test('RF-423906B2 shape keeps one visible refund action despite optional intake metadata',()=>{
 const action=load('primaryActionConfig',{
  ...dependencies,
  derivePortalRefundMissingFields:()=>['incident_time_source'],
  isWaitingCase:()=>false,
 });
 const refundCase={
  status:'needs_review',paymentMethod:'card',matched:true,
  paymentAmountCents:1000,refundAmountCents:1090,cardLast4:'4242',
  incidentAt:'2026-09-12T18:28:00Z',
  hasMatchedNayaxTransaction:true,officialActionVersion:11,
  selectedNayaxTransaction:{saleAmountCents:1090,currencyCode:'USD',
   providerAuthorizedAt:'2026-09-12T18:30:00Z',cardLast4:'4242'},
 };
 const editor={status:'needs_review',decision:null,matchedNayaxCandidateToken:''};
 const readiness={transactionConfirmed:true,caseVersion:11,
  canIssueCardRefund:true,refundAmountCents:1090};
 const result=action(refundCase,editor,[],readiness);
 assert.equal(result.mode,'nayax_refund_execution');
 assert.equal(result.label,'Refund $10.90');
 assert.equal(result.disabled,undefined);
});
test('selected candidate exposes one ordinary refund decision with no manual portal fallback',()=>{
 const action=load('primaryActionConfig',{
  ...dependencies,
  isWaitingCase:()=>false,
  activeNayaxCandidate:(_refundCase,_editor,candidates)=>candidates[0]??null,
 });
 const candidate={candidateToken:'candidate-1',amountCents:1090};
 const pendingCase={status:'needs_review',paymentMethod:'card',correlationStatus:'needs_nayax'};
 const pendingEditor={status:'needs_review',decision:null,matchedNayaxCandidateToken:'candidate-1'};
 const oldBackend=action(pendingCase,pendingEditor,[candidate],{});
 assert.equal(oldBackend.label,'Save transaction before refunding');
 assert.equal(oldBackend.disabled,true);
 assert.equal(oldBackend.mode,undefined);

 const combined=action(pendingCase,pendingEditor,[candidate],{approvalPendingExecution:false});
 assert.equal(combined.label,'Save transaction before refunding');
 assert.equal(combined.disabled,true);
 assert.equal(combined.mode,undefined);

 const selectedWallet={...pendingCase,...freshPersistedSelection,matched:true,refundAmountCents:1090};
 const savedEditor={...pendingEditor,matchedNayaxCandidateToken:''};
 assert.equal(
  action(selectedWallet,savedEditor,[],{...freshAvailability,refundAmountCents:1090}).mode,
  'nayax_refund_execution',
 );
 const unavailable=action(selectedWallet,savedEditor,[],{...freshAvailability,canIssueCardRefund:false,blockReason:'provider_temporarily_unavailable'});
 assert.equal(unavailable.mode,undefined);
 assert.equal(unavailable.disabled,true);
 assert.equal(unavailable.label,'Refund temporarily unavailable');
});
test('separated competing purchases cannot bypass server-owned outreach authority',()=>{
 const action=load('primaryActionConfig',{
  ...dependencies,
  derivePortalRefundMissingFields:refundCase=>refundCase.customerCorrectionFields??[],
  isWaitingCase:()=>false,
 });
 const refundCase={
  status:'needs_review',paymentMethod:'card',correlationStatus:'multiple_candidates',
  customerCorrectionFields:['incident_time','incident_time_source'],
 };
 const editor={status:'needs_review',decision:null,matchedNayaxCandidateToken:''};
 const candidates=[
  {candidateToken:'candidate-1',selectionAllowed:false},
  {candidateToken:'candidate-2',selectionAllowed:false},
 ];
 const result=action(refundCase,editor,candidates,null);
 assert.equal(result.label,'Customer follow-up unavailable');
 assert.equal(result.disabled,true);
 assert.equal(result.messageType,undefined);
 assert.equal(result.mode,undefined);
});
test('unknown provider-time collision stays manager-owned after the customer cannot distinguish it',()=>{
 const action=load('primaryActionConfig',{
  ...dependencies,
  derivePortalRefundMissingFields:refundCase=>refundCase.customerCorrectionFields??[],
  isWaitingCase:()=>false,
 });
 const refundCase={
  status:'needs_review',paymentMethod:'card',correlationStatus:'multiple_candidates',
  customerCorrectionFields:[],customerCorrection:{state:'answered',isActive:false,isUsable:false},
 };
 const editor={status:'needs_review',decision:null,matchedNayaxCandidateToken:''};
 const candidates=[
  {candidateToken:'candidate-1',selectionAllowed:false,reasonCodes:['multiple_candidates_need_manager_review']},
  {candidateToken:'candidate-2',selectionAllowed:false,reasonCodes:['multiple_candidates_need_manager_review']},
 ];
 const result=action(refundCase,editor,candidates,null);
 assert.equal(result.label,'Review transaction evidence');
 assert.equal(result.mode,'review_transaction_evidence');
 assert.match(result.helper,/do not ask the customer .* again/i);
 assert.equal(result.messageType,undefined);
});
test('exact Gmail uncertainty action remains available beside an independent transactional delivery exception',()=>{
 const action=load('primaryActionConfig',{
  ...dependencies,
  isRefundCustomerDeliveryUncertain:error=>error==='gmail_send_unconfirmed',
  getLatestCustomerMessage:refundCase=>refundCase.messages[0],
  derivePortalRefundMissingFields:()=>['incident_time'],
 });
 const lifecycle={
  stage:'matching',terminal:false,paymentState:'not_requested',
  operations:{required:false,safeStage:'not_needed',failureClass:null},
  managerQueue:{bucket:'needs_action'},
 };
 const refundCase={
  status:'needs_review',paymentMethod:'card',providerOutcome:'not_attempted',providerHold:false,
  lifecycle,customerDeliveryException:{state:'failed'},
  messages:[{status:'failed',messageType:'status_update',errorMessage:'gmail_send_unconfirmed'}],
 };
 const editor={status:'needs_review',decision:null,matchedNayaxCandidateToken:''};
 const result=action(refundCase,editor,[],null);
 assert.equal(result.mode,'resolve_delivery_not_found',JSON.stringify(result));
 assert.equal(result.label,'Resolve uncertain Gmail delivery');
});
test('provider rejection remains primary when uncertain Gmail has no transactional delivery exception',()=>{
 const action=load('primaryActionConfig',{
  ...dependencies,
  isRefundCustomerDeliveryUncertain:error=>error==='gmail_send_unconfirmed',
  getLatestCustomerMessage:refundCase=>refundCase.messages[0],
  derivePortalRefundMissingFields:()=>['incident_time'],
 });
 const refundCase={
  status:'needs_review',paymentMethod:'card',providerOutcome:'rejected',providerHold:false,
  lifecycle:{
   stage:'matching',terminal:false,paymentState:'not_requested',
   operations:{required:false,safeStage:'not_needed',failureClass:null},
   managerQueue:{bucket:'needs_action'},
  },
  messages:[{status:'failed',messageType:'status_update',errorMessage:'gmail_send_unconfirmed'}],
 };
 const editor={status:'needs_review',decision:null,matchedNayaxCandidateToken:''};
 const result=action(refundCase,editor,[],null);
 assert.equal(result.mode,undefined,JSON.stringify(result));
 assert.equal(result.disabled,true,JSON.stringify(result));
 assert.equal(result.label,'Refund was rejected');
});
test('delivery-record review opens and focuses existing evidence without dispatching work',()=>{
 let focused=0;let scrolled=0;let scheduled=0;
 const details={open:false};
 const summary={
  scrollIntoView:options=>{assert.equal(options.behavior,'auto');assert.equal(options.block,'center');scrolled++;},
  focus:options=>{assert.equal(options.preventScroll,true);focused++;},
 };
 load('handleReviewDeliveryRecord',{
 customerMessagesDetailsRef:{current:details},
  activityHistoryDetailsRef:{current:{open:false}},
  customerMessagesSummaryRef:{current:summary},
  customerDeliveryEvidenceRef:{current:summary},
  window:{requestAnimationFrame:callback=>{scheduled++;callback();}},
 })();
 assert.equal(details.open,true);
 assert.equal(scheduled,2);
 assert.equal(scrolled,1);
 assert.equal(focused,1);
});
test('delivery-record review falls back to the Customer messages summary when exact evidence is unavailable',()=>{
 let focused=0;let scrolled=0;
 const details={open:false};
 const summary={
  scrollIntoView:()=>{scrolled++;},
  focus:()=>{focused++;},
 };
 load('handleReviewDeliveryRecord',{
 customerMessagesDetailsRef:{current:details},
  activityHistoryDetailsRef:{current:{open:false}},
  customerMessagesSummaryRef:{current:summary},
  customerDeliveryEvidenceRef:{current:null},
  window:{requestAnimationFrame:callback=>callback()},
 })();
 assert.equal(details.open,true);
 assert.equal(focused,1);
 assert.equal(scrolled,1);
});
test('delivery-record review selects the exact exception record when the case has a competing same-state message',()=>{
 const selectEvidence=load('getRefundDeliveryEvidenceMessageId',{});
 const exception={state:'bounced',messageType:'completed',occurredAt:'2026-09-06T10:30:00.000Z'};
 const messages=[
  {id:'message-competing',messageType:'completed',deliveryTransport:'resend',deliveryState:'bounced',deliveryStateUpdatedAt:'2026-09-06T09:00:00.000Z',createdAt:'2026-09-06T08:00:00.000Z'},
  {id:'message-wrong-type',messageType:'status_update',deliveryTransport:'resend',deliveryState:'bounced',deliveryStateUpdatedAt:exception.occurredAt,createdAt:'2026-09-06T08:30:00.000Z'},
  {id:'message-target',messageType:'completed',deliveryTransport:'resend',deliveryState:'bounced',deliveryStateUpdatedAt:exception.occurredAt,createdAt:'2026-09-06T10:00:00.000Z'},
 ];
 assert.equal(selectEvidence(messages,exception),'message-target');
 assert.equal(selectEvidence(messages,{...exception,occurredAt:'2026-09-06T11:00:00.000Z'}),null,'missing exact evidence falls back to the Customer messages summary');
 assert.equal(selectEvidence([...messages,{...messages[2],id:'message-duplicate'}],exception),null,'ambiguous exact evidence fails closed to the Customer messages summary');
});
test('actual one-action correction sends canonical fields without unreviewed triage/editor content',async()=>{
 let sent;let refreshed=0;const errors=[];const customerDraftDirtyUpdates=[];
 const handler=load('handleSendCustomerMessage',{
  selectedCase:{id:'case-1',customerCorrectionFields:['card_last4','amount']},customerDeliveryNeedsReconciliation:false,isUsingDemoData:false,pendingRevision:null,setPendingRevision:()=>{},
  correctionSelection:{caseId:'case-1',version:12,fields:['amount']},setCorrectionSelection:()=>{},
  messageType:'denied',messageSubject:'Old denial subject',messageBody:'Old denial draft',
  gmailContext:{triageSuggestion:{id:'unreviewed',status:'ready_for_review',route:'draft_reply',missingFields:['incident_time']}},
  officialActionVersion:12,getCustomerMessageDraft:()=>({subject:'Canonical',body:'Canonical'}),manualMessageIntentRef:{current:null},
  setIsSendingCustomerMessage:()=>{},setIsCustomerDraftDirty:value=>customerDraftDirtyUpdates.push(value),sendRefundCaseMessage:async input=>{sent=input;return {transport:'gmail_thread'};},refresh:async()=>{refreshed++;},
  toast:{error:value=>errors.push(value),success:()=>{},info:()=>{}},isEdgeFunctionError:()=>false,
 });
 await handler('more_info',['amount']);
 assert.equal(errors.length,0);assert.equal(refreshed,1);assert.equal(sent.messageType,'more_info');
 assert.deepEqual(Array.from(sent.missingFields),['amount']);
 assert.equal(sent.subject,undefined);assert.equal(sent.body,undefined);assert.equal(sent.triageSuggestionId,undefined);
 assert.deepEqual(customerDraftDirtyUpdates,[],'canonical override must preserve a different unsent editor draft');
});

test('successful editable send clears only customer-draft dirtiness',async()=>{
 const customerDraftDirtyUpdates=[];let internalDraftDirtyUpdates=0;
 const handler=load('handleSendCustomerMessage',{
  selectedCase:{id:'case-1'},customerDeliveryNeedsReconciliation:false,isUsingDemoData:false,pendingRevision:null,setPendingRevision:()=>{},
  correctionSelection:null,setCorrectionSelection:()=>{},messageType:'denied',messageSubject:'Reviewed subject',messageBody:'Reviewed body',
  gmailContext:{},officialActionVersion:12,getCustomerMessageDraft:()=>({subject:'Canonical',body:'Canonical'}),manualMessageIntentRef:{current:null},
  setIsSendingCustomerMessage:()=>{},setIsCustomerDraftDirty:value=>customerDraftDirtyUpdates.push(value),
  setIsInternalNoteDirty:()=>{internalDraftDirtyUpdates++;},sendRefundCaseMessage:async()=>({transport:'gmail_thread'}),refresh:async()=>{},
  toast:{error:()=>{},success:()=>{},info:()=>{}},isEdgeFunctionError:()=>false,
 });
 await handler();
 assert.deepEqual(customerDraftDirtyUpdates,[false]);
 assert.equal(internalDraftDirtyUpdates,0,'email success must not clear an unsaved internal note');
});

test('canonical guided actions stay clean while manager template changes are draft edits',()=>{
 const updates=[];const draft={subject:'Canonical denial',body:'Canonical denial body'};
 const base={
  selectedCase:{id:'case-1'},isCustomerDraftDirty:false,getCustomerMessageDraft:()=>draft,
  setMessageType:value=>updates.push(['type',value]),setMessageSubject:value=>updates.push(['subject',value]),
  setMessageBody:value=>updates.push(['body',value]),setIsCustomerDraftDirty:value=>updates.push(['dirty',value]),
 };
 load('handleMessageTypeChange',base)('denied');
 assert.deepEqual(updates,[['type','denied'],['subject',draft.subject],['body',draft.body],['dirty',false]]);
 updates.length=0;
 load('handleMessageTypeChange',base)('more_info',true);
 assert.deepEqual(updates,[['type','more_info'],['subject',draft.subject],['body',draft.body],['dirty',true]]);
});

test('canonical guided actions preserve a genuinely edited customer draft',()=>{
 const updates=[];
 load('handleMessageTypeChange',{
  selectedCase:{id:'case-1'},isCustomerDraftDirty:true,getCustomerMessageDraft:()=>{throw Error('must preserve edited draft');},
  setMessageType:value=>updates.push(['type',value]),setMessageSubject:value=>updates.push(['subject',value]),
  setMessageBody:value=>updates.push(['body',value]),setIsCustomerDraftDirty:value=>updates.push(['dirty',value]),
 })('denied');
 assert.deepEqual(updates,[]);
});

test('denial cancellation restores the exact prior customer-draft dirty state',()=>{
 const restored=[];const previousEditor={status:'card_refund_pending',decision:'approved'};
 const denialPreviousStateRef={current:{
  caseId:'case-1',editor:previousEditor,messageType:'status_update',
  messageSubject:'Edited subject',messageBody:'Edited body',isCustomerDraftDirty:true,
 }};
 load('cancelDenial',{
  selectedCase:{id:'case-1'},denialPreviousStateRef,denialTriggerRef:{current:null},
  setEditor:value=>restored.push(['editor',value]),setMessageType:value=>restored.push(['type',value]),
  setMessageSubject:value=>restored.push(['subject',value]),setMessageBody:value=>restored.push(['body',value]),
  setIsCustomerDraftDirty:value=>restored.push(['dirty',value]),
  window:{requestAnimationFrame:callback=>callback()},
  document:{querySelector:()=>null},
 })();
 assert.deepEqual(restored,[
  ['editor',previousEditor],['type','status_update'],['subject','Edited subject'],
  ['body','Edited body'],['dirty',true],
 ]);
 assert.equal(denialPreviousStateRef.current,null);
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
 getCustomerMessageDraft:()=>({subject:'canonical',body:'canonical'}),manualMessageIntentRef:intent,setIsSendingCustomerMessage:()=>{},setIsCustomerDraftDirty:()=>{},
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
 const base={status:'needs_review',decision:'approved',paymentMethod:'card',providerOutcome:'not_attempted',matched:true,...freshPersistedSelection,lifecycle};
 const available=freshAvailability;
 for(const status of ['sent','failed','skipped']) for(const state of ['unknown','deferred','failed','bounced','complained']) {
  const action=load('primaryActionConfig',{...dependencies,getLatestCustomerMessage:()=>({status,messageType:'confirmation'}),isWaitingCase:()=>false});
  const result=action({...base,customerDeliveryException:{state}},editor,[],available);
  assert.equal(result.mode,'nayax_refund_execution',`${status}/${state}`);
  assert.equal(result.messageType,'completed');assert.notEqual(result.disabled,true);
  assert.equal(action({...base,customerDeliveryException:{state}},editor,[],{...available,canIssueCardRefund:false,blockReason:'unauthorized'}).disabled,true);
 }
 const missing=load('primaryActionConfig',{...dependencies,derivePortalRefundMissingFields:()=>['incident_time']});
 assert.equal(missing({...base,customerDeliveryException:{state:'bounced'}},editor,[],available).mode,'nayax_refund_execution');
 assert.equal(load('primaryActionConfig',dependencies)({...base,lifecycle:{...lifecycle,stage:'waiting_on_customer'},customerDeliveryException:{state:'bounced'}},editor,[],available).mode,'nayax_refund_execution');
});

test('actual action gives payment holds, pending and terminal truth priority over a delivery task',()=>{
 const action=load('primaryActionConfig',dependencies);
 const editor={status:'needs_review',decision:null,matchedNayaxCandidateToken:''};
 const base={status:'needs_review',paymentMethod:'card',customerDeliveryException:{state:'bounced'}};
 for(const [stage,paymentState,label] of [['refund_initiated','submitted_pending','Refund in progress'],['confirming_with_nayax','submitted_pending','Confirming refund'],['needs_refund_operations','outcome_unknown','Check Nayax refund status'],['integrity_hold','integrity_unknown','Lifecycle evidence needs review'],['denied','not_issued','Denied']]) {
  const result=action({...base,lifecycle:{stage,paymentState,terminal:stage==='denied',managerQueue:{bucket:'needs_action'}}},editor,[],{canIssueCardRefund:true});
  assert.equal(result.disabled,true,stage);assert.equal(result.label,label,stage);
  assert.equal(result.mode,undefined,stage);
 }
 assert.equal(action({...base,providerHold:true},editor,[],{canIssueCardRefund:true}).label,'Check the exact transaction in Nayax');
});

test('authoritative unknown-outcome hold cannot restore the manager payment action',()=>{
 const action=load('primaryActionConfig',{...dependencies,isDefinitiveNoRefundRetryReady:managerModule.exports.isDefinitiveNoRefundRetryReady,isWaitingCase:()=>false});
 const lifecycle={stage:'transaction_confirmed',terminal:false,paymentState:'not_requested',definitiveNoRefund:true,safeRetryEligible:true,operations:{required:true,safeStage:'released_no_refund',failureClass:'customer_delivery_exception'},managerQueue:{bucket:'ready_to_pay'}};
 const current={status:'needs_review',paymentMethod:'card',providerOutcome:'rejected',providerHold:false,matched:true,...freshPersistedSelection,lifecycle,customerDeliveryException:{state:'unknown'}};
 const editor={status:'needs_review',decision:null,matchedNayaxCandidateToken:''};
 assert.equal(action(current,editor,[],{...freshAvailability,canIssueCardRefund:false,blockReason:'reconciliation_hold'}).disabled,true);
 assert.equal(action({...current,lifecycle:{...lifecycle,operations:{...lifecycle.operations,failureClass:'provider_outcome_unknown'}}},editor,[],{...freshAvailability,canIssueCardRefund:false,blockReason:'reconciliation_hold'}).disabled,true);
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
 for(const mode of ['case_update']) {
  assert.equal(JSON.stringify(displayIssues(approvedCase,approvedEditor,{disabled:true,mode})),JSON.stringify(saveIssues(approvedCase,approvedEditor)));
 }
 for(const change of [{decision:null},{decision:'denied'},{refundAmountCents:null},{refundAmountCents:0},{paymentMethod:'cash'}]) {
  assert.equal(unchangedApproval({...approvedCase,...change},approvedEditor),false);
 }
});

test('server-authorized card execution bypasses duplicate browser form policy',()=>{
 const completed={...approvedEditor,status:'completed',matchedNayaxAmount:'9.64'};
 const issues=displayIssues(approvedCase,completed,{mode:'nayax_refund_execution'});
 assert.equal(issues.length,0);
 assert.ok(saveIssues(approvedCase,completed).some(issue=>issue.includes('must match the selected machine transaction')),'generic case mutations retain form validation');
});
