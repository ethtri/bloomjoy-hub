#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildNayaxRefundApprovalBody,
  buildNayaxRefundRequestBody,
  classifyNayaxRefundResponse,
  createNayaxRefundProviderAdapter,
  executeNayaxRefundProvider,
  freezeNayaxRefundEvidence,
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

check(Object.isFrozen(contract), 'The confirmed provider contract must be immutable.');
check(Object.isFrozen(contract.requestResponses), 'Request patterns must be immutable.');
check(Object.isFrozen(contract.requestResponses[0]), 'Individual response patterns must be immutable.');
equal(contract.baseUrl, baseContract.baseUrl, 'The exact approved QA path is preserved.');

for (const [mutate, pattern, message] of [
  [(value) => ({ ...value, extra: true }), /unsupported field/, 'Unknown contract fields fail closed.'],
  [(value) => ({ ...value, schemaVersion: 2 }), /schemaVersion/, 'Unknown schema versions fail closed.'],
  [(value) => ({ ...value, authorizationMode: 'guess' }), /authorizationMode/, 'Authorization mode must be explicit.'],
  [(value) => ({ ...value, amountUnit: 'guess' }), /amountUnit/, 'Amount units must be explicit.'],
  [(value) => ({ ...value, refundEmailListMode: 'guess' }), /refundEmailListMode/, 'Refund email ownership must be explicit.'],
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
    payloadRedacted: true,
  },
  'Only normalized Result and Status values survive classification.',
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
  token: 'synthetic-test-token',
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
check(successfulResult.executed, 'Exact request acceptance plus exact approval is success.');
equal(successfulCalls.length, 2, 'A successful flow makes one request and one approval.');
deepEqual(successfulCalls.map((call) => call.url), [
  'https://qa-lynx.nayax.com/operational/v1/payment/refund-request',
  'https://qa-lynx.nayax.com/operational/v1/payment/refund-approve',
], 'Only the two reviewed endpoints are called, in order.');
equal(successfulCalls[0].options.headers.Authorization, 'Bearer synthetic-test-token', 'Bearer mode is explicit.');
equal(successfulCalls[0].options.redirect, 'error', 'Redirects are rejected to protect the credential.');
equal(JSON.parse(successfulCalls[1].options.body).IsRefundedExternally, false, 'Approval preserves the provider-execution flag.');
check(!JSON.stringify(successfulStages).includes('discard-me'), 'Raw provider payload fields are discarded.');

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
    token: 'synthetic-test-token',
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
    token: 'synthetic-test-token',
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
  token: 'dedicated-write-token',
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
equal(adapterSuccess.providerReference, 'nayax-transaction-123456789', 'The reference is derived from frozen evidence, not mutable input.');
equal(adapterCalls.length, 2, 'One adapter execution makes at most one request and one approval.');

for (const changedRequest of [
  { ...orchestrationRequest, caseId: '76000000-0000-4000-8000-000000000002' },
  { ...orchestrationRequest, amountCents: 726 },
  { ...orchestrationRequest, currencyCode: 'EUR' },
  { ...orchestrationRequest, idempotencyKey: 'not-an-idempotency-key' },
]) {
  let transportCalls = 0;
  const boundAdapter = createNayaxRefundProviderAdapter({
    contract: baseContract,
    token: 'dedicated-write-token',
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
    token: 'dedicated-write-token',
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
const envExample = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
const capMigration = fs.readFileSync(
  path.join(
    repoRoot,
    'supabase/migrations/202608110020_refund_nayax_provider_caps.sql',
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
check(handler.includes('provider: disabledNayaxProviderAdapter'), 'The existing production handler remains statically fail-closed in this bounded adapter PR.');
check(!handler.includes('createNayaxRefundProviderAdapter'), 'The new live adapter cannot be selected by request or environment in this PR.');
check(/^NAYAX_REFUND_EXECUTION_ENABLED=false$/m.test(envExample), 'Execution defaults to disabled.');
check(/^NAYAX_REFUND_EXECUTION_DRY_RUN=true$/m.test(envExample), 'Dry-run defaults to enabled.');
check(/^NAYAX_REFUND_EXECUTION_KILL_SWITCH=true$/m.test(envExample), 'The kill switch defaults to active.');
check(/^NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED=false$/m.test(envExample), 'Provider-contract confirmation defaults to false.');
check(/^NAYAX_REFUND_PROVIDER_CONTRACT_JSON=$/m.test(envExample), 'The exact provider contract defaults to unset.');
check(/^NAYAX_REFUND_API_TOKEN_ACCOUNT_KEY=$/m.test(envExample), 'The dedicated account-scoped write credential defaults to unset.');

console.log(`Nayax refund provider adapter validated (${assertionCount} assertions).`);
