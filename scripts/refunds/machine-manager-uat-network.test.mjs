import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeFailedUatRequest,
  describeFailedUatResponse,
  redactUatRequestTarget,
} from './machine-manager-uat-network.mjs';

const APP_URL = 'http://127.0.0.1:8081';

const mockRequest = ({
  url = `${APP_URL}/missing.svg`,
  method = 'GET',
  resourceType = 'image',
  failure = null,
} = {}) => ({
  url: () => url,
  method: () => method,
  resourceType: () => resourceType,
  failure: () => failure,
});

const mockResponse = ({ status = 404, request = mockRequest() } = {}) => ({
  status: () => status,
  url: () => request.url(),
  request: () => request,
});

test('same-origin failures retain only a safe pathname', () => {
  assert.equal(
    redactUatRequestTarget(
      `${APP_URL}/assets/missing.svg?email=person@example.test#private`,
      APP_URL
    ),
    '/assets/[redacted.svg]'
  );
  assert.equal(
    redactUatRequestTarget(`${APP_URL}/cases/123e4567-e89b-12d3-a456-426614174000`, APP_URL),
    '/[redacted]/[redacted]'
  );
  assert.equal(
    redactUatRequestTarget(`${APP_URL}/.well-known/appspecific/com.chrome.devtools.json`, APP_URL),
    '/.well-known/appspecific/com.chrome.devtools.json'
  );
  assert.equal(
    redactUatRequestTarget(`${APP_URL}/src/pages/admin/Machines.tsx?t=secret`, APP_URL),
    '/src/pages/[redacted.tsx]'
  );
});

test('external, short identity-shaped, token-shaped, and invalid targets never leak', () => {
  assert.equal(
    redactUatRequestTarget('https://private-project.example/path?token=secret', APP_URL),
    '[external-origin]/[redacted]'
  );
  assert.equal(
    redactUatRequestTarget(
      'http://127.0.0.1:54321/rest/v1/cases/123e4567-e89b-12d3-a456-426614174000?token=secret',
      APP_URL
    ),
    '[loopback]/rest/v1/[redacted]/[redacted]'
  );
  assert.equal(
    redactUatRequestTarget(`${APP_URL}/invite/person%40example.test`, APP_URL),
    '/[redacted]/[redacted]'
  );
  assert.equal(redactUatRequestTarget(`${APP_URL}/users/alice`, APP_URL), '/[redacted]/[redacted]');
  assert.equal(redactUatRequestTarget(`${APP_URL}/cases/12345`, APP_URL), '/[redacted]/[redacted]');
  assert.equal(redactUatRequestTarget(`${APP_URL}/reset/secret123`, APP_URL), '/[redacted]/[redacted]');
  assert.equal(
    redactUatRequestTarget('https://private-project.example/customer/jane-doe', APP_URL),
    '[external-origin]/[redacted]/[redacted]'
  );
  for (const dynamicValue of ['admin', 'login', 'machines', 'v1']) {
    assert.equal(
      redactUatRequestTarget(`${APP_URL}/users/${dynamicValue}`, APP_URL),
      '/[redacted]/[redacted]'
    );
  }
  assert.equal(redactUatRequestTarget('not a URL secret=unsafe', APP_URL), '[invalid-url]');
});

test('an exact app 404 remains a fail-closed response with useful provenance', () => {
  assert.equal(
    describeFailedUatResponse(mockResponse(), APP_URL),
    'HTTP 404 GET image /[redacted.svg]'
  );
  assert.equal(describeFailedUatResponse(mockResponse({ status: 200 }), APP_URL), null);
});

test('an unrelated 404 and a network failure are never ignored', () => {
  const unrelated = mockRequest({
    url: `${APP_URL}/unexpected.js?credential=secret`,
    resourceType: 'script',
  });
  assert.equal(
    describeFailedUatResponse(mockResponse({ request: unrelated }), APP_URL),
    'HTTP 404 GET script /[redacted.js]'
  );

  const failed = mockRequest({
    url: 'https://private-project.example/rest/v1/secret?token=unsafe',
    method: 'POST',
    resourceType: 'fetch',
    failure: { errorText: 'net::ERR_FAILED secret=unsafe' },
  });
  assert.equal(
    describeFailedUatRequest(failed, APP_URL),
    'NETWORK_FAILED POST fetch [external-origin]/rest/v1/[redacted]'
  );
});
