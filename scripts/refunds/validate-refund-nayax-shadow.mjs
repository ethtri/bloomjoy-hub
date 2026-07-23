#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNayaxRecommendation } from '../../supabase/functions/_shared/nayax-recommendation.mjs';
import {
  buildShadowEvidence,
  buildTimingDiagnostics,
  buildTransactionStates,
  ensureSafeReadConfiguration,
  parseArgs,
  parseEnvFile,
} from './refund-nayax-shadow.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(path.join(__dirname, 'refund-nayax-shadow.mjs'), 'utf8');
const nowMs = Date.parse('2026-07-22T20:00:00.000Z');
const refundCase = {
  id: '11111111-1111-4111-8111-111111111111',
  incident_at: '2026-07-22T19:00:00.000Z',
  incident_time_resolution: 'exact',
  payment_amount_cents: 700,
  card_last4: '4242',
  card_wallet_used: false,
};
const providerRecords = [
  {
    TransactionID: 123456789,
    SiteID: 42,
    MachineID: 9001,
    MachineAuthorizationTime: '2026-07-22T19:02:00.000Z',
    AuthorizationValue: 7,
    CurrencyCode: 'USD',
    CardNumber: '************4242',
    CardBrand: 'Visa',
    RecognitionMethod: 'Chip',
    PaymentStatus: 'Approved',
  },
];
const recommendation = buildNayaxRecommendation({
  payload: providerRecords,
  incidentAt: refundCase.incident_at,
  incidentTimeResolution: refundCase.incident_time_resolution,
  expectedMachineId: '9001',
  locationTimezone: 'America/Los_Angeles',
  requestAmountCents: refundCase.payment_amount_cents,
  requestCardLast4: refundCase.card_last4,
  cardWalletUsed: refundCase.card_wallet_used,
  windowHours: 6,
});
const evidence = buildShadowEvidence({
  projectRefMatches: true,
  providerStatus: 200,
  providerRecords,
  recommendation,
  refundCase,
  mappingConsistent: true,
  nowMs,
});

assert.equal(recommendation.recommendationState, 'high_confidence');
assert.equal(recommendation.oneClickEligible, true);
assert.equal(evidence.topCandidate?.oneClickEligible, true);
assert.equal(evidence.rawIdentifiersEmitted, false);
assert.equal(evidence.customerDataEmitted, false);
assert.equal(evidence.providerWriteAttempted, false);
assert.equal(evidence.productionDataWritten, false);
assert.equal(evidence.providerEvidenceCoverage.siteIdPresentCount, 1);
assert.equal(evidence.providerEvidenceCoverage.explicitPaymentStatusPresentCount, 1);
assert.equal(JSON.stringify(evidence).includes('123456789'), false);
assert.equal(JSON.stringify(evidence).includes('4242'), false);
assert.equal(JSON.stringify(evidence).includes('700'), false);

const oldCaseDiagnostics = buildTimingDiagnostics({
  providerRecords,
  refundCase: { ...refundCase, incident_at: '2026-05-15T19:00:00.000Z' },
  nowMs,
});
assert.ok(oldCaseDiagnostics.caseAgeDays > oldCaseDiagnostics.providerOldestAgeDays);
assert.ok(oldCaseDiagnostics.nearestExactAmountAndLast4DeltaHours > 24);

assert.deepEqual(
  buildTransactionStates(
    [
      {
        id: '22222222-2222-4222-8222-222222222222',
        status: 'completed',
        matched_nayax_transaction_id: 'TX-1',
        reporting_adjustment_id: null,
        nayax_refund_execution_status: 'succeeded',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        status: 'under_review',
        matched_nayax_transaction_id: 'TX-2',
        reporting_adjustment_id: null,
        nayax_refund_execution_status: 'not_requested',
      },
    ],
    refundCase.id,
  ),
  { 'TX-1': 'already_refunded', 'TX-2': 'duplicate' },
);

assert.deepEqual(parseEnvFile('A=1\nB="two"\n# C=3\n'), { A: '1', B: 'two' });
assert.equal(parseArgs(['--project-ref', 'project', '--window-hours', '12']).windowHours, 12);
assert.throws(() => parseArgs(['--window-hours', '25']), /1 to 24/);
assert.throws(() => parseArgs(['--project-ref']), /Unknown or incomplete argument/);
assert.throws(() => parseArgs(['--surprise']), /Unknown or incomplete argument/);
assert.throws(
  () =>
    ensureSafeReadConfiguration(
      {
        VITE_SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'server-only',
        VITE_SUPABASE_SERVICE_ROLE_KEY: 'unsafe',
      },
      'project',
    ),
  /client-exposed/,
);
assert.throws(
  () =>
    ensureSafeReadConfiguration(
      {
        VITE_SUPABASE_URL: 'https://wrong.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'server-only',
      },
      'expected',
    ),
  /does not match/,
);

assert.equal(source.includes(".insert("), false);
assert.equal(source.includes(".update("), false);
assert.equal(source.includes(".upsert("), false);
assert.equal(source.includes(".delete("), false);
assert.equal(source.includes('/refund-request'), false);
assert.equal(source.includes('/refund-approve'), false);
assert.match(source, /lastSales/);
assert.match(source, /rawIdentifiersEmitted: false/);
assert.match(source, /customerDataEmitted: false/);

console.log('Read-only production Nayax shadow validator passed.');
