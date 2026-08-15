import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNayaxControlledPilotClients,
  NAYAX_CONTROLLED_PILOT_OWNER_QUERIES,
} from './nayax-controlled-owner-pilot-runner-clients.mjs';
import { sha256Hex } from './nayax-controlled-owner-pilot-runner-lib.mjs';

const config = {
  projectRef: 'ygbzkgxktzqsiygjlqyg',
  confirmProjectRef: 'ygbzkgxktzqsiygjlqyg',
  managementToken: 'm'.repeat(32),
  runnerAssertion: 'runner_assertion_value_12345678901234567890',
  runnerAssertionDigest: sha256Hex('runner_assertion_value_12345678901234567890'),
  providerContractJson: '{"contract":"private"}',
  contractDigest: sha256Hex('{"contract":"private"}'),
  accountKey: 'PILOT_ACCOUNT',
  accountKeyDigest: sha256Hex('PILOT_ACCOUNT'),
  ownerEmailDigest: sha256Hex('owner.test@example.com'),
  selfCaseAttestationDigest: 'a'.repeat(64),
  ownerCaseEvidenceDigest: '2'.repeat(64),
  expectedMachineDigest: '3'.repeat(64),
  requestWriteToken: 'request-write-token-value-123456789',
  approveWriteToken: 'approve-write-token-value-123456789',
  requestWriteTokenDigest: sha256Hex('request-write-token-value-123456789'),
  approveWriteTokenDigest: sha256Hex('approve-write-token-value-123456789'),
  idempotencySecretDigest: '6'.repeat(64),
  executorAssertion: 'x'.repeat(48),
  executorAssertionDigest: sha256Hex('x'.repeat(48)),
  expectedAmountCents: 700,
};

const response = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});
const secret = (name, value) => ({ name, value: sha256Hex(value) });

const alignedSecrets = () => [
  secret('NAYAX_REFUND_CONTROLLED_PILOT_RUNNER_ASSERTION', config.runnerAssertion),
  secret('NAYAX_REFUND_CONTROLLED_PILOT_CONTRACT_JSON', config.providerContractJson),
  { name: 'NAYAX_REFUND_REQUEST_WRITE_TOKEN_PILOT_ACCOUNT',
    value: config.requestWriteTokenDigest },
  { name: 'NAYAX_REFUND_APPROVE_WRITE_TOKEN_PILOT_ACCOUNT',
    value: config.approveWriteTokenDigest },
  { name: 'NAYAX_REFUND_IDEMPOTENCY_SECRET', value: config.idempotencySecretDigest },
  { name: 'NAYAX_REFUND_EXECUTOR_ASSERTION', value: config.executorAssertionDigest },
  secret('NAYAX_REFUND_MAX_AMOUNT_CENTS', '700'),
  secret('NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS', '700'),
  secret('NAYAX_REFUND_DAILY_COUNT_CAP', '1'),
];

test('fixed owner queries use DB-owner sessions and exact authorization binding', () => {
  const expected = {
    initializationState: [4, '3caf5d8230893d4458fe84be50d9051791e5e0561c312f145cfb88f2fa6c1f52'],
    preflight: [2, '9d0ba1625bcbf327466deb4c851b842618df4e879f5a85118299fe8164163701'],
    authorize: [16, 'a4ec9ff486561c7e27b4bbac8375fb04feebb93cddd266c06702ef1ef5cb8cd6'],
    cancel: [1, 'c7a084cb3ab6e18f126a5f88c02dd3f74d257722125ec5b1e785be47ee9696dc'],
    recover: [0, '911f0dbada74fa1df28d2ca5916f580e12049d74fd77bcb734ee3208b2695712'],
    recoveryState: [0, 'afca8422303424bd2dea31ede5aba75988b11fbe55c459b389fb1d5ee9de8e87'],
    postflight: [1, 'a83afd1063bd755ab626bd9fab390fae815602fec14fef9fe8262eb93651d51e'],
  };
  assert.deepEqual(Object.keys(NAYAX_CONTROLLED_PILOT_OWNER_QUERIES), Object.keys(expected));
  for (const [name, operation] of Object.entries(NAYAX_CONTROLLED_PILOT_OWNER_QUERIES)) {
    assert.equal(operation.readOnly, false, `${name} must assert a DB-owner session`);
    assert.equal(operation.parameterCount, expected[name][0], `${name} parameter count`);
    assert.equal(sha256Hex(operation.sql), expected[name][1], `${name} fixed SQL snapshot`);
  }
  assert.match(
    NAYAX_CONTROLLED_PILOT_OWNER_QUERIES.postflight.sql,
    /closure\.authorization_id = \$1::uuid/u,
  );
  assert.match(
    NAYAX_CONTROLLED_PILOT_OWNER_QUERIES.initializationState.sql,
    /current_user = pg_catalog\.pg_get_userbyid/u,
  );
  assert.match(
    NAYAX_CONTROLLED_PILOT_OWNER_QUERIES.recover.sql,
    /owner_recover_expired_refund_nayax_controlled_pilot\(\)/u,
  );
});

test('client rejects the wrong project before any network call', () => {
  assert.throws(
    () => createNayaxControlledPilotClients({ ...config, projectRef: 'wrong-project' }),
    (error) => error.code === 'client_configuration_invalid',
  );
});

test('Auth identity normalizes email and returns only its digest', async () => {
  let calls = 0;
  const clients = createNayaxControlledPilotClients(config, {
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.match(String(url), /\/auth\/v1\/user$/u);
      assert.equal(options.method, 'GET');
      return response(200, {
        id: '43000000-0000-4000-8000-000000000002',
        email: '  Owner.Test@Example.COM  ',
      });
    },
  });
  assert.deepEqual(await clients.authIdentity(), {
    userId: '43000000-0000-4000-8000-000000000002',
    emailDigest: sha256Hex('owner.test@example.com'),
  });
  assert.equal(calls, 1);
});

test('owner recovery preserves unknown provider-call cardinality for a consumed attempt', async () => {
  let calls = 0;
  const clients = createNayaxControlledPilotClients(config, {
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.match(String(url), /\/database\/query$/u);
      assert.equal(options.method, 'POST');
      assert.equal(JSON.parse(options.body).read_only, false);
      return response(201, [{
        database_owner_session: true,
        result: {
          closed: true, payloadRedacted: true, consumedAttemptCount: 1,
          providerCallCountStatus: 'unknown', providerHold: true,
          manualReconciliationRequired: true,
        },
      }]);
    },
  });
  const result = await clients.recoverExpired();
  assert.equal(result.consumedAttemptCount, 1);
  assert.equal(result.providerCallCountStatus, 'unknown');
  assert.equal(Object.hasOwn(result, 'providerCallCount'), false);
  assert.equal(JSON.stringify(result).includes('providerBody'), false);
  assert.equal(calls, 1);
});

test('owner recovery rejects a consumed attempt mislabeled as proven zero', async () => {
  const clients = createNayaxControlledPilotClients(config, {
    fetchImpl: async () => response(201, [{
      database_owner_session: true,
      result: {
        closed: true, payloadRedacted: true, consumedAttemptCount: 1,
        providerCallCountStatus: 'proven_zero', providerHold: true,
        manualReconciliationRequired: true,
      },
    }]),
  });
  await assert.rejects(
    () => clients.recoverExpired(),
    (error) => error.code === 'owner_recovery_response_invalid',
  );
});

for (const status of [429, 500]) {
  test(`Edge ${status} is one attempt, unconfirmed, and body-redacted`, async () => {
    let calls = 0;
    const clients = createNayaxControlledPilotClients(config, {
      fetchImpl: async (_url, options) => {
        calls += 1;
        assert.equal(options.method, 'POST');
        return response(status, { token: 'private', providerBody: 'private' });
      },
    });
    const result = await clients.execute({
      authorizationId: '43000000-0000-4000-8000-000000000004',
      intentId: '43000000-0000-4000-8000-000000000003',
      expectedCaseVersion: 1,
      code: '123456',
    });
    assert.deepEqual(result, { confirmed: false, status });
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes('private'), false);
  });
}

test('aborted Edge transport fails ambiguously after exactly one POST without leaking input', async () => {
  let calls = 0;
  const clients = createNayaxControlledPilotClients(config, {
    fetchImpl: async () => {
      calls += 1;
      throw new Error('private provider response with identifiers');
    },
  });
  await assert.rejects(
    () => clients.execute({
      authorizationId: '43000000-0000-4000-8000-000000000004',
      intentId: '43000000-0000-4000-8000-000000000003',
      expectedCaseVersion: 1,
      code: '123456',
    }),
    (error) => error.code === 'edge_result_ambiguous' &&
      !JSON.stringify(error).includes('private provider'),
  );
  assert.equal(calls, 1);
});

test('initialization never overwrites the existing idempotency secret', async () => {
  let initializedBody;
  const clients = createNayaxControlledPilotClients(config, {
    fetchImpl: async (_url, options) => {
      if (options.method === 'POST') {
        initializedBody = JSON.parse(options.body);
        return response(201, {});
      }
      return response(200, alignedSecrets());
    },
  });
  const result = await clients.initializePilotSecrets();
  assert.equal(result.initialized, true);
  const names = initializedBody.map((entry) => entry.name);
  assert.equal(names.includes('NAYAX_REFUND_IDEMPOTENCY_SECRET'), false);
  assert.equal(names.includes('NAYAX_REFUND_EXECUTOR_ASSERTION'), true);
  assert.equal(names.includes('NAYAX_REFUND_REQUEST_WRITE_TOKEN_PILOT_ACCOUNT'), true);
  assert.equal(names.includes('NAYAX_REFUND_APPROVE_WRITE_TOKEN_PILOT_ACCOUNT'), true);
});

test('ambiguous initialization reads exact committed digests without retrying', async () => {
  let writeCount = 0;
  const clients = createNayaxControlledPilotClients(config, {
    fetchImpl: async (_url, options) => {
      if (options.method === 'POST') {
        writeCount += 1;
        throw new Error('simulated client timeout');
      }
      return response(200, alignedSecrets());
    },
  });
  const result = await clients.initializePilotSecrets();
  assert.equal(result.initialized, true);
  assert.equal(result.writeAccepted, false);
  assert.equal(writeCount, 1);
});

test('retirement deletes temporary executor/write secrets and restores canonical safe caps', async () => {
  let deletedNames;
  let restoredBody;
  const retiredSecrets = [
    { name: 'NAYAX_REFUND_IDEMPOTENCY_SECRET', value: config.idempotencySecretDigest },
    secret('NAYAX_REFUND_MAX_AMOUNT_CENTS', '1000'),
    secret('NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS', '5000'),
    secret('NAYAX_REFUND_DAILY_COUNT_CAP', '10'),
    secret('NAYAX_REFUND_EXECUTION_ENABLED', 'false'),
    secret('NAYAX_REFUND_EXECUTION_DRY_RUN', 'true'),
    secret('NAYAX_REFUND_EXECUTION_KILL_SWITCH', 'true'),
  ];
  const clients = createNayaxControlledPilotClients(config, {
    fetchImpl: async (_url, options) => {
      if (options.method === 'DELETE') {
        deletedNames = JSON.parse(options.body);
        return response(204, null);
      }
      if (options.method === 'POST') {
        restoredBody = JSON.parse(options.body);
        return response(201, {});
      }
      return response(200, retiredSecrets);
    },
  });
  const result = await clients.retirePilotSecrets();
  assert.equal(result.retired, true);
  assert.equal(deletedNames.includes('NAYAX_REFUND_EXECUTOR_ASSERTION'), true);
  assert.equal(deletedNames.includes('NAYAX_REFUND_IDEMPOTENCY_SECRET'), false);
  assert.equal(restoredBody.some((entry) =>
    entry.name === 'NAYAX_REFUND_IDEMPOTENCY_SECRET'), false);
  assert.deepEqual(restoredBody.filter((entry) => entry.name.includes('CAP')).map(
    (entry) => entry.value,
  ), ['5000', '10']);
});

test('retirement ambiguity fails closed when exact readback cannot prove deletion', async () => {
  const clients = createNayaxControlledPilotClients(config, {
    fetchImpl: async (_url, options) => {
      if (options.method === 'DELETE' || options.method === 'POST') {
        throw new Error('simulated client timeout');
      }
      return response(200, alignedSecrets());
    },
  });
  await assert.rejects(
    () => clients.retirePilotSecrets(),
    (error) => error.code === 'pilot_retirement_incomplete' &&
      error.details.metadataReconciliationRequired === true,
  );
});
