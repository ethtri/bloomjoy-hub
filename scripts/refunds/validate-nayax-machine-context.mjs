import assert from 'node:assert/strict';
import {
  buildNayaxCandidateContext,
  buildNayaxMachineContext,
} from '../../supabase/functions/_shared/nayax-machine-context.mjs';

const checkedAt = '2026-08-11T20:00:00.000Z';
const machineContext = buildNayaxMachineContext({
  checkedAt,
  productsPayload: {
    Data: [
      { SelectionNumber: 25, ProductName: '', Price: 10.9 },
      { SelectionNumber: 26, ProductName: 'Pink vanilla', Price: 10.9 },
    ],
  },
  statusPayload: { Data: { IsOnline: true } },
  alertsPayload: {
    Alerts: [
      { AlertCategoryName: 'No VMC Communication', AlertDateTimeGMT: '2026-08-11T18:45:00Z' },
      { AlertCategoryName: 'Power Down', AlertDateTimeGMT: '2026-08-10T09:00:00Z' },
    ],
  },
});

assert.equal(machineContext.status.state, 'online');
assert.equal(machineContext.status.checkedAt, checkedAt);
assert.equal(machineContext.products.length, 2);

const candidateContext = buildNayaxCandidateContext({
  record: {
    ProductName: 'Unknown(25 = 10.90)',
    AuthorizationValue: 10.9,
  },
  machineContext,
  authorizedAt: '2026-08-11T19:00:00.000Z',
});

assert.equal(candidateContext.productCode, '25');
assert.equal(candidateContext.productLabel, 'Selection 25');
assert.equal(candidateContext.standardPriceCents, 1090);
assert.equal(candidateContext.priceMatchesMachineConfiguration, true);
assert.equal(candidateContext.nearbyMachineAlerts.length, 1);
assert.equal(candidateContext.nearbyMachineAlerts[0].category, 'No VMC Communication');

const unavailableContext = buildNayaxMachineContext({
  checkedAt,
  productsPayload: null,
  statusPayload: null,
  alertsPayload: null,
});
assert.equal(unavailableContext.status.state, 'unknown');
assert.deepEqual(unavailableContext.products, []);
assert.deepEqual(unavailableContext.alerts, []);

console.log('Nayax machine context validation passed.');
