import { waitForUatPageRequestDrain } from './refund-browser-uat-network.mjs';

const DEFAULT_SETTLE_TIMEOUT_MS = 10_000;
const DEMO_ACCESS_READ_RPCS = Object.freeze([
  'get_my_portal_access_context',
  'get_my_reporting_access_context',
]);

const awaitWithTimeout = async (promise, timeout, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeout);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const settleRefundPortalPage = async (
  page,
  {
    timeout = DEFAULT_SETTLE_TIMEOUT_MS,
    waitForRequestDrain = waitForUatPageRequestDrain,
  } = {}
) => {
  await page.waitForLoadState('networkidle', { timeout });
  await waitForRequestDrain(page, { timeout });
  await awaitWithTimeout(
    page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    }),
    timeout,
    'refund_portal_fonts'
  );
  await page.waitForFunction(
    () => [...document.images].every((image) => image.complete),
    undefined,
    { timeout }
  );
  await page.waitForLoadState('networkidle', { timeout });
  await waitForRequestDrain(page, { timeout });
};

export const navigateRefundPortalPage = async (page, url, options, settleOptions) => {
  await settleRefundPortalPage(page, settleOptions);
  return page.goto(url, options);
};

export const reloadRefundPortalPage = async (page, options, settleOptions) => {
  await settleRefundPortalPage(page, settleOptions);
  return page.reload(options);
};

export const closeRefundPortalPage = async (page, settleOptions) => {
  if (page.isClosed()) return;
  await settleRefundPortalPage(page, settleOptions);
  await page.close();
};

export const closeRefundPortalContext = async (context, settleOptions) => {
  const openPages = context.pages().filter((page) => !page.isClosed());
  await Promise.all(openPages.map((page) => settleRefundPortalPage(page, settleOptions)));
  await context.close();
};

export const withRefundPortalContext = async (createContext, runInContext) => {
  const context = await createContext();
  try {
    return await runInContext(context);
  } finally {
    await closeRefundPortalContext(context);
  }
};

export const waitForRefundPortalDemoAccessReads = async (
  page,
  { timeout = DEFAULT_SETTLE_TIMEOUT_MS } = {}
) => {
  try {
    await Promise.all(DEMO_ACCESS_READ_RPCS.map((rpcName) =>
      page.waitForResponse((response) => {
        try {
          const request = response.request();
          return (
            response.status() >= 200 &&
            response.status() < 300 &&
            request.method() === 'POST' &&
            new URL(request.url()).pathname === `/rest/v1/rpc/${rpcName}`
          );
        } catch {
          return false;
        }
      }, { timeout })
    ));
  } catch {
    throw new Error('refund_portal_demo_access_read_barrier_failed');
  }
};

export const waitForRefundPortalRouteCommitted = async (
  page,
  { timeout = DEFAULT_SETTLE_TIMEOUT_MS } = {}
) => {
  try {
    await page
      .getByLabel('Refund case views')
      .waitFor({ state: 'visible', timeout });
  } catch {
    throw new Error('refund_portal_route_commit_barrier_failed');
  }
};
