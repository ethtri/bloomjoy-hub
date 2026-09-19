import assert from 'node:assert/strict';
import test from 'node:test';

import {
  refundPortalJourneyNames,
  runRefundPortalJourneys,
} from './index.mjs';

test('portal UAT is organized around five business journeys', () => {
  assert.deepEqual(refundPortalJourneyNames, [
    'ordinary-success',
    'ambiguous-selection',
    'duplicate-idempotency',
    'authorization',
    'unknown-provider-outcome',
  ]);
});

test('a focused journey runs only its owned business checks', async () => {
  const calls = [];
  await runRefundPortalJourneys({
    journeyNames: ['duplicate-idempotency'],
    checks: {
      'email-duplicate': async () => calls.push('email-duplicate'),
      'official-action-version-reset': async () => calls.push('official-action-version-reset'),
      'transactional-delivery-truth': async () => calls.push('transactional-delivery-truth'),
    },
  });
  assert.deepEqual(calls, [
    'email-duplicate',
    'official-action-version-reset',
    'transactional-delivery-truth',
  ]);
});

test('journey selection rejects unknown names and missing implementations', async () => {
  await assert.rejects(
    runRefundPortalJourneys({ journeyNames: ['invented-gate'], checks: {} }),
    /Unknown Refund portal journey/,
  );
  await assert.rejects(
    runRefundPortalJourneys({ journeyNames: ['ordinary-success'], checks: {} }),
    /missing check unauthenticated-entry/,
  );
});
