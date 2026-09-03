import { handlePurchaseCorrection, recheckSavedPurchaseCorrection } from './refund-purchase-correction-handler.ts';
const assert = (value:unknown) => { if (!value) throw new Error('Assertion failed'); };
Deno.test('saved response records lookup failure truthfully rather than success', async () => {
  let written:Record<string,unknown>|undefined;
  const query={eq(){return this;},then(resolve:(v:unknown)=>unknown){return Promise.resolve({error:null}).then(resolve);}};
  const client={from:()=>({update:(value:Record<string,unknown>)=>{written=value;return query;}})};
  await recheckSavedPurchaseCorrection(client as never,'request','case',2,async()=>({status:'failed',reason:'provider_unavailable'}));
  assert(written?.correction_recheck_state==='failed' && written?.correction_next_action==='review');
});
Deno.test('an already-running fact-version lookup retains recovery without another claim', async () => {
  let written:Record<string,unknown>|undefined;let count=0;
  const query={eq(){return this;},maybeSingle:async()=>({data:{status:'claimed'},error:null}),then(resolve:(v:unknown)=>unknown){return Promise.resolve({error:null}).then(resolve);}};
  const client={from:()=>({select:()=>query,update:(value:Record<string,unknown>)=>{written=value;return query;}})};
  await recheckSavedPurchaseCorrection(client as never,'request','case',2,async()=>{count++;return {status:'deduplicated'};});
  assert(count===1 && written?.correction_recheck_state==='in_progress' && written?.correction_next_action==='recheck');
});
Deno.test('unexpected lookup failure leaves the committed recovery marker untouched', async () => {
  let updated=false;
  await recheckSavedPurchaseCorrection({from:()=>{updated=true;throw new Error('should not write');}} as never,'request','case',2,async()=>{throw new Error('connection lost');});
  assert(!updated);
});

Deno.test('submitted replay returns current committed recheck disposition without another save', async () => {
  let reads=0; let writes=0;
  const chain={eq(){return this;},maybeSingle:async()=>({data:null,error:null})};
  const client={from:()=>({select:()=>chain}),rpc:async(name:string)=>{
    if(name!=='service_get_refund_purchase_correction') { writes++; throw new Error('unexpected write'); }
    reads++; return {data:{state:'received',publicReference:'RF-TEST',nextAction:reads===1?'recheck':'review'},error:null};
  }};
  const response=await handlePurchaseCorrection({action:'submitPurchaseCorrection',token:'a'.repeat(43),version:1,answers:{}},client as never);
  assert((await response.json()).correction.nextAction==='review' && reads===2 && writes===0);
});

Deno.test('inspect stays read-only and saved response remains saved when follow-up read is unavailable', async () => {
  let reads=0;
  const ready={state:'ready',publicReference:'RF-TEST',version:1,requestedFields:['card_last4'],allowedFields:['card_last4'],values:{card_last4:'1234'}};
  const client={rpc:async(name:string)=>{
    if(name==='service_submit_refund_purchase_correction') return {data:{publicReference:'RF-TEST',nextAction:'review'},error:null};
    reads++; return reads<=2 ? {data:ready,error:null} : {data:null,error:new Error('read unavailable')};
  }};
  const inspect=await handlePurchaseCorrection({action:'inspectPurchaseCorrection',token:'a'.repeat(43)},client as never);
  assert((await inspect.json()).correction.state==='ready' && reads===1);
  const saved=await handlePurchaseCorrection({action:'submitPurchaseCorrection',token:'a'.repeat(43),version:1,answers:{card_last4:{disposition:'confirmed'}}},client as never);
  const body=await saved.json();
  assert(body.correction.state==='received' && body.correction.publicReference==='RF-TEST' && body.correction.nextAction===undefined && reads===3);
});

Deno.test('thrown post-save read failure never turns a committed response into a retry', async () => {
  let reads=0;
  const client={rpc:async(name:string)=>{
    if(name==='service_submit_refund_purchase_correction') return {data:{publicReference:'RF-TEST',nextAction:'review'},error:null};
    if(++reads>1)throw new Error('connection lost');
    return {data:{state:'ready',version:1,requestedFields:['card_last4'],allowedFields:['card_last4'],values:{card_last4:'1234'}},error:null};
  }};
  const response=await handlePurchaseCorrection({action:'submitPurchaseCorrection',token:'a'.repeat(43),version:1,answers:{card_last4:{disposition:'confirmed'}}},client as never);
  const body=await response.json();
  assert(response.status===200 && body.correction.state==='received' && body.correction.nextAction===undefined);
});
