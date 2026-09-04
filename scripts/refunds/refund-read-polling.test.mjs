import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../../src/lib/refundReadPolling.ts',import.meta.url),'utf8');
const compiled=ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
const {createRefundReadPolling,refundOverviewPollingInterval,refundAvailabilityIsTerminal,refundOverviewReadMessage}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
// QueryObserver only schedules browser intervals when a window exists at import.
globalThis.window={};
const {QueryClient,QueryObserver,focusManager,onlineManager}=await import('@tanstack/query-core');
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

// Node20's experimental MockTimers can resurrect an interval cleared/replaced
// inside its own callback. Use browser-style cancellation for the real observer.
const installClock=(t)=>{
 let now=1000;let nextId=1;const timers=new Map();
 const schedule=(callback,delay,repeat,args)=>{
  const id=nextId++;const interval=Math.max(1,Number(delay)||0);
  timers.set(id,{callback,args,due:now+interval,repeat:repeat?interval:0});return id;
 };
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>schedule(callback,delay,false,args));
 t.mock.method(globalThis,'setInterval',(callback,delay,...args)=>schedule(callback,delay,true,args));
 t.mock.method(globalThis,'clearTimeout',(id)=>timers.delete(id));
 t.mock.method(globalThis,'clearInterval',(id)=>timers.delete(id));
 return {async tick(ms){
  const target=now+ms;let steps=0;
  for(;;){
   const next=[...timers].filter(([,timer])=>timer.due<=target).sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];
   if(!next)break;
   assert.ok(++steps<10000,'Clock must not loop indefinitely');
   const [id,timer]=next;now=timer.due;
   if(timer.repeat)timer.due+=timer.repeat;else timers.delete(id);
   timer.callback(...timer.args);await flush();
  }
  now=target;await flush();
 }};
};

test('test clock cancels an interval replaced inside its callback',async(t)=>{
 const clock=installClock(t);let calls=0;
 let id=setInterval(()=>{calls++;clearInterval(id);id=setInterval(()=>calls++,5000);},5000);
 await clock.tick(5000);clearInterval(id);await clock.tick(60000);assert.equal(calls,1);
});

test('real QueryObserver backs off across failed polls, preserves cached truth, recovers and stops at terminal',async(t)=>{
 const clock=installClock(t);
 focusManager.setFocused(true);onlineManager.setOnline(true);
 const client=new QueryClient();client.mount();
 const polling=createRefundReadPolling();let fail=false;let terminal=false;const at=[];
 const options=()=>({queryKey:['availability','case-a'],retry:false,staleTime:30_000,gcTime:Infinity,
  queryFn:()=>polling.read(async()=>{at.push(Date.now());if(fail)throw Error('Read unavailable');return {available:false,case:'a'};}),
  refetchInterval:()=>polling.interval(terminal?false:5000),refetchOnWindowFocus:!terminal,refetchOnReconnect:!terminal});
 const observer=new QueryObserver(client,options());const unsubscribe=observer.subscribe(()=>{});
 try{
  await flush();assert.deepEqual(at,[1000]);fail=true;
  for(const ms of [5000,10000,20000,40000,60000])await clock.tick(ms);
  assert.deepEqual(at,[1000,6000,16000,36000,76000,136000]);
  assert.deepEqual(observer.getCurrentResult().data,{available:false,case:'a'});
  fail=false;await clock.tick(60000);await clock.tick(5000);
  assert.deepEqual(at.slice(-2),[196000,201000]);
  terminal=true;observer.setOptions(options());await clock.tick(60000);assert.equal(at.length,8);
  await observer.refetch();await flush();assert.equal(at.length,9,'Explicit refresh remains available after terminal');
  terminal=false;observer.setOptions(options());await clock.tick(5000);assert.equal(at.at(-1),266000);
  onlineManager.setOnline(false);await clock.tick(5000);assert.equal(at.length,10);
  onlineManager.setOnline(true);await flush();assert.equal(at.length,11);
  focusManager.setFocused(false);await clock.tick(60000);assert.equal(at.length,11);
  focusManager.setFocused(true);await flush();assert.equal(at.length,12);
 }finally{unsubscribe();client.unmount();client.clear();focusManager.setFocused(undefined);onlineManager.setOnline(true);}
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

test('terminal availability includes only the same authorized internal-case scope as the workbench',()=>{
 const overview={cases:[{id:'ordinary',lifecycle:{terminal:true}}],internalTestCases:[{id:'archived',lifecycle:{terminal:true}}],refundOperationsAccess:true};
 assert.equal(refundAvailabilityIsTerminal(overview,'ordinary'),true);
 assert.equal(refundAvailabilityIsTerminal(overview,'archived'),true);
 assert.equal(refundAvailabilityIsTerminal({...overview,refundOperationsAccess:false},'archived'),false);
 assert.equal(refundAvailabilityIsTerminal(overview,'unknown'),false);
 assert.equal(refundAvailabilityIsTerminal({...overview,cases:[{id:'ordinary',lifecycle:{terminal:false}}]},'ordinary'),false);
});

test('read announcements change only on settled error/recovery, with a silent healthy baseline',()=>{
 assert.equal(refundOverviewReadMessage('', 'success'),'');
 const failed=refundOverviewReadMessage('', 'error');assert.match(failed,/could not be loaded/);
 assert.equal(refundOverviewReadMessage(failed,'error'),failed);
 assert.equal(refundOverviewReadMessage(failed,'pending'),failed);
 const recovered=refundOverviewReadMessage(failed,'success');assert.equal(recovered,'Refund information is up to date.');
 assert.equal(refundOverviewReadMessage(recovered,'success'),recovered);
 assert.equal(refundOverviewReadMessage(recovered,'error'),failed);
});
