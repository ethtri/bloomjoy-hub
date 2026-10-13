#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = 'https://lynx.nayax.com/operational/v1';
const maxResponseBytes = 5 * 1024 * 1024;
const identifier = (value) => /^\d{1,30}$/.test(String(value ?? '')) ? String(value) : null;

class ReadinessError extends Error {
  constructor(code, httpStatus = null) {
    super(code);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function parseArgs(argv) {
  const result = { probe: false, help: false };
  const names = { '--account-key': 'accountKey', '--expected-actor-id': 'expectedActorId' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--probe' || arg === '--help') {
      result[arg.slice(2)] = true;
    } else if (names[arg] && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      result[names[arg]] = argv[++i];
    } else {
      throw new ReadinessError('invalid_arguments');
    }
  }
  return result;
}

export function accountConfiguration(accountKey, env) {
  // Require a canonical key instead of silently collapsing two different scopes.
  if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(accountKey ?? '')) {
    throw new ReadinessError('invalid_account_key');
  }
  const secretNames = {
    reporting: `NAYAX_LYNX_API_TOKEN_${accountKey}`,
    refundRequest: `NAYAX_REFUND_REQUEST_WRITE_TOKEN_${accountKey}`,
    refundApproval: `NAYAX_REFUND_APPROVE_WRITE_TOKEN_${accountKey}`,
  };
  const readToken = String(env[secretNames.reporting] ?? '').trim();
  const requestToken = String(env[secretNames.refundRequest] ?? '').trim();
  const approveToken = String(env[secretNames.refundApproval] ?? '').trim();
  const inventoryAccounts = (env.REFUND_NAYAX_INVENTORY_ACCOUNT_KEYS || 'TGPACI_USA_DB')
    .split(',').map((key) => key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'));
  const queueAccounts = [env.NAYAX_REFUND_ATTEMPT_QUEUE_ACCOUNT_KEY ?? '',
    ...(env.NAYAX_REFUND_ATTEMPT_QUEUE_ACCOUNT_KEYS ?? '').split(',')]
    .map((key) => key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'));
  return {
    readToken,
    summary: {
      accountKey,
      readOnly: true,
      secretNames,
      credentialPresence: {
        reporting: Boolean(readToken),
        refundRequest: Boolean(requestToken),
        refundApproval: Boolean(approveToken),
      },
      separateWriteTokensPresent: Boolean(requestToken && approveToken && requestToken !== approveToken),
      inventoryAccountConfigured: inventoryAccounts.includes(accountKey),
      refundWorkerAccountConfigured: queueAccounts.includes(accountKey),
      // Presence and a GET probe never establish payment permissions or activation.
      refundWritePermissionsVerified: false,
      activationPerformed: false,
    },
  };
}

async function getJson(route, token, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${route}`, {
      method: 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ReadinessError('provider_read_unavailable');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ReadinessError('provider_read_rejected', response.status);
  }
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel();
    throw new ReadinessError('provider_response_invalid');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ReadinessError('provider_response_invalid');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel();
        throw new ReadinessError('provider_response_too_large');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof ReadinessError) throw error;
    throw new ReadinessError('provider_response_invalid');
  } finally {
    reader.releaseLock();
  }
}

function records(payload, arrayKeys) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const key of arrayKeys) if (Array.isArray(payload[key])) return payload[key];
  }
  throw new ReadinessError('provider_response_invalid');
}

function actorScope(payload, expectedActorId) {
  const roots = Array.isArray(payload) ? payload
    : payload?.ActorID !== undefined ? [payload] : records(payload, ['data', 'Data', 'Actors']);
  const pending = [...roots];
  let expected;
  let visited = 0;
  while (pending.length) {
    const actor = pending.pop();
    if (++visited > 10000 || !actor || typeof actor !== 'object') {
      throw new ReadinessError('provider_response_invalid');
    }
    if (identifier(actor.ActorID) === expectedActorId) { expected = actor; break; }
    if (Array.isArray(actor.ActorChildren)) pending.push(...actor.ActorChildren);
  }
  if (!expected) throw new ReadinessError('actor_scope_mismatch');
  const ids = new Set();
  pending.length = 0;
  pending.push(expected);
  while (pending.length) {
    const actor = pending.pop();
    const id = identifier(actor?.ActorID);
    if (!id || ++visited > 20000) throw new ReadinessError('provider_response_invalid');
    ids.add(id);
    if (Array.isArray(actor.ActorChildren)) pending.push(...actor.ActorChildren);
  }
  return ids;
}

export async function checkAccountReadiness({
  accountKey, expectedActorId, probe = false, env = process.env, fetchImpl = fetch,
}) {
  const { readToken, summary } = accountConfiguration(accountKey, env);
  const result = {
    ...summary,
    status: readToken ? 'configured_unverified' : 'awaiting_reporting_token',
    providerCalls: 0,
    inventoryCompletenessVerified: false,
  };
  if (!probe) return result;
  if (!readToken) return { ...result, status: 'probe_failed', errorCode: 'reporting_token_missing' };
  const actorId = identifier(expectedActorId || env[`NAYAX_EXPECTED_ACTOR_ID_${accountKey}`]);
  if (!actorId) return { ...result, status: 'probe_failed', errorCode: 'expected_actor_id_missing' };
  const read = (route) => { result.providerCalls++; return getJson(route, readToken, fetchImpl); };
  try {
    const scope = actorScope(await read(`/actors/hierarchy?ActorID=${actorId}`), actorId);
    const machines = records(await read(`/machines?ActorID=${actorId}&ResultsLimit=1000`),
      ['data', 'Data', 'machines', 'Machines', 'result', 'Result', 'records', 'Records']);
    const ids = new Set();
    for (const machine of machines) {
      const id = identifier(machine?.MachineID);
      const owner = identifier(machine?.OperatorActorID ?? machine?.ActorID);
      if (!id || ids.has(id)) throw new ReadinessError('provider_response_invalid');
      if (!scope.has(owner)) throw new ReadinessError('machine_scope_mismatch');
      ids.add(id);
    }
    const active = machines.filter((machine) => Number(machine.MachineStatusBit) === 1);
    const sample = active[0] ?? machines[0];
    let lastSales = 'not_sampled';
    if (sample) {
      const sales = records(await read(`/machines/${identifier(sample.MachineID)}/lastSales`),
        ['data', 'Data', 'sales', 'Sales', 'result', 'Result', 'records', 'Records']);
      if (sales.some((sale) => !sale || typeof sale !== 'object' || Array.isArray(sale)
        || identifier(sale.MachineID) !== identifier(sample.MachineID))) {
        throw new ReadinessError('sale_scope_mismatch');
      }
      lastSales = 'read_succeeded';
    }
    return { ...result, status: 'read_scope_verified', visibleMachineCount: machines.length,
      visibleActiveMachineCount: active.length, lastSales,
      // This endpoint's result is visibility evidence, not a complete provider census.
      machineLimitReached: machines.length >= 1000 };
  } catch (error) {
    return { ...result, status: 'probe_failed',
      errorCode: error instanceof ReadinessError ? error.code : 'provider_read_unavailable',
      httpStatus: error instanceof ReadinessError ? error.httpStatus : null };
  }
}

const usage = 'Usage: node scripts/nayax/account-readiness.mjs --account-key ACCOUNT_KEY [--probe --expected-actor-id ACTOR_ID]\n'
  + 'Default: offline configuration only. --probe makes only GET requests to production Nayax.\n'
  + 'Load credentials with Node --env-file from a private file outside Git; never pass tokens as arguments.';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) console.log(usage);
    else {
      const result = await checkAccountReadiness(args);
      console.log(JSON.stringify(result, null, 2));
      if (result.status === 'probe_failed') process.exitCode = 1;
    }
  } catch {
    // Neither argument errors nor remote exceptions can leak supplied credentials.
    console.error('Nayax readiness arguments are invalid. Use --help.');
    process.exitCode = 1;
  }
}
