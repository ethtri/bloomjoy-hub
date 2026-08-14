import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closeRefundPortalPage,
  closeRefundPortalContext,
  navigateRefundPortalPage,
  reloadRefundPortalPage,
  settleRefundPortalPage,
  waitForRefundPortalDemoAccessReads,
  waitForRefundPortalRouteCommitted,
  withRefundPortalContext,
} from './refund-portal-uat-lifecycle.mjs';

const createPage = ({ closed = false, failAt = null, hangAt = null } = {}) => {
  const calls = [];
  let loadStateCall = 0;
  const page = {
    calls,
    isClosed: () => closed,
    waitForLoadState: async (state, options) => {
      loadStateCall += 1;
      calls.push(['load', loadStateCall, state, options]);
      if (failAt === `load-${loadStateCall}`) throw new Error('settle_failed');
    },
    evaluate: async () => {
      calls.push(['fonts']);
      if (failAt === 'fonts') throw new Error('settle_failed');
      if (hangAt === 'fonts') return new Promise(() => {});
    },
    waitForFunction: async (_fn, value, options) => {
      calls.push(['images', value, options]);
      if (failAt === 'images') throw new Error('settle_failed');
    },
    goto: async (url, options) => {
      calls.push(['goto', url, options]);
      return 'navigated';
    },
    reload: async (options) => {
      calls.push(['reload', options]);
      return 'reloaded';
    },
    close: async () => {
      calls.push(['close']);
    },
  };
  return page;
};

const testSettleOptions = {
  waitForRequestDrain: async (page) => page.calls.push(['drain']),
};

test('waits for the initial request lock before checking images, then rechecks requests', async () => {
  const page = createPage();
  const result = await navigateRefundPortalPage(
    page,
    '/next',
    { waitUntil: 'networkidle' },
    testSettleOptions
  );

  assert.equal(result, 'navigated');
  assert.deepEqual(page.calls.map(([kind]) => kind), [
    'load',
    'drain',
    'fonts',
    'images',
    'load',
    'drain',
    'goto',
  ]);
  assert.equal(page.calls[0][2], 'networkidle');
  assert.equal(page.calls[4][2], 'networkidle');
});

test('an initial in-flight request blocks before image evaluation or navigation', async () => {
  const page = createPage({ failAt: 'load-1' });
  await assert.rejects(
    navigateRefundPortalPage(page, '/next', undefined, testSettleOptions),
    /settle_failed/
  );
  assert.deepEqual(page.calls.map(([kind]) => kind), ['load']);
});

test('a never-resolving font readiness promise rejects within the local bound', async () => {
  const page = createPage({ hangAt: 'fonts' });
  const startedAt = Date.now();

  await assert.rejects(
    settleRefundPortalPage(page, { ...testSettleOptions, timeout: 20 }),
    /refund_portal_fonts_timeout/
  );

  assert.ok(Date.now() - startedAt < 500);
  assert.deepEqual(page.calls.map(([kind]) => kind), ['load', 'drain', 'fonts']);
});

test('a thrown font readiness error fails before images and is not suppressed', async () => {
  const page = createPage({ failAt: 'fonts' });
  await assert.rejects(settleRefundPortalPage(page, testSettleOptions), /settle_failed/);
  assert.deepEqual(page.calls.map(([kind]) => kind), ['load', 'drain', 'fonts']);
});

test('reload uses the same fail-closed settle boundary', async () => {
  const page = createPage();
  const result = await reloadRefundPortalPage(
    page,
    { waitUntil: 'domcontentloaded' },
    testSettleOptions
  );

  assert.equal(result, 'reloaded');
  assert.deepEqual(page.calls.map(([kind]) => kind), [
    'load',
    'drain',
    'fonts',
    'images',
    'load',
    'drain',
    'reload',
  ]);
});

test('page close settles before closing', async () => {
  const page = createPage();
  await closeRefundPortalPage(page, testSettleOptions);
  assert.deepEqual(page.calls.map(([kind]) => kind), [
    'load',
    'drain',
    'fonts',
    'images',
    'load',
    'drain',
    'close',
  ]);
});

test('page close remains blocked when font readiness exceeds its bound', async () => {
  const page = createPage({ hangAt: 'fonts' });
  await assert.rejects(
    closeRefundPortalPage(page, { ...testSettleOptions, timeout: 20 }),
    /refund_portal_fonts_timeout/
  );
  assert.equal(page.calls.some(([kind]) => kind === 'close'), false);
});

test('context close settles every open page and skips already closed pages', async () => {
  const first = createPage();
  const second = createPage();
  const closed = createPage({ closed: true });
  const calls = [];
  const context = {
    pages: () => [first, closed, second],
    close: async () => calls.push('close'),
  };

  await closeRefundPortalContext(context, testSettleOptions);

  assert.equal(first.calls.at(-1)[0], 'drain');
  assert.equal(second.calls.at(-1)[0], 'drain');
  assert.deepEqual(closed.calls, []);
  assert.deepEqual(calls, ['close']);
});

test('context close holds a concurrent settle barrier across every open page', async () => {
  const releases = [];
  const calls = [];
  const createBarrierPage = (name) => {
    let loadStateCall = 0;
    return {
      name,
      isClosed: () => false,
      waitForLoadState: async () => {
        loadStateCall += 1;
        calls.push(`${name}:load-${loadStateCall}`);
        if (loadStateCall === 1) {
          await new Promise((resolve) => releases.push(resolve));
        }
      },
      evaluate: async () => calls.push(`${name}:fonts`),
      waitForFunction: async () => calls.push(`${name}:images`),
    };
  };
  const context = {
    pages: () => [createBarrierPage('first'), createBarrierPage('second')],
    close: async () => calls.push('context:close'),
  };
  const concurrentSettleOptions = {
    waitForRequestDrain: async (page) => calls.push(`${page.name}:drain`),
  };

  const closing = closeRefundPortalContext(context, concurrentSettleOptions);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['first:load-1', 'second:load-1']);
  assert.equal(calls.includes('context:close'), false);
  releases.splice(0).forEach((release) => release());
  await closing;

  assert.equal(calls.at(-1), 'context:close');
  assert.ok(calls.indexOf('first:load-2') < calls.indexOf('context:close'));
  assert.ok(calls.indexOf('second:load-2') < calls.indexOf('context:close'));
});

test('isolated context runs close completely before the next context starts', async () => {
  const calls = [];
  const contexts = ['first', 'second'].map((name) => ({
    name,
    pages: () => [],
    close: async () => calls.push(`${name}:close`),
  }));
  let created = 0;
  const createContext = async () => {
    const context = contexts[created];
    created += 1;
    calls.push(`${context.name}:create`);
    return context;
  };

  await withRefundPortalContext(createContext, async (context) => {
    calls.push(`${context.name}:run`);
  });
  await withRefundPortalContext(createContext, async (context) => {
    calls.push(`${context.name}:run`);
  });

  assert.deepEqual(calls, [
    'first:create',
    'first:run',
    'first:close',
    'second:create',
    'second:run',
    'second:close',
  ]);
  assert.notEqual(contexts[0], contexts[1]);
});

const mockRpcResponse = ({ name, status = 200, method = 'POST' }) => ({
  status: () => status,
  request: () => ({
    method: () => method,
    url: () => `http://127.0.0.1:54321/rest/v1/rpc/${name}`,
  }),
});

test('demo access barrier requires both exact successful reads in any order', async () => {
  const seenTimeouts = [];
  const responses = [
    mockRpcResponse({ name: 'get_my_reporting_access_context' }),
    mockRpcResponse({ name: 'get_my_portal_access_context' }),
  ];
  const page = {
    waitForResponse: async (predicate, options) => {
      seenTimeouts.push(options.timeout);
      const response = responses.find((candidate) => predicate(candidate));
      if (!response) throw new Error('missing');
      return response;
    },
  };

  await waitForRefundPortalDemoAccessReads(page, { timeout: 1234 });
  assert.deepEqual(seenTimeouts, [1234, 1234]);
});

test('demo access barrier fails closed on missing, aborted, wrong-path, and non-success reads', async () => {
  const missing = {
    waitForResponse: async (predicate) => {
      const response = mockRpcResponse({ name: 'get_my_portal_access_context' });
      if (predicate(response)) return response;
      throw new Error('timed out');
    },
  };
  await assert.rejects(
    waitForRefundPortalDemoAccessReads(missing, { timeout: 20 }),
    /refund_portal_demo_access_read_barrier_failed/
  );

  const aborted = {
    waitForResponse: async () => {
      throw new Error('request aborted');
    },
  };
  await assert.rejects(
    waitForRefundPortalDemoAccessReads(aborted, { timeout: 20 }),
    /refund_portal_demo_access_read_barrier_failed/
  );

  for (const response of [
    mockRpcResponse({ name: 'get_my_portal_access_context_extra' }),
    mockRpcResponse({ name: 'get_my_portal_access_context', status: 500 }),
    mockRpcResponse({ name: 'get_my_portal_access_context', method: 'GET' }),
  ]) {
    const wrong = {
      waitForResponse: async (predicate) => {
        if (predicate(response)) return response;
        throw new Error('wrong response');
      },
    };
    await assert.rejects(
      waitForRefundPortalDemoAccessReads(wrong, { timeout: 20 }),
      /refund_portal_demo_access_read_barrier_failed/
    );
  }
});

test('route commit barrier requires the exact visible Refund workbench control', async () => {
  const calls = [];
  const page = {
    getByLabel: (label) => {
      calls.push(['label', label]);
      return {
        waitFor: async (options) => calls.push(['wait', options]),
      };
    },
  };
  await waitForRefundPortalRouteCommitted(page, { timeout: 1234 });
  assert.deepEqual(calls, [
    ['label', 'Filter refund cases by status'],
    ['wait', { state: 'visible', timeout: 1234 }],
  ]);

  await assert.rejects(
    waitForRefundPortalRouteCommitted({
      getByLabel: () => ({ waitFor: async () => { throw new Error('missing'); } }),
    }),
    /refund_portal_route_commit_barrier_failed/
  );
});

test('a late request failure blocks navigation instead of being ignored', async () => {
  const page = createPage({ failAt: 'load-2' });
  await assert.rejects(
    navigateRefundPortalPage(page, '/next', undefined, testSettleOptions),
    /settle_failed/
  );
  assert.equal(page.calls.some(([kind]) => kind === 'goto'), false);
});

test('an incomplete image blocks close instead of becoming an allowed abort', async () => {
  const page = createPage({ failAt: 'images' });
  let closed = false;
  const context = {
    pages: () => [page],
    close: async () => { closed = true; },
  };

  await assert.rejects(closeRefundPortalContext(context, testSettleOptions), /settle_failed/);
  assert.equal(closed, false);
});

test('settle timeout is bounded and consistent across both network locks and images', async () => {
  const page = createPage();
  await settleRefundPortalPage(page, { ...testSettleOptions, timeout: 1234 });
  assert.equal(page.calls[0][3].timeout, 1234);
  assert.equal(page.calls[3][2].timeout, 1234);
  assert.equal(page.calls[4][3].timeout, 1234);
});
