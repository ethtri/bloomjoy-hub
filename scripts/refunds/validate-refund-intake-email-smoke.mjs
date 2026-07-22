#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  buildRefundIntakeEmailEvidenceQuery,
  buildRefundIntakeEmailPreflightQuery,
  buildExistingSyntheticRunQuery,
  invokeSyntheticRefundIntake,
  parseRefundIntakeEmailSmokeArgs,
  validateRefundIntakeEmailEvidence,
  validateRefundIntakeEmailPreflight,
  validateRefundIntakeEmailSmokeArgs,
  validateExistingSyntheticRun,
} from './refund-intake-email-smoke.mjs';

const projectRef = 'a'.repeat(20);
const machineId = '11111111-1111-4111-8111-111111111111';
const caseId = '22222222-2222-4222-8222-222222222222';
const args = parseRefundIntakeEmailSmokeArgs([
  '--project-ref', projectRef,
  '--confirm-project-ref', projectRef,
  '--machine-id', machineId,
  '--timeout-ms', '25000',
]);
assert.deepEqual(args, {
  projectRef,
  confirmProjectRef: projectRef,
  machineId,
  executeSynthetic: false,
  authorizationPhrase: '',
  syntheticRunId: '',
  timeoutMs: 25_000,
  help: false,
});
assert.deepEqual(validateRefundIntakeEmailSmokeArgs(args, {}), { customerEmail: '' });

assert.throws(
  () => validateRefundIntakeEmailSmokeArgs({ ...args, confirmProjectRef: 'b'.repeat(20) }, {}),
  /exactly match/,
);
assert.throws(
  () => validateRefundIntakeEmailSmokeArgs({ ...args, machineId: 'not-a-uuid' }, {}),
  /machine-id/,
);
assert.throws(
  () => validateRefundIntakeEmailSmokeArgs({ ...args, authorizationPhrase: 'unexpected' }, {}),
  /only with --execute-synthetic/,
);

const executionArgs = {
  ...args,
  executeSynthetic: true,
  authorizationPhrase: 'SEND SYNTHETIC REFUND EMAILS',
  syntheticRunId: '33333333-3333-4333-8333-333333333333',
};
assert.throws(
  () => validateRefundIntakeEmailSmokeArgs({ ...executionArgs, authorizationPhrase: 'yes' }, {}),
  /requires --authorize-email-send/,
);
assert.throws(
  () => validateRefundIntakeEmailSmokeArgs(executionArgs, {
    REFUND_SMOKE_CUSTOMER_EMAIL: 'refund-smoke@example.test',
    REFUND_SMOKE_CONFIRM_CUSTOMER_EMAIL: 'different@example.test',
  }),
  /must exactly match/,
);
assert.deepEqual(
  validateRefundIntakeEmailSmokeArgs(executionArgs, {
    REFUND_SMOKE_CUSTOMER_EMAIL: 'Refund-Smoke@Example.Test',
    REFUND_SMOKE_CONFIRM_CUSTOMER_EMAIL: 'refund-smoke@example.test',
  }),
  { customerEmail: 'refund-smoke@example.test' },
);

const preflightQuery = buildRefundIntakeEmailPreflightQuery(machineId);
assert.match(preflightQuery, /true as read_only/);
assert.match(preflightQuery, /refund_intake_enabled = true/);
assert.match(preflightQuery, /reporting_machine_refund_managers/);
assert.doesNotMatch(preflightQuery, /customer_email|customer_name|card_last4|issue_summary/);
assert.throws(() => buildRefundIntakeEmailPreflightQuery("' or true --"), /Invalid machine UUID/);

assert.deepEqual(
  validateRefundIntakeEmailPreflight({
    read_only: true,
    selected_machine_count: 1,
    active_manager_assignment_count: 2,
  }),
  {
    read_only: true,
    selected_machine_count: 1,
    active_manager_assignment_count: 2,
    ready: true,
  },
);
assert.equal(
  validateRefundIntakeEmailPreflight({
    read_only: true,
    selected_machine_count: 1,
    active_manager_assignment_count: 0,
  }).ready,
  false,
);
assert.throws(
  () => validateRefundIntakeEmailPreflight({
    read_only: true,
    selected_machine_count: 1,
    active_manager_assignment_count: 1,
    manager_email: 'must-not-leak@example.test',
  }),
  /unexpected columns/,
);

const evidenceQuery = buildRefundIntakeEmailEvidenceQuery(caseId);
assert.match(evidenceQuery, /customer_acknowledgement/);
assert.match(evidenceQuery, /manager_notification_sent/);
assert.doesNotMatch(evidenceQuery, /customer_email|recipient_email|subject|body|issue_summary|card_last4/);
assert.throws(() => buildRefundIntakeEmailEvidenceQuery("' or true --"), /Invalid refund case UUID/);

const existingRunQuery = buildExistingSyntheticRunQuery(machineId, executionArgs.syntheticRunId);
assert.match(existingRunQuery, /Bloomjoy Refund Smoke/);
assert.match(existingRunQuery, new RegExp(executionArgs.syntheticRunId));
assert.doesNotMatch(existingRunQuery, /customer_email|recipient_email|card_last4/);
assert.equal(validateExistingSyntheticRun([]), null);
assert.deepEqual(
  validateExistingSyntheticRun([{ id: caseId, public_reference: 'RF-SMOKE-001' }]),
  { id: caseId, publicReference: 'RF-SMOKE-001' },
);
assert.throws(
  () => validateExistingSyntheticRun([
    { id: caseId, public_reference: 'RF-SMOKE-001' },
    { id: machineId, public_reference: 'RF-SMOKE-002' },
  ]),
  /multiple cases/,
);

const goodRows = [
  {
    case_reference: 'RF-SMOKE-001',
    event_type: 'customer_acknowledgement',
    recipient_count: 1,
    delivery_state: 'sent',
  },
  {
    case_reference: 'RF-SMOKE-001',
    event_type: 'manager_notification_sent',
    recipient_count: 3,
    delivery_state: 'sent',
  },
];
assert.equal(validateRefundIntakeEmailEvidence(goodRows, 'RF-SMOKE-001').passed, true);
assert.equal(
  validateRefundIntakeEmailEvidence(
    goodRows.map((row) => row.event_type === 'customer_acknowledgement'
      ? { ...row, recipient_count: 0, delivery_state: 'failed' }
      : row),
    'RF-SMOKE-001',
  ).passed,
  false,
);
assert.throws(
  () => validateRefundIntakeEmailEvidence([
    ...goodRows,
    {
      case_reference: 'RF-SMOKE-001',
      event_type: 'unexpected',
      recipient_count: 1,
      delivery_state: 'sent',
    },
  ], 'RF-SMOKE-001'),
  /exactly two/,
);
assert.throws(
  () => validateRefundIntakeEmailEvidence([
    { ...goodRows[0], recipient_email: 'must-not-leak@example.test' },
    goodRows[1],
  ], 'RF-SMOKE-001'),
  /unexpected columns/,
);

const requests = [];
const syntheticCase = await invokeSyntheticRefundIntake({
  projectRef,
  machineId,
  customerEmail: 'refund-smoke@example.test',
  timeoutMs: 5_000,
  syntheticRunId: executionArgs.syntheticRunId,
  now: () => new Date('2026-07-22T18:00:00.000Z'),
  fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({
      refundCase: {
        id: caseId,
        publicReference: 'RF-SMOKE-001',
        status: 'needs_review',
        correlationStatus: 'needs_nayax',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  },
});
assert.deepEqual(syntheticCase, { id: caseId, publicReference: 'RF-SMOKE-001' });
assert.equal(requests.length, 1);
assert.equal(requests[0].options.method, 'POST');
assert.equal(requests[0].options.headers.Authorization, undefined);
const syntheticPayload = JSON.parse(requests[0].options.body);
assert.deepEqual(Object.keys(syntheticPayload).sort(), [
  'attachments',
  'cardLast4',
  'cardWalletUsed',
  'customerEmail',
  'customerName',
  'incidentAt',
  'issueSummary',
  'machineId',
  'paymentAmount',
  'paymentMethod',
].sort());
assert.equal(syntheticPayload.customerEmail, 'refund-smoke@example.test');
assert.equal(syntheticPayload.customerName, 'Bloomjoy Refund Smoke');
assert.match(syntheticPayload.issueSummary, new RegExp(executionArgs.syntheticRunId));
assert.equal(syntheticPayload.incidentAt, '2026-07-22T18:00:00.000Z');
assert.equal(syntheticPayload.paymentMethod, 'card');
assert.equal(syntheticPayload.paymentAmount, '0.01');
assert.equal(syntheticPayload.cardLast4, '0000');
assert.deepEqual(syntheticPayload.attachments, []);

await assert.rejects(
  () => invokeSyntheticRefundIntake({
    projectRef,
    machineId,
    customerEmail: 'refund-smoke@example.test',
    timeoutMs: 5_000,
    syntheticRunId: executionArgs.syntheticRunId,
    fetchImpl: async () => new Response(
      JSON.stringify({ error: 'sensitive upstream detail must not surface' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    ),
  }),
  /returned HTTP 500/,
);

console.log('Refund intake/email smoke validation passed: read-only preflight, exact production authorization, private test inbox confirmation, sanitized delivery evidence, and fail-closed output columns are enforced.');
