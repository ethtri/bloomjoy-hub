#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildNayaxRefundApprovalBody,
  buildRedactedNayaxStageDigest,
  buildNayaxRefundRequestBody,
  classifyNayaxRefundResponse,
  createNayaxRefundProviderAdapter,
  executeNayaxRefundApprovalOnly,
  executeNayaxRefundProvider,
  freezeNayaxRefundEvidence,
  parseNayaxRefundApprovalContract,
  parseNayaxRefundProviderContract,
  postNayaxRefundStep,
} from '../../supabase/functions/_shared/nayax-refund-provider.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
let assertionCount = 0;

const check = (condition, message) => {
  assertionCount += 1;
  assert.ok(condition, message);
};

const equal = (actual, expected, message) => {
  assertionCount += 1;
  assert.equal(actual, expected, message);
};

const deepEqual = (actual, expected, message) => {
  assertionCount += 1;
  assert.deepEqual(actual, expected, message);
};

const throws = (fn, expected, message) => {
  assertionCount += 1;
  assert.throws(fn, expected, message);
};

const baseContract = {
  schemaVersion: 1,
  contractVersion: 'nayax-qa-confirmed-v1',
  baseUrl: 'https://qa-lynx.nayax.com/operational/v1',
  authorizationMode: 'bearer',
  amountUnit: 'major',
  amountRoundingMode: 'exact_cent',
  refundEmailListMode: 'omit',
  providerEmailBehavior: 'suppressed_by_written_contract',
  writeCredentialMode: 'separate',
  sameWriteTokenContractConfirmed: false,
  reconciliationMode: 'dtm_then_structured_resolution',
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
const approvalContract = parseNayaxRefundApprovalContract({
  schemaVersion: 1,
  contractVersion: 'nayax-qa-approval-v1',
  baseUrl: 'https://qa-lynx.nayax.com/operational/v1',
  authorizationMode: 'bearer',
  reconciliationMode: 'dtm_then_structured_resolution',
  approveResponses: baseContract.approveResponses,
});
equal(
  approvalContract.approveResponses.length,
  baseContract.approveResponses.length,
  'Approval-only recovery has a contract that cannot guess request-stage responses.',
);
throws(
  () => parseNayaxRefundApprovalContract({
    ...approvalContract,
    requestResponses: baseContract.requestResponses,
  }),
  /unsupported field/,
  'Approval-only recovery rejects request-stage contract fields.',
);

check(Object.isFrozen(contract), 'The confirmed provider contract must be immutable.');
check(Object.isFrozen(contract.requestResponses), 'Request patterns must be immutable.');
check(Object.isFrozen(contract.requestResponses[0]), 'Individual response patterns must be immutable.');
equal(contract.baseUrl, baseContract.baseUrl, 'The exact approved QA path is preserved.');

for (const [mutate, pattern, message] of [
  [(value) => ({ ...value, extra: true }), /unsupported field/, 'Unknown contract fields fail closed.'],
  [(value) => ({ ...value, schemaVersion: 2 }), /schemaVersion/, 'Unknown schema versions fail closed.'],
  [(value) => ({ ...value, authorizationMode: 'guess' }), /authorizationMode/, 'Authorization mode must be explicit.'],
  [(value) => ({ ...value, amountUnit: 'guess' }), /amountUnit/, 'Amount units must be explicit.'],
  [(value) => ({ ...value, amountRoundingMode: 'guess' }), /amountRoundingMode/, 'Amount rounding must be exact.'],
  [(value) => ({ ...value, refundEmailListMode: 'guess' }), /refundEmailListMode/, 'Refund email ownership must be explicit.'],
  [(value) => ({ ...value, providerEmailBehavior: 'unproven' }), /providerEmailBehavior/, 'Provider-originated email behavior must have written suppression or owner consent.'],
  [(value) => ({ ...value, writeCredentialMode: 'guess' }), /writeCredentialMode/, 'Write credential ownership must be explicit.'],
  [(value) => ({ ...value, reconciliationMode: 'guess' }), /reconciliationMode/, 'Reconciliation ownership must be explicit.'],
  [(value) => ({ ...value, requestAdvanceMode: 'guess' }), /requestAdvanceMode/, 'Request advancement must be explicit.'],
  [(value) => ({ ...value, writeCredentialMode: 'same_token_explicit' }), /explicit contract confirmation/, 'Shared write credentials require a written contract assertion.'],
  [(value) => ({ ...value, baseUrl: 'http://qa-lynx.nayax.com/operational/v1' }), /approved HTTPS host/, 'HTTP is rejected.'],
  [(value) => ({ ...value, baseUrl: 'https://example.com/operational/v1' }), /approved HTTPS host/, 'Unapproved hosts are rejected.'],
  [(value) => ({ ...value, baseUrl: 'https://lynx.nayax.com:444/operational/v1' }), /approved HTTPS host/, 'Nonstandard ports are rejected.'],
  [(value) => ({ ...value, baseUrl: 'https://lynx.nayax.com/operational/v2' }), /operational\/v1/, 'Unexpected API paths are rejected.'],
  [(value) => ({ ...value, baseUrl: 'https://user@lynx.nayax.com/operational/v1' }), /approved HTTPS host/, 'Embedded credentials are rejected.'],
  [(value) => ({ ...value, requestResponses: [] }), /1 to 30 patterns/, 'Empty response contracts are rejected.'],
  [(value) => ({ ...value, requestResponses: [{ result: 'True', status: null, outcome: 'accepted' }] }), /exact Result and Status pair/, 'Wildcard response matches are rejected.'],
  [(value) => ({ ...value, requestResponses: [{ result: 'False', status: 'Rejected', outcome: 'rejected' }] }), /accepted request response/, 'A contract needs a confirmed accepted request state.'],
  [(value) => ({ ...value, approveResponses: [{ result: 'False', status: 'Rejected', outcome: 'rejected' }] }), /succeeded approval response/, 'A contract needs a confirmed approved state.'],
  [(value) => ({
    ...value,
    requestResponses: [
      { result: 'True', status: 'Pending Approval', outcome: 'accepted' },
      { result: ' true ', status: 'PENDING APPROVAL', outcome: 'accepted' },
    ],
  }), /duplicate match/, 'Case-normalized duplicate patterns are rejected.'],
]) {
  throws(
    () => parseNayaxRefundProviderContract(mutate(baseContract)),
    pattern,
    message,
  );
}

throws(
  () => parseNayaxRefundProviderContract('{'),
  /not valid JSON/,
  'Malformed JSON fails closed.',
);

const majorBody = buildNayaxRefundRequestBody({
  contract,
  amountCents: 725,
  transactionId: '123456789',
  siteId: 42,
  machineAuthorizationTime: '2026-07-22T10:30:00-07:00',
});
deepEqual(majorBody, {
  RefundAmount: 7.25,
  RefundReason: 'Bloomjoy manager-approved customer refund',
  TransactionId: 123456789,
  SiteId: 42,
  MachineAuTime: '2026-07-22T10:30:00-07:00',
}, 'Major-unit contracts convert integer cents to decimal currency exactly.');
check(!('RefundEmailList' in majorBody), 'The omit policy sends no Nayax customer email field.');

const minorContract = parseNayaxRefundProviderContract({
  ...baseContract,
  contractVersion: 'nayax-qa-confirmed-v2',
  amountUnit: 'minor',
  refundEmailListMode: 'empty_string',
});
const minorBody = buildNayaxRefundRequestBody({
  contract: minorContract,
  amountCents: 725,
  transactionId: '123456789',
  siteId: 42,
  machineAuthorizationTime: '2026-07-22T17:30:00Z',
});
equal(minorBody.RefundAmount, 725, 'Minor-unit contracts send integer cents.');
equal(minorBody.RefundEmailList, '', 'The empty-string policy is represented exactly.');

deepEqual(
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
  'Approval requires Nayax—not Bloomjoy—to perform the refund.',
);

for (const invalid of [
  { transactionId: 'ABC', siteId: 42, machineAuthorizationTime: '2026-07-22T17:30:00Z' },
  { transactionId: '123', siteId: 0, machineAuthorizationTime: '2026-07-22T17:30:00Z' },
  { transactionId: '123', siteId: 2_147_483_648, machineAuthorizationTime: '2026-07-22T17:30:00Z' },
  { transactionId: '123', siteId: 42, machineAuthorizationTime: '2026-07-22T17:30:00' },
]) {
  throws(
    () => buildNayaxRefundApprovalBody(invalid),
    /Nayax|timezone-qualified/,
    'Invalid identifiers and ambiguous times fail before provider transport.',
  );
}

const frozenEvidenceInput = {
  caseId: '76000000-0000-4000-8000-000000000001',
  amountCents: 725,
  currencyCode: 'USD',
  transactionId: '123456789',
  siteId: 42,
  machineAuthorizationTime: '2026-07-22T17:30:00Z',
};
const frozenEvidence = freezeNayaxRefundEvidence(frozenEvidenceInput);
check(Object.isFrozen(frozenEvidence), 'Provider evidence is copied into an immutable snapshot.');
deepEqual(frozenEvidence, {
  ...frozenEvidenceInput,
  transactionId: 123456789,
}, 'Frozen evidence contains only validated provider fields.');
throws(
  () => freezeNayaxRefundEvidence({ ...frozenEvidenceInput, currencyCode: 'EUR' }),
  /must use USD/,
  'Only exact USD evidence is accepted.',
);
throws(
  () => freezeNayaxRefundEvidence({ ...frozenEvidenceInput, surprise: true }),
  /unsupported field/,
  'Frozen evidence rejects unexpected fields.',
);

deepEqual(
  classifyNayaxRefundResponse({
    stage: 'request',
    httpStatus: 200,
    payload: { Result: ' true ', Status: 'PENDING APPROVAL', ignored: 'discard-me' },
    patterns: contract.requestResponses,
  }),
  {
    stage: 'request',
    outcome: 'accepted',
    httpStatus: 200,
    result: 'true',
    status: 'pending approval',
    contractMatched: true,
    payloadRedacted: true,
  },
  'Only normalized Result and Status values survive classification.',
);
equal(
  classifyNayaxRefundResponse({
    stage: 'request', httpStatus: 200,
    payload: { Result: 'owner@example.test', Status: '4111111111111111' },
    patterns: contract.requestResponses,
  }).contractMatched,
  false,
  'Unmatched provider text is never classified as a contract match.',
);
equal(
  classifyNayaxRefundResponse({
    stage: 'request',
    httpStatus: 200,
    payload: { Result: 'True', Status: 'Unexpected' },
    patterns: contract.requestResponses,
  }).outcome,
  'unknown',
  'An unfamiliar provider response is never treated as success.',
);
equal(
  classifyNayaxRefundResponse({
    stage: 'approve',
    httpStatus: 503,
    payload: { Result: 'True', Status: 'Approved' },
    patterns: contract.approveResponses,
  }).outcome,
  'unknown',
  'A non-success HTTP response is never treated as an approved refund.',
);
throws(
  () => classifyNayaxRefundResponse({
    stage: 'decline',
    httpStatus: 200,
    payload: {},
    patterns: [],
  }),
  /stage must be request or approve/,
  'No unreviewed provider path can be selected.',
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
  requestToken: 'synthetic-request-token',
  approveToken: 'synthetic-approve-token',
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
  onStageEvent: async (stage) => successfulStages.push(stage),
});
check(successfulResult.executed, 'Exact request acceptance plus exact approval is success.');
equal(successfulCalls.length, 2, 'A successful flow makes one request and one approval.');
deepEqual(successfulCalls.map((call) => call.url), [
  'https://qa-lynx.nayax.com/operational/v1/payment/refund-request',
  'https://qa-lynx.nayax.com/operational/v1/payment/refund-approve',
], 'Only the two reviewed endpoints are called, in order.');
equal(successfulCalls[0].options.headers.Authorization, 'Bearer synthetic-request-token', 'Request write credential is exact.');
equal(successfulCalls[1].options.headers.Authorization, 'Bearer synthetic-approve-token', 'Approval uses its dedicated write credential.');
equal(successfulCalls[0].options.redirect, 'error', 'Redirects are rejected to protect the credential.');
equal(JSON.parse(successfulCalls[1].options.body).IsRefundedExternally, false, 'Approval preserves the provider-execution flag.');
check(!JSON.stringify(successfulStages).includes('discard-me'), 'Raw provider payload fields are discarded.');
deepEqual(
  successfulStages.map(({ stage, event }) => `${stage}_${event}`),
  ['request_started', 'request_result', 'approve_started', 'approve_result'],
  'Durable stage callbacks bracket each provider POST in exact order.',
);

const observedRequestContract = parseNayaxRefundProviderContract({
  ...baseContract,
  contractVersion: 'nayax-qa-observed-request-v1',
  requestAdvanceMode: 'http_2xx',
});
const observedRequestCalls = [];
const observedRequestStages = [];
const observedRequestResult = await executeNayaxRefundProvider({
  contract: observedRequestContract,
  requestToken: 'synthetic-request-token',
  approveToken: 'synthetic-approve-token',
  amountCents: 725,
  transactionId: '123456789',
  siteId: 42,
  machineAuthorizationTime: '2026-07-22T17:30:00Z',
  fetchImpl: async (url) => {
    observedRequestCalls.push(url);
    return observedRequestCalls.length === 1
      ? response({ Result: 'unfamiliar', Status: 'provider wording changed' })
      : response({ Result: 'True', Status: 'Approved' });
  },
  onStageEvent: async (stage) => observedRequestStages.push(stage),
});
check(
  observedRequestResult.executed,
  'An observed HTTP-success request may advance to the separate exact approval.',
);
equal(
  observedRequestResult.request.outcome,
  'unknown',
  'Unfamiliar request wording remains classified as unknown instead of guessed success.',
);
equal(
  observedRequestCalls.length,
  2,
  'HTTP-success request advancement makes exactly one request and one approval.',
);
deepEqual(
  observedRequestStages.map(({ stage, event }) => `${stage}_${event}`),
  ['request_started', 'request_result', 'approve_started', 'approve_result'],
  'Observed HTTP-success request advancement retains the full durable stage journal.',
);

let failedObservedRequestCalls = 0;
const failedObservedRequest = await executeNayaxRefundProvider({
  contract: observedRequestContract,
  requestToken: 'synthetic-request-token',
  approveToken: 'synthetic-approve-token',
  amountCents: 725,
  transactionId: '123456789',
  siteId: 42,
  machineAuthorizationTime: '2026-07-22T17:30:00Z',
  fetchImpl: async () => {
    failedObservedRequestCalls += 1;
    return response({ Result: 'True', Status: 'Unexpected' }, 500);
  },
});
check(!failedObservedRequest.executed, 'A failed request never advances to approval.');
equal(
  failedObservedRequestCalls,
  1,
  'A failed request remains one no-retry provider call.',
);

const approvalOnlyCalls = [];
const approvalOnlyStages = [];
const approvalOnlyResult = await executeNayaxRefundApprovalOnly({
  contract: approvalContract,
  approveToken: 'synthetic-approve-token',
  transactionId: '123456789',
  siteId: 42,
  machineAuthorizationTime: '2026-07-22T17:30:00Z',
  fetchImpl: async (url, options) => {
    approvalOnlyCalls.push({ url, options });
    return response({ Result: 'True', Status: 'Approved' });
  },
  onStageEvent: async (stage) => approvalOnlyStages.push(stage),
});
check(approvalOnlyResult.executed, 'Approval-only recovery accepts only the exact configured success pair.');
equal(approvalOnlyResult.request, null, 'Approval-only recovery cannot contain a request result.');
equal(approvalOnlyCalls.length, 1, 'Approval-only recovery makes exactly one provider call.');
check(
  approvalOnlyCalls[0].url.endsWith('/payment/refund-approve'),
  'Approval-only recovery can call only the reviewed approval endpoint.',
);
check(
  !approvalOnlyCalls[0].url.includes('refund-request'),
  'Approval-only recovery cannot create another refund request.',
);
deepEqual(
  approvalOnlyStages.map(({ stage, event }) => `${stage}_${event}`),
  ['approve_started', 'approve_result'],
  'Approval-only recovery journals only the one approval call.',
);

const stageDigest = await buildRedactedNayaxStageDigest({
  journalSecret: 'synthetic-stage-journal-secret-'.padEnd(64, 'x'),
  attemptId: '76000000-0000-4000-8000-000000000001',
  contractVersion: approvalContract.contractVersion,
  stageEvent: {
    stage: 'request',
    event: 'result',
    result: classifyNayaxRefundResponse({
      stage: 'request',
      httpStatus: 200,
      payload: { Result: 'owner@example.test', Status: '4111111111111111' },
      patterns: contract.requestResponses,
    }),
  },
});
check(/^[a-f0-9]{64}$/u.test(stageDigest), 'Stage evidence is persisted only as an HMAC digest.');
check(!stageDigest.includes('owner@example.test'), 'The stage digest never exposes unmatched response text.');

let callsAfterJournalFailure = 0;
await assert.rejects(
  () => executeNayaxRefundProvider({
    contract,
    requestToken: 'synthetic-request-token',
    approveToken: 'synthetic-approve-token',
    amountCents: 725,
    transactionId: '123456789',
    siteId: 42,
    machineAuthorizationTime: '2026-07-22T17:30:00Z',
    fetchImpl: async () => {
      callsAfterJournalFailure += 1;
      return response({ Result: 'True', Status: 'Pending Approval' });
    },
    onStageEvent: async ({ stage, event }) => {
      if (stage === 'request' && event === 'result') {
        throw new Error('synthetic journal failure');
      }
    },
  }),
  /synthetic journal failure/,
  'A response that cannot be journaled fails closed before approval.',
);
assertionCount += 1;
equal(callsAfterJournalFailure, 1, 'Journal ambiguity never triggers a second provider POST.');

let rawAuthorizationHeader = null;
await postNayaxRefundStep({
  stage: 'request',
  contract: parseNayaxRefundProviderContract({
    ...baseContract,
    contractVersion: 'nayax-qa-raw-auth-v1',
    authorizationMode: 'raw',
  }),
  token: 'raw-synthetic-token',
  body: majorBody,
  fetchImpl: async (_url, options) => {
    rawAuthorizationHeader = options.headers.Authorization;
    return response({ Result: 'True', Status: 'Pending Approval' });
  },
});
equal(rawAuthorizationHeader, 'raw-synthetic-token', 'Raw authorization is used only when the confirmed contract selects it.');

for (const requestFixture of [
  { Result: 'False', Status: 'Rejected' },
  { Result: 'False', Status: 'Duplicate' },
  { Result: 'False', Status: 'Already Refunded' },
  { Result: 'True', Status: 'Unexpected' },
]) {
  let callCount = 0;
  const result = await executeNayaxRefundProvider({
    contract,
    requestToken: 'synthetic-request-token',
    approveToken: 'synthetic-approve-token',
    amountCents: 725,
    transactionId: '123456789',
    siteId: 42,
    machineAuthorizationTime: '2026-07-22T17:30:00Z',
    fetchImpl: async () => {
      callCount += 1;
      return response(requestFixture);
    },
  });
  check(!result.executed, 'A non-accepted request cannot execute a refund.');
  equal(callCount, 1, 'A non-accepted request is not retried and is never followed by approval.');
}

for (const approveFixture of [
  { Result: 'False', Status: 'Rejected' },
  { Result: 'False', Status: 'Duplicate' },
  { Result: 'False', Status: 'Already Refunded' },
  { Result: 'True', Status: 'Pending' },
  { Result: 'True', Status: 'Unexpected' },
]) {
  let callCount = 0;
  const result = await executeNayaxRefundProvider({
    contract,
    requestToken: 'synthetic-request-token',
    approveToken: 'synthetic-approve-token',
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
  check(!result.executed, 'Only the exact configured approval response succeeds.');
  equal(callCount, 2, 'Approval uncertainty is never retried internally.');
}

const networkResult = await postNayaxRefundStep({
  stage: 'request',
  contract,
  token: 'synthetic-test-token',
  body: majorBody,
  fetchImpl: async () => {
    throw new Error('synthetic network failure with secret details');
  },
});
deepEqual(networkResult, {
  stage: 'request',
  outcome: 'unknown',
  httpStatus: null,
  result: null,
  status: null,
  contractMatched: false,
  failureType: 'network',
  payloadRedacted: true,
}, 'Network failures become sanitized unknown outcomes.');

const timeoutResult = await postNayaxRefundStep({
  stage: 'request',
  contract,
  token: 'synthetic-test-token',
  body: majorBody,
  timeoutMs: 1_000,
  fetchImpl: async (_url, options) =>
    await new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('synthetic timeout');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
});
equal(timeoutResult.failureType, 'timeout', 'The bounded transport timeout is distinguishable from network uncertainty.');
equal(timeoutResult.outcome, 'unknown', 'Timeouts are never treated as success.');

await assert.rejects(
  () => postNayaxRefundStep({
    stage: 'request',
    contract,
    token: 'bad\r\ntoken',
    body: majorBody,
    fetchImpl: async () => response({}),
  }),
  /token is missing or invalid/,
  'Credential header injection fails before transport.',
);
assertionCount += 1;

const orchestrationRequest = {
  caseId: frozenEvidence.caseId,
  idempotencyKey: `nayax-refund-${'a'.repeat(64)}`,
  amountCents: frozenEvidence.amountCents,
  currencyCode: 'USD',
};
const adapterCalls = [];
const adapter = createNayaxRefundProviderAdapter({
  contract: baseContract,
  requestToken: 'dedicated-request-write-token',
  approveToken: 'dedicated-approve-write-token',
  evidence: frozenEvidenceInput,
  fetchImpl: async (url) => {
    adapterCalls.push(url);
    return adapterCalls.length === 1
      ? response({ Result: 'True', Status: 'Pending Approval' })
      : response({ Result: 'True', Status: 'Approved' });
  },
});
frozenEvidenceInput.transactionId = '999999999';
const adapterSuccess = await adapter.execute(orchestrationRequest);
equal(adapter.mode, 'live', 'The production adapter is explicitly identified.');
equal(adapter.contractVersion, baseContract.contractVersion, 'The adapter exposes only the sanitized contract version.');
equal(adapterSuccess.kind, 'success', 'The adapter maps exact two-step success into the orchestration contract.');
check(/^nayax-evidence-[a-f0-9]{64}$/u.test(adapterSuccess.providerReference), 'Success returns only an internal redacted correlation digest.');
check(!adapterSuccess.providerReference.includes('123456789'), 'The provider transaction ID is never represented as a provider refund receipt.');
equal(adapterCalls.length, 2, 'One adapter execution makes at most one request and one approval.');

throws(
  () => createNayaxRefundProviderAdapter({
    contract: baseContract,
    requestToken: 'same-write-token',
    approveToken: 'same-write-token',
    evidence: frozenEvidenceInput,
  }),
  /requires separate request and approval write credentials/,
  'A token cannot silently serve both write stages.',
);
const explicitSharedTokenContract = {
  ...baseContract,
  contractVersion: 'nayax-qa-shared-write-v1',
  writeCredentialMode: 'same_token_explicit',
  sameWriteTokenContractConfirmed: true,
};
check(
  createNayaxRefundProviderAdapter({
    contract: explicitSharedTokenContract,
    requestToken: 'explicit-shared-write-token',
    approveToken: 'explicit-shared-write-token',
    evidence: frozenEvidenceInput,
  }).mode === 'live',
  'A shared token is accepted only with the exact written-contract assertion.',
);

for (const changedRequest of [
  { ...orchestrationRequest, caseId: '76000000-0000-4000-8000-000000000002' },
  { ...orchestrationRequest, amountCents: 726 },
  { ...orchestrationRequest, currencyCode: 'EUR' },
  { ...orchestrationRequest, idempotencyKey: 'not-an-idempotency-key' },
]) {
  let transportCalls = 0;
  const boundAdapter = createNayaxRefundProviderAdapter({
    contract: baseContract,
    requestToken: 'dedicated-request-write-token',
    approveToken: 'dedicated-approve-write-token',
    evidence: { ...frozenEvidence, transactionId: '123456789' },
    fetchImpl: async () => {
      transportCalls += 1;
      return response({});
    },
  });
  await assert.rejects(
    () => boundAdapter.execute(changedRequest),
    /frozen orchestration evidence/,
    'Changed case, amount, currency, or idempotency evidence must fail closed.',
  );
  assertionCount += 1;
  equal(transportCalls, 0, 'Evidence mismatch fails before any provider call.');
}

const adapterOutcomeFor = async ({ requestPayload, approvePayload, networkStage = null }) => {
  let calls = 0;
  const candidate = createNayaxRefundProviderAdapter({
    contract: baseContract,
    requestToken: 'dedicated-request-write-token',
    approveToken: 'dedicated-approve-write-token',
    evidence: { ...frozenEvidence, transactionId: '123456789' },
    fetchImpl: async () => {
      calls += 1;
      if (networkStage === calls) throw new Error('synthetic network uncertainty');
      return calls === 1 ? response(requestPayload) : response(approvePayload);
    },
  });
  return { outcome: await candidate.execute(orchestrationRequest), calls };
};

const rejectedRequest = await adapterOutcomeFor({
  requestPayload: { Result: 'False', Status: 'Rejected' },
});
equal(rejectedRequest.outcome.kind, 'rejected', 'Exact request rejection is terminal rejection.');
equal(rejectedRequest.calls, 1, 'Request rejection has exactly one provider call.');

const duplicateRequest = await adapterOutcomeFor({
  requestPayload: { Result: 'False', Status: 'Duplicate' },
});
equal(duplicateRequest.outcome.kind, 'unknown', 'Duplicate requires reconciliation rather than assumed failure or success.');
equal(duplicateRequest.outcome.errorCode, 'provider_duplicate', 'Duplicate has a sanitized explicit code.');

const alreadyRefundedRequest = await adapterOutcomeFor({
  requestPayload: { Result: 'False', Status: 'Already Refunded' },
});
equal(alreadyRefundedRequest.outcome.kind, 'unknown', 'Already-refunded requires reconciliation.');
equal(alreadyRefundedRequest.outcome.errorCode, 'provider_already_refunded', 'Already-refunded has a sanitized explicit code.');

const pendingApproval = await adapterOutcomeFor({
  requestPayload: { Result: 'True', Status: 'Pending Approval' },
  approvePayload: { Result: 'True', Status: 'Pending' },
});
equal(pendingApproval.outcome.kind, 'unknown', 'A pending approval never completes the case.');
equal(pendingApproval.outcome.errorCode, 'provider_approval_pending', 'Pending approval is explicitly reconcilable.');

const networkUnknown = await adapterOutcomeFor({
  requestPayload: { Result: 'True', Status: 'Pending Approval' },
  networkStage: 2,
});
equal(networkUnknown.outcome.kind, 'unknown', 'Network uncertainty after request acceptance is held for reconciliation.');
equal(networkUnknown.outcome.errorCode, 'provider_approve_network_unknown', 'The uncertain stage is retained without raw payloads.');

const handler = fs.readFileSync(
  path.join(repoRoot, 'supabase/functions/nayax-card-refund/index.ts'),
  'utf8',
);
const officialAction = fs.readFileSync(
  path.join(repoRoot, 'supabase/functions/_shared/refund-official-action.ts'),
  'utf8',
);
const gates = fs.readFileSync(
  path.join(repoRoot, 'supabase/functions/_shared/nayax-refund-gates.ts'),
  'utf8',
);
const envExample = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
const capMigration = fs.readFileSync(
  path.join(
    repoRoot,
    'supabase/migrations/202608110020_refund_nayax_provider_caps.sql',
  ),
  'utf8',
).replace(/\r\n/g, '\n');
const pilotMigration = fs.readFileSync(
  path.join(
    repoRoot,
    'supabase/migrations/202608140002_refund_nayax_controlled_owner_pilot.sql',
  ),
  'utf8',
).replace(/\r\n/g, '\n');
const managerSessionMigration = fs.readFileSync(
  path.join(
    repoRoot,
    'supabase/migrations/202608160001_refund_nayax_manager_session_execution.sql',
  ),
  'utf8',
).replace(/\r\n/g, '\n');
const pendingApprovalRecoveryMigration = fs.readFileSync(
  path.join(
    repoRoot,
    'supabase/migrations/20260820041101_refund_nayax_pending_approval_recovery.sql',
  ),
  'utf8',
).replace(/\r\n/g, '\n');
check(capMigration.includes('pg_catalog.pg_advisory_xact_lock'), 'Daily cap checks and reservation share a transaction-scoped advisory lock.');
check(capMigration.includes("attempt.execution_mode = 'request_and_approve'"), 'Only real provider-attempt reservations consume daily caps.');
check(capMigration.includes('current_daily_count + 1 > p_daily_count_cap'), 'The daily count cap is checked before reservation.');
check(capMigration.includes('current_daily_amount_cents + p_amount_cents > p_daily_amount_cap_cents'), 'The daily amount cap is checked before reservation.');
check(
  capMigration.indexOf('if existing_attempt_id is not null then') <
    capMigration.indexOf('current_daily_count + 1 > p_daily_count_cap'),
  'An exact idempotent replay is returned before cap accounting so it cannot consume cap twice.',
);
check(
  capMigration.includes('from service_role;') &&
    capMigration.includes('service_reserve_and_consume_nayax_refund_attempt_v2'),
  'The uncapped reservation entry point is revoked from service callers.',
);
check(
  handler.includes('NAYAX_REFUND_MANAGER_CONTRACT_JSON') &&
    handler.includes('DEFAULT_NAYAX_MANAGER_CONTRACT') &&
    handler.includes('requestAdvanceMode: "http_2xx"') &&
    handler.includes('NAYAX_LYNX_API_TOKEN_${normalAccountKey}') &&
    handler.includes('provider,') &&
    handler.includes('service_reserve_nayax_refund_manager_action') &&
    handler.includes('service_record_nayax_refund_provider_stage') &&
    !handler.includes('...(!rawManagerContract ? ["provider_contract_missing"] : [])') &&
    !handler.includes('provider: disabledNayaxProviderAdapter'),
  'The normal manager action has a reviewed pilot-derived default, permits a reviewed override, and journals every stage after server-side gates.',
);
check(
  handler.includes('executeNayaxRefundApprovalOnly') &&
    handler.includes('service_reserve_nayax_pending_approval_recovery') &&
    handler.includes('service_settle_nayax_pending_approval_recovery') &&
    pendingApprovalRecoveryMigration.includes("provider_status is distinct from 'request_unknown_contract_mismatch'") &&
    pendingApprovalRecoveryMigration.includes("journal.stage = 'approve'") &&
    pendingApprovalRecoveryMigration.includes('nayax_refund_attempt_id uuid not null unique') &&
    !pendingApprovalRecoveryMigration.includes('/payment/refund-request'),
  'The single-use pending-request recovery is approval-only and rejects any attempt with an approval-start marker.',
);
check(
  pendingApprovalRecoveryMigration.includes('classification_digest') &&
    pendingApprovalRecoveryMigration.includes('payload_redacted boolean not null default true') &&
    pendingApprovalRecoveryMigration.includes('guard_refund_nayax_provider_stage_immutable') &&
    handler.includes('buildRedactedNayaxStageDigest'),
  'Normal and recovery provider stages retain only immutable keyed redacted evidence.',
);
check(
  managerSessionMigration.includes('authorization_method') &&
    managerSessionMigration.includes("'manager_session'") &&
    managerSessionMigration.includes('public.can_perform_refund_official_action') &&
    managerSessionMigration.includes('public.service_reserve_and_consume_nayax_refund_attempt_v2') &&
    !managerSessionMigration.includes('/payment/refund-request') &&
    !managerSessionMigration.includes('/payment/refund-approve'),
  'The manager-session bridge reuses mapped-manager authority and the existing atomic reservation without making provider calls in SQL.',
);
check(
  handler.includes('machine.nayax_refunds_enabled !== true') &&
    handler.includes('machine.nayax_refund_max_amount_cents !== amountCents') &&
    handler.includes('service_validate_nayax_controlled_pilot_postarm') &&
    handler.indexOf('service_validate_nayax_controlled_pilot_postarm') <
      handler.indexOf('authorizeRefundOfficialAction({') &&
    pilotMigration.includes(
      'machine.nayax_refunds_enabled is distinct from true',
    ) &&
    pilotMigration.includes(
      'machine.nayax_refund_max_amount_cents is distinct from pilot.amount_cents',
    ),
  'The pilot requires its exact authorization-bound post-arm machine and cap before TOTP.',
);
check(
  officialAction.includes('admin_consume_refund_nayax_controlled_pilot_intent') &&
    pilotMigration.includes(
      'reservation := public.service_reserve_and_consume_nayax_controlled_pilot_attempt(',
    ) &&
    !handler.includes('service_reserve_and_consume_nayax_controlled_pilot_attempt') &&
    handler.includes('service_record_nayax_controlled_pilot_stage') &&
    handler.includes('service_settle_nayax_controlled_pilot_attempt'),
  'The custom TOTP RPC atomically reserves; Edge has no separate reservation gap.',
);
check(
  pilotMigration.includes("'request_started', 'request_result', 'approve_started', 'approve_result'") &&
    pilotMigration.includes('one exact owner pilot'),
  'Migration 52 preserves one immutable four-stage provider journal.',
);
check(
  gates.includes('NAYAX_REFUND_EXECUTOR_ASSERTION') &&
    gates.includes('NAYAX_REFUND_IDEMPOTENCY_SECRET') &&
    !handler.includes('supabaseServiceRoleKey || "local-dev"'),
  'Function identity and idempotency require dedicated secrets without broad-key fallbacks.',
);
check(/^NAYAX_REFUND_EXECUTION_ENABLED=false$/m.test(envExample), 'Execution defaults to disabled.');
check(/^NAYAX_REFUND_EXECUTION_DRY_RUN=true$/m.test(envExample), 'Dry-run defaults to enabled.');
check(/^NAYAX_REFUND_EXECUTION_KILL_SWITCH=true$/m.test(envExample), 'The kill switch defaults to active.');
check(/^NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED=false$/m.test(envExample), 'Provider-contract confirmation defaults to false.');
check(/^NAYAX_REFUND_MANAGER_CONTRACT_JSON=$/m.test(envExample), 'The manager response contract defaults to unset.');
check(/^NAYAX_REFUND_PENDING_APPROVAL_RECOVERY_ENABLED=false$/m.test(envExample), 'Pending-request recovery defaults to disabled.');
check(/^NAYAX_REFUND_PENDING_APPROVAL_CONTRACT_JSON=$/m.test(envExample), 'The approval-only contract defaults to unset.');
check(/^NAYAX_REFUND_CONTROLLED_PILOT_CONTRACT_JSON=$/m.test(envExample), 'The exact provider contract defaults to unset.');
check(/^NAYAX_REFUND_REQUEST_WRITE_TOKEN_ACCOUNT_KEY=$/m.test(envExample), 'The dedicated request write credential defaults to unset.');
check(/^NAYAX_REFUND_APPROVE_WRITE_TOKEN_ACCOUNT_KEY=$/m.test(envExample), 'The dedicated approval write credential defaults to unset.');
check(/^NAYAX_REFUND_CONTROLLED_PILOT_RUNNER_ASSERTION=$/m.test(envExample), 'The runner-only assertion defaults to unset.');
check(/^NAYAX_REFUND_EXECUTOR_ASSERTION=$/m.test(envExample), 'The function-scoped executor assertion defaults to unset.');

console.log(`Nayax refund provider adapter validated (${assertionCount} assertions).`);
