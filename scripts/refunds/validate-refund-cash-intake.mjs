import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file) => readFileSync(path.resolve(process.cwd(), file), 'utf8');

const page = read('src/pages/RefundRequest.tsx');
const client = read('src/lib/refundOperations.ts');
const intake = read('supabase/functions/refund-case-intake/index.ts');
const payment = read('supabase/functions/_shared/refund-intake-payment.ts');
const migration = read('supabase/migrations/20260825013128_refund_simple_cash_intake.sql');
const browserUat = read('scripts/refunds/validate-refund-qr-intake-uat.mjs');

assert.match(page, /paymentMethod: 'card' as RefundPaymentMethod/u);
assert.match(page, /<RadioGroupItem id="payment-method-card" value="card"/u);
assert.match(page, /<RadioGroupItem id="payment-method-cash" value="cash"/u);
assert.match(page, /const choosesGiftCard = giftCardAvailable && form\.resolutionMethod === 'gift_card'/u);
assert.match(page, /const legacyCash = form\.paymentMethod === 'cash' && \(!giftCardAvailable \|\| offerQuery\.data\?\.giftCardEnabled === false\)/u);
assert.match(page, /const wantsGiftCard = choosesGiftCard && !legacyCash/u);
assert.match(page, /const needsCardDetails = form\.paymentMethod === 'card' && !wantsGiftCard/u);
assert.equal([...page.matchAll(/\{needsCardDetails && \(/gu)].length, 2,
  'Both required card details and optional card metadata must be gated by original-payment resolution');
assert.match(page, /form\.paymentMethod === 'cash' \? 'cash'/u);
assert.match(page, /cardLast4: needsCardDetails \? form\.cardLast4\.trim\(\) : undefined/u);
assert.match(page, /cardLast4Source:\s*needsCardDetails && form\.cardLast4Source \? form\.cardLast4Source : undefined/u);
assert.match(page, /cardNetwork:\s*needsCardDetails && form\.cardNetwork \? form\.cardNetwork : undefined/u);
assert.match(page, /cardWalletUsed: needsCardDetails \? form\.cardWalletUsed : undefined/u);
assert.match(page, /if \(needsCardDetails && !\/\^\[0-9\]\{4\}\$\//u);
assert.match(page, /const resolutionMethod: RefundResolutionMethod = wantsGiftCard \? 'gift_card' : 'original_payment'/u);
assert.match(page, /giftCardEnabled === false/u);
assert.match(page, /giftCardOffer: wantsGiftCard && giftCardOffer/u);
assert.doesNotMatch(page, /Zelle|Venmo/iu);

assert.match(client, /public_refund_selections_v2/u);
assert.doesNotMatch(
  client.slice(client.indexOf('export type SubmitRefundRequestInput'), client.indexOf('export type SubmitRefundRequestResponse')),
  /zellePaymentContact/u
);

assert.match(intake, /validateRefundIntakePayment/u);
assert.match(intake, /zelle_payment_contact: null/u);
assert.doesNotMatch(intake, /Please enter your Zelle phone number or email/u);
assert.equal(
  [...intake.matchAll(/if \(paymentValidation\.shouldRunNayaxLookup\)/gu)].length,
  2,
  'Both new-case and replay Nayax triggers must remain card-only'
);
assert.match(payment, /paymentMethod: "cash"[\s\S]*shouldRunNayaxLookup: false/u);
assert.match(payment, /paymentMethod: "card"[\s\S]*shouldRunNayaxLookup: true/u);

assert.match(migration, /drop constraint if exists refund_cases_cash_zelle_contact_present/u);
assert.match(migration, /create or replace function public\.public_refund_selections_v2\(\)/u);
assert.match(migration, /revoke all on function public\.public_refund_selections_v2\(\) from public/u);
assert.match(migration, /grant execute on function public\.public_refund_selections_v2\(\) to anon, authenticated/u);

assert.match(browserUat, /runDirectCashTransitionJourney/u);
assert.match(browserUat, /runMobileCashQrJourney/u);
assert.match(browserUat, /Cash intake must make no Nayax request/u);
assert.match(browserUat, /refund-direct-intake-cash-desktop\.png/u);
assert.match(browserUat, /refund-qr-intake-cash-mobile\.png/u);

console.log('Refund cash intake contract validated.');
