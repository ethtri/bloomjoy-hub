import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { accountConfiguration, checkAccountReadiness, parseArgs } from './account-readiness.mjs';

const accountKey = 'BLOOMJOY_NC_ADAM';
const env = {
  NAYAX_LYNX_API_TOKEN_BLOOMJOY_NC_ADAM: 'private-nc-reporting-token',
  NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB: 'private-primary-token',
  NAYAX_LYNX_API_TOKEN: 'private-legacy-token',
  NAYAX_REFUND_REQUEST_WRITE_TOKEN_BLOOMJOY_NC_ADAM: 'private-nc-request-token',
  NAYAX_REFUND_APPROVE_WRITE_TOKEN_BLOOMJOY_NC_ADAM: 'private-nc-approval-token',
  REFUND_NAYAX_INVENTORY_ACCOUNT_KEYS: 'TGPACI_USA_DB,BLOOMJOY_NC_ADAM',
  NAYAX_REFUND_ATTEMPT_QUEUE_ACCOUNT_KEY: 'TGPACI_USA_DB',
};
const actorId = '123456';
const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const hierarchy = { ActorID: actorId, ActorChildren: [{ ActorID: '123457', ActorChildren: [] }] };
const machines = [{ MachineID: '654321', OperatorActorID: actorId, ActorID: '123457',
  MachineStatusBit: 1, MachineName: 'Never print this machine name' }];
const syntheticTransport = (replies, calls = []) => async (url, options) => {
  calls.push({ url, options });
  assert.equal(options.method, 'GET');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, `Bearer ${env.NAYAX_LYNX_API_TOKEN_BLOOMJOY_NC_ADAM}`);
  assert.equal(new URL(url).origin, 'https://lynx.nayax.com');
  assert.ok(!url.includes('/payment/'));
  return replies.shift();
};

test('offline preparation requires no credentials or network and prints exact secret names', async () => {
  const result = await checkAccountReadiness({ accountKey, env: {}, fetchImpl: () => assert.fail('no network') });
  assert.equal(result.status, 'awaiting_reporting_token');
  assert.equal(result.providerCalls, 0);
  assert.equal(result.secretNames.reporting, 'NAYAX_LYNX_API_TOKEN_BLOOMJOY_NC_ADAM');
  assert.equal(result.activationPerformed, false);
  assert.equal(result.refundWritePermissionsVerified, false);
  const additional = await checkAccountReadiness({ accountKey,
    env: { ...env, NAYAX_REFUND_ATTEMPT_QUEUE_ACCOUNT_KEYS: accountKey } });
  assert.equal(additional.refundWorkerAccountConfigured, true);
});

test('NC never borrows a primary or legacy token and never probes without an expected actor', async () => {
  const primaryOnly = { NAYAX_LYNX_API_TOKEN: env.NAYAX_LYNX_API_TOKEN,
    NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB: env.NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB };
  const noNetwork = () => assert.fail('no network');
  const missing = await checkAccountReadiness({ accountKey, env: primaryOnly, probe: true, fetchImpl: noNetwork });
  assert.equal(missing.errorCode, 'reporting_token_missing');
  const unbound = await checkAccountReadiness({ accountKey, env, probe: true, fetchImpl: noNetwork });
  assert.equal(unbound.errorCode, 'expected_actor_id_missing');
});

test('credential presence does not claim write permissions or expose values', async () => {
  const result = await checkAccountReadiness({ accountKey, env, fetchImpl: () => assert.fail('no network') });
  assert.equal(result.status, 'configured_unverified');
  assert.equal(result.separateWriteTokensPresent, true);
  assert.equal(result.inventoryAccountConfigured, true);
  assert.equal(result.refundWorkerAccountConfigured, false);
  assert.equal(result.refundWritePermissionsVerified, false);
  for (const value of Object.values(env).filter((value) => value.startsWith('private-'))) {
    assert.ok(!JSON.stringify(result).includes(value));
  }
  assert.equal(accountConfiguration(accountKey, { ...env,
    NAYAX_REFUND_APPROVE_WRITE_TOKEN_BLOOMJOY_NC_ADAM: env.NAYAX_REFUND_REQUEST_WRITE_TOKEN_BLOOMJOY_NC_ADAM,
  }).summary.separateWriteTokensPresent, false);
});

test('verified hierarchy, machine scope and sampled Last Sales use only three GET requests', async () => {
  const calls = [];
  const result = await checkAccountReadiness({ accountKey, expectedActorId: actorId, env, probe: true,
    fetchImpl: syntheticTransport([json(hierarchy), json({ Machines: machines }),
      json([{ MachineID: '654321', TransactionID: 'sensitive-transaction', CardNumber: 'sensitive-card' }])], calls) });
  assert.equal(result.status, 'read_scope_verified');
  assert.equal(result.providerCalls, 3);
  assert.equal(result.visibleMachineCount, 1);
  assert.equal(result.lastSales, 'read_succeeded');
  assert.equal(result.inventoryCompletenessVerified, false);
  assert.equal(result.refundWritePermissionsVerified, false);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    '/operational/v1/actors/hierarchy', '/operational/v1/machines', '/operational/v1/machines/654321/lastSales',
  ]);
  for (const privateText of [actorId, '654321', 'sensitive-transaction', 'sensitive-card', machines[0].MachineName]) {
    assert.ok(!JSON.stringify(result).includes(privateText));
  }
});

test('a wrong-account hierarchy stops before inventory or Last Sales', async () => {
  const result = await checkAccountReadiness({ accountKey, expectedActorId: actorId, env, probe: true,
    fetchImpl: syntheticTransport([json({ ActorID: '999999', ActorChildren: [] })]) });
  assert.equal(result.errorCode, 'actor_scope_mismatch');
  assert.equal(result.providerCalls, 1);
});

test('a machine belonging to another operator stops before transaction reads', async () => {
  const result = await checkAccountReadiness({ accountKey, expectedActorId: actorId, env, probe: true,
    fetchImpl: syntheticTransport([json(hierarchy), json([{ ...machines[0], OperatorActorID: '999999' }])]) });
  assert.equal(result.errorCode, 'machine_scope_mismatch');
  assert.equal(result.providerCalls, 2);
});

test('Last Sales evidence from another machine does not pass the sampled check', async () => {
  const result = await checkAccountReadiness({ accountKey, expectedActorId: actorId, env, probe: true,
    fetchImpl: syntheticTransport([json(hierarchy), json(machines), json([{ MachineID: '999999' }])]) });
  assert.equal(result.errorCode, 'sale_scope_mismatch');
});

test('HTTP errors and transport exceptions produce bounded diagnostics without raw errors', async () => {
  for (const status of [401, 403, 307, 500]) {
    const result = await checkAccountReadiness({ accountKey, expectedActorId: actorId, env, probe: true,
      fetchImpl: syntheticTransport([new Response('secret echoed by provider', { status })]) });
    assert.equal(result.status, 'probe_failed');
    assert.equal(result.httpStatus, status);
    assert.ok(!JSON.stringify(result).includes('secret echoed'));
  }
  const result = await checkAccountReadiness({ accountKey, expectedActorId: actorId, env, probe: true,
    fetchImpl: () => { throw new Error(env.NAYAX_LYNX_API_TOKEN_BLOOMJOY_NC_ADAM); } });
  assert.equal(result.errorCode, 'provider_read_unavailable');
  assert.ok(!JSON.stringify(result).includes(env.NAYAX_LYNX_API_TOKEN_BLOOMJOY_NC_ADAM));
});

test('invalid MIME, malformed JSON and oversized responses fail without exposing bodies', async () => {
  const responses = [
    [new Response('private HTML'), 'provider_response_invalid'],
    [new Response('private invalid JSON', { headers: { 'Content-Type': 'application/json' } }), 'provider_response_invalid'],
    [new Response('x'.repeat(5 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }), 'provider_response_too_large'],
  ];
  for (const [response, code] of responses) {
    const result = await checkAccountReadiness({ accountKey, expectedActorId: actorId, env, probe: true,
      fetchImpl: syntheticTransport([response]) });
    assert.equal(result.errorCode, code);
  }
});

test('duplicate machine identities fail and an empty inventory does not prove transaction access', async () => {
  const duplicate = await checkAccountReadiness({ accountKey, expectedActorId: actorId, env, probe: true,
    fetchImpl: syntheticTransport([json(hierarchy), json([machines[0], machines[0]])]) });
  assert.equal(duplicate.errorCode, 'provider_response_invalid');
  const empty = await checkAccountReadiness({ accountKey, expectedActorId: actorId, env, probe: true,
    fetchImpl: syntheticTransport([json(hierarchy), json([])]) });
  assert.equal(empty.visibleMachineCount, 0);
  assert.equal(empty.lastSales, 'not_sampled');
  assert.equal(empty.inventoryCompletenessVerified, false);
});

test('canonical account keys and explicit CLI flags prevent scope collisions or token arguments', () => {
  for (const key of ['NC:ADAM', 'nc_adam', '', 'NC/ADAM']) {
    assert.throws(() => accountConfiguration(key, {}));
  }
  assert.throws(() => parseArgs(['--token', 'private-token']));
  assert.deepEqual(parseArgs(['--account-key', accountKey, '--probe', '--expected-actor-id', actorId]),
    { help: false, probe: true, accountKey, expectedActorId: actorId });
});

test('CLI default stays offline and argument errors do not echo supplied secrets', () => {
  const script = fileURLToPath(new URL('./account-readiness.mjs', import.meta.url));
  const offline = spawnSync(process.execPath, [script,
    '--account-key', accountKey], { env: { ...process.env,
    NAYAX_LYNX_API_TOKEN_BLOOMJOY_NC_ADAM: '', NAYAX_EXPECTED_ACTOR_ID_BLOOMJOY_NC_ADAM: '' }, encoding: 'utf8' });
  assert.equal(offline.status, 0);
  assert.equal(JSON.parse(offline.stdout).providerCalls, 0);
  const bad = spawnSync(process.execPath, [script,
    '--token', 'private-cli-secret'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.ok(!(bad.stdout + bad.stderr).includes('private-cli-secret'));
});
