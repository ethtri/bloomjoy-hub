const DEFAULT_SETTLE_TIMEOUT_MS = 10_000;

export const settleRefundPortalPage = async (
  page,
  { timeout = DEFAULT_SETTLE_TIMEOUT_MS } = {}
) => {
  await page.waitForLoadState('networkidle', { timeout });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
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

export const closeRefundPortalContext = async (context) => {
  for (const page of context.pages()) {
    if (!page.isClosed()) await settleRefundPortalPage(page);
  }
  await context.close();
};
