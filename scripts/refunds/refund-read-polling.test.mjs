import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../../src/lib/refundReadPolling.ts',import.meta.url),'utf8');
const compiled=ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
const {createRefundReadPolling,refundOverviewPollingInterval}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
// QueryObserver only schedules browser intervals when a window exists at import.
globalThis.window={};
const {QueryClient,QueryObserver,focusManager,onlineManager}=await import('@tanstack/query-core');
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

test('real QueryObserver backs off across failed polls, preserves cached truth, recovers and stops at terminal',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000});
 focusManager.setFocused(true);onlineManager.setOnline(true);
 const client=new QueryClient();client.mount();
 const polling=createRefundReadPolling();let fail=false;let terminal=false;const at=[];
 const options=()=>({queryKey:['availability','case-a'],retry:false,staleTime:30_000,gcTime:Infinity,
  queryFn:()=>polling.read(async()=>{at.push(Date.now());if(fail)throw Error('Read unavailable');return {available:false,case:'a'};}),
  refetchInterval:()=>polling.interval(terminal?false:5000),refetchOnWindowFocus:!terminal,refetchOnReconnect:!terminal});
 const observer=new QueryObserver(client,options());const unsubscribe=observer.subscribe(()=>{});
 try{
  await flush();assert.deepEqual(at,[1000]);fail=true;
  for(const ms of [5000,10000,20000,40000,60000]){t.mock.timers.tick(ms);await flush();}
  assert.deepEqual(at,[1000,6000,16000,36000,76000,136000]);
  assert.deepEqual(observer.getCurrentResult().data,{available:false,case:'a'});
  fail=false;t.mock.timers.tick(60000);await flush();t.mock.timers.tick(5000);await flush();
  assert.deepEqual(at.slice(-2),[196000,201000]);
  terminal=true;observer.setOptions(options());t.mock.timers.tick(60000);await flush();assert.equal(at.length,8);
  await observer.refetch();await flush();assert.equal(at.length,9,'Explicit refresh remains available after terminal');
  terminal=false;observer.setOptions(options());t.mock.timers.tick(5000);await flush();assert.equal(at.at(-1),266000);
  onlineManager.setOnline(false);t.mock.timers.tick(5000);await flush();assert.equal(at.length,10);
  onlineManager.setOnline(true);await flush();assert.equal(at.length,11);
  focusManager.setFocused(false);t.mock.timers.tick(60000);await flush();assert.equal(at.length,11);
  focusManager.setFocused(true);await flush();assert.equal(at.length,12);
 }finally{unsubscribe();client.unmount();client.clear();focusManager.setFocused(undefined);onlineManager.setOnline(true);t.mock.timers.reset();}
});

test('real observer case switch isolates a late old failure and resets the new read cadence',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
 const old=createRefundReadPolling();const current=createRefundReadPolling();let rejectOld;
 const observer=new QueryObserver(client,{queryKey:['availability','a'],queryFn:()=>old.read(()=>new Promise((_,reject)=>{rejectOld=reject;}))});
 const unsubscribe=observer.subscribe(()=>{});
 try{
  await flush();observer.setOptions({queryKey:['availability','b'],queryFn:()=>current.read(async()=>({case:'b',available:false}))});await flush();
  rejectOld(Error('late old case outage'));await flush();
  assert.deepEqual(observer.getCurrentResult().data,{case:'b',available:false});
  assert.equal(old.interval(5000),10000);assert.equal(current.interval(5000),5000);
  assert.equal(createRefundReadPolling().interval(5000),5000);
 }finally{unsubscribe();client.clear();}
});

test('overview cadence recovers missing reads without declaring terminal and respects authoritative terminal',()=>{
 assert.equal(refundOverviewPollingInterval(undefined),5000);
 assert.equal(refundOverviewPollingInterval([{lifecycle:{terminal:true,refreshAfterSeconds:5}}]),false);
 assert.equal(refundOverviewPollingInterval([{lifecycle:{terminal:false,refreshAfterSeconds:5}}]),5000);
 assert.equal(refundOverviewPollingInterval([{lifecycle:{terminal:false,refreshAfterSeconds:60}}]),15000);
});
