import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  closeUatSuiteResources,
  createTrackedUatBrowser,
  describeFailedUatRequest,
  describeFailedUatResponse,
  evaluateUatSuiteFailures,
  getUatPageFailures,
  isFixtureOwnedUatRequestFailure,
  redactUatRequestTarget,
} from './refund-browser-uat-network.mjs';

const APP_URL = 'http://127.0.0.1:8081';

const mockRequest = ({
  url = `${APP_URL}/missing.svg`,
  method = 'GET',
  resourceType = 'image',
  failure = null,
  page = null,
} = {}) => ({
  url: () => url,
  method: () => method,
  resourceType: () => resourceType,
  failure: () => failure,
  frame: () => {
    if (!page) throw new Error('No frame for this synthetic request.');
    return { page: () => page };
  },
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
    'NETWORK_FAILED UNKNOWN POST fetch [external-origin]/rest/v1/[redacted]'
  );
  assert.equal(
    describeFailedUatRequest(mockRequest({
      failure: { errorText: 'net::ERR_ABORTED' },
    }), APP_URL),
    'NETWORK_FAILED ERR_ABORTED GET image /[redacted.svg]'
  );
});

const createMockPage = () => new EventEmitter();

const createMockBrowser = () => {
  const contexts = [];
  const browser = {
    get brandedValue() {
      assert.equal(this, browser);
      return 'browser-target';
    },
    identity() {
      return this === browser;
    },
    async newContext() {
      const context = new EventEmitter();
      context.identity = function identity() {
        return this === context;
      };
      Object.defineProperty(context, 'brandedValue', {
        get() {
          assert.equal(this, context);
          return 'context-target';
        },
      });
      context.newPage = async () => {
        const page = createMockPage();
        context.emit('page', page);
        return page;
      };
      context.routes = [];
      context.route = async (pattern, handler) => {
        context.routes.push({ pattern, handler });
      };
      contexts.push(context);
      return context;
    },
  };
  return { browser, contexts };
};

test('tracked browser binds Playwright methods and deduplicates explicit pages', async () => {
  const failures = [];
  const { browser, contexts } = createMockBrowser();
  const trackedBrowser = createTrackedUatBrowser(browser, { appUrl: APP_URL, failures });

  assert.equal(trackedBrowser.identity(), true);
  assert.equal(trackedBrowser.brandedValue, 'browser-target');
  const context = await trackedBrowser.newContext();
  assert.equal(context.identity(), true);
  assert.equal(context.brandedValue, 'context-target');
  const page = await context.newPage();
  contexts[0].emit('response', mockResponse({ request: mockRequest({ page }) }));

  assert.deepEqual(failures, ['HTTP 404 GET image /[redacted.svg]']);
  assert.deepEqual(getUatPageFailures(page, ['console detail']), [
    'HTTP 404 GET image /[redacted.svg]',
    'console detail',
  ]);
  assert.equal(contexts.length, 1);
});

test('a popup response before the page event is still fail-closed', async () => {
  const failures = [];
  const { browser, contexts } = createMockBrowser();
  const trackedBrowser = createTrackedUatBrowser(browser, { appUrl: APP_URL, failures });
  await trackedBrowser.newContext();

  const popup = createMockPage();
  contexts[0].emit('response', mockResponse({
    request: mockRequest({
      url: `${APP_URL}/users/admin?token=private`,
      resourceType: 'fetch',
      page: popup,
    }),
  }));
  contexts[0].emit('page', popup);

  assert.deepEqual(failures, ['HTTP 404 GET fetch /[redacted]/[redacted]']);
  assert.deepEqual(getUatPageFailures(popup), [
    'HTTP 404 GET fetch /[redacted]/[redacted]',
  ]);
});

test('expected predicates are narrow and predicate errors fail closed', async () => {
  const failures = [];
  const { browser, contexts } = createMockBrowser();
  const trackedBrowser = createTrackedUatBrowser(browser, {
    appUrl: APP_URL,
    failures,
    isExpectedResponse: (response) => response.status() === 409,
    isExpectedRequestFailure: () => {
      throw new Error('predicate failure must not suppress evidence');
    },
  });
  const context = await trackedBrowser.newContext();
  const page = await context.newPage();

  contexts[0].emit('response', mockResponse({
    status: 409,
    request: mockRequest({ page }),
  }));
  contexts[0].emit('response', mockResponse({
    status: 404,
    request: mockRequest({ page }),
  }));
  contexts[0].emit('requestfailed', mockRequest({
    url: `${APP_URL}/private/12345`,
    failure: { errorText: 'secret raw failure' },
    page,
  }));

  assert.deepEqual(failures, [
    'HTTP 404 GET image /[redacted.svg]',
    'NETWORK_FAILED UNKNOWN GET image /[redacted]/[redacted]',
  ]);
});

test('a labelled abort is allowed only while its owning context is closing', async () => {
  const failures = [];
  const labelledRequests = new WeakSet();
  const { browser, contexts } = createMockBrowser();
  const trackedBrowser = createTrackedUatBrowser(browser, {
    appUrl: APP_URL,
    failures,
    isExpectedClosingRequestFailure: (request) =>
      labelledRequests.has(request) &&
      request.failure()?.errorText === 'net::ERR_ABORTED' &&
      request.method() === 'POST' &&
      request.resourceType() === 'fetch',
  });
  const context = await trackedBrowser.newContext();
  const page = await context.newPage();
  const openPageAbort = mockRequest({
    url: 'http://127.0.0.1:54321/rest/v1/rpc/read_only_fixture',
    method: 'POST',
    resourceType: 'fetch',
    failure: { errorText: 'net::ERR_ABORTED' },
    page,
  });
  const closingAbort = mockRequest({
    url: 'http://127.0.0.1:54321/rest/v1/rpc/read_only_fixture',
    method: 'POST',
    resourceType: 'fetch',
    failure: { errorText: 'net::ERR_ABORTED' },
    page,
  });
  labelledRequests.add(openPageAbort);
  labelledRequests.add(closingAbort);

  contexts[0].emit('requestfailed', openPageAbort);
  contexts[0].close = async () => {
    contexts[0].emit('requestfailed', closingAbort);
  };
  await context.close();

  assert.deepEqual(failures, [
    'NETWORK_FAILED ERR_ABORTED POST fetch [loopback]/rest/v1/rpc/[redacted]',
  ]);
});

test('a close-time network failure is visible before the suite aggregate is evaluated', async () => {
  const networkFailures = [];
  const closeOrder = [];
  const teardownFailures = await closeUatSuiteResources({
    context: {
      async close() {
        closeOrder.push('context');
        networkFailures.push('NETWORK_FAILED ERR_ABORTED GET script /src/pages/[redacted.tsx]');
      },
    },
    browser: {
      async close() {
        closeOrder.push('browser');
      },
    },
  });
  const result = evaluateUatSuiteFailures({
    networkFailures,
    consoleErrors: [],
    teardownFailures,
    pageFailures: [...networkFailures],
  });

  assert.deepEqual(closeOrder, ['context', 'browser']);
  assert.equal(result.pass, false);
  assert.match(result.detail, /NETWORK_FAILED ERR_ABORTED GET script/);
});

test('context and browser teardown errors are both retained without exposing exceptions', async () => {
  const teardownFailures = await closeUatSuiteResources({
    context: {
      async close() {
        throw new Error('private context detail');
      },
    },
    browser: {
      async close() {
        throw new Error('private browser detail');
      },
    },
  });
  const result = evaluateUatSuiteFailures({
    networkFailures: [],
    consoleErrors: [],
    teardownFailures,
    pageFailures: [],
  });

  assert.deepEqual(teardownFailures, ['CONTEXT_CLOSE_FAILED', 'BROWSER_CLOSE_FAILED']);
  assert.deepEqual(result, {
    pass: false,
    detail: 'CONTEXT_CLOSE_FAILED | BROWSER_CLOSE_FAILED',
  });
});

test('fixture ownership never suppresses a same-shaped unowned or wrong failure', () => {
  const ownedRequests = new WeakSet();
  const expected = mockRequest({
    url: 'http://127.0.0.1:54321/functions/v1/refund-case-intake',
    method: 'POST',
    resourceType: 'fetch',
    failure: { errorText: 'net::ERR_FAILED' },
  });
  const unownedSameShape = mockRequest({
    url: 'http://127.0.0.1:54321/functions/v1/refund-case-intake',
    method: 'POST',
    resourceType: 'fetch',
    failure: { errorText: 'net::ERR_FAILED' },
  });
  const wrongCode = mockRequest({
    url: 'http://127.0.0.1:54321/functions/v1/refund-case-intake',
    method: 'POST',
    resourceType: 'fetch',
    failure: { errorText: 'net::ERR_ABORTED' },
  });
  const wrongType = mockRequest({
    url: 'http://127.0.0.1:54321/functions/v1/refund-case-intake',
    method: 'POST',
    resourceType: 'xhr',
    failure: { errorText: 'net::ERR_FAILED' },
  });
  for (const request of [expected, wrongCode, wrongType]) ownedRequests.add(request);
  const isExpected = (request) => isFixtureOwnedUatRequestFailure(request, {
    ownedRequests,
    failureCode: 'ERR_FAILED',
    method: 'POST',
    resourceType: 'fetch',
    validateRequest: (candidate) => new URL(candidate.url()).pathname ===
      '/functions/v1/refund-case-intake',
  });

  assert.equal(isExpected(expected), true);
  assert.equal(isExpected(unownedSameShape), false);
  assert.equal(isExpected(wrongCode), false);
  assert.equal(isExpected(wrongType), false);
  assert.equal(isFixtureOwnedUatRequestFailure(expected, {
    ownedRequests,
    failureCode: 'ERR_FAILED',
    method: 'POST',
    resourceType: 'fetch',
    validateRequest: () => {
      throw new Error('validator errors must fail closed');
    },
  }), false);
});

test('tracked contexts replace only the exact public Google font stylesheet with empty CSS', async () => {
  const failures = [];
  const { browser, contexts } = createMockBrowser();
  const trackedBrowser = createTrackedUatBrowser(browser, { appUrl: APP_URL, failures });
  await trackedBrowser.newContext();
  assert.equal(contexts[0].routes.length, 1);
  assert.equal(contexts[0].routes[0].pattern, 'https://fonts.googleapis.com/**');

  const exactActions = [];
  await contexts[0].routes[0].handler({
    request: () => mockRequest({
      url: 'https://fonts.googleapis.com/css2?family=Inter',
      method: 'GET',
      resourceType: 'stylesheet',
    }),
    fulfill: async (value) => exactActions.push(['fulfill', value]),
    continue: async () => exactActions.push(['continue']),
  });
  assert.deepEqual(exactActions, [[
    'fulfill',
    {
      status: 200,
      contentType: 'text/css',
      headers: { 'x-bloomjoy-uat-synthetic-resource': 'google-font-css' },
      body: '',
    },
  ]]);

  const unrelatedActions = [];
  await contexts[0].routes[0].handler({
    request: () => mockRequest({
      url: 'https://fonts.googleapis.com/private/alice',
      method: 'GET',
      resourceType: 'stylesheet',
    }),
    fulfill: async () => unrelatedActions.push(['fulfill']),
    continue: async () => unrelatedActions.push(['continue']),
  });
  assert.deepEqual(unrelatedActions, [['continue']]);
});
