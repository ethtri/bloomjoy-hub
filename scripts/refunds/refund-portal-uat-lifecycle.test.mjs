import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closeRefundPortalPage,
  closeRefundPortalContext,
  navigateRefundPortalPage,
  reloadRefundPortalPage,
  settleRefundPortalPage,
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

test('waits for the initial request lock before checking images, then rechecks requests', async () => {
  const page = createPage();
  const result = await navigateRefundPortalPage(page, '/next', { waitUntil: 'networkidle' });

  assert.equal(result, 'navigated');
  assert.deepEqual(page.calls.map(([kind]) => kind), [
    'load',
    'fonts',
    'images',
    'load',
    'goto',
  ]);
  assert.equal(page.calls[0][2], 'networkidle');
  assert.equal(page.calls[3][2], 'networkidle');
});

test('an initial in-flight request blocks before image evaluation or navigation', async () => {
  const page = createPage({ failAt: 'load-1' });
  await assert.rejects(
    navigateRefundPortalPage(page, '/next'),
    /settle_failed/
  );
  assert.deepEqual(page.calls.map(([kind]) => kind), ['load']);
});

test('a never-resolving font readiness promise rejects within the local bound', async () => {
  const page = createPage({ hangAt: 'fonts' });
  const startedAt = Date.now();

  await assert.rejects(
    settleRefundPortalPage(page, { timeout: 20 }),
    /refund_portal_fonts_timeout/
  );

  assert.ok(Date.now() - startedAt < 500);
  assert.deepEqual(page.calls.map(([kind]) => kind), ['load', 'fonts']);
});

test('a thrown font readiness error fails before images and is not suppressed', async () => {
  const page = createPage({ failAt: 'fonts' });
  await assert.rejects(settleRefundPortalPage(page), /settle_failed/);
  assert.deepEqual(page.calls.map(([kind]) => kind), ['load', 'fonts']);
});

test('reload uses the same fail-closed settle boundary', async () => {
  const page = createPage();
  const result = await reloadRefundPortalPage(page, { waitUntil: 'domcontentloaded' });

  assert.equal(result, 'reloaded');
  assert.deepEqual(page.calls.map(([kind]) => kind), [
    'load',
    'fonts',
    'images',
    'load',
    'reload',
  ]);
});

test('page close settles before closing', async () => {
  const page = createPage();
  await closeRefundPortalPage(page);
  assert.deepEqual(page.calls.map(([kind]) => kind), [
    'load',
    'fonts',
    'images',
    'load',
    'close',
  ]);
});

test('page close remains blocked when font readiness exceeds its bound', async () => {
  const page = createPage({ hangAt: 'fonts' });
  await assert.rejects(
    closeRefundPortalPage(page, { timeout: 20 }),
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

  await closeRefundPortalContext(context);

  assert.equal(first.calls.at(-1)[0], 'load');
  assert.equal(second.calls.at(-1)[0], 'load');
  assert.deepEqual(closed.calls, []);
  assert.deepEqual(calls, ['close']);
});

test('context close holds a concurrent settle barrier across every open page', async () => {
  const releases = [];
  const calls = [];
  const createBarrierPage = (name) => {
    let loadStateCall = 0;
    return {
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

  const closing = closeRefundPortalContext(context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['first:load-1', 'second:load-1']);
  assert.equal(calls.includes('context:close'), false);
  releases.splice(0).forEach((release) => release());
  await closing;

  assert.equal(calls.at(-1), 'context:close');
  assert.ok(calls.indexOf('first:load-2') < calls.indexOf('context:close'));
  assert.ok(calls.indexOf('second:load-2') < calls.indexOf('context:close'));
});

test('a late request failure blocks navigation instead of being ignored', async () => {
  const page = createPage({ failAt: 'load-2' });
  await assert.rejects(
    navigateRefundPortalPage(page, '/next'),
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

  await assert.rejects(closeRefundPortalContext(context), /settle_failed/);
  assert.equal(closed, false);
});

test('settle timeout is bounded and consistent across both network locks and images', async () => {
  const page = createPage();
  await settleRefundPortalPage(page, { timeout: 1234 });
  assert.equal(page.calls[0][3].timeout, 1234);
  assert.equal(page.calls[2][2].timeout, 1234);
  assert.equal(page.calls[3][3].timeout, 1234);
});
