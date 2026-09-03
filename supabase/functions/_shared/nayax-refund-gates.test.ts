import { buildNayaxRefundIdempotencyKey, readNayaxRefundAvailability, resolveNormalNayaxRefundAmountCents,
  resolveNayaxRefundAvailability, resolveNayaxRefundExecutionConfig } from './nayax-refund-gates.ts';
const assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
const envReader=(values:Record<string,string>)=>(name:string)=>values[name];
const enabledConfig={NAYAX_REFUND_EXECUTION_KILL_SWITCH:'false',NAYAX_REFUND_EXECUTION_ENABLED:'true',
  NAYAX_REFUND_EXECUTION_DRY_RUN:'false',NAYAX_REFUND_IDEMPOTENCY_SECRET:'i'.repeat(64),
  NAYAX_REFUND_EXECUTOR_ASSERTION:'e'.repeat(64),NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED:'true',NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED:'true'};
Deno.test('missing production configuration preserves runtime and credential gates',()=>{
 const config=resolveNayaxRefundExecutionConfig(envReader({}));
 for(const block of ['kill_switch_active','feature_disabled','dry_run_active','idempotency_secret_missing','executor_assertion_missing','manager_contract_unconfirmed','approval_scope_unconfirmed'])
   assert(config.blocks.includes(block as never),block+' must block');
});
Deno.test('configured first attempts require no remaining-balance attestation',()=>{
 const config=resolveNayaxRefundExecutionConfig(envReader(enabledConfig));
 assert(config.blocks.length===0,'Ready configuration permits the normal provider path');
 assert(!('maxAmountCents' in config)&&!('dailyCountCap' in config),'Retired launch caps stay retired');
});
Deno.test('legacy canary and cap variables do not gate qualified transactions',()=>{
 const config=resolveNayaxRefundExecutionConfig(envReader({...enabledConfig,NAYAX_REFUND_BROAD_REOPEN_APPROVED:'false',
 NAYAX_REFUND_CANARY_ENABLED:'false',NAYAX_REFUND_MAX_AMOUNT_CENTS:'1',NAYAX_REFUND_DAILY_COUNT_CAP:'1'}));
 assert(config.blocks.length===0,'Retired variables cannot recreate a blanket block');
});
Deno.test('normal amount uses the selected original purchase without inventing a remaining balance',()=>{
 assert(resolveNormalNayaxRefundAmountCents({matchedTransactionAmountCents:1090})===1090,'Exact selected original amount');
 for(const amount of [null,0,-1,1.5,Number.MAX_SAFE_INTEGER+1])
   assert(resolveNormalNayaxRefundAmountCents({matchedTransactionAmountCents:amount})===null,'Invalid amount rejected');
});
Deno.test("idempotency is deterministic for an exact replay and changes with immutable evidence", async () => {
  const secret = "s".repeat(64);
  const evidence = {
    caseId: "76000000-0000-4000-8000-000000000001",
    attemptGeneration: 0,
    transactionId: "123456789",
    siteId: 42,
    machineAuthorizationTime: "2026-07-22T17:30:00Z",
    amountCents: 700,
    currencyCode: "USD" as const,
  };
  const first = await buildNayaxRefundIdempotencyKey(secret, evidence);
  const replay = await buildNayaxRefundIdempotencyKey(secret, evidence);
  const changed = await buildNayaxRefundIdempotencyKey(secret, {
    ...evidence,
    amountCents: 701,
  });
  const retryGeneration = await buildNayaxRefundIdempotencyKey(secret, {
    ...evidence,
    attemptGeneration: 1,
  });
  assert(first === replay, "exact replay must retain one key");
  assert(first !== changed, "changed evidence must change the key");
  assert(
    first !== retryGeneration,
    "a support-approved retry generation must create a fresh key",
  );
  assert(
    /^nayax-refund-[a-f0-9]{64}$/.test(first),
    "key must match the database contract",
  );
});

Deno.test("idempotency never falls back to a service key or local default", async () => {
  let failed = false;
  try {
    await buildNayaxRefundIdempotencyKey(null, {
      caseId: "76000000-0000-4000-8000-000000000001",
      attemptGeneration: 0,
      transactionId: "123456789",
      siteId: 42,
      machineAuthorizationTime: "2026-07-22T17:30:00Z",
      amountCents: 700,
      currencyCode: "USD",
    });
  } catch (error) {
    failed = error instanceof Error &&
      error.message.includes("dedicated Nayax refund idempotency secret");
  }
  assert(failed, "missing dedicated secret must fail before HMAC");
});


Deno.test('availability exposes configured execution without revealing credentials',()=>{
 const result=resolveNayaxRefundAvailability({executionConfig:resolveNayaxRefundExecutionConfig(envReader(enabledConfig)),officialActionsEnabled:true});
 assert(result.available&&result.status==='available'&&result.blockReason===null,'Configured availability');
 assert(Object.keys(result).sort().join('|')==='available|blockReason|payloadRedacted|status','Bounded public response');
 assert(!JSON.stringify(result).includes(enabledConfig.NAYAX_REFUND_IDEMPOTENCY_SECRET),'No credential disclosure');
});
Deno.test('availability preserves pause and configuration precedence',()=>{
 for(const f of [{values:{},official:false,reason:'official_actions_disabled'},{values:{},official:true,reason:'kill_switch_active'},
 {values:{...enabledConfig,NAYAX_REFUND_EXECUTOR_ASSERTION:''},official:true,reason:'configuration_missing'}]){
 const result=resolveNayaxRefundAvailability({executionConfig:resolveNayaxRefundExecutionConfig(envReader(f.values)),officialActionsEnabled:f.official});
 assert(!result.available&&result.blockReason===f.reason,'The actual pause/configuration issue remains visible');
 }
});
Deno.test('availability reads gates only and performs zero execution side effects',async()=>{
 const result=await readNayaxRefundAvailability({readEnv:envReader(enabledConfig),officialActionsEnabled:true});
 assert(result.available,'Read-only availability has no provider or mutation dependencies');
});
