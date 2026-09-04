import { handleOwnerNonrefundAdoption } from "./refund-owner-nonrefund-adoption.ts";
const assert = (v: unknown, message = "assertion") => { if (!v) throw new Error(message); };
const request = () => ({mode:"adopt_owner_nonrefund_resolution",caseId:"ef400000-0000-4000-8000-000000000001",
  intentId:"ef500000-0000-4000-8000-000000000001",expectedCaseVersion:2,expectedFactVersion:1,caseReference:"RF-OWNER-1",
  providerMessageId:"cafe000000000001",providerThreadId:"cafe000000000099",originalSentAt:"2026-09-03T12:00:00Z",
  recipientEmail:"customer@example.invalid",reviewedMessageDigest:"a".repeat(64),expectedOwnerReviewBinding:"b".repeat(64),
  reasonCode:"not_operated_by_bloomjoy",reviewedOwnedMailboxSent:true,reviewedExactCaseResolution:true});
const result = () => ({status:"adopted",adoptionId:"ef600000-0000-4000-8000-000000000001",noticeVerification:"operator_observed",
  customerMessageSent:false,paymentAction:false,payloadRedacted:true});
Deno.test("owner resolution uses one authenticated adoption RPC and exposes only operator attestation",async()=>{
  let calls=0;
  const response=await handleOwnerNonrefundAdoption(request(),(name,args)=>{
    calls++; assert(name==="admin_adopt_refund_owner_nonrefund_resolution");
    assert(!Object.keys(args).some(k=>/actor|sender|delivery_verified|payment/.test(k)));
    assert(args.p_expected_fact_version===1 && args.p_expected_case_version===2);
    return Promise.resolve({data:{...result(),rawBody:"PRIVATE",recipientEmail:"PRIVATE"},error:null});
  });
  assert(calls===1 && response.status===200 && !JSON.stringify(response).includes("PRIVATE"));
});
Deno.test("unsupported authority, source claims and non-exact evidence are rejected before any RPC",async()=>{
  for(const [key,value] of Object.entries({actorUserId:"forged",senderEmail:"other@example.invalid",providerVerified:true,
    reasonCode:"refund_paid",reviewedOwnedMailboxSent:false,reviewedExactCaseResolution:false,expectedFactVersion:0,
    expectedCaseVersion:null,intentId:null,providerMessageId:"NOT-ID",originalSentAt:"infinity",recipientEmail:"two@x.invalid,one@y.invalid"})){
    let calls=0;
    const response=await handleOwnerNonrefundAdoption({...request(),[key]:value},()=>{calls++;return Promise.resolve({data:result(),error:null});});
    assert(response.status===400 && calls===0,key);
  }
});
Deno.test("saved exact payload is forwarded unchanged on replay and never rebased",async()=>{
  const args:unknown[]=[];
  const rpc=(_name:string,arg:Record<string,unknown>)=>{args.push(arg);return Promise.resolve({data:result(),error:null});};
  const first=await handleOwnerNonrefundAdoption(request(),rpc);
  const replay=await handleOwnerNonrefundAdoption(request(),rpc);
  assert(JSON.stringify(args[0])===JSON.stringify(args[1]) && JSON.stringify(first)===JSON.stringify(replay));
});
Deno.test("operational failure supports same-intent recovery without raw diagnostics",async()=>{
  for(const code of ["40P01","08006",undefined]){
    const response=await handleOwnerNonrefundAdoption(request(),()=>Promise.resolve({data:null,error:{code,message:"PRIVATE"}}));
    assert(response.status===503 && !JSON.stringify(response).includes("PRIVATE"));
  }
  assert((await handleOwnerNonrefundAdoption(request(),()=>Promise.resolve({data:null,error:{code:"P4671"}}))).status===409);
  assert((await handleOwnerNonrefundAdoption(request(),()=>Promise.resolve({data:null,error:{code:"42501"}}))).status===403);
});
Deno.test("response cannot claim sending, payment or independently verified delivery",async()=>{
  for(const change of [{customerMessageSent:true},{paymentAction:true},{noticeVerification:"provider_verified"},{payloadRedacted:false}]){
    assert((await handleOwnerNonrefundAdoption(request(),()=>Promise.resolve({data:{...result(),...change},error:null}))).status===409);
  }
});
