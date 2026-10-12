import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { closeRefundPortalContext, navigateRefundPortalPage } from '../../refund-portal-uat-lifecycle.mjs';

// Uses the existing synthetic API/auth harness. No real provider or customer work.
export const createMobileReviewChecks = ({ fixtures, harness }) => {
  const { buildManagerDraftNavigationOverview, buildEmptyRefundOverview, buildMockGmailDraftCases, buildMockGmailContext } = fixtures;
  const { installMockSupabaseRoutes, signInRefundUser, queueCase } = harness;
  return async ({ browser, appUrl, artifactDir, recorder }) => {
    const capture = async (page, state) => {
      const directory = path.join(artifactDir, state);
      await mkdir(directory, { recursive: true });
      await page.getByText('Signed in. Redirecting...', { exact: true }).waitFor({ state: 'hidden', timeout: 10000 });
      if ((await page.viewportSize()).width >= 1024) await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: path.join(directory, 'refund-portal-uat-mobile.png'), fullPage: false });
    };
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const base = buildManagerDraftNavigationOverview();
    const cases = Array.from({ length: 30 }, (_, index) => ({ ...base.cases[0],
      id: `case-mobile-${index + 1}`, publicReference: `RF-MOBILE-${index + 1}`,
      createdAt: new Date(Date.now() - (index + 1) * 3600000).toISOString(),
    }));
    const functionBodies = [];
    await installMockSupabaseRoutes(context, { refundOverview: () => ({ ...base, cases }), functionBodies });
    const page = await context.newPage();
    await signInRefundUser(page, appUrl);
    await page.getByRole('button', { name: /^Decision needed 30$/ }).click();
    for (const width of [320, 360, 390, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const metrics = await page.getByRole('button', { name: /^Waiting on customer/ }).evaluate(element => ({
        controlHeight: element.getBoundingClientRect().height, contentHeight: element.scrollHeight,
        width: document.documentElement.scrollWidth, viewport: window.innerWidth,
      }));
      recorder.assert(`Queue fits wrapped labels at ${width}px`, metrics.controlHeight >= 44 && metrics.contentHeight <= metrics.controlHeight + 1 && metrics.width <= metrics.viewport + 1, JSON.stringify(metrics));
      await capture(page, `queue-${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const lateRow = page.getByTestId('refund-case-queue-item').filter({ visible: true }).last();
    const lateReference = (await lateRow.innerText()).match(/RF-MOBILE-\d+/)[0];
    await lateRow.scrollIntoViewIfNeeded();
    const returnY = await page.evaluate(() => window.scrollY);
    await lateRow.click();
    await page.getByRole('heading', { name: lateReference, exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Selected refund case');
    recorder.assert('Opened mobile case has one focused task and a concise purchase summary',
      !await page.locator('#refund-queue-panel').isVisible() &&
      !await page.getByRole('button', { name: /^Waiting on customer/ }).isVisible() &&
      await page.getByTestId('refund-purchase-summary').isVisible() &&
      !await page.getByTestId('refund-purchase-comparison').isVisible());
    const actionBox = await page.getByTestId('refund-run-nayax-refund').boundingBox();
    recorder.assert('Ordinary short case decision is visible in the first phone viewport', actionBox && actionBox.y + actionBox.height <= 844, JSON.stringify(actionBox));
    await capture(page, 'case-390-844');
    for (const { width, height } of [{ width: 320, height: 844 }, { width: 768, height: 844 }, { width: 1440, height: 1000 }, { width: 844, height: 390 }]) {
      await page.setViewportSize({ width, height });
      recorder.assert(`Case remains contained at ${width} by ${height}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await capture(page, `case-${width}-${height}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('refund-detail-back-to-queue').click();
    await lateRow.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.activeElement?.hasAttribute('data-refund-case-id'));
    const returnState = await page.evaluate(() => ({ scrollY: window.scrollY, focus: document.activeElement?.dataset.refundCaseId }));
    recorder.assert('Return preserves late row position and focus', Math.abs(returnState.scrollY - returnY) < 3 && !new URL(page.url()).searchParams.has('case'), JSON.stringify({ returnY, ...returnState }));
    await lateRow.click();
    await page.getByTestId('refund-detail-back-to-queue').waitFor({ state: 'visible' });
    recorder.assert('Same case reopens after return', !await page.locator('#refund-queue-panel').isVisible());
    await page.goBack();
    await lateRow.waitFor({ state: 'visible' });
    await page.goForward();
    await page.getByTestId('refund-detail-back-to-queue').waitFor({ state: 'visible' });
    recorder.assert('Native Back and Forward represent queue and the same detail', !await page.locator('#refund-queue-panel').isVisible());
    await page.getByTestId('refund-deny-instead').click();
    await page.getByTestId('refund-card-denial-reason').selectOption({ index: 1 });
    const reason = await page.getByTestId('refund-card-denial-reason').inputValue();
    await page.goBack();
    await lateRow.waitFor({ state: 'visible' });
    await lateRow.click();
    recorder.assert('Same-case reopening preserves the unsaved decision editor', await page.getByTestId('refund-card-denial-reason').inputValue() === reason);
    const link = page.url();
    await navigateRefundPortalPage(page, link, { waitUntil: 'networkidle' });
    await page.getByTestId('refund-detail-back-to-queue').waitFor({ state: 'visible' });
    await page.getByTestId('refund-detail-back-to-queue').click();
    await page.locator('#refund-queue-panel').waitFor({ state: 'visible' });
    recorder.assert('Direct case link returns to its own queue', !new URL(page.url()).searchParams.has('case'));
    recorder.assert('Review navigation never performs a monetary operation', functionBodies.every(entry => entry.functionName !== 'nayax-card-refund' || entry.body?.operation === 'availability'));
    await closeRefundPortalContext(context);

    const draftContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const drafts = buildMockGmailDraftCases();
    drafts.push({ ...drafts[0], id: 'case-mobile-draft-alt', publicReference: 'RF-MOBILE-ALT-DRAFT' });
    await installMockSupabaseRoutes(draftContext, { refundOverview: buildEmptyRefundOverview, gmailDraftCases: drafts, gmailContext: buildMockGmailContext() });
    const draftPage = await draftContext.newPage();
    await signInRefundUser(draftPage, appUrl);
    await draftPage.getByRole('button', { name: /^All active/ }).click();
    await queueCase(draftPage, 'RF-UAT-GMAIL').click();
    await draftPage.getByTestId('refund-gpt-draft-body').fill('Synthetic unsent draft, keep these edits.');
    await draftPage.goBack();
    await queueCase(draftPage, 'RF-UAT-GMAIL').click();
    recorder.assert('Native return and same-case reopening preserve unsent customer text', await draftPage.getByTestId('refund-gpt-draft-body').inputValue() === 'Synthetic unsent draft, keep these edits.');
    await draftPage.goBack();
    await queueCase(draftPage, 'RF-MOBILE-ALT-DRAFT').click();
    await draftPage.getByTestId('refund-unsaved-text-dialog').waitFor({ state: 'visible' });
    await draftPage.getByTestId('refund-unsaved-text-stay').click();
    await queueCase(draftPage, 'RF-UAT-GMAIL').click();
    recorder.assert('Staying keeps the original draft before another case', await draftPage.getByTestId('refund-gpt-draft-body').inputValue() === 'Synthetic unsent draft, keep these edits.');
    await draftPage.goBack();
    await queueCase(draftPage, 'RF-MOBILE-ALT-DRAFT').click();
    await draftPage.getByTestId('refund-unsaved-text-discard').click();
    await draftPage.getByRole('heading', { name: 'RF-MOBILE-ALT-DRAFT', exact: true }).waitFor();
    recorder.assert('Existing discard choice opens the intended other case', !await draftPage.locator('#refund-queue-panel').isVisible());
    await draftPage.setViewportSize({ width: 1440, height: 1000 });
    await queueCase(draftPage, 'RF-UAT-GMAIL').click();
    await queueCase(draftPage, 'RF-MOBILE-ALT-DRAFT').click();
    await draftPage.getByTestId('refund-gpt-draft-body').fill('Synthetic draft protected during native Back.');
    await draftPage.goBack();
    await draftPage.getByTestId('refund-unsaved-text-dialog').waitFor({ state: 'visible' });
    await draftPage.getByTestId('refund-unsaved-text-stay').click();
    recorder.assert('Native Back to a different case retains the existing draft safeguard',
      await draftPage.getByTestId('refund-gpt-draft-body').inputValue() === 'Synthetic draft protected during native Back.' &&
      new URL(draftPage.url()).searchParams.get('case') === 'case-mobile-draft-alt');
    await closeRefundPortalContext(draftContext);

    const pendingContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pendingCase = base.cases[0];
    const projection = { schemaVersion: 'refund_portal_queue_v1', observedAt: new Date().toISOString(),
      counts: { allOpen: 1, decisions: 1, waitingOnCustomer: 0, completed: 0, internalTest: 0 },
      items: [{ caseId: pendingCase.id, publicReference: pendingCase.publicReference, accountId: pendingCase.accountId,
        amountCents: pendingCase.paymentAmountCents, currencyCode: 'USD', machineLabel: pendingCase.machineLabel,
        locationName: pendingCase.locationName, createdAt: pendingCase.createdAt, view: 'decisions', isOpen: true,
        decisionReady: true, nextWorkActor: 'manager', nextWorkActionCode: 'approve_card_refund',
        nextWorkActionLabel: 'Review this refund', payloadRedacted: true }], refundOperationsAccess: false, payloadRedacted: true };
    await installMockSupabaseRoutes(pendingContext, { refundOverview: () => ({ ...base, cases: [pendingCase] }), refundPortalQueueProjection: projection });
    let resumeOverview;
    const overviewGate = new Promise(resolve => { resumeOverview = resolve; });
    await pendingContext.route('**/rpc/admin_get_refund_operations_overview', async route => { await overviewGate; await route.fallback(); });
    const pendingPage = await pendingContext.newPage();
    await signInRefundUser(pendingPage, appUrl);
    await queueCase(pendingPage, pendingCase.publicReference).click();
    await pendingPage.getByTestId('refund-detail-back-to-queue').waitFor({ state: 'visible' });
    recorder.assert('Loading detail has an in-screen return path', await pendingPage.getByText('Loading the current case details and available actions…').isVisible());
    await pendingPage.getByTestId('refund-detail-back-to-queue').click();
    await pendingPage.locator('#refund-queue-panel').waitFor({ state: 'visible' });
    resumeOverview();
    await pendingPage.waitForResponse(response => response.url().endsWith('/rpc/admin_get_refund_operations_overview'));
    await pendingPage.waitForTimeout(100);
    recorder.assert('Late detail hydration preserves the returned queue', await pendingPage.locator('#refund-queue-panel').isVisible() && !new URL(pendingPage.url()).searchParams.has('case'));
    await closeRefundPortalContext(pendingContext);
  };
};
