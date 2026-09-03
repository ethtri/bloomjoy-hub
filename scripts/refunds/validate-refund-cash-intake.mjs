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
assert.match(page, /form\.paymentMethod === 'card' && \(/u);
assert.match(page, /form\.paymentMethod === 'cash' \? 'cash'/u);
assert.match(page, /cardLast4: form\.paymentMethod === 'card'[\s\S]*: undefined/u);
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
