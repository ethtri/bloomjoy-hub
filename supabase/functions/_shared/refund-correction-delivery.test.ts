import { assertEquals, assertRejects, assertThrows, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { correctionTokenForMessage, issueRefundCorrectionForMessage, requireRefundCorrectionUrl, STORED_CORRECTION_LINK_MARKER } from './refund-correction-delivery.ts';
import { buildRefundCustomerEmail, redactRefundStatusLinksForStorage } from './refund-email.ts';
import { buildNayaxCustomerCorrectionEmail } from './refund-nayax-customer-correction.ts';
import { deliverRefundManualMessageClaim } from './refund-manual-message-outbox.ts';
import { refundCorrectionCopy, refundCorrectionReason } from './refund-correction-copy.ts';
import { correctionFields, type CorrectionField } from './refund-correction.ts';

const messageId = 'b2000000-0000-4000-8000-000000000001';
const secret = 'synthetic-correction-test-secret-01234567890123456789';
const input = { messageType: 'more_info' as const, publicReference: 'RF-SYNTHETIC', customerEmail: 'customer@example.com', missingFields: ['amount', 'incident_time'] as const };
Deno.test('scoped email and manager preview share the form reason for each supported field and combined request', () => {
  for (const fields of [...correctionFields.map((field) => [field]), ['amount', 'card_last4'] as CorrectionField[]]) {
    for (const locale of ['en', 'es']) {
      const reason = refundCorrectionReason(fields, locale === 'es');
      const preview = refundCorrectionCopy(fields, input.publicReference, locale === 'es');
      const email = buildRefundCustomerEmail({...input, missingFields: fields, customerLocale: locale, correctionUrl: STORED_CORRECTION_LINK_MARKER});
      assert(reason.length > 0 && preview.paragraphs.includes(reason));
      assert(email.text.includes(reason) && email.html.includes(reason));
      assertEquals(email.subject, preview.subject);
      assertEquals(preview.paragraphs.filter((paragraph) => paragraph === reason).length, 1);
    }
  }
  assertEquals(refundCorrectionReason(['amount', 'incident_time', 'location_or_machine'], false), refundCorrectionReason(['amount'], false));
  assertEquals(refundCorrectionReason([], false), '');
  assert(!refundCorrectionReason(['amount', 'card_last4'], false).includes('approved'));
});
const withConfig = async (run: () => Promise<void>) => {
  const prior = Deno.env.get('REFUND_CORRECTION_TOKEN_SECRET');
  Deno.env.set('REFUND_CORRECTION_TOKEN_SECRET',secret);
  try { await run(); } finally {
    if (prior === undefined) Deno.env.delete('REFUND_CORRECTION_TOKEN_SECRET'); else Deno.env.set('REFUND_CORRECTION_TOKEN_SECRET',prior);
  }
};

Deno.test('correction token is stable per message, isolated across messages, and cannot use missing configuration', async () => {
  const token = await correctionTokenForMessage(messageId,secret);
  assert(/^[A-Za-z0-9_-]{43}$/.test(token));
  assertEquals(await correctionTokenForMessage(messageId,secret),token);
  assert(await correctionTokenForMessage('b2000000-0000-4000-8000-000000000002',secret)!==token);
  await assertRejects(() => correctionTokenForMessage(messageId,''));
});

Deno.test('capability issuance binds one message/version and never returns a URL for rejected or expired scope', () => withConfig(async () => {
  const calls: Array<Record<string, unknown>> = [];
  const supabase = { rpc: (name: string,args: Record<string,unknown>) => {
    if(name==='refund_purchase_correction_links_enabled') return Promise.resolve({data:true,error:null});
    calls.push(args); return Promise.resolve({data:{state:'pending',requestId:messageId,expiresAt:new Date(Date.now()+48*3600000).toISOString()},error:null});
  } };
  const first = await issueRefundCorrectionForMessage({supabase,messageId,factVersion:7});
  assertEquals(await issueRefundCorrectionForMessage({supabase,messageId,factVersion:7}),first);
  assertEquals(calls[0],calls[1]);
  assertEquals(calls[0].p_message_id,messageId); assertEquals(calls[0].p_expected_fact_version,7);
  assert(!JSON.stringify(calls).includes(first.split('#token=')[1]));
  for (const state of ['submitted','expired','failed']) {
    await assertRejects(() => issueRefundCorrectionForMessage({messageId,factVersion:7,supabase:{rpc:(name)=>Promise.resolve({data:name==='refund_purchase_correction_links_enabled'?true:{state,requestId:messageId,expiresAt:'2020-01-01'},error:null})}}));
  }
  await assertRejects(() => issueRefundCorrectionForMessage({messageId,factVersion:7,supabase:{rpc:()=>Promise.resolve({data:null,error:{code:'not_current'}})}}));
}));

Deno.test('only approved correction fragment URLs can become actionable email links', async () => {
  const token = await correctionTokenForMessage(messageId,secret);
  for (const url of [`https://attacker.example/refunds/correct#token=${token}`,`https://app.bloomjoyusa.com/refunds/status#token=${token}`,`https://app.bloomjoyusa.com/refunds/correct?token=${token}`,`https://app.bloomjoyusa.com:444/refunds/correct#token=${token}`]) {
    assertThrows(()=>requireRefundCorrectionUrl(url));
  }
  const url=`https://app.bloomjoyusa.com/refunds/correct#token=${token}`;
  const stored = redactRefundStatusLinksForStorage(`Quoted request: ${url}`);
  assertEquals(stored, `Quoted request: ${STORED_CORRECTION_LINK_MARKER}`);
  assert(!stored.includes(token));
  for (const locale of ['en','es']) {
    const email=buildRefundCustomerEmail({...input,missingFields:[...input.missingFields],correctionUrl:url,customerLocale:locale});
    assert(email.text.includes('confirm it is correct')); assert(email.text.includes('not sure'));
    assert(email.text.includes('does not approve or complete a refund'));
    assert(!email.text.includes('copy these lines'));
    assertEquals(email.html.split(`href="${url}"`).length-1,1);
    if(locale==='es') assert(email.text.includes('no está seguro'));
  }
  const prepared=buildRefundCustomerEmail({...input,missingFields:[...input.missingFields],correctionUrl:STORED_CORRECTION_LINK_MARKER});
  assert(prepared.text.includes(STORED_CORRECTION_LINK_MARKER)); assert(!prepared.html.includes('#token='));
  const wallet=buildNayaxCustomerCorrectionEmail({...input,missingFields:['card_last4'],cardWalletUsed:true,correctionUrl:url});
  assert(wallet.text.includes('Update your refund request'));
  const legacy=buildRefundCustomerEmail({...input,missingFields:[...input.missingFields]});
  assert(legacy.text.includes('Approximate purchase time (include AM or PM):'));
});

Deno.test('manual outbox cannot attempt transport or mark sent when its scoped capability is unavailable', () => withConfig(async () => {
  const rpcCalls:string[]=[];
  const row={id:messageId,refund_case_id:'b3000000-0000-4000-8000-000000000001',message_type:'more_info',status:'pending',recipient_email:'customer@example.com',subject:'Update your refund request',body:STORED_CORRECTION_LINK_MARKER,manual_delivery_state:'claimed',manual_delivery_claim_token:messageId,manual_delivery_expected_case_version:3,manual_delivery_status_link_requested:false,created_by:'b4000000-0000-4000-8000-000000000001'};
  const client={
    from:(table:string)=>{const query={select:()=>query,eq:()=>query,maybeSingle:()=>Promise.resolve({data:table==='refund_case_messages'?row:{official_action_version:3,deterministic_fact_version:7,case_population:'customer',customer_email:row.recipient_email},error:null})};return query;},
    rpc:(name:string,args:Record<string,unknown>)=>{rpcCalls.push(name); if(name==='refund_purchase_correction_links_enabled')return Promise.resolve({data:true,error:null}); if(name==='service_issue_refund_purchase_correction') return Promise.resolve({data:null,error:{code:'stale'}}); if(name==='service_finish_refund_manual_message_delivery'){assertEquals(args.p_outcome,'failed');return Promise.resolve({data:{finished:true,payloadRedacted:true},error:null});} throw new Error(`Unexpected side effect ${name}`);},
  };
  const result=await deliverRefundManualMessageClaim({supabase:client as never,reference:{messageId,claimToken:messageId}});
  assertEquals(result.outcome,'failed'); assertEquals(result.transport,null);
  assertEquals(rpcCalls,['refund_purchase_correction_links_enabled','service_issue_refund_purchase_correction','service_finish_refund_manual_message_delivery']);
}));
