import { hashCorrectionToken, validateCorrectionAnswers, type CorrectionContext } from './refund-correction.ts';
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
