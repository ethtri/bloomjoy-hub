#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  areNayaxRefundWriteCredentialsReady,
  buildNayaxRefundApprovalBody,
  buildRedactedNayaxStageDigest,
  buildNayaxRefundRequestBody,
  classifyNayaxRefundResponse,
  createNayaxRefundProviderAdapter as createNayaxRefundProviderAdapterRaw,
  executeNayaxRefundApprovalContinuation,
  executeNayaxRefundApprovalOnly,
  executeNayaxRefundProvider as executeNayaxRefundProviderRaw,
  freezeNayaxRefundEvidence,
  mapNayaxRefundExecutionOutcome,
  NAYAX_REFUND_PRODUCTION_BASE_URL,
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

// Unit tests supply a deterministic stand-in for the database-owned decision.
// The pgTAP suite independently exercises the real migrated state machine.
const simulatedDatabaseStageDecision = async (stageEvent) => ({
  approvalAuthorized:
    stageEvent.stage === 'request' &&
    stageEvent.event === 'result' &&
    !stageEvent.result.failureType &&
    stageEvent.result.httpAccepted === true &&
    stageEvent.result.mediaTypeClass === 'application_json' &&
    stageEvent.result.jsonParsed === true &&
    stageEvent.result.jsonObject === true &&
    stageEvent.result.schemaMatched === true &&
    stageEvent.result.semanticPairMatched === true &&
    stageEvent.result.outcome === 'accepted' &&
    stageEvent.result.contractMatched === true,
  journalContractVersion: 'nayax-provider-journal-v3',
  payloadRedacted: true,
});

const executeNayaxRefundProvider = (input) => {
  const suppliedStageCallback = input.onStageEvent;
  return executeNayaxRefundProviderRaw({
    ...input,
    onStageEvent: async (stageEvent) => {
      const suppliedDecision = await suppliedStageCallback?.(stageEvent);
      return suppliedDecision && typeof suppliedDecision === 'object'
        ? suppliedDecision
        : simulatedDatabaseStageDecision(stageEvent);
    },
  });
};

const createNayaxRefundProviderAdapter = (input) => {
  const suppliedStageCallback = input.onStageEvent;
  return createNayaxRefundProviderAdapterRaw({
    ...input,
    onStageEvent: async (stageEvent) => {
      const suppliedDecision = await suppliedStageCallback?.(stageEvent);
      return suppliedDecision && typeof suppliedDecision === 'object'
        ? suppliedDecision
        : simulatedDatabaseStageDecision(stageEvent);
    },
  });
};

const throws = (fn, expected, message) => {
  assertionCount += 1;
  assert.throws(fn, expected, message);
};

const baseContract = {
  schemaVersion: 2,
  contractVersion: 'nayax-production-account-contract-v2',
  baseUrl: 'https://qa-lynx.nayax.com/operational/v1',
  authorizationMode: 'bearer',
  amountUnit: 'major',
  amountRoundingMode: 'exact_cent',
  refundEmailListMode: 'omit',
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
  schemaVersion: 2,
  contractVersion: 'nayax-production-account-contract-v2',
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
throws(
  () => parseNayaxRefundApprovalContract({
    ...approvalContract,
    schemaVersion: 1,
  }),
  /schemaVersion must be 2/,
  'Approval-only recovery rejects stale schemaVersion 1.',
);
throws(
  () => parseNayaxRefundApprovalContract({
    ...approvalContract,
    authorizationMode: 'raw',
  }),
  /must be bearer/,
  'Approval-only recovery rejects raw authorization.',
);

check(Object.isFrozen(contract), 'The confirmed provider contract must be immutable.');
check(Object.isFrozen(contract.requestResponses), 'Request patterns must be immutable.');
check(Object.isFrozen(contract.requestResponses[0]), 'Individual response patterns must be immutable.');
equal(contract.baseUrl, baseContract.baseUrl, 'The exact approved QA path is preserved.');
equal(
  NAYAX_REFUND_PRODUCTION_BASE_URL,
  'https://lynx.nayax.com/operational/v1',
  'The production runtime host is a single exact constant.',
);
check(
  areNayaxRefundWriteCredentialsReady({
    contract,
    requestToken: 'request-write-token',
    approveToken: 'approve-write-token',
  }),
  'A valid separate credential pair is ready.',
);
check(
  !areNayaxRefundWriteCredentialsReady({
    contract,
    requestToken: 'same-write-token',
    approveToken: 'same-write-token',
  }),
  'A separate-mode contract rejects identical credentials during readiness.',
);
check(
  !areNayaxRefundWriteCredentialsReady({
    contract,
    requestToken: 'short',
    approveToken: 'approve-write-token',
  }),
  'Malformed credentials fail readiness before adapter construction.',
);
check(
  areNayaxRefundWriteCredentialsReady({
    contract: {
      ...baseContract,
      writeCredentialMode: 'same_token_explicit',
      sameWriteTokenContractConfirmed: true,
    },
    requestToken: 'shared-write-token',
    approveToken: 'shared-write-token',
  }),
  'An explicitly confirmed same-token contract accepts one shared credential.',
);

for (const [mutate, pattern, message] of [
  [(value) => ({ ...value, extra: true }), /unsupported field/, 'Unknown contract fields fail closed.'],
  [(value) => ({ ...value, schemaVersion: 1 }), /schemaVersion/, 'Stale schemaVersion 1 contracts fail closed.'],
  [(value) => ({ ...value, authorizationMode: 'raw' }), /must be bearer/, 'Raw authorization fails closed.'],
  [(value) => ({ ...value, authorizationMode: 'guess' }), /authorizationMode/, 'Authorization mode must be explicit.'],
  [(value) => ({ ...value, amountUnit: 'guess' }), /amountUnit/, 'Amount units must be explicit.'],
  [(value) => ({ ...value, amountRoundingMode: 'guess' }), /amountRoundingMode/, 'Amount rounding must be exact.'],
  [(value) => ({ ...value, refundEmailListMode: 'guess' }), /refundEmailListMode/, 'Refund email ownership must be explicit.'],
  [(value) => ({ ...value, providerEmailBehavior: 'recipient_omitted' }), /unsupported field/, 'Dead provider email assertions fail closed.'],
  [(value) => ({ ...value, writeCredentialMode: 'guess' }), /writeCredentialMode/, 'Write credential ownership must be explicit.'],
  [(value) => ({ ...value, reconciliationMode: 'guess' }), /reconciliationMode/, 'Reconciliation ownership must be explicit.'],
  [(value) => ({ ...value, requestAdvanceMode: 'http_2xx' }), /unsupported field/, 'HTTP-only request advancement cannot be configured.'],
  [(value) => ({ ...value, responseLearningMode: 'approve_unknown' }), /inspect_unknown/, 'Learning mode cannot authorize unfamiliar responses.'],
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
      { result: 'True', status: 'Pending Approval', outcome: 'accepted' },
    ],
  }), /duplicate match/, 'Exact duplicate patterns are rejected.'],
  [(value) => ({
    ...value,
    requestResponses: [
      { result: ' True ', status: 'Pending Approval', outcome: 'accepted' },
    ],
  }), /exact Result and Status pair/, 'Contract literals cannot hide whitespace normalization.'],
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

// Learning keeps business outcome rules explicit; HTTP or familiar-looking
// words cannot fill a missing response rule. All credentials/data here are synthetic.
const learningContract = parseNayaxRefundProviderContract({ ...baseContract,
  responseLearningMode: 'inspect_unknown', requestResponses: [], approveResponses: [] });
equal(parseNayaxRefundProviderContract(learningContract).responseLearningMode, 'inspect_unknown', 'Explicit learning mode survives adapter reparsing.');
for (const httpStatus of [200, 500]) {
  const calls = [];
  const events = [];
  const learningResult = await executeNayaxRefundProvider({ contract: learningContract,
    requestToken: 'synthetic-request-token', approveToken: 'synthetic-approve-token', amountCents: 800,
    transactionId: '723456781', siteId: 6, machineAuthorizationTime: '2026-08-26T13:17:08.123',
    fetchImpl: async (url) => { calls.push(url); return new Response(JSON.stringify({ Result: 'True', Status: 'Pending Approval' }),
      { status: httpStatus, headers: { 'content-type': 'application/json' } }); },
    onStageEvent: async (event) => { events.push(event); },
  });
  equal(calls.length, 1, `Unlearned HTTP ${httpStatus} permits one request and no approval/retry.`);
  equal(learningResult.request.outcome, 'unknown', 'Missing response rule stays unknown.');
  equal(learningResult.approve, null, 'Unknown request never proceeds to approval.');
  equal(learningResult.executed, false, 'Unknown response cannot report completion.');
  deepEqual(events.map(({ stage, event }) => `${stage}:${event}`), ['request:started', 'request:result'], 'Unknown request retains its journal evidence.');
}
const partiallyLearned = parseNayaxRefundProviderContract({ ...learningContract,
  requestResponses: [{ result: 'True', status: 'Pending Approval', outcome: 'accepted' }] });
const learnedCalls = [];
const unknownApproval = await executeNayaxRefundProvider({ contract: partiallyLearned,
  requestToken: 'synthetic-request-token', approveToken: 'synthetic-approve-token', amountCents: 800,
  transactionId: '723456781', siteId: 6, machineAuthorizationTime: '2026-08-26T13:17:08.123',
  fetchImpl: async (url, options) => { learnedCalls.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ Result: 'True', Status: 'Pending Approval' }), { status: 200, headers: { 'content-type': 'application/json' } }); },
});
equal(learnedCalls.length, 2, 'An exact learned request result permits only its single journal-authorized approval.');
equal(unknownApproval.approve.outcome, 'unknown', 'An unlearned approval result remains held.');
equal(unknownApproval.executed, false, 'Unknown approval cannot claim completion.');
equal(learnedCalls[0].body.MachineAuTime, learnedCalls[1].body.MachineAuTime, 'Learning cannot change the approved transaction time.');

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
  contractVersion: 'nayax-production-account-contract-v2-minor',
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
  { transactionId: '123', siteId: 42, machineAuthorizationTime: '2026-02-30T17:30:00' },
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
    payload: { Result: 'True', Status: 'Pending Approval', ignored: 'discard-me' },
    patterns: contract.requestResponses,
  }),
  {
    stage: 'request',
    outcome: 'accepted',
    httpStatus: 200,
    httpAccepted: true,
    mediaTypeClass: 'application_json',
    bodyKind: 'json_object',
    bodyLengthBucket: '1_256',
    jsonParsed: true,
    jsonObject: true,
    resultKeyPresent: true,
    statusKeyPresent: true,
    resultValueType: 'string',
    statusValueType: 'string',
    schemaMatched: true,
    semanticPairMatched: true,
    contractMatched: true,
    businessResult: 'True',
    businessStatus: 'Pending Approval',
    businessPairRetained: true,
    payloadRedacted: true,
  },
  'An exact HTTP 200 application/json object retains only the bounded business pair.',
);
const redactedClassification = classifyNayaxRefundResponse({
  stage: 'request',
  httpStatus: 200,
  payload: { Result: 'owner@example.test', Status: 'customer-4242' },
  patterns: contract.requestResponses,
});
check(
  redactedClassification.businessResult === null &&
    redactedClassification.businessStatus === null &&
    redactedClassification.businessPairRetained === false,
  'Identifier-like Result or Status values are never retained.',
);
check(
  !JSON.stringify(redactedClassification).includes('owner@example.test') &&
    !JSON.stringify(redactedClassification).includes('customer-4242'),
  'Unmatched provider text cannot enter a stage result or log payload.',
);
equal(
  redactedClassification.contractMatched,
  false,
  'Unmatched provider text is never classified as a contract match.',
);
equal(
  classifyNayaxRefundResponse({
    stage: 'request',
    httpStatus: 200,
    payload: { Result: 'true', Status: 'PENDING APPROVAL' },
    patterns: contract.requestResponses,
  }).semanticPairMatched,
  false,
  'Response pairs are matched exactly without case normalization.',
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
  }).semanticPairMatched,
  true,
  'Semantic pair evidence remains distinguishable from HTTP acceptance.',
);
equal(
  classifyNayaxRefundResponse({
    stage: 'approve',
    httpStatus: 503,
    payload: { Result: 'True', Status: 'Approved' },
    patterns: contract.approveResponses,
  }).contractMatched,
  false,
  'A non-200 response never matches the complete refund contract.',
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

const rawResponse = (body, {
  status = 200,
  contentType = 'application/json',
} = {}) => new Response(body, {
  status,
  headers: contentType === null ? {} : { 'Content-Type': contentType },
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

const continuationCalls = [];
const continuationStages = [];
const continuationResult = await executeNayaxRefundApprovalContinuation({
  contract,
  approveToken: 'synthetic-approve-token',
  transactionId: '123456789',
  siteId: 42,
  machineAuthorizationTime: '2026-07-22T17:30:00Z',
  fetchImpl: async (url, options) => {
    continuationCalls.push({ url, options });
    return response({ Result: 'True', Status: 'Approved' });
  },
  onStageEvent: async (stage) => continuationStages.push(stage),
});
check(continuationResult.executed, 'Current-contract continuation accepts the exact configured approval success pair.');
equal(continuationCalls.length, 1, 'Continuation makes exactly one provider call.');
check(
  continuationCalls[0].url.endsWith('/payment/refund-approve') &&
    !continuationCalls[0].url.includes('refund-request'),
  'Continuation cannot create a second request.',
);
deepEqual(
  continuationStages.map(({ stage, event }) => `${stage}_${event}`),
  ['approve_started', 'approve_result'],
  'Continuation brackets only the approval call in the current journal.',
);

let noDatabaseDecisionCalls = 0;
const noDatabaseDecisionResult = await executeNayaxRefundProviderRaw({
  contract,
  requestToken: 'synthetic-request-token',
  approveToken: 'synthetic-approve-token',
  amountCents: 725,
  transactionId: '123456789',
  siteId: 42,
  machineAuthorizationTime: '2026-07-22T17:30:00Z',
  fetchImpl: async () => {
    noDatabaseDecisionCalls += 1;
    return response({ Result: 'True', Status: 'Pending Approval' });
  },
});
check(!noDatabaseDecisionResult.executed, 'Missing database authorization fails closed.');
equal(noDatabaseDecisionCalls, 1, 'Missing database authorization cannot call approval.');

let databaseDenialCalls = 0;
const databaseDenialResult = await executeNayaxRefundProviderRaw({
  contract,
  requestToken: 'synthetic-request-token',
  approveToken: 'synthetic-approve-token',
  amountCents: 725,
  transactionId: '123456789',
  siteId: 42,
  machineAuthorizationTime: '2026-07-22T17:30:00Z',
  fetchImpl: async () => {
    databaseDenialCalls += 1;
    return response({ Result: 'True', Status: 'Pending Approval' });
  },
  onStageEvent: async () => ({ approvalAuthorized: false, payloadRedacted: true }),
});
check(!databaseDenialResult.executed, 'The database can deny approval even after exact request acceptance.');
equal(databaseDenialCalls, 1, 'Database denial stops before the approval endpoint.');

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
      payload: { Result: 'owner@example.test', Status: 'customer-4242' },
      patterns: contract.requestResponses,
    }),
  },
});
check(/^[a-f0-9]{64}$/u.test(stageDigest), 'Stage evidence is persisted only as an HMAC digest.');
check(!stageDigest.includes('owner@example.test'), 'The stage digest never exposes unmatched response text.');
const digestWithIgnoredRawValues = await buildRedactedNayaxStageDigest({
  journalSecret: 'synthetic-stage-journal-secret-'.padEnd(64, 'x'),
  attemptId: '76000000-0000-4000-8000-000000000001',
  contractVersion: approvalContract.contractVersion,
  stageEvent: {
    stage: 'request',
    event: 'result',
    result: {
      ...classifyNayaxRefundResponse({
        stage: 'request',
        httpStatus: 200,
        payload: { Result: 'owner@example.test', Status: 'customer-4242' },
        patterns: contract.requestResponses,
      }),
      result: 'raw-value-that-must-not-be-bound',
      status: 'raw-status-that-must-not-be-bound',
    },
  },
});
equal(
  digestWithIgnoredRawValues,
  stageDigest,
  'The stage HMAC binds only safe categorical metadata, never raw provider values.',
);
const digestWithChangedSchemaEvidence = await buildRedactedNayaxStageDigest({
  journalSecret: 'synthetic-stage-journal-secret-'.padEnd(64, 'x'),
  attemptId: '76000000-0000-4000-8000-000000000001',
  contractVersion: approvalContract.contractVersion,
  stageEvent: {
    stage: 'request',
    event: 'result',
    result: {
      ...classifyNayaxRefundResponse({
        stage: 'request',
        httpStatus: 200,
        payload: { Result: 'owner@example.test', Status: 'customer-4242' },
        patterns: contract.requestResponses,
      }),
      schemaMatched: false,
    },
  },
});
check(
  digestWithChangedSchemaEvidence !== stageDigest,
  'The stage HMAC changes when safe schema evidence changes.',
);

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

let nonBearerTransportCalls = 0;
await assert.rejects(
  () => postNayaxRefundStep({
    stage: 'request',
    contract: { ...contract, authorizationMode: 'raw' },
    token: 'raw-synthetic-token',
    body: majorBody,
    fetchImpl: async () => {
      nonBearerTransportCalls += 1;
      return response({ Result: 'True', Status: 'Pending Approval' });
    },
  }),
  /schemaVersion 2 Bearer contract/,
  'The transport independently rejects a non-Bearer contract.',
);
assertionCount += 1;
equal(nonBearerTransportCalls, 0, 'Non-Bearer configuration fails before transport.');

for (const requestFixture of [
  { Result: 'False', Status: 'Rejected' },
  { Result: 'False', Status: 'Duplicate' },
  { Result: 'False', Status: 'Already Refunded' },
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

let unfamiliarRequestCallCount = 0;
const unfamiliarRequestResult = await executeNayaxRefundProvider({
  contract,
  requestToken: 'synthetic-request-token',
  approveToken: 'synthetic-approve-token',
  amountCents: 725,
  transactionId: '123456789',
  siteId: 42,
  machineAuthorizationTime: '2026-07-22T17:30:00Z',
  fetchImpl: async () => {
    unfamiliarRequestCallCount += 1;
    return unfamiliarRequestCallCount === 1
      ? response({ Result: 'True', Status: 'Unexpected' })
      : response({ Result: 'True', Status: 'Approved' });
  },
});
check(
  !unfamiliarRequestResult.executed,
  'An unfamiliar HTTP 200 response cannot advance to approval.',
);
equal(
  unfamiliarRequestCallCount,
  1,
  'The unfamiliar HTTP 200 request is held after one call and never retried.',
);

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

const exactJsonResult = await postNayaxRefundStep({
  stage: 'request',
  contract,
  token: 'synthetic-test-token',
  body: majorBody,
  fetchImpl: async () => rawResponse(
    JSON.stringify({ Result: 'True', Status: 'Pending Approval' }),
    { contentType: 'application/json; charset=utf-8' },
  ),
});
check(exactJsonResult.contractMatched, 'application/json parameters preserve the exact contract match.');
equal(exactJsonResult.mediaTypeClass, 'application_json', 'application/json parameters use the safe JSON media class.');

const suffixJsonResult = await postNayaxRefundStep({
  stage: 'request',
  contract,
  token: 'synthetic-test-token',
  body: majorBody,
  fetchImpl: async () => rawResponse(
    JSON.stringify({ Result: 'True', Status: 'Pending Approval' }),
    { contentType: 'application/problem+json' },
  ),
});
equal(suffixJsonResult.mediaTypeClass, 'json_suffix', 'JSON suffix media types are classified without being accepted.');
check(suffixJsonResult.semanticPairMatched, 'A suffix response can preserve exact semantic-pair evidence.');
check(!suffixJsonResult.contractMatched, 'Only documented application/json can match the complete contract.');
equal(suffixJsonResult.outcome, 'unknown', 'A suffix media type cannot produce an accepted request outcome.');

const non200ExactResult = await postNayaxRefundStep({
  stage: 'request',
  contract,
  token: 'synthetic-test-token',
  body: majorBody,
  fetchImpl: async () => rawResponse(
    JSON.stringify({ Result: 'True', Status: 'Pending Approval' }),
    { status: 201 },
  ),
});
equal(non200ExactResult.httpStatus, 201, 'A non-200 status is retained as safe evidence.');
check(!non200ExactResult.httpAccepted, 'Only exact HTTP 200 is accepted.');
check(non200ExactResult.semanticPairMatched, 'Semantic evidence is independent from HTTP acceptance.');
check(!non200ExactResult.contractMatched, 'HTTP 201 cannot match the complete contract.');

const schemaMismatchResult = await postNayaxRefundStep({
  stage: 'request',
  contract,
  token: 'synthetic-test-token',
  body: majorBody,
  fetchImpl: async () => response({ Result: true, Status: 'Pending Approval' }),
});
check(schemaMismatchResult.jsonObject, 'A parsed JSON object is distinguished from its schema.');
equal(schemaMismatchResult.resultValueType, 'boolean', 'Result value type is retained only as a safe category.');
equal(schemaMismatchResult.statusValueType, 'string', 'Status value type is retained only as a safe category.');
check(!schemaMismatchResult.schemaMatched, 'Non-string Result values fail the response schema.');
check(!schemaMismatchResult.semanticPairMatched, 'Schema-invalid values cannot match a semantic pair.');

const nonObjectResult = await postNayaxRefundStep({
  stage: 'request',
  contract,
  token: 'synthetic-test-token',
  body: majorBody,
  fetchImpl: async () => response(['True', 'Pending Approval']),
});
check(nonObjectResult.jsonParsed, 'A JSON array is recognized as parsed JSON.');
check(!nonObjectResult.jsonObject, 'A JSON array cannot satisfy the object contract.');
equal(nonObjectResult.bodyKind, 'json_non_object', 'Non-object JSON has a fixed body category.');

const malformedJsonResult = await postNayaxRefundStep({
  stage: 'request',
  contract,
  token: 'synthetic-test-token',
  body: majorBody,
  fetchImpl: async () => rawResponse('{not-json'),
});
equal(malformedJsonResult.bodyKind, 'malformed_json', 'Malformed application/json is distinguishable without retaining its body.');
check(!malformedJsonResult.jsonParsed, 'Malformed JSON cannot be marked parsed.');

const htmlResult = await postNayaxRefundStep({
  stage: 'approve',
  contract,
  token: 'synthetic-test-token',
  body: majorBody,
  fetchImpl: async () => rawResponse('<html>synthetic gateway failure</html>', {
    status: 500,
    contentType: 'text/html; charset=utf-8',
  }),
});
equal(htmlResult.httpStatus, 500, 'An HTML response preserves only its safe HTTP status.');
equal(htmlResult.mediaTypeClass, 'html', 'HTML media is classified without retaining content.');
equal(htmlResult.bodyKind, 'html', 'HTML content uses a fixed body category.');
check(!JSON.stringify(htmlResult).includes('synthetic gateway failure'), 'HTML response text is never returned or logged by the adapter.');

const oversizeResult = await postNayaxRefundStep({
  stage: 'request',
  contract,
  token: 'synthetic-test-token',
  body: majorBody,
  fetchImpl: async () => rawResponse('x'.repeat(16_385)),
});
equal(oversizeResult.bodyKind, 'oversize', 'Oversize responses are not parsed.');
equal(oversizeResult.bodyLengthBucket, 'over_16384', 'Only a bounded length category survives.');

const responseReadResult = await postNayaxRefundStep({
  stage: 'approve',
  contract,
  token: 'synthetic-test-token',
  body: majorBody,
  fetchImpl: async () => ({
    status: 200,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    text: async () => {
      throw new Error('synthetic body read failure with private response details');
    },
  }),
});
equal(responseReadResult.httpStatus, 200, 'A body-read failure preserves the received HTTP status.');
check(responseReadResult.httpAccepted, 'HTTP acceptance remains separate from body-read success.');
equal(responseReadResult.failureType, 'response_read', 'Body-read failures have a fixed safe failure type.');
equal(responseReadResult.bodyKind, 'read_error', 'Body-read failures have a fixed body category.');
check(!responseReadResult.contractMatched, 'A body-read failure can never match the complete contract.');
check(!JSON.stringify(responseReadResult).includes('private response details'), 'Read errors cannot leak exception text.');

const errorCodeFor = async (stageResult) => (await mapNayaxRefundExecutionOutcome(
  { request: stageResult, approve: null, executed: false },
  contract.contractVersion,
  `nayax-refund-${'b'.repeat(64)}`,
)).errorCode;
equal(await errorCodeFor(responseReadResult), 'provider_approve_response_read_unknown', 'Response-read uncertainty has a fixed safe code.');
equal(await errorCodeFor(non200ExactResult), 'provider_request_http_error_unknown', 'HTTP failure uses a fixed code without status interpolation.');
equal(await errorCodeFor(suffixJsonResult), 'provider_request_media_type_invalid', 'Invalid media uses a fixed safe code.');
equal(await errorCodeFor(nonObjectResult), 'provider_request_response_invalid', 'Invalid JSON shape uses a fixed safe code.');
equal(await errorCodeFor(schemaMismatchResult), 'provider_request_schema_mismatch', 'Schema mismatch uses a fixed safe code.');
equal(
  await errorCodeFor(classifyNayaxRefundResponse({
    stage: 'request',
    httpStatus: 200,
    payload: { Result: 'True', Status: 'Unexpected' },
    patterns: contract.requestResponses,
  })),
  'provider_request_semantic_mismatch',
  'An exact-schema unfamiliar pair uses a fixed semantic-mismatch code.',
);

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
  httpAccepted: false,
  mediaTypeClass: 'unavailable',
  bodyKind: 'unavailable',
  bodyLengthBucket: 'unavailable',
  jsonParsed: false,
  jsonObject: false,
  resultKeyPresent: false,
  statusKeyPresent: false,
  resultValueType: 'unavailable',
  statusValueType: 'unavailable',
  schemaMatched: false,
  semanticPairMatched: false,
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

const continuationAdapterCalls = [];
const continuationAdapter = createNayaxRefundProviderAdapter({
  contract: baseContract,
  requestToken: 'dedicated-request-write-token',
  approveToken: 'dedicated-approve-write-token',
  evidence: { ...frozenEvidence, transactionId: '123456789' },
  fetchImpl: async (url) => {
    continuationAdapterCalls.push(url);
    return response({ Result: 'True', Status: 'Approved' });
  },
});
const continuationAdapterOutcome = await continuationAdapter.execute(
  orchestrationRequest,
  'approval_continuation',
);
equal(continuationAdapterOutcome.kind, 'success', 'Adapter maps same-attempt approval continuation through the current contract.');
equal(continuationAdapterCalls.length, 1, 'Continuation adapter performs only one approval POST.');
check(!continuationAdapterCalls[0].includes('refund-request'), 'Continuation adapter never reaches the request endpoint.');

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
  contractVersion: 'nayax-production-account-contract-v2-shared',
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
const refundOperations = fs.readFileSync(
  path.join(repoRoot, 'src/lib/refundOperations.ts'),
  'utf8',
);
const refundsUi = fs.readFileSync(
  path.join(repoRoot, 'src/pages/admin/Refunds.tsx'),
  'utf8',
);
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
const authoritativeJournalMigration = fs.readFileSync(
  path.join(
    repoRoot,
    'supabase/migrations/20260825041548_refund_nayax_authoritative_journal_v2.sql',
  ),
  'utf8',
).replace(/\r\n/g, '\n');
const authoritativeJournalV3Migration = fs.readFileSync(
  path.join(
    repoRoot,
    'supabase/migrations/20260828003503_refund_nayax_authoritative_journal_v3.sql',
  ),
  'utf8',
).replace(/\r\n/g, '\n');
const productionSimplificationMigration = fs.readFileSync(
  path.join(
    repoRoot,
    'supabase/migrations/20260830202234_refund_production_simplification.sql',
  ),
  'utf8',
).replace(/\r\n/g, '\n');
check(capMigration.includes('pg_catalog.pg_advisory_xact_lock'), 'The retired cap implementation remains preserved as migration history.');
check(
  capMigration.indexOf('if existing_attempt_id is not null then') <
    capMigration.indexOf('current_daily_count + 1 > p_daily_count_cap'),
  'Historical cap handling returned an exact replay before its old accounting path.',
);
check(
  productionSimplificationMigration.includes('service_reserve_and_consume_nayax_refund_attempt(') &&
    productionSimplificationMigration.includes("update public.reporting_machines\nset nayax_refund_max_amount_cents = null") &&
    productionSimplificationMigration.includes("function_definition := replace(\n    function_definition,\n    daily_cap_call_anchor,\n    cap_free_call"),
  'Production uses the original atomic reservation without rollout amount or daily-volume caps.',
);
check(
  handler.includes('NAYAX_REFUND_MANAGER_CONTRACT_JSON') &&
    !handler.includes('DEFAULT_NAYAX_MANAGER_CONTRACT') &&
    handler.includes('NAYAX_REFUND_REQUEST_WRITE_TOKEN_${accountKey}') &&
    handler.includes('NAYAX_REFUND_APPROVE_WRITE_TOKEN_${accountKey}') &&
    !handler.includes('NAYAX_LYNX_API_TOKEN_${normalAccountKey}') &&
    handler.includes('provider,') &&
    handler.includes('service_reserve_nayax_refund_manager_action_v3') &&
    handler.includes('service_record_nayax_refund_provider_stage_v3') &&
    handler.includes('service_get_nayax_refund_provider_journal_capability_v3') &&
    handler.includes('p_media_type_class:') &&
    handler.includes('p_body_kind:') &&
    handler.includes('p_semantic_pair_matched:') &&
    handler.includes('db-authoritative-exact-200-json-v1') &&
    handler.includes('nayax-response-envelope-v1') &&
    handler.includes('approvalAuthorized: decision.approvalAuthorized === true') &&
    handler.includes('productionScope: "manager_approved_original_transaction"') &&
    !gates.includes('remainingValueVerified') &&
    handler.includes('service_get_refund_nayax_execution_context') &&
    handler.includes('p_execution_context_hash: refundCase.executionContext!.contextHash') &&
    !gates.includes('provider_remaining_value_unverified') &&
    !gates.includes('NAYAX_REFUND_BROAD_REOPEN_APPROVED') &&
    !gates.includes('NAYAX_REFUND_CANARY_CASE_ID') &&
    !handler.includes('resolveNayaxRefundCaseExecutionConfig') &&
    !handler.includes('provider: disabledNayaxProviderAdapter'),
  'The reviewed provider contract binds the automatic exact selected purchase at the existing reservation boundary.',
);
check(
  authoritativeJournalMigration.includes('service_record_nayax_refund_provider_stage_v2') &&
    authoritativeJournalV3Migration.includes('service_record_nayax_refund_provider_stage_v3') &&
    authoritativeJournalV3Migration.includes('service_reserve_nayax_refund_manager_action_v3') &&
    authoritativeJournalV3Migration.includes('service_get_nayax_refund_provider_journal_capability_v3') &&
    authoritativeJournalV3Migration.includes("p_http_status = 200") &&
    authoritativeJournalV3Migration.includes("normalized_media_type = 'application_json'") &&
    authoritativeJournalV3Migration.includes('p_semantic_pair_matched is true') &&
    authoritativeJournalV3Migration.includes("'approvalPolicyVersion', 'db-authoritative-exact-200-json-v1'") &&
    authoritativeJournalV3Migration.includes("'responseEnvelopeVersion', 'nayax-response-envelope-v1'") &&
    authoritativeJournalV3Migration.includes("'response_read'") &&
    authoritativeJournalV3Migration.includes('enable row level security'),
  'Journal v3 owns the exact-200 JSON response transition while journal v2 remains available for rollback.',
);
check(
  refundOperations.includes("supabaseClient.rpc('get_refund_nayax_reliability_health')") &&
    refundsUi.includes('refund-payment-health') &&
    refundsUi.includes('Some card refunds need attention') &&
    refundsUi.includes('${nayaxReliabilityHealth.ownerLabel} owns follow-up; other eligible refunds remain available.'),
  'Managers receive a privacy-safe reconciliation alert with a follow-up owner and no pause on other eligible refunds.',
);
check(
  handler.includes('NAYAX_REFUND_PENDING_APPROVAL_RECOVERY_SUPPORTED = false') &&
    handler.includes('pending_approval_recovery_retired') &&
    handler.includes('...executionConfig.blocks') &&
    handler.includes('NAYAX_REFUND_APPROVE_WRITE_TOKEN_${accountKey}') &&
    handler.includes('NAYAX_REFUND_PRODUCTION_BASE_URL') &&
    handler.includes('provider_contract_host_invalid') &&
    handler.includes('areNayaxRefundWriteCredentialsReady') &&
    handler.includes('approval_contract_version_invalid') &&
    handler.includes('Unsupported operation.') &&
    handler.includes('executeNayaxRefundApprovalOnly') &&
    handler.includes('service_reserve_nayax_pending_approval_recovery') &&
    handler.includes('service_settle_nayax_pending_approval_recovery') &&
    pendingApprovalRecoveryMigration.includes("provider_status is distinct from 'request_unknown_contract_mismatch'") &&
    pendingApprovalRecoveryMigration.includes("journal.stage = 'approve'") &&
    pendingApprovalRecoveryMigration.includes('nayax_refund_attempt_id uuid not null unique') &&
    !pendingApprovalRecoveryMigration.includes('/payment/refund-request'),
  'The legacy pending-request recovery is retired and also retains dedicated credentials, full gates, and its single-use forensic boundary.',
);
check(
  pendingApprovalRecoveryMigration.includes('classification_digest') &&
    pendingApprovalRecoveryMigration.includes('payload_redacted') &&
    pendingApprovalRecoveryMigration.includes('guard_refund_nayax_provider_stage_immutable') &&
    authoritativeJournalV3Migration.includes('body_length_bucket') &&
    authoritativeJournalV3Migration.includes('result_value_type') &&
    handler.includes('buildRedactedNayaxStageDigest'),
  'Normal provider stages retain only immutable keyed redacted envelope evidence.',
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
check(/^NAYAX_REFUND_MANAGER_CONTRACT_JSON=$/m.test(envExample), 'The manager response contract defaults to unset.');
check(/^NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED=false$/m.test(envExample), 'Normal manager contract confirmation defaults to false.');
check(/^NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED=false$/m.test(envExample), 'Approval permission confirmation defaults to false.');
check(!/NAYAX_REFUND_(?:CANARY|BROAD_REOPEN|MAX_AMOUNT|DAILY_)/m.test(envExample), 'Retired canary and cap settings are absent from the production environment template.');
check(/^NAYAX_REFUND_PENDING_APPROVAL_RECOVERY_ENABLED=false$/m.test(envExample), 'Pending-request recovery defaults to disabled.');
check(/^NAYAX_REFUND_PENDING_APPROVAL_CONTRACT_JSON=$/m.test(envExample), 'The approval-only contract defaults to unset.');
check(/^NAYAX_REFUND_REQUEST_WRITE_TOKEN_ACCOUNT_KEY=$/m.test(envExample), 'The dedicated request write credential defaults to unset.');
check(/^NAYAX_REFUND_APPROVE_WRITE_TOKEN_ACCOUNT_KEY=$/m.test(envExample), 'The dedicated approval write credential defaults to unset.');
check(/^NAYAX_REFUND_EXECUTOR_ASSERTION=$/m.test(envExample), 'The function-scoped executor assertion defaults to unset.');

console.log(`Nayax refund provider adapter validated (${assertionCount} assertions).`);
