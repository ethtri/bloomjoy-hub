#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  parseRefundRouteSmokeArgs,
  refundRouteSmokeExpectations,
  resolveRefundRouteSmokeBaseUrl,
  runRefundRouteSmoke,
} from './refund-route-smoke.mjs';

const projectRef = 'a'.repeat(20);
assert.equal(
  resolveRefundRouteSmokeBaseUrl({ projectRef, confirmProjectRef: projectRef, baseUrl: '' }),
  `https://${projectRef}.supabase.co/functions/v1`,
);
assert.equal(
  resolveRefundRouteSmokeBaseUrl({ projectRef: '', confirmProjectRef: '', baseUrl: 'http://127.0.0.1:54321/functions/v1/' }),
  'http://127.0.0.1:54321/functions/v1',
);
assert.throws(
  () => resolveRefundRouteSmokeBaseUrl({ projectRef, confirmProjectRef: 'b'.repeat(20), baseUrl: '' }),
  /exactly match/,
);
assert.throws(
  () => resolveRefundRouteSmokeBaseUrl({ projectRef, confirmProjectRef: projectRef, baseUrl: 'https://example.test' }),
  /either/,
);
await assert.rejects(
  () => runRefundRouteSmoke({ baseUrl: 'not-a-url', fetchImpl: async () => new Response(null, { status: 200 }) }),
  /absolute HTTP\(S\) URL/,
);
assert.deepEqual(
  parseRefundRouteSmokeArgs(['--project-ref', projectRef, '--confirm-project-ref', projectRef, '--timeout-ms', '2500']),
  { projectRef, confirmProjectRef: projectRef, baseUrl: '', timeoutMs: 2500 },
);

const requests = [];
const expectedBySlug = new Map(
  refundRouteSmokeExpectations.map(({ slug, expectedStatus }) => [slug, expectedStatus]),
);
const successfulFetch = async (url, options) => {
  requests.push({ url, options });
  const slug = new URL(url).pathname.split('/').pop();
  return new Response(null, { status: expectedBySlug.get(slug) });
};
const success = await runRefundRouteSmoke({
  baseUrl: 'https://synthetic.supabase.test/functions/v1',
  fetchImpl: successfulFetch,
  timeoutMs: 2_500,
});
assert.equal(success.length, 8, 'Every approved Refund Operations function must be probed.');
assert.equal(requests.length, 8);
for (const request of requests) {
  assert.equal(request.options.method, 'OPTIONS', 'Production route smoke must be non-mutating.');
  assert.equal(request.options.body, undefined, 'Production route smoke must send no body.');
  assert.equal(request.options.headers.Authorization, undefined, 'Production route smoke must send no credential.');
}

await assert.rejects(
  () => runRefundRouteSmoke({
    baseUrl: 'https://synthetic.supabase.test/functions/v1',
    fetchImpl: async (url) => {
      const slug = new URL(url).pathname.split('/').pop();
      return new Response(null, {
        status: slug === 'refund-case-message-send' ? 404 : expectedBySlug.get(slug),
      });
    },
    timeoutMs: 2_500,
  }),
  /refund-case-message-send: 404/,
  'A missing manual/retry route must fail visibly.',
);

await assert.rejects(
  () => runRefundRouteSmoke({
    baseUrl: 'https://synthetic.supabase.test/functions/v1',
    fetchImpl: async (url) => {
      const slug = new URL(url).pathname.split('/').pop();
      return new Response(null, {
        status: slug === 'refund-gpt-triage' ? 500 : expectedBySlug.get(slug),
      });
    },
    timeoutMs: 2_500,
  }),
  /refund-gpt-triage: 500/,
  'Unexpected route behavior must not be accepted merely because the route exists.',
);

await assert.rejects(
  () => runRefundRouteSmoke({
    baseUrl: 'https://synthetic.supabase.test/functions/v1',
    fetchImpl: async () => {
      throw new Error('synthetic network failure');
    },
    timeoutMs: 2_500,
  }),
  /network_or_timeout/,
  'Network uncertainty must fail closed without exposing a response body.',
);

console.log('Refund route smoke validation passed: eight no-auth OPTIONS probes, exact safe statuses, and missing/unexpected/network failures are enforced.');
