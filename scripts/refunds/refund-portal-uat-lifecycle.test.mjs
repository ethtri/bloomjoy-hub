import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closeRefundPortalContext,
  navigateRefundPortalPage,
  reloadRefundPortalPage,
  settleRefundPortalPage,
} from './refund-portal-uat-lifecycle.mjs';

const createPage = ({ closed = false, failAt = null } = {}) => {
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
