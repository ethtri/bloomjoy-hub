import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deliverRefundTechnicalHandoff } from "./refund-technical-handoff.ts";
const incidentId="f1430000-0000-4000-8000-000000000001", token="f1430000-0000-4000-8000-000000000002";
const payload={to:["etrifari@bloomjoysweets.com","ian@bloomjoysweets.com"],senderEmail:"Original <ops@example.invalid>",
 subject:"Refund processing needs technical follow-through",text:"Some required processing still needs attention. Please arrange technical follow-through.",idempotencyKey:`refund_technical_incident_${incidentId}`};
const claim={claimed:true,incidentId,claimToken:token,payload,payloadRedacted:true};
const runtime={automation:true,customerContact:true,manualOutbox:true,managerDigest:true,managerReady:true};
const receipt={provider:"resend" as const,providerMessageId:"synthetic_receipt_1234",acceptedAt:"2026-10-15T22:00:00Z"};
function fixture({capability=1 as unknown,claimValue=claim as unknown,marker=true,settlement=true,sendError=null as Error|null,timeout=false}={}) {
 const calls:{name:string;args:Record<string,unknown>}[]=[],sent:unknown[]=[];
 const client={rpc:(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return Promise.resolve({error:null,data:
  name.includes("service_claim_")?claimValue:name.includes("provider_started")?{allowed:marker}:settlement});}};
 return {calls,sent,run:()=>deliverRefundTechnicalHandoff({client,health:{technicalIncidentHandoffVersion:capability,status:"failing"},
  runId:token,sender:"Changed <changed@example.invalid>",refundsUrl:"https://app.bloomjoyusa.com/refunds",runtime,mailboxIdentities:[],providerTimeoutMs:5,
  sendEmail:(message)=>{sent.push(message);if(sendError) return Promise.reject(sendError);return timeout?new Promise(()=>{}):Promise.resolve(receipt);}})};
}
Deno.test("absent capability alone is legacy; present unsupported capability is unavailable",async()=>{
 for(const capability of [null,0,"1",2]) {const f=fixture({capability});assertEquals(await f.run(),"unavailable");assertEquals(f.calls,[]);assertEquals(f.sent,[]);}
 assertEquals(await deliverRefundTechnicalHandoff({client:{rpc:()=>{throw new Error("Must not call old backend");}},health:{},
  runId:token,sender:payload.senderEmail,refundsUrl:"https://app.bloomjoyusa.com/refunds",runtime,mailboxIdentities:[],sendEmail:()=>Promise.resolve(receipt)}),"legacy");
 assertEquals(await deliverRefundTechnicalHandoff({client:{rpc:()=>{throw new Error("Must not call unsupported backend");}},health:{technicalIncidentHandoffVersion:undefined},
  runId:token,sender:payload.senderEmail,refundsUrl:"https://app.bloomjoyusa.com/refunds",runtime,mailboxIdentities:[],sendEmail:()=>Promise.resolve(receipt)}),"unavailable");
});
Deno.test("one frozen exact-recipient payload is sent and accepted without implying delivered or repaired",async()=>{
 const f=fixture();assertEquals(await f.run(),"accepted");assertEquals(f.sent,[payload]);
 assertEquals(f.calls[1].args.p_payload,payload);assertEquals(f.calls[2].args.p_outcome,"accepted");
});
Deno.test("unverified configured extras and mutable claim bodies cannot expand recipients",async()=>{
 const f=fixture({claimValue:{...claim,payload:{...payload,to:[...payload.to,"extra@example.invalid"]}}});
 assertEquals(await f.run(),"unavailable");assertEquals(f.sent,[]);assertEquals(f.calls.length,1);
});
Deno.test("current quiet/master/account/resolution rejection never calls provider",async()=>{
 const f=fixture({marker:false});assertEquals(await f.run(),"deferred");assertEquals(f.sent,[]);assertEquals(f.calls.length,2);
});
Deno.test("legacy initial already routed does not prevent an independent existing-incident claim",async()=>{
 const f=fixture();assertEquals(await f.run(),"accepted");assertEquals(f.calls[0].name,"service_claim_refund_technical_incident_handoff");
});
Deno.test("409,5xx,network and malformed acceptance stay unknown with no retry",async()=>{
 for(const sendError of [new Error("Resend request failed (409)."),new Error("Resend request failed (500)."),new TypeError("Network lost")]) {
  const f=fixture({sendError});assertEquals(await f.run(),"delivery_unknown");assertEquals(f.sent.length,1);assertEquals(f.calls.at(-1)?.args.p_outcome,"delivery_unknown");
 }
});
Deno.test("acceptance commit failure and provider timeout preserve the pre-send unknown hold",async()=>{
 for(const options of [{settlement:false},{timeout:true}]) {const f=fixture(options);assertEquals(await f.run(),"delivery_unknown");assertEquals(f.sent.length,1);}
});
Deno.test("existing unknown intent causes no new send",async()=>{
 const f=fixture({claimValue:{claimed:false,state:"delivery_unknown"}});assertEquals(await f.run(),"delivery_unknown");assertEquals(f.sent,[]);
});
Deno.test("present capability RPC errors are unavailable rather than old-backend success",async()=>{
 let sends=0;
 const result=await deliverRefundTechnicalHandoff({client:{rpc:()=>Promise.resolve({data:null,error:{code:"PGRST202"}})},
 health:{technicalIncidentHandoffVersion:1,status:"failing"},runId:token,sender:payload.senderEmail,
 refundsUrl:"https://app.bloomjoyusa.com/refunds",runtime,mailboxIdentities:[],sendEmail:()=>{sends++;return Promise.resolve(receipt);}});
 assertEquals(result,"unavailable");assertEquals(sends,0);
});
