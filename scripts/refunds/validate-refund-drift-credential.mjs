#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  probeRefundDriftCredential,
  validateRefundDriftCredentialInput,
  writeProbeSlug,
} from './refund-drift-credential.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = fs.readFileSync(
  path.join(repositoryRoot, '.github', 'workflows', 'refund-production-drift.yml'),
  'utf8'
);
const token = `sbp_${'a'.repeat(40)}`;
const projectRef = 'a'.repeat(20);

const response = (status, body) =>
  new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const createFetch = (responses) => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const next = responses.shift();
    if (!next) throw new Error('Unexpected request');
    return next;
  };
  return { calls, fetchImpl };
};

validateRefundDriftCredentialInput({ token, projectRef });
assert.throws(
  () => validateRefundDriftCredentialInput({ token: '', projectRef }),
  /missing or malformed/,
  'A missing credential must fail before any request'
);
assert.throws(
  () => validateRefundDriftCredentialInput({ token: 'sbp_short', projectRef }),
  /missing or malformed/,
  'A malformed credential must fail before any request'
);
assert.throws(
  () => validateRefundDriftCredentialInput({ token, projectRef: 'wrong-project' }),
  /missing or malformed/,
  'A malformed project ref must fail before any request'
);

{
  const { calls, fetchImpl } = createFetch([
    response(200, [{ slug: 'refund-case-intake' }]),
    response(403, { message: 'Forbidden' }),
    response(403, { message: 'Forbidden' }),
  ]);
  assert.deepEqual(
    await probeRefundDriftCredential({ token, projectRef, fetchImpl }),
    { visibleFunctionCount: 1 }
  );
  assert.equal(calls.length, 3, 'The probe must make exactly one read and two negative checks');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(calls[2].options.method, 'DELETE');
  assert.match(calls[2].url, new RegExp(`${writeProbeSlug}$`));
  for (const call of calls) {
    assert.equal(call.options.headers.Authorization, `Bearer ${token}`);
    assert.equal(call.options.redirect, 'error');
  }
}

{
  const { fetchImpl } = createFetch([response(403, { message: 'Forbidden' })]);
  await assert.rejects(
    probeRefundDriftCredential({ token, projectRef, fetchImpl }),
    /cannot read Edge Functions/,
    'The intended read permission is required'
  );
}

{
  const { calls, fetchImpl } = createFetch([
    response(200, [{ slug: writeProbeSlug }]),
  ]);
  await assert.rejects(
    probeRefundDriftCredential({ token, projectRef, fetchImpl }),
    /unexpectedly exists/,
    'An existing reserved probe function must abort before DELETE'
  );
  assert.equal(calls.length, 1, 'No negative write check may run when the probe slug exists');
}

{
  const { fetchImpl } = createFetch([
    response(200, []),
    response(200, [{ id: projectRef }]),
  ]);
  await assert.rejects(
    probeRefundDriftCredential({ token, projectRef, fetchImpl }),
    /broader account project-list access/,
    'A token that can list account projects is too broad'
  );
}

{
  const { fetchImpl } = createFetch([
    response(200, []),
    response(403, { message: 'Forbidden' }),
    response(404, { message: 'Not found' }),
  ]);
  await assert.rejects(
    probeRefundDriftCredential({ token, projectRef, fetchImpl }),
    /did not prove Edge Function writes are forbidden/,
    'A broad token that reaches the delete endpoint must fail even when the probe target is absent'
  );
}

assert.match(workflow, /permissions:\r?\n  contents: read/);
assert.doesNotMatch(workflow, /id-token:\s*write/);
assert.match(workflow, /Validate least-privilege Supabase credential/);
assert.match(workflow, /npm run refunds:validate-drift-credential/);
assert.equal(
  (workflow.match(/SUPABASE_EDGE_FUNCTIONS_READ_TOKEN/g) ?? []).length,
  2,
  'The protected secret must be supplied only to the credential probe and production drift steps'
);

console.log('Refund drift credential tooling validated.');
