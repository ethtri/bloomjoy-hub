const DEFAULT_SETTLE_TIMEOUT_MS = 10_000;

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
  { timeout = DEFAULT_SETTLE_TIMEOUT_MS } = {}
) => {
  await page.waitForLoadState('networkidle', { timeout });
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
};

export const navigateRefundPortalPage = async (page, url, options) => {
  await settleRefundPortalPage(page);
  return page.goto(url, options);
};

export const reloadRefundPortalPage = async (page, options) => {
  await settleRefundPortalPage(page);
  return page.reload(options);
};

export const closeRefundPortalPage = async (page, settleOptions) => {
  if (page.isClosed()) return;
  await settleRefundPortalPage(page, settleOptions);
  await page.close();
};

export const closeRefundPortalContext = async (context) => {
  const openPages = context.pages().filter((page) => !page.isClosed());
  await Promise.all(openPages.map((page) => settleRefundPortalPage(page)));
  await context.close();
};
