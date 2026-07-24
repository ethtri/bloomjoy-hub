#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  buildNayaxRefundApprovalBody,
  buildNayaxRefundRequestBody,
  classifyNayaxRefundResponse,
  executeNayaxRefundProvider,
  parseNayaxRefundProviderContract,
  postNayaxRefundStep,
} from '../../supabase/functions/_shared/nayax-refund-provider.mjs';

const baseContract = {
  schemaVersion: 1,
  contractVersion: 'nayax-qa-confirmed-v1',
  baseUrl: 'https://qa-lynx.nayax.com/operational/v1',
  authorizationMode: 'bearer',
  amountUnit: 'major',
  refundEmailListMode: 'omit',
  requestResponses: [
    { result: 'True', status: 'Pending Approval', outcome: 'accepted' },
    { result: 'False', status: 'Rejected', outcome: 'rejected' },
    { result: 'False', status: 'Duplicate', outcome: 'duplicate' },
    { result: 'False', status: 'Already Refunded', outcome: 'already_refunded' },
  ],
  approveResponses: [
    { result: 'True', status: 'Approved', outcome: 'succeeded' },
    { result: 'False', status: 'Rejected', outcome: 'rejected' },
    { result: 'False', status: 'Duplicate', outcome: 'duplicate' },
    { result: 'False', status: 'Already Refunded', outcome: 'already_refunded' },
    { result: 'True', status: 'Pending', outcome: 'pending' },
  ],
};

const contract = parseNayaxRefundProviderContract(baseContract);

assert.throws(
  () => parseNayaxRefundProviderContract({ ...baseContract, extra: true }),
  /unsupported field/,
  'Unknown contract fields must fail closed.',
);
assert.throws(
  () => parseNayaxRefundProviderContract({ ...baseContract, schemaVersion: 2 }),
  /schemaVersion/,
  'Unknown contract schema versions must fail closed.',
);
assert.throws(
  () => parseNayaxRefundProviderContract({ ...baseContract, authorizationMode: 'guess' }),
  /authorizationMode/,
  'The account-confirmed authorization header format must be explicit.',
);
assert.throws(
  () => parseNayaxRefundProviderContract({
    ...baseContract,
    baseUrl: 'https://example.com/operational/v1',
  }),
  /approved HTTPS host/,
  'Only approved Nayax HTTPS hosts may receive a refund request.',
);
assert.throws(
  () => parseNayaxRefundProviderContract({
    ...baseContract,
    requestResponses: [{ result: 'True', status: null, outcome: 'accepted' }],
  }),
  /exact Result and Status pair/,
  'Response patterns must match exact Result and Status pairs.',
);
assert.throws(
  () => parseNayaxRefundProviderContract({
    ...baseContract,
    requestResponses: [{ result: 'False', status: 'Rejected', outcome: 'rejected' }],
  }),
  /accepted request response/,
  'A contract without a confirmed request acceptance is invalid.',
);
assert.throws(
  () => parseNayaxRefundProviderContract({
    ...baseContract,
    approveResponses: [{ result: 'False', status: 'Rejected', outcome: 'rejected' }],
  }),
  /succeeded approval response/,
  'A contract without a confirmed approval success is invalid.',
);

const majorBody = buildNayaxRefundRequestBody({
  contract,
  amountCents: 725,
  transactionId: '123456789',
  siteId: 42,
  machineAuthorizationTime: '2026-07-22T10:30:00-07:00',
});
assert.deepEqual(majorBody, {
  RefundAmount: 7.25,
  RefundReason: 'Bloomjoy manager-approved customer refund',
  TransactionId: 123456789,
  SiteId: 42,
  MachineAuTime: '2026-07-22T10:30:00-07:00',
});

const minorContract = parseNayaxRefundProviderContract({
  ...baseContract,
  contractVersion: 'nayax-qa-confirmed-v2',
  amountUnit: 'minor',
  refundEmailListMode: 'empty_string',
});
assert.equal(
  buildNayaxRefundRequestBody({
    contract: minorContract,
    amountCents: 725,
    transactionId: '123456789',
    siteId: 42,
    machineAuthorizationTime: '2026-07-22T17:30:00Z',
  }).RefundAmount,
  725,
  'Minor-unit contracts must send integer cents.',
);
assert.equal(
  buildNayaxRefundRequestBody({
    contract: minorContract,
    amountCents: 725,
    transactionId: '123456789',
    siteId: 42,
    machineAuthorizationTime: '2026-07-22T17:30:00Z',
  }).RefundEmailList,
  '',
  'Refund email behavior must be explicit in the confirmed contract.',
);

assert.deepEqual(
  buildNayaxRefundApprovalBody({
    transactionId: '123456789',
    siteId: 42,
    machineAuthorizationTime: '2026-07-22T17:30:00Z',
  }),
  {
    IsRefundedExternally: false,
    TransactionId: 123456789,
    SiteId: 42,
    MachineAuTime: '2026-07-22T17:30:00Z',
  },
  'Approval must tell Nayax that Nayax, not Bloomjoy, is processing the refund.',
);

for (const invalid of [
  { transactionId: 'ABC', siteId: 42, machineAuthorizationTime: '2026-07-22T17:30:00Z' },
  { transactionId: '123', siteId: 0, machineAuthorizationTime: '2026-07-22T17:30:00Z' },
  { transactionId: '123', siteId: 42, machineAuthorizationTime: '2026-07-22T17:30:00' },
]) {
  assert.throws(
    () => buildNayaxRefundApprovalBody(invalid),
    /Nayax|timezone-qualified/,
    'Invalid provider identifiers and ambiguous times must fail before any provider call.',
  );
}

assert.deepEqual(
  classifyNayaxRefundResponse({
    stage: 'request',
    httpStatus: 200,
    payload: { Result: ' true ', Status: 'PENDING APPROVAL', ignored: 'secret' },
    patterns: contract.requestResponses,
  }),
  {
    stage: 'request',
    outcome: 'accepted',
    httpStatus: 200,
    result: 'true',
    status: 'pending approval',
    payloadRedacted: true,
  },
  'Only normalized Result and Status may be retained from the provider response.',
);
assert.equal(
  classifyNayaxRefundResponse({
    stage: 'request',
    httpStatus: 200,
    payload: { Result: 'True', Status: 'Unexpected' },
    patterns: contract.requestResponses,
  }).outcome,
  'unknown',
  'An unfamiliar provider response must never be treated as success.',
);
assert.equal(
  classifyNayaxRefundResponse({
    stage: 'approve',
    httpStatus: 503,
    payload: { Result: 'True', Status: 'Approved' },
    patterns: contract.approveResponses,
  }).outcome,
  'unknown',
  'A non-success HTTP response must never be treated as an approved refund.',
);
assert.equal(
  classifyNayaxRefundResponse({
    stage: 'request',
    httpStatus: 503,
    payload: { Result: 'False', Status: 'Rejected' },
    patterns: contract.requestResponses,
  }).outcome,
  'unknown',
  'Every non-success HTTP response must be reconciled instead of retried.',
);

const response = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const successfulCalls = [];
const successfulStages = [];
const successfulResult = await executeNayaxRefundProvider({
  contract,
  token: 'test-token',
  amountCents: 725,
  transactionId: '123456789',
  siteId: 42,
  machineAuthorizationTime: '2026-07-22T17:30:00Z',
  fetchImpl: async (url, options) => {
    successfulCalls.push({ url, options });
    return successfulCalls.length === 1
      ? response({ Result: 'True', Status: 'Pending Approval', raw: 'discard-me' })
      : response({ Result: 'True', Status: 'Approved', raw: 'discard-me' });
  },
  onStage: async (stage) => successfulStages.push(stage),
});
assert.equal(successfulResult.executed, true);
assert.equal(successfulCalls.length, 2, 'A confirmed flow makes one request and one approval.');
assert.deepEqual(
  successfulCalls.map((call) => call.url),
  [
    'https://qa-lynx.nayax.com/operational/v1/payment/refund-request',
    'https://qa-lynx.nayax.com/operational/v1/payment/refund-approve',
  ],
);
assert.equal(successfulCalls[0].options.headers.Authorization, 'Bearer test-token');
assert.equal(
  successfulCalls[0].options.redirect,
  'error',
  'Redirects must be rejected so the server-only Nayax token cannot leave an approved host.',
);
assert.equal(
  JSON.parse(successfulCalls[1].options.body).IsRefundedExternally,
  false,
);
assert.equal(
  'RefundDocumentUrl' in JSON.parse(successfulCalls[1].options.body),
  false,
);
assert.equal(JSON.stringify(successfulStages).includes('discard-me'), false);

let rawAuthorizationHeader = null;
await postNayaxRefundStep({
  stage: 'request',
  contract: parseNayaxRefundProviderContract({
    ...baseContract,
    contractVersion: 'nayax-qa-raw-auth-v1',
    authorizationMode: 'raw',
  }),
  token: 'raw-test-token',
  body: majorBody,
  fetchImpl: async (_url, options) => {
    rawAuthorizationHeader = options.headers.Authorization;
    return response({ Result: 'True', Status: 'Pending Approval' });
  },
});
assert.equal(
  rawAuthorizationHeader,
  'raw-test-token',
  'Raw API-key authorization is available only when the confirmed contract selects it.',
);

for (const requestFixture of [
  { Result: 'False', Status: 'Rejected' },
  { Result: 'False', Status: 'Duplicate' },
  { Result: 'False', Status: 'Already Refunded' },
  { Result: 'True', Status: 'Unexpected' },
]) {
  let callCount = 0;
  const result = await executeNayaxRefundProvider({
    contract,
    token: 'test-token',
    amountCents: 725,
    transactionId: '123456789',
    siteId: 42,
    machineAuthorizationTime: '2026-07-22T17:30:00Z',
    fetchImpl: async () => {
      callCount += 1;
      return response(requestFixture);
    },
  });
  assert.equal(result.executed, false);
  assert.equal(callCount, 1, 'A non-accepted request must never be followed by approval.');
}

for (const approveFixture of [
  { Result: 'False', Status: 'Rejected' },
  { Result: 'True', Status: 'Pending' },
  { Result: 'True', Status: 'Unexpected' },
]) {
  let callCount = 0;
  const result = await executeNayaxRefundProvider({
    contract,
    token: 'test-token',
    amountCents: 725,
    transactionId: '123456789',
    siteId: 42,
    machineAuthorizationTime: '2026-07-22T17:30:00Z',
    fetchImpl: async () => {
      callCount += 1;
      return callCount === 1
        ? response({ Result: 'True', Status: 'Pending Approval' })
        : response(approveFixture);
    },
  });
  assert.equal(result.executed, false);
  assert.equal(callCount, 2);
}

const networkResult = await postNayaxRefundStep({
  stage: 'request',
  contract,
  token: 'test-token',
  body: majorBody,
  fetchImpl: async () => {
    throw new Error('synthetic network failure with secret details');
  },
});
assert.deepEqual(networkResult, {
  stage: 'request',
  outcome: 'unknown',
  httpStatus: null,
  result: null,
  status: null,
  failureType: 'network',
  payloadRedacted: true,
});

console.log('Nayax refund provider adapter validated.');
