import { recheckSavedPurchaseCorrection } from './refund-purchase-correction-handler.ts';
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
