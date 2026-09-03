import { hashCorrectionToken, updateCorrectionAnswer, validateCorrectionAnswers, type CorrectionAnswers, type CorrectionContext } from './refund-correction.ts';
const context: CorrectionContext = { state: 'ready', requestedFields: ['card_last4'], allowedFields: ['card_last4','amount','incident_date','incident_time','payment_method','payment_interaction'], values: { card_last4: '1234' } };
const assert = (value: unknown) => { if (!value) throw new Error('Assertion failed'); };
const rejects = (input: unknown, ctx = context) => { let threw = false; try { validateCorrectionAnswers(input,ctx); } catch { threw = true; } assert(threw); };
Deno.test('requested field can be changed, confirmed or explicitly unknown', () => {
  for (const answer of [{ disposition: 'changed', value: '6789' }, { disposition: 'confirmed' }, { disposition: 'cannot_provide' }]) {
    assert(validateCorrectionAnswers({ card_last4: answer },context).card_last4);
  }
  assert(validateCorrectionAnswers({ card_last4: { disposition: 'changed', value: '1234' } },context).card_last4?.disposition === 'confirmed');
});
Deno.test('rejects forbidden fields, extra keys, missing requested answers and full card data', () => {
  rejects({}); rejects({ caseId: 'other-case' });
  rejects({ card_last4: { disposition: 'changed', value: '1234567890123456' } });
  rejects({ card_last4: { disposition: 'confirmed', value: '9876' } });
  rejects({ card_last4: { disposition: 'cannot_provide', value: '1234' } });
  rejects({ card_last4: { disposition: 'confirmed', approved: true } });
  rejects({ card_last4: { disposition: 'confirmed' } }, { ...context, values: {} });
});
Deno.test('supports decimal-comma amount and validates calendar dates and times', () => {
  const answer = { card_last4: { disposition: 'confirmed' }, amount: { disposition: 'changed', value: '7,25' } };
  assert(validateCorrectionAnswers(answer,context).amount?.value === '7.25');
  rejects({ ...answer, amount: { disposition: 'changed', value: '-7' } });
  rejects({ ...answer, incident_date: { disposition: 'changed', value: '2026-02-30' } });
  rejects({ ...answer, incident_time: { disposition: 'changed', value: '25:30' } });
  rejects({ ...answer, payment_method: { disposition: 'changed', value: 'paypal' } });
});
Deno.test('purchase correction tokens have a distinct domain from wallet/status capabilities', async () => {
  const token = 'a'.repeat(43);
  const digest = await hashCorrectionToken(token);
  const raw = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`refund-wallet-correction:${token}`));
  const legacyDigest = Array.from(new Uint8Array(raw),(byte)=>byte.toString(16).padStart(2,'0')).join('');
  assert(digest.length === 64 && digest !== legacyDigest && digest === await hashCorrectionToken(token));
});

Deno.test('changed time has explicit confidence even when the clock value stays the same', () => {
  const timeContext: CorrectionContext = { ...context, values: { card_last4: '1234', incident_time: '12:30' } };
  rejects({ card_last4: { disposition: 'confirmed' }, incident_time: { disposition: 'changed', value: '12:30' } },timeContext);
  const result = validateCorrectionAnswers({ card_last4: { disposition: 'confirmed' }, incident_time: { disposition: 'changed', value: '12:30', confidence: 'rough' } },timeContext);
  assert(result.incident_time?.disposition === 'changed' && result.incident_time.confidence === 'rough');
});
Deno.test('new payment context requires explicit dependent answers without guessing', () => {
  const paymentContext: CorrectionContext = { ...context, allowedFields: [...context.allowedFields!, 'wallet_provider'], values: { card_last4: '1234',payment_method:'card',payment_interaction:'tap_card' } };
  const answers = { card_last4: { disposition:'changed',value:'1234' }, payment_interaction:{disposition:'changed',value:'phone_watch_wallet'} };
  rejects(answers,paymentContext);
  const result=validateCorrectionAnswers({...answers,wallet_provider:{disposition:'cannot_provide'}},paymentContext);
  assert(result.card_last4?.disposition === 'confirmed' && result.wallet_provider?.disposition === 'cannot_provide');
});

Deno.test('changing payment context drops inapplicable requested questions', () => {
  const cardContext: CorrectionContext={state:'ready',requestedFields:['card_last4'],allowedFields:['payment_method','payment_interaction','card_last4','wallet_provider'],values:{payment_method:'card',payment_interaction:'tap_card'}};
  const cash=validateCorrectionAnswers({payment_method:{disposition:'changed',value:'cash'}},cardContext);
  assert(cash.payment_method?.value==='cash' && !cash.card_last4);
  const physical=validateCorrectionAnswers({payment_interaction:{disposition:'changed',value:'tap_card'},card_last4:{disposition:'confirmed'}},
    {...cardContext,requestedFields:['wallet_provider'],values:{payment_method:'card',payment_interaction:'phone_watch_wallet',card_last4:'1234'}});
  assert(physical.payment_interaction?.value==='tap_card' && !physical.wallet_provider);
});

Deno.test('unchanged payment confirmations preserve entered dependent answers; real changes clear them', () => {
  const ctx: CorrectionContext={state:'ready',values:{payment_method:'card',payment_interaction:'phone_watch_wallet'}};
  const prior: CorrectionAnswers={card_last4:{disposition:'changed',value:'5678'},wallet_provider:{disposition:'changed',value:'apple_pay'},card_network:{disposition:'confirmed'}};
  for(const field of ['payment_method','payment_interaction'] as const) {
    for(const answer of [{disposition:'confirmed' as const},{disposition:'changed' as const,value:ctx.values![field]}]) {
      const next=updateCorrectionAnswer(prior,field,answer,ctx);
      assert(next.card_last4===prior.card_last4 && next.wallet_provider===prior.wallet_provider && next.card_network===prior.card_network);
    }
  }
  const cash=updateCorrectionAnswer(prior,'payment_method',{disposition:'changed',value:'cash'},ctx);
  assert(!cash.card_last4 && !cash.wallet_provider && !cash.card_network && !cash.payment_interaction);
  const physical=updateCorrectionAnswer(prior,'payment_interaction',{disposition:'changed',value:'tap_card'},ctx);
  assert(!physical.card_last4 && !physical.wallet_provider && !physical.card_network);
  const repeated=updateCorrectionAnswer({...physical,card_last4:prior.card_last4},'payment_interaction',{disposition:'changed',value:'tap_card'},ctx);
  assert(repeated.card_last4===prior.card_last4);
  const reverted=updateCorrectionAnswer(repeated,'payment_interaction',{disposition:'confirmed'},ctx);
  assert(!reverted.card_last4);
});
